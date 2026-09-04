import {describe,expect,it} from "./runner";
import {REPO_TOOL_NAMES,verifyRepoContract} from "@/repo/contract";
import {registerRepoWebMcpTools} from "@/repo/webmcp";
import {initialRepoState,type RepoRuntime} from "@/repo/state";
import type {RepoAppState} from "@/repo/types";

type Registered={name:string;title?:string;description?:string;inputSchema?:unknown;execute:(input:Record<string,unknown>)=>unknown};

/** Registers Repo's real tools against a fake ModelContext, so the contract test sees what Chrome would. */
async function registeredRepoTools(){
  let state:RepoAppState=initialRepoState();
  const runtime:RepoRuntime={getState:()=>state,commit:next=>{state=next}};
  const tools:Registered[]=[];
  const modelContext={registerTool:async(tool:Registered)=>{tools.push(tool)}};
  Object.defineProperty(globalThis,"window",{value:globalThis,configurable:true});
  Object.defineProperty(globalThis,"document",{value:{modelContext},configurable:true});
  Object.defineProperty(globalThis,"navigator",{value:{},configurable:true});
  const cleanup=registerRepoWebMcpTools(runtime);
  await new Promise(resolve=>setTimeout(resolve,0));
  cleanup();
  return {tools,runtime,get state(){return state}};
}

const record=(value:unknown)=>value as Record<string,unknown>;

describe("Repo WebMCP contract",()=>{
  it("registers exactly the five expected tools with titles, descriptions and schemas",async()=>{
    const {tools}=await registeredRepoTools();
    const report=verifyRepoContract(tools);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.count).toBe(5);
    expect(tools.map(tool=>tool.name).sort()).toEqual([...REPO_TOOL_NAMES].sort());
  });

  it("accepts schemas serialized as JSON strings, as Chrome returns them",async()=>{
    const {tools}=await registeredRepoTools();
    const serialized=tools.map(tool=>({...tool,inputSchema:JSON.stringify(tool.inputSchema)}));
    expect(verifyRepoContract(serialized).ok).toBe(true);
  });

  it("rejects a drifted contract",()=>{
    const base=REPO_TOOL_NAMES.map(name=>({name,title:"Title",description:"A sufficiently long description.",inputSchema:{type:"object",properties:Object.fromEntries((name==="create_repository"?["name"]:name==="configure_repository"?["repositoryId","configuration"]:name==="set_environment"?["repositoryId","environment"]:["repositoryId"]).map(key=>[key,{type:"string"}])),required:name==="create_repository"?["name"]:name==="configure_repository"?["repositoryId","configuration"]:name==="set_environment"?["repositoryId","environment"]:["repositoryId"],additionalProperties:false}}));
    expect(verifyRepoContract(base).ok).toBe(true);
    expect(verifyRepoContract(base.slice(1)).ok).toBe(false);
    expect(verifyRepoContract([...base,{name:"extra_tool",title:"x",description:"another description here",inputSchema:{type:"object",properties:{},required:[],additionalProperties:false}}]).issues.some(issue=>issue.problem.includes("unexpected tool"))).toBe(true);
    expect(verifyRepoContract(base.map(tool=>({...tool,title:""}))).issues.some(issue=>issue.problem==="missing title")).toBe(true);
    expect(verifyRepoContract(base.map(tool=>({...tool,inputSchema:{...tool.inputSchema,additionalProperties:true}}))).issues.some(issue=>issue.problem.includes("additionalProperties"))).toBe(true);
  });
});

describe("Repo tool handlers operate real state",()=>{
  it("runs the full sequence through the registered handlers",async()=>{
    const harness=await registeredRepoTools();
    const call=async(name:string,input:Record<string,unknown>)=>{
      const tool=harness.tools.find(item=>item.name===name);
      if(!tool)throw new Error(`${name} is not registered`);
      return record(JSON.parse(JSON.stringify(await tool.execute(input))));
    };
    const created=await call("create_repository",{name:"Agent Service"});
    expect(created.created).toBe(true);
    const repositoryId=String(record(created.repository).id);
    expect(await call("configure_repository",{repositoryId,configuration:{runtime:"node",packageManager:"npm",testCommand:"npm test"}}).then(r=>r.configured)).toBe(true);
    expect(await call("set_environment",{repositoryId,environment:"development"}).then(r=>r.set)).toBe(true);
    const validation=await call("validate_repository",{repositoryId});
    expect(validation.valid).toBe(true);
    const read=await call("get_repository",{repositoryId});
    expect(record(read.repository).environment).toBe("development");
    expect(harness.state.repositories[0].environment).toBe("development");
    expect(harness.state.activities[0].source).toBe("agent");
  });

  it("refuses a production environment through the registered tool",async()=>{
    const harness=await registeredRepoTools();
    const create=harness.tools.find(tool=>tool.name==="create_repository")!;
    const setEnv=harness.tools.find(tool=>tool.name==="set_environment")!;
    await create.execute({name:"Agent Service"});
    const result=record(await setEnv.execute({repositoryId:"repo_agent-service",environment:"production"}));
    expect(result.set).toBe(false);
    expect(harness.state.repositories[0].environment).toBeNull();
  });

  it("coerces malformed input instead of throwing",async()=>{
    const harness=await registeredRepoTools();
    const create=harness.tools.find(tool=>tool.name==="create_repository")!;
    const configure=harness.tools.find(tool=>tool.name==="configure_repository")!;
    expect(record(await create.execute({name:42})).created).toBe(false);
    expect(record(await configure.execute({repositoryId:null,configuration:"nope"})).configured).toBe(false);
    expect(harness.state.repositories).toHaveLength(0);
  });
});
