import type {RepoActivity,RepoAppState,RepoConfiguration,RepoValidation,Repository} from "@/repo/types";

export type RepoRuntime={getState:()=>RepoAppState;commit:(state:RepoAppState)=>void};

/** Repo starts empty on purpose: the demo is creation from scratch, and no production entity exists to mutate. */
export function initialRepoState():RepoAppState{return {repositories:[],selectedRepositoryId:null,validations:{},activities:[]}}

let agentDepth=0;
/** Marks activity written while a WebMCP invocation is running as agent-originated. */
export function runAsRepoAgent<T>(fn:()=>T):T{agentDepth+=1;try{return fn()}finally{agentDepth-=1}}

const stamp=(kind:RepoActivity["kind"],message:string):RepoActivity=>({id:`repo_activity_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,kind,message,timestamp:"Just now",source:agentDepth>0?"agent":"human"});
const update=(runtime:RepoRuntime,fn:(state:RepoAppState)=>RepoAppState)=>{const next=fn(runtime.getState());runtime.commit(next);return next};
const find=(runtime:RepoRuntime,repositoryId:string)=>runtime.getState().repositories.find(repository=>repository.id===repositoryId);
const slug=(name:string)=>name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

export function createRepository(runtime:RepoRuntime,name:string){
  const trimmed=name.trim();
  if(!trimmed)return {created:false,error:"A repository name is required."};
  const id=`repo_${slug(trimmed)||"new"}`;
  const existing=find(runtime,id);
  if(existing)return {created:false,error:"A repository with this name already exists.",repository:existing};
  const repository:Repository={id,name:trimmed,environment:null,configuration:{},createdAt:"Just now",updatedAt:"Just now"};
  update(runtime,state=>({...state,repositories:[...state.repositories,repository],selectedRepositoryId:id,activities:[stamp("repository",`Created repository ${repository.name}.`),...state.activities]}));
  return {created:true,repository};
}

export function getRepository(runtime:RepoRuntime,repositoryId:string){
  const repository=find(runtime,repositoryId);
  if(!repository)return {found:false,error:"Unknown repository id.",availableRepositoryIds:runtime.getState().repositories.map(item=>item.id)};
  return {found:true,repository,validation:runtime.getState().validations[repositoryId]??null};
}

export function configureRepository(runtime:RepoRuntime,repositoryId:string,configuration:RepoConfiguration){
  const repository=find(runtime,repositoryId);
  if(!repository)return {configured:false,error:"Unknown repository id."};
  const merged:RepoConfiguration={...repository.configuration,...configuration};
  update(runtime,state=>({...state,repositories:state.repositories.map(item=>item.id===repositoryId?{...item,configuration:merged,updatedAt:"Just now"}:item),selectedRepositoryId:repositoryId,activities:[stamp("configuration",`Configured ${repository.name}.`),...state.activities]}));
  return {configured:true,repositoryId,configuration:merged};
}

/** Repo is development-only by construction: any other environment is refused rather than created. */
export function setEnvironment(runtime:RepoRuntime,repositoryId:string,environment:string){
  const repository=find(runtime,repositoryId);
  if(!repository)return {set:false,error:"Unknown repository id."};
  if(environment!=="development")return {set:false,error:"Repo only manages development environments.",allowedEnvironments:["development"]};
  update(runtime,state=>({...state,repositories:state.repositories.map(item=>item.id===repositoryId?{...item,environment:"development" as const,updatedAt:"Just now"}:item),selectedRepositoryId:repositoryId,activities:[stamp("environment",`Set ${repository.name} to the development environment.`),...state.activities]}));
  return {set:true,repositoryId,environment:"development"};
}

export function validateRepository(runtime:RepoRuntime,repositoryId:string){
  const repository=find(runtime,repositoryId);
  if(!repository)return {valid:false,errors:["Unknown repository id."],warnings:[],repositoryId};
  const errors:string[]=[];const warnings:string[]=[];
  if(repository.environment!=="development")errors.push("Environment must be set to development before the repository can be used.");
  if(typeof repository.configuration.runtime!=="string"||!repository.configuration.runtime)errors.push("A runtime must be configured, for example node or python.");
  if(typeof repository.configuration.packageManager!=="string"||!repository.configuration.packageManager)warnings.push("No package manager configured; npm will be assumed.");
  if(typeof repository.configuration.testCommand!=="string"||!repository.configuration.testCommand)warnings.push("No test command configured; the repository has no verification step.");
  const valid=errors.length===0;
  const validation:RepoValidation={repositoryId,valid,errors,warnings,validatedAt:"Just now"};
  update(runtime,state=>({...state,validations:{...state.validations,[repositoryId]:validation},selectedRepositoryId:repositoryId,activities:[stamp("validation",valid?`${repository.name} is valid.`:`${repository.name} needs attention.`),...state.activities]}));
  return validation;
}

/** Development-only demo reset. */
export function resetRepoDemoState(runtime:RepoRuntime){if(process.env.NODE_ENV!=="development")return runtime.getState();const fresh=initialRepoState();runtime.commit(fresh);return fresh}
