import {describe,expect,it} from "./runner";
import {EXPECTED_TOOL_NAMES,verifyWebMcpContract} from "@/lib/webmcp-contract";
import {registerForgeWebMcpTools} from "@/lib/webmcp";
import {createTestRuntime} from "./helpers";

type Registered={name:string;title?:string;description?:string;inputSchema?:unknown;execute:(input:Record<string,unknown>)=>unknown};

/** Registers the real tools against a fake ModelContext, so the contract test sees exactly what Chrome would. */
async function registeredTools(){
  const harness=createTestRuntime();const {runtime}=harness;
  const tools:Registered[]=[];
  const modelContext={registerTool:async(tool:Registered)=>{tools.push(tool)}};
  const original=Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{value:globalThis,configurable:true});
  Object.defineProperty(globalThis,"document",{value:{modelContext},configurable:true});
  Object.defineProperty(globalThis,"navigator",{value:{},configurable:true});
  const cleanup=registerForgeWebMcpTools(runtime);
  await new Promise(resolve=>setTimeout(resolve,0));
  cleanup();
  if(original)Object.defineProperty(globalThis,"window",original);
  return {tools,harness,runtime};
}

describe("WebMCP contract",()=>{
  it("registers exactly the ten expected tools with titles, descriptions and schemas",async()=>{
    const {tools}=await registeredTools();
    const report=verifyWebMcpContract(tools);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.count).toBe(10);
    expect(tools.map(tool=>tool.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("rejects a drifted contract",()=>{
    const base=EXPECTED_TOOL_NAMES.map(name=>({name,title:"Title",description:"A sufficiently long description.",inputSchema:name==="get_platform_overview"?undefined:{type:"object",properties:{},required:[],additionalProperties:false}}));
    expect(verifyWebMcpContract(base.slice(1)).ok).toBe(false);
    expect(verifyWebMcpContract([...base,{name:"extra_tool",title:"x",description:"another description here",inputSchema:undefined}]).issues.some(issue=>issue.problem.includes("unexpected tool"))).toBe(true);
    expect(verifyWebMcpContract(base.map(tool=>({...tool,title:""}))).issues.some(issue=>issue.problem==="missing title")).toBe(true);
    expect(verifyWebMcpContract(base.map(tool=>({...tool,description:"short"}))).issues.some(issue=>issue.problem.includes("description"))).toBe(true);
  });

  it("accepts schemas serialized as JSON strings, as Chrome returns them",async()=>{
    const {tools}=await registeredTools();
    const serialized=tools.map(tool=>({...tool,inputSchema:tool.inputSchema?JSON.stringify(tool.inputSchema):undefined}));
    expect(verifyWebMcpContract(serialized).ok).toBe(true);
  });
});

describe("agent-visible state sanitization",()=>{
  it("never exposes agentEvents, agentPlan or activity attribution through get_platform_overview",async()=>{
    const {tools,runtime}=await registeredTools();
    const overview=tools.find(tool=>tool.name==="get_platform_overview")!;
    const result=await overview.execute({}) as {runtimeState:Record<string,unknown>};
    const runtimeState=result.runtimeState;
    expect(runtimeState).toBeDefined();
    expect("agentEvents" in runtimeState).toBe(false);
    expect("agentPlan" in runtimeState).toBe(false);
    const activities=runtimeState.activities as Record<string,unknown>[];
    for(const activity of activities)expect(Object.keys(activity).sort()).toEqual(["id","kind","message","timestamp"]);
    expect(Object.keys(runtimeState).sort()).toEqual(["activities","approvedDeployments","configurations","deployments","goal","pendingAction","projects","recommendation","selectedProjectId","validationResults","why"]);
    expect(JSON.stringify(result)).not.toContain("agentPlan");
    expect(runtime.getState().agentPlan).toBeDefined();
  });

  it("keeps recording telemetry internally while hiding it from the agent",async()=>{
    const {tools,runtime}=await registeredTools();
    const search=tools.find(tool=>tool.name==="search_services")!;
    await search.execute({query:"inference"});
    expect(runtime.getState().agentEvents[0]).toMatchObject({toolName:"search_services",status:"success",decision:"auto"});
    const overview=tools.find(tool=>tool.name==="get_platform_overview")!;
    const result=JSON.stringify(await overview.execute({}));
    expect(result).not.toContain("agentEvents");
    expect(result).not.toContain('"source"');
  });
});
