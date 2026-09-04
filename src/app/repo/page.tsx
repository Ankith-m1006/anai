"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import "./repo.css";
import {initialRepoState,resetRepoDemoState,type RepoRuntime} from "@/repo/state";
import {registerRepoWebMcpTools,supportsRepoWebMcp} from "@/repo/webmcp";
import {verifyRepoContract} from "@/repo/contract";
import {REPO_TOOL_NAMES} from "@/repo/contract";

export default function RepoPage(){
  const [state,setState]=useState(initialRepoState);
  const [available,setAvailable]=useState(false);
  const ref=useRef(state);ref.current=state;
  const runtime=useMemo<RepoRuntime>(()=>({getState:()=>ref.current,commit:next=>{ref.current=next;setState(next)}}),[]);
  useEffect(()=>{setAvailable(supportsRepoWebMcp());const cleanup=registerRepoWebMcpTools(runtime);return ()=>{cleanup()}},[runtime]);
  useEffect(()=>{
    if(process.env.NODE_ENV!=="development")return;
    const dev=window as unknown as Record<string,unknown>;
    dev.__repoCheckWebMcpContract=async()=>{
      const mc=(document as unknown as {modelContext?:{getTools?:()=>Promise<unknown[]>}}).modelContext;
      if(!mc?.getTools)return {ok:false,count:0,issues:[{tool:"<registry>",problem:"WebMCP is unavailable in this browser."}]};
      return verifyRepoContract(await mc.getTools() as Parameters<typeof verifyRepoContract>[0]);
    };
    dev.__repoResetDemo=()=>{resetRepoDemoState(runtime);return "Repo demo state reset."};
    return ()=>{delete dev.__repoCheckWebMcpContract;delete dev.__repoResetDemo};
  },[runtime]);

  const selected=state.repositories.find(repository=>repository.id===state.selectedRepositoryId)??null;
  const validation=selected?state.validations[selected.id]:undefined;
  const configurationEntries=selected?Object.entries(selected.configuration):[];

  return <main className="repo-shell">
    <header className="repo-header">
      <div className="repo-brand"><i>R</i><span><b>Repo</b><small>Development repositories, operable by agents</small></span></div>
      <div className="repo-mcp"><b>WebMCP</b><span><i className={available?"yes":"no"}/>{available?"Connected":"Browser support unavailable"}</span></div>
    </header>

    <section className="repo-panel repo-intro">
      <p>REPO EXPOSES {REPO_TOOL_NAMES.length} CAPABILITIES</p>
      <div className="repo-tools">{REPO_TOOL_NAMES.map(name=><span key={name}>{name}</span>)}</div>
      <small>Repo manages development repositories only. It has no production environment and no deployment capability.</small>
    </section>

    <div className="repo-columns">
      <section className="repo-panel">
        <div className="repo-panel-head"><h2>Repositories</h2><small>{state.repositories.length===0?"None yet":`${state.repositories.length} repository(ies)`}</small></div>
        {state.repositories.length===0
          ? <p className="repo-empty">No repositories yet. An agent can create one through the <code>create_repository</code> tool.</p>
          : <div className="repo-list">{state.repositories.map(repository=>
              <div key={repository.id} className={repository.id===state.selectedRepositoryId?"repo-item selected":"repo-item"}>
                <span><b>{repository.name}</b><small>{repository.id}</small></span>
                <em className={repository.environment?"env-set":""}>{repository.environment??"no environment"}</em>
              </div>)}
            </div>}
      </section>

      <section className="repo-panel">
        <div className="repo-panel-head"><h2>Repository details</h2><small>{selected?selected.name:"Nothing selected"}</small></div>
        {selected
          ? <div className="repo-detail">
              <div className="repo-facts">
                <span><small>ID</small><b>{selected.id}</b></span>
                <span><small>ENVIRONMENT</small><b>{selected.environment??"Not set"}</b></span>
                <span><small>UPDATED</small><b>{selected.updatedAt}</b></span>
              </div>
              <div className="repo-config">
                <small>CONFIGURATION</small>
                {configurationEntries.length===0
                  ? <p className="repo-empty">Not configured yet.</p>
                  : <ul>{configurationEntries.map(([key,value])=><li key={key}><b>{key}</b><span>{typeof value==="string"?value:JSON.stringify(value)}</span></li>)}</ul>}
              </div>
              <div className="repo-validation">
                <small>VALIDATION</small>
                {validation
                  ? <div className={validation.valid?"repo-valid ok":"repo-valid bad"}>
                      <b>{validation.valid?"Valid":"Not valid"}</b>
                      {validation.errors.map(error=><p key={error} className="repo-error">{error}</p>)}
                      {validation.warnings.map(warning=><p key={warning} className="repo-warning">{warning}</p>)}
                      {validation.valid&&validation.warnings.length===0&&<p>No issues detected.</p>}
                    </div>
                  : <p className="repo-empty">Not validated yet.</p>}
              </div>
            </div>
          : <p className="repo-empty">Repository details appear here once a repository exists.</p>}
      </section>
    </div>

    <section className="repo-panel">
      <div className="repo-panel-head"><h2>Recent activity</h2><small>Every entry comes from a real state change</small></div>
      {state.activities.length===0
        ? <p className="repo-empty">Nothing has happened yet.</p>
        : <div className="repo-activity">{state.activities.slice(0,6).map(activity=>
            <div key={activity.id} className={activity.source==="agent"?"by-agent":""}>
              <i>{activity.source==="agent"?"A":"You"}</i>
              <span>{activity.message}<small>{activity.source==="agent"?"Agent via WebMCP":"You"} · {activity.timestamp}</small></span>
            </div>)}
          </div>}
    </section>
  </main>;
}
