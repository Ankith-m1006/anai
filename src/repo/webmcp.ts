import {configureRepository,createRepository,getRepository,runAsRepoAgent,setEnvironment,validateRepository,type RepoRuntime} from "@/repo/state";
import type {RepoConfiguration} from "@/repo/types";

type Schema={type:"object";properties?:Record<string,unknown>;required?:string[];additionalProperties?:boolean};
type Tool={name:string;title:string;description:string;inputSchema:Schema;execute:(input:Record<string,unknown>)=>unknown|Promise<unknown>};
type Context={registerTool:(tool:Tool,options?:{signal?:AbortSignal})=>Promise<void>;getTools?:()=>Promise<Array<{name:string}>>};
type Nav=Navigator&{modelContext?:Context};
type Doc=Document&{modelContext?:Context};

function context():Context|undefined{if(typeof window==="undefined")return undefined;return (document as Doc).modelContext??(navigator as Nav).modelContext}
export function supportsRepoWebMcp(){return typeof context()?.registerTool==="function"}
const devLog=(message:string,data?:unknown)=>{if(process.env.NODE_ENV==="development")console.info(`[Repo WebMCP] ${message}`,data??"")};

const asString=(value:unknown)=>typeof value==="string"?value:"";
const asConfiguration=(value:unknown):RepoConfiguration=>value&&typeof value==="object"&&!Array.isArray(value)?value as RepoConfiguration:{};

/** Registers Repo's five tools on the browser's WebMCP model context. Repo has its own registry; it never touches another application's tools. */
export function registerRepoWebMcpTools(runtime:RepoRuntime){
  const mc=context();
  if(!mc){devLog("WebMCP is unavailable; no tools registered.");return ()=>undefined}
  const controller=new AbortController();
  const tools:Tool[]=[
    {name:"create_repository",title:"Create repository",description:"Create a new development repository in Repo. This is a reversible, no-cost action.",
     inputSchema:{type:"object",properties:{name:{type:"string",description:"Name for the new development repository."}},required:["name"],additionalProperties:false},
     execute:input=>createRepository(runtime,asString(input.name))},
    {name:"get_repository",title:"Get repository",description:"Read the current state of one repository, including its configuration, environment, and latest validation.",
     inputSchema:{type:"object",properties:{repositoryId:{type:"string",description:"Existing repository id."}},required:["repositoryId"],additionalProperties:false},
     execute:input=>getRepository(runtime,asString(input.repositoryId))},
    {name:"configure_repository",title:"Configure repository",description:"Apply configuration to an existing repository, such as its runtime, package manager, and test command.",
     inputSchema:{type:"object",properties:{repositoryId:{type:"string",description:"Existing repository id."},configuration:{type:"object",description:"Repository configuration."}},required:["repositoryId","configuration"],additionalProperties:false},
     execute:input=>configureRepository(runtime,asString(input.repositoryId),asConfiguration(input.configuration))},
    {name:"set_environment",title:"Set environment",description:"Set a repository's environment. Repo manages development environments only and refuses any other value.",
     inputSchema:{type:"object",properties:{repositoryId:{type:"string",description:"Existing repository id."},environment:{type:"string",enum:["development"]}},required:["repositoryId","environment"],additionalProperties:false},
     execute:input=>setEnvironment(runtime,asString(input.repositoryId),asString(input.environment))},
    {name:"validate_repository",title:"Validate repository",description:"Validate a repository's real configuration and environment, returning structured errors and warnings.",
     inputSchema:{type:"object",properties:{repositoryId:{type:"string",description:"Existing repository id."}},required:["repositoryId"],additionalProperties:false},
     execute:input=>validateRepository(runtime,asString(input.repositoryId))},
  ];
  const instrumented=tools.map(tool=>({...tool,execute:async(input:Record<string,unknown>)=>runAsRepoAgent(()=>tool.execute(input))}));
  void Promise.all(instrumented.map(tool=>mc.registerTool(tool,{signal:controller.signal})
    .then(()=>devLog(`Registered ${tool.name}.`))
    .catch(error=>console.warn(`[Repo WebMCP] Registration failed for ${tool.name}.`,error))));
  return ()=>controller.abort();
}

/** Discovery helper used by the development-only contract checker. */
export async function discoverRepoWebMcpTools(){
  const mc=context();
  if(!mc?.getTools)return {names:[],error:"WebMCP discovery API unavailable: document.modelContext.getTools is not a function."};
  try{const tools=await mc.getTools();return {names:tools.map(tool=>tool.name),count:tools.length}}
  catch(error){return {names:[],error:error instanceof Error?error.message:String(error)}}
}
