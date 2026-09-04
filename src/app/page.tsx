"use client";
import {motion} from "framer-motion";
import {useEffect,useMemo,useRef,useState} from "react";
import {getPlatformOverview,searchServices,services} from "@/data/forge";
import {evaluateAction} from "@/lib/anai-decision";
import {confirmPendingDeployment,estimateCost,initialForgeState,prepareRecommendedProject,recordAgentInvocation,resetForgeDemoState,type ForgeRuntime,validateConfiguration,deployProject} from "@/lib/forge-state";
import {callForgeToolThroughWebMcp,discoverForgeWebMcpTools,registerForgeWebMcpTools,supportsWebMcp} from "@/lib/webmcp";
import {verifyWebMcpContract} from "@/lib/webmcp-contract";
import {completeAnaiPlanAfterConfirmation,runAnaiPlan} from "@/lib/anai-agent";
import {DEFAULT_REQUIREMENT,parseRequirement,requirementFacts} from "@/lib/anai-requirement";

const navItems=["Overview","Services","Deployments","Observability","Billing"] as const;

export default function Home(){
  const [requirementText,setRequirementText]=useState(DEFAULT_REQUIREMENT),
    [requirementError,setRequirementError]=useState<string|null>(null),
    [active,setActive]=useState<(typeof navItems)[number]>("Overview"),
    [available,setAvailable]=useState(false),
    [query,setQuery]=useState(""),
    [state,setState]=useState(initialForgeState);
  const ref=useRef(state);ref.current=state;
  const planRef=useRef<HTMLElement|null>(null);
  const gateRef=useRef<HTMLElement|null>(null);
  const revealed=useRef(false);
  /** Brings an element into view. Native smooth scrolling is unreliable inside nested
   *  scroll containers, so this animates the real scroll position instead. */
  const reveal=(el:HTMLElement|null,offset=16)=>{
    if(!el||typeof window==="undefined")return;
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches===true;
    let container:HTMLElement|null=el.parentElement;
    while(container){
      const overflowY=getComputedStyle(container).overflowY;
      if((overflowY==="auto"||overflowY==="scroll")&&container.scrollHeight>container.clientHeight)break;
      container=container.parentElement;
    }
    const from=container?container.scrollTop:window.scrollY;
    const delta=container
      ?el.getBoundingClientRect().top-container.getBoundingClientRect().top-offset
      :el.getBoundingClientRect().top-88;
    const max=container?container.scrollHeight-container.clientHeight:document.documentElement.scrollHeight-window.innerHeight;
    const to=Math.max(0,Math.min(from+delta,Math.max(0,max)));
    const apply=(value:number)=>{if(container)container.scrollTop=value;else window.scrollTo(0,value)};
    if(reduced||document.visibilityState!=="visible"||Math.abs(to-from)<4){apply(to);return}
    const started=performance.now(),duration=420;
    const step=()=>{
      const progress=Math.min(1,(performance.now()-started)/duration);
      const eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;
      apply(from+(to-from)*eased);
      if(progress<1)window.setTimeout(step,16);
    };
    step();
  };
  const runtime=useMemo<ForgeRuntime>(()=>({getState:()=>ref.current,commit:next=>{ref.current=next;setState(next)}}),[]);
  const overview=getPlatformOverview(),
    results=query?searchServices(query).services:overview.services,
    selected=state.projects.find(p=>p.id===state.selectedProjectId)??null;
  const validation=selected?state.validationResults[selected.id]:undefined;
  const deployed=selected?state.deployments.find(d=>d.projectId===selected.id):undefined;
  const estimate=["compute","model-runtime","api-gateway","database"].reduce((sum,id)=>sum+estimateCost(id,{tier:"starter",monthlyUnits:id==="compute"?160:id==="database"?20:100}).monthlyCost,0);

  useEffect(()=>{setAvailable(supportsWebMcp());const cleanup=registerForgeWebMcpTools(runtime);return ()=>{cleanup()}},[runtime]);
  useEffect(()=>{
    if(process.env.NODE_ENV!=="development")return;
    const dev=window as unknown as Record<string,unknown>;
    dev.__forgeResetDemo=()=>{resetForgeDemoState(runtime);return "Forge demo state reset."};
    dev.__forgeCheckWebMcpContract=async()=>{
      const mc=(document as unknown as {modelContext?:{getTools?:()=>Promise<unknown[]>}}).modelContext;
      if(!mc?.getTools)return {ok:false,count:0,issues:[{tool:"<registry>",problem:"WebMCP is unavailable in this browser."}]};
      return verifyWebMcpContract(await mc.getTools() as Parameters<typeof verifyWebMcpContract>[0]);
    };
    dev.__forgeDiscoverTools=()=>discoverForgeWebMcpTools();
    return ()=>{delete dev.__forgeResetDemo;delete dev.__forgeCheckWebMcpContract;delete dev.__forgeDiscoverTools};
  },[runtime]);

  const prepare=()=>prepareRecommendedProject(runtime);
  const plan=state.agentPlan;
  const callTool=async(name:string,args:Record<string,unknown>={})=>{
    try{return await callForgeToolThroughWebMcp(name,args)}
    catch(error){
      const evaluation=evaluateAction(name);
      recordAgentInvocation(runtime,{toolName:name,status:"error",decision:evaluation.decision,risk:evaluation.risk,error:error instanceof Error?error.message:String(error)});
      throw error;
    }
  };
  const parsed=parseRequirement(requirementText);
  const runPlan=(fromStep?:typeof plan.steps[number]["id"])=>{
    const current=parseRequirement(requirementText);
    if(!current.supported){setRequirementError(current.message);return}
    setRequirementError(null);
    revealed.current=false;
    void runAnaiPlan(runtime,callTool,{...(fromStep?{fromStep}:{}),requirement:current.requirement});
  };
  const startGoldenDemo=()=>{
    resetForgeDemoState(runtime);
    setRequirementText(DEFAULT_REQUIREMENT);
    setRequirementError(null);
    const parse=parseRequirement(DEFAULT_REQUIREMENT);
    revealed.current=false;
    if(parse.supported)void runAnaiPlan(runtime,callTool,{requirement:parse.requirement});
  };
  const confirmDeployment=()=>{confirmPendingDeployment(runtime);if(available)void completeAnaiPlanAfterConfirmation(runtime,callTool)};

  useEffect(()=>{
    if(plan.status!=="running")return;
    const id=window.setTimeout(()=>reveal(planRef.current),30);
    return ()=>window.clearTimeout(id);
  },[plan.status]);

  useEffect(()=>{
    if(!state.pendingAction){revealed.current=false;return}
    if(revealed.current)return;
    revealed.current=true;
    const id=window.setTimeout(()=>reveal(gateRef.current,24),80);
    return ()=>window.clearTimeout(id);
  },[state.pendingAction]);

  const planCost=plan.estimatedMonthlyCost;
  const devStatus=deployed?"LIVE":state.pendingAction?"Awaiting approval":selected?"Preparing":"Idle";

  return <div className="app">
    <header className="topbar">
      <div className="topbar-left">
        <span className="brand"><i>F</i>forge</span>
        <span className="workspace">Acme AI Lab</span>
      </div>
      <nav className="tabs">{navItems.map(item=><button key={item} className={item===active?"on":""} onClick={()=>setActive(item)}>{item}</button>)}</nav>
      <div className="topbar-right">
        <div className={plan.status==="running"?"mcp agent-live":"mcp"}>
          <i className={available?"yes":"no"}/><b>WebMCP</b><span>{available?"Connected":"Browser support unavailable"}</span>
        </div>
        {plan.status==="running"&&<motion.span className="agent-active" initial={{opacity:0}} animate={{opacity:1}}><i/>Agent active</motion.span>}
      </div>
    </header>

    <div className="layout">
      <aside className="command">
        <section className="card requirement">
          <div className="card-head"><h2>What do you need?</h2><small>ANAI turns an outcome into an operational plan. You do not choose services or tools.</small></div>
          <textarea aria-label="Describe what you need" value={requirementText} rows={3} spellCheck={false}
            onChange={event=>{setRequirementText(event.target.value);setRequirementError(null)}}/>
          {requirementError
            ?<p className="requirement-error">{requirementError}</p>
            :parsed.supported
              ?<dl className="requirement-facts">
                  <div className="requirement-kicker">ANAI understands</div>
                  {requirementFacts(parsed.requirement).map(fact=><div key={fact.label} className="requirement-fact"><dt><small>{fact.label}</small></dt><dd><b>{fact.value}</b></dd></div>)}
                </dl>
              :<p className="requirement-error">{parsed.message}</p>}
          <div className="requirement-actions">
            <button className="btn primary requirement-run" onClick={()=>runPlan()} disabled={!available||plan.status==="running"||!parsed.supported}>
              {available?plan.status==="running"?"ANAI is working…":"Run with ANAI":"WebMCP unavailable"}
            </button>
            {process.env.NODE_ENV==="development"&&<button className="btn ghost requirement-demo" onClick={startGoldenDemo} disabled={!available||plan.status==="running"}>Golden demo</button>}
          </div>
          <p className="requirement-foot">{plan.requirement?`Running: ${plan.requirement.text}`:"Runs through this page's own WebMCP tools."}</p>
        </section>

        <section className={plan.status==="running"?"card anai working":"card anai"} ref={planRef}>
          <div className="card-head anai-head">
            <span className="anai-mark">A</span>
            <span><h2>ANAI plan</h2><small>{plan.status==="idle"?"Ready to plan":plan.status==="running"?"Executing WebMCP tools…":plan.status==="awaiting_confirmation"?"Waiting for you":plan.status==="failed"?"Halted":"Complete"}</small></span>
          </div>
          {plan.requirement&&<p className="plan-requirement">&ldquo;{plan.requirement.text}&rdquo;</p>}
          <p className="plan-objective">{plan.objective}{plan.requirement?.budgetLimit!==null&&plan.requirement?` · limit $${plan.requirement.budgetLimit}/month`:""}</p>
          <ol className="plan-steps">
            {plan.steps.map(step=><li key={step.id} className={`plan-step ${step.status}`}>
              <i>{step.status==="done"?"✓":step.status==="failed"?"!":step.status==="blocked"?"→":step.status==="active"?"●":""}</i>
              <span><b>{step.label}</b>{(step.detail||step.error)&&<small>{step.error??step.detail}</small>}</span>
            </li>)}
          </ol>
          {plan.status!=="idle"&&<div className="plan-meta">
            <div><small>CURRENT ACTION</small><b>{plan.nextAction??plan.steps.find(step=>step.id===plan.currentStepId)?.label??"—"}</b></div>
            <div className="plan-meta-pair">
              <span><small>DECISION</small><b>{plan.decision==="confirm"?"Confirmation":plan.decision==="auto"?"Automatic":"—"}</b></span>
              <span><small>RISK</small><b className={plan.risk==="medium"||plan.risk==="high"?"risk-raised":""}>{plan.risk?plan.risk[0].toUpperCase()+plan.risk.slice(1):"—"}</b></span>
            </div>
            <div><small>ESTIMATED COST</small><b className="figure">{planCost!==null?`$${planCost.toFixed(2)} / month`:"Not priced yet"}</b></div>
          </div>}
          {plan.why&&<details className="plan-why" open={plan.status==="awaiting_confirmation"||plan.status==="failed"}><summary>Why this action?</summary><p>{plan.why}</p></details>}
          {plan.failure&&<div className="plan-failure"><b>Step failed</b><p>{plan.failure}</p><button className="btn warn" onClick={()=>runPlan(plan.currentStepId??undefined)}>Retry this step</button></div>}
          {plan.status==="running"&&<p className="plan-note">ANAI is executing Forge&apos;s WebMCP tools…</p>}
          {plan.status==="awaiting_confirmation"&&<p className="plan-note">Paused. ANAI will not deploy until you confirm.</p>}
        </section>

        {state.agentEvents.length>0&&<section className="card">
          <div className="card-head"><h2>Agent activity</h2><small>Real WebMCP invocations from this page</small></div>
          <ul className="agent-trace">
            {state.agentEvents.map(event=><li key={event.id} className={event.status==="error"?"failed":""}>
              <i>{event.status==="error"?"!":event.decision==="auto"?"✓":"?"}</i>
              <span><b>{event.toolName}{event.count>1&&<em>&times;{event.count}</em>}</b><small>{event.status==="error"?event.error:`${event.decision==="auto"?"Automatic":"Confirmation"} · ${event.risk} risk`}</small></span>
              <time>{event.timestamp}</time>
            </li>)}
          </ul>
        </section>}

        <section className="card">
          <div className="card-head"><h2>Recent activity</h2><small>Agent and human actions</small></div>
          <ul className="activity">
            {state.activities.slice(0,5).map(item=><li key={item.id} className={item.source==="agent"?"by-agent":""}>
              <i>{item.source==="agent"?"A":"You"}</i>
              <span>{item.message}<small>{item.source==="agent"?"Agent via WebMCP":"You"} · {item.timestamp}</small></span>
            </li>)}
          </ul>
        </section>

        <footer className="command-foot">
          <span><b>Guided autonomy</b><small>Product-level policy, not a security boundary.</small></span>
          {process.env.NODE_ENV==="development"&&<button className="btn ghost demo-reset" onClick={()=>resetForgeDemoState(runtime)}>Reset demo</button>}
        </footer>
      </aside>

      <main className="main">
        <section className="intro">
          <h1>ANAI is an operating layer for WebMCP-enabled web applications.</h1>
          <p>Forge publishes its capabilities to the browser as WebMCP tools. ANAI discovers those tools and operates the real application: automatically for safe, reversible work, and only up to the point where a human decision is required.</p>
          <details className="explainer-how"><summary>How it works</summary>
            <div className="flow">
              <div className="flow-node"><small>USER</small><b>&ldquo;I need an AI backend under $50/month. Don&apos;t touch production.&rdquo;</b></div>
              <i className="flow-arrow">↓</i>
              <div className="flow-node"><small>ANAI</small><b>Understand · Discover · Compare · Estimate · Prepare · Validate</b></div>
              <i className="flow-arrow">↓</i>
              <div className="flow-node"><small>WEBMCP</small><b>getTools() then executeTool() against this page&apos;s registered tools</b></div>
              <i className="flow-arrow">↓</i>
              <div className="flow-node"><small>FORGE</small><b>Actual application state changes because the tools ran</b></div>
              <i className="flow-arrow">↓</i>
              <div className="flow-node gate"><small>HUMAN APPROVAL</small><b>Deployment is never automatic</b></div>
              <i className="flow-arrow">↓</i>
              <div className="flow-node live"><small>RESULT</small><b>LIVE · production unchanged</b></div>
            </div>
            <div className="contrast">
              <div><small>TRADITIONAL AI CHAT</small><p>&ldquo;Here are the steps you should take.&rdquo;</p></div>
              <div><small>ANAI + WEBMCP</small><p>&ldquo;I can perform the safe steps through this site&apos;s own tools, then stop when your approval is required.&rdquo;</p></div>
            </div>
          </details>
        </section>

        <section className="env-contrast">
          <article className="env prod">
            <header><small>PRODUCTION</small><span className="pill ok">Unchanged</span></header>
            <b>Healthy</b>
            <dl><div><dt>Monthly spend</dt><dd className="figure">$842</dd></div><div><dt>Projects</dt><dd>Atlas Assistant · Signal Index</dd></div></dl>
            <p>ANAI will not modify this workspace.</p>
          </article>
          <article className="env dev">
            <header><small>DEVELOPMENT</small><span className={deployed?"pill live":state.pendingAction?"pill wait":"pill"}>{devStatus}</span></header>
            <b>{selected?selected.name:"Not created yet"}</b>
            <dl>
              <div><dt>Estimated spend</dt><dd className="figure">{planCost!==null?`$${planCost.toFixed(2)}`:selected?`$${estimate.toFixed(2)}`:"—"}</dd></div>
              <div><dt>Services</dt><dd>{selected?selected.serviceIds.map(id=>services.find(s=>s.id===id)?.name).join(" · "):"None yet"}</dd></div>
            </dl>
            <p className={deployed?"live-copy":""}>{deployed?"LIVE — AI backend deployed successfully.":validation?.valid?"Configuration valid — no blocking issues detected.":selected?"Next: validate the configuration.":"ANAI creates this environment when you run a requirement."}</p>
          </article>
        </section>

        {state.pendingAction&&<motion.section className="confirm-gate" ref={gateRef} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
            <div className="confirm-copy">
              <small>CONFIRMATION REQUIRED</small>
              <b className="confirm-title">ANAI is ready</b>
              <p className="confirm-lede">Production stays unchanged. ANAI needs your confirmation before deployment.</p>
              {validation?.valid&&<p className="confirm-valid">Configuration validated. No blocking issues detected.</p>}
            </div>
            <div className="confirm-facts">
              <span><small>PROJECT</small><b>{selected?.name??"Development project"}</b></span>
              <span><small>ENVIRONMENT</small><b>Development</b></span>
              <span><small>ESTIMATED COST</small><b className="figure">{planCost!==null?`$${planCost.toFixed(2)} / month`:`$${estimate.toFixed(2)} / month`}</b></span>
            </div>
            <button className="btn primary large confirm-cta" onClick={confirmDeployment}>Confirm deployment</button>
        </motion.section>}

        <section className="card workflow">
          <div className="card-head">
            <span><h2>{selected?selected.name:"Separate development environment"}</h2><small>{selected?"ANAI is preparing a separate environment. Production remains unchanged.":"A low-cost AI backend, isolated from the healthy production workspace."}</small></span>
            {deployed&&<span className="live-badge">LIVE</span>}
          </div>
          <WorkflowSteps prepared={!!selected} validated={!!validation?.valid} pending={!!state.pendingAction} live={!!deployed}/>
          {selected&&<div className="workflow-actions">
            {!validation?.valid&&<button className="btn" onClick={()=>validateConfiguration(runtime,selected.id)}>Validate</button>}
            {validation?.valid&&!deployed&&!state.pendingAction&&<button className="btn primary" onClick={()=>deployProject(runtime,selected.id)}>Deploy simulation</button>}
          </div>}
        </section>

        <section className="card recommendation">
          <div className="card-head"><span><h2>Recommended stack</h2><small>Separate development environment</small></span><strong className="figure price">${(planCost??estimate).toFixed(2)}<em>/month</em></strong></div>
          <div className="stack">
            {(plan.selection.length>0
              ?plan.selection.map(item=>({id:item.serviceId,name:item.name,note:item.reason,cost:item.monthlyCost}))
              :["compute","model-runtime","api-gateway","database"].map(id=>({id,name:services.find(s=>s.id===id)?.name??id,note:services.find(s=>s.id===id)?.description??"",cost:null as number|null})))
              .map(item=><div key={item.id} className="stack-item">
                <b>{item.name}{item.cost!==null&&<em className="figure">${item.cost.toFixed(2)}</em>}</b>
                <small>{item.note}</small>
              </div>)}
          </div>
          <p className="rec-reason">{plan.recommendationReason??"Keep the $842/month production environment healthy. ANAI prepares this isolated development stack instead."}</p>
          {!selected&&<button className="btn ghost" onClick={prepare}>Create development project</button>}
        </section>

        <section className="metrics">
          <Metric l="Active services" v="6" d="All systems operational" good/>
          <Metric l="Requests today" v="2.48M" d="Up 18.4% from yesterday"/>
          <Metric l="Compute spend" v="$842" d="Current production environment" warn/>
          <Metric l="Error rate" v="0.08%" d="Within your SLO target" good/>
        </section>

        <section className="card">
          <PanelHead title="Production services" description="Current production infrastructure. ANAI will not modify this workspace." action="View all services"/>
          <label className="filter">Search<input aria-label="Filter services" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter services"/></label>
          <div className="table">
            <div className="row labels"><span>Service</span><span>Status</span><span>Usage</span><span>Monthly cost</span></div>
            {results.map(s=><div className="row" key={s.id}>
              <div className="service"><i className={s.id}>{s.icon}</i><span><b>{s.name}</b><small>{s.description}</small></span></div>
              <span className="status"><i/>{s.status}</span>
              <span>{s.usage}</span>
              <strong className="figure">{s.monthlyCost}</strong>
            </div>)}
          </div>
        </section>

        <div className="grid-2">
          <section className="card">
            <PanelHead title="Recent deployments" description="Production and simulated development deployments." action="View deployments"/>
            {state.deployments.slice(0,3).map(d=><motion.div className="deploy" key={d.id} initial={{opacity:0}} animate={{opacity:1}}>
              <i>/</i><span><b>{d.projectName}</b><small>{d.version} · {d.region}</small></span><em className="status"><i/>{d.status}</em><time>{d.relativeTime}</time>
            </motion.div>)}
          </section>
          <section className="card">
            <div className="card-head"><span><h2>Usage pulse</h2><small>Model requests, last 7 days.</small></span><b className="trend">Up 14.8%</b></div>
            <div className="chart">{[42,57,48,64,60,78,88].map((v,i)=><i key={i} style={{height:`${v}%`}}/>)}</div>
            <div className="days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Today</span></div>
          </section>
        </div>

        <div className="grid-2">
          <section className="card">
            <div className="card-head"><span><h2>Autonomy policy</h2><small>What ANAI may do without asking</small></span></div>
            <div className="autonomy">
              <Autonomy action="search_services" label="Search services"/>
              <Autonomy action="compare_services" label="Compare options"/>
              <Autonomy action="estimate_cost" label="Estimate cost"/>
              <Autonomy action="create_project" label="Create development"/>
              <Autonomy action="configure_service" label="Configure development" context={{environment:"Development"}}/>
              <Autonomy action="deploy_project" label="Deploy simulation" context={{environment:"Development"}}/>
              <Autonomy action="configure_service" label="Production changes" context={{environment:"Production"}}/>
            </div>
            <p className="autonomy-note">ANAI acts automatically when an action is low-risk and reversible. Consequential changes require your confirmation.</p>
          </section>
          <section className="card">
            <div className="card-head"><span><h2>Why WebMCP?</h2><small>How this differs from an agent guessing at a UI</small></span></div>
            <details className="why-webmcp" open><summary>Why WebMCP?</summary>
              <ul>
                <li>This page registers its capabilities as WebMCP tools.</li>
                <li>ANAI discovers them through the browser&apos;s model context.</li>
                <li>ANAI invokes the registered tools through the real WebMCP API.</li>
                <li>Tool results flow back into the plan as evidence.</li>
                <li>Forge&apos;s state changes because those tools actually executed.</li>
                <li>Consequential actions stay behind the confirmation boundary.</li>
              </ul>
              <small>WebMCP is an experimental browser capability; where it is unavailable, Forge stays fully usable and ANAI does not run.</small>
            </details>
          </section>
        </div>
      </main>
    </div>
  </div>;
}

function WorkflowSteps({prepared,validated,pending,live}:{prepared:boolean;validated:boolean;pending:boolean;live:boolean}){
  const steps=[[prepared,"Prepare"],[validated,"Validate"],[live,"Confirm"],[live,"Live"]] as const;
  const awaiting=pending&&!live;
  const firstPending=steps.findIndex(([done])=>!done);
  const current=firstPending===-1?steps.length-1:firstPending;
  return <div className="workflow-steps">{steps.map(([done,label],i)=>
    <span className={[done?"done":"",i===current?"current":"",awaiting&&label==="Confirm"?"awaiting":""].filter(Boolean).join(" ")} key={label}>
      <i>{done?"✓":i+1}</i>{label}
    </span>)}</div>;
}

function Autonomy({action,label,context}:{action:string;label:string;context?:{environment:string}}){
  const decision=evaluateAction(action,context);
  return <div className={decision.decision==="auto"?"autonomy-row auto":"autonomy-row confirm"}>
    <span>{decision.decision==="auto"?"✓":"!"}</span><b>{label}</b><small>{decision.decision==="auto"?"Automatic":"Confirmation"}</small>
  </div>;
}

function Metric({l,v,d,good,warn}:{l:string,v:string,d:string,good?:boolean,warn?:boolean}){
  return <motion.article initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="metric">
    <p>{l}</p><b className="figure">{v}</b><small className={good?"good":warn?"warn":""}>{d}</small>
  </motion.article>;
}

function PanelHead({title,description,action}:{title:string,description:string,action:string}){
  return <div className="card-head"><span><h2>{title}</h2><small>{description}</small></span><button className="link">{action} →</button></div>;
}
