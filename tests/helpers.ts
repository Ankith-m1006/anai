import {initialForgeState,type ForgeRuntime} from "@/lib/forge-state";
import type {ForgeAppState} from "@/types/forge";

/** Mirrors the ForgeRuntime the page builds: a ref-like read plus a commit. */
export function createTestRuntime(){
  let state:ForgeAppState=initialForgeState();
  const runtime:ForgeRuntime={getState:()=>state,commit:next=>{state=next}};
  return {runtime,get state(){return state}};
}

export const PRODUCTION_DEPLOYMENT_IDS=["dep_01","dep_02","dep_03"];

export function productionSnapshot(state:ForgeAppState){
  return JSON.stringify({
    projects:state.projects.filter(project=>project.environment==="Production"),
    deployments:state.deployments.filter(deployment=>PRODUCTION_DEPLOYMENT_IDS.includes(deployment.id)),
  });
}
