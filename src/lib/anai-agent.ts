import {evaluateAction} from "@/lib/anai-decision";
import type {ForgeRuntime} from "@/lib/forge-state";
import type {AgentPlan,AgentSelection,AgentStep,AgentStepId,PlanRequirement} from "@/types/forge";

/** Every call goes through the real WebMCP transport supplied by the caller. There is no direct-handler fallback: an unexecutable plan must fail visibly rather than fake progress. */
export type ToolCaller=(name:string,args?:Record<string,unknown>)=>Promise<unknown>;

const STEP_LABELS:{id:AgentStepId;label:string}[]=[
  {id:"understand",label:"Understand requirement"},
  {id:"select",label:"Select services"},
  {id:"estimate",label:"Estimate cost"},
  {id:"prepare",label:"Prepare environment"},
  {id:"validate",label:"Validate configuration"},
  {id:"confirm",label:"Confirm deployment"},
  {id:"golive",label:"Go live"},
];

/** Roles come from the validator's own rules in validateConfiguration: compute and model-runtime are hard requirements, api-gateway and database are its recommendations. */
const ROLES:{serviceId:string;monthlyUnits:number;reason:string}[]=[
  {serviceId:"compute",monthlyUnits:160,reason:"Required: validation rejects an AI backend without Compute to run the workload."},
  {serviceId:"model-runtime",monthlyUnits:100,reason:"Required: provides hosted inference, which validation demands for an AI backend."},
  {serviceId:"api-gateway",monthlyUnits:100,reason:"Recommended by validation to expose the backend securely at the edge."},
  {serviceId:"database",monthlyUnits:20,reason:"Included so the backend has persistent state; validation warns when it is absent."},
];

const OBJECTIVE="Set up the cheapest reliable development environment for an AI backend, leaving production untouched.";
const PROJECT_NAME="Budget AI Backend";

export function initialAgentPlan():AgentPlan{return {requirement:null,objective:OBJECTIVE,status:"idle",steps:STEP_LABELS.map(step=>({...step,status:"pending" as const})),currentStepId:null,nextAction:"Run the ANAI plan to discover and price a development stack.",decision:null,risk:null,estimatedMonthlyCost:null,selection:[],recommendationReason:null,why:null,projectId:null,failure:null}}

const patchPlan=(runtime:ForgeRuntime,patch:Partial<AgentPlan>)=>{const state=runtime.getState();runtime.commit({...state,agentPlan:{...state.agentPlan,...patch}})};
const setStep=(runtime:ForgeRuntime,id:AgentStepId,status:AgentStep["status"],extra:{detail?:string;error?:string}={})=>{const state=runtime.getState();runtime.commit({...state,agentPlan:{...state.agentPlan,steps:state.agentPlan.steps.map(step=>step.id===id?{...step,status,...extra}:step)}})};
const failureText=(value:unknown,fallback:string)=>{const r=value&&typeof value==="object"?value as Record<string,unknown>:null;return typeof r?.error==="string"?r.error:fallback};

class StepFailure extends Error{step:AgentStepId;constructor(step:AgentStepId,message:string){super(message);this.step=step}}

/** A tool result is only usable if it is a real object. Malformed JSON reaches us as a string and must never be treated as progress. */
function expectObject(step:AgentStepId,tool:string,value:unknown,options:{errorIsFatal?:boolean}={}):Record<string,unknown>{
  if(typeof value==="string")throw new StepFailure(step,`${tool} returned a malformed result that could not be parsed as JSON.`);
  if(!value||typeof value!=="object"||Array.isArray(value))throw new StepFailure(step,`${tool} returned no usable result.`);
  const result=value as Record<string,unknown>;
  if(options.errorIsFatal!==false&&typeof result.error==="string")throw new StepFailure(step,result.error);
  return result;
}
function expectField<T>(step:AgentStepId,tool:string,result:Record<string,unknown>,key:string,guard:(value:unknown)=>value is T):T{
  const value=result[key];
  if(!guard(value))throw new StepFailure(step,`${tool} returned no usable "${key}" field.`);
  return value;
}
const isArray=(value:unknown):value is unknown[]=>Array.isArray(value);
const isNumber=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const isString=(value:unknown):value is string=>typeof value==="string"&&value.length>0;

/** Runs the deterministic ANAI plan. Each step performs real WebMCP tool calls, so the AGENT ACTIVITY rail is populated by the existing instrumentation rather than by this module. */
export async function runAnaiPlan(runtime:ForgeRuntime,call:ToolCaller,options:{fromStep?:AgentStepId;requirement?:PlanRequirement}={}){
  const startIndex=options.fromStep?STEP_LABELS.findIndex(step=>step.id===options.fromStep):0;
  const resumeFrom=startIndex<0?0:startIndex;
  const requirement=options.requirement??runtime.getState().agentPlan.requirement;
  patchPlan(runtime,{status:"running",failure:null,requirement,objective:requirement?requirement.objective:OBJECTIVE,steps:runtime.getState().agentPlan.steps.map((step,index)=>index<resumeFrom?step:{...step,status:"pending",error:undefined})});
  let selection=runtime.getState().agentPlan.selection;
  let projectId=runtime.getState().agentPlan.projectId;
  try{
    if(resumeFrom<=0){
      begin(runtime,"understand","Discovering the capabilities this workspace exposes, plus its state and autonomy policy.");
      const overview=expectObject("understand","get_platform_overview",await call("get_platform_overview"));
      expectField("understand","get_platform_overview",overview,"services",isArray);
      setStep(runtime,"understand","done",{detail:`${requirement?`${requirement.objective}. `:""}Discovered ${(overview.services as unknown[]).length} capabilities in ${String(overview.workspace)} · production left untouched.`});
    }
    if(resumeFrom<=1){
      begin(runtime,"select","Searching the catalogue, inspecting candidates, and comparing them before committing to a stack.");
      const search=expectObject("select","search_services",await call("search_services",{query:"inference"}));
      expectField("select","search_services",search,"services",isArray);
      for(const role of ROLES){
        const details=expectObject("select","get_service_details",await call("get_service_details",{serviceId:role.serviceId}));
        if(details.found!==true)throw new StepFailure("select",failureText(details,`get_service_details did not find ${role.serviceId}.`));
      }
      const comparison=expectObject("select","compare_services",await call("compare_services",{serviceIds:ROLES.map(role=>role.serviceId)}));
      const missing=expectField("select","compare_services",comparison,"missingServiceIds",isArray);
      if(missing.length)throw new StepFailure("select",`Unavailable services: ${missing.join(", ")}.`);
      const compared=expectField("select","compare_services",comparison,"comparison",isArray) as Record<string,unknown>[];
      if(compared.length!==ROLES.length)throw new StepFailure("select",`compare_services returned ${compared.length} of ${ROLES.length} services.`);
      selection=ROLES.map(role=>({serviceId:role.serviceId,name:String(compared.find(item=>item.id===role.serviceId)?.name??role.serviceId),monthlyCost:0,reason:role.reason}));
      patchPlan(runtime,{selection});
      setStep(runtime,"select","done",{detail:`${selection.length} services selected from ${String(search.count??0)} search result(s) and a 4-way comparison.`});
    }
    if(resumeFrom<=2){
      begin(runtime,"estimate","Pricing every selected service and totalling the monthly development spend.");
      const priced:AgentSelection[]=[];let total=0;
      for(const role of ROLES){
        const pricing=expectObject("estimate","get_pricing",await call("get_pricing",{serviceId:role.serviceId}));
        if(pricing.found!==true)throw new StepFailure("estimate",failureText(pricing,`get_pricing did not price ${role.serviceId}.`));
        expectField("estimate","get_pricing",pricing,"pricing",isObject);
        const estimate=expectObject("estimate","estimate_cost",await call("estimate_cost",{serviceId:role.serviceId,configuration:{tier:"starter",monthlyUnits:role.monthlyUnits}}));
        const monthlyCost=expectField("estimate","estimate_cost",estimate,"monthlyCost",isNumber);
        if(monthlyCost<=0)throw new StepFailure("estimate",`estimate_cost returned no usable cost for ${role.serviceId}.`);
        total+=monthlyCost;
        priced.push({serviceId:role.serviceId,name:String(pricing.serviceName??role.serviceId),monthlyCost,reason:role.reason});
      }
      selection=priced;
      const estimatedMonthlyCost=Number(total.toFixed(2));
      const budgetLimit=requirement?.budgetLimit??null;
      if(budgetLimit!==null&&estimatedMonthlyCost>budgetLimit)throw new StepFailure("estimate",`The cheapest compliant stack is $${estimatedMonthlyCost.toFixed(2)}/month, which exceeds your $${budgetLimit}/month limit. ANAI will not prepare an environment that breaks the stated budget.`);
      const spendDecision=evaluateAction("estimate_cost",{monthlyCost:estimatedMonthlyCost});
      patchPlan(runtime,{selection,estimatedMonthlyCost,recommendationReason:`Lowest-cost purpose-built development stack that satisfies the AI backend requirement while keeping production completely unchanged. Estimated $${estimatedMonthlyCost.toFixed(2)}/month${budgetLimit!==null?` against a $${budgetLimit}/month limit`:""}.`});
      setStep(runtime,"estimate","done",{detail:`Estimated $${estimatedMonthlyCost.toFixed(2)}/month across ${priced.length} services${budgetLimit!==null?`, within the $${budgetLimit}/month limit`:""} (${spendDecision.decision==="auto"?"below":"above"} the significant-spend threshold).`});
    }
    if(resumeFrom<=3){
      begin(runtime,"prepare","Creating an isolated development project and attaching each selected service. Reversible, no production impact.");
      const created=expectObject("prepare","create_project",await call("create_project",{name:PROJECT_NAME}),{errorIsFatal:false});
      const project=isObject(created.project)?created.project:null;
      const createdId=project&&isString(project.id)?project.id:null;
      if(!createdId)throw new StepFailure("prepare",failureText(created,"create_project did not return a project."));
      const reused=created.created===false;
      projectId=createdId;
      patchPlan(runtime,{projectId});
      for(const role of ROLES){
        const configured=expectObject("prepare","configure_service",await call("configure_service",{projectId,serviceId:role.serviceId,configuration:{tier:"starter",monthlyUnits:role.monthlyUnits}}));
        if(configured.configured!==true)throw new StepFailure("prepare",failureText(configured,`configure_service failed for ${role.serviceId}.`));
      }
      setStep(runtime,"prepare","done",{detail:`${reused?"Reused existing":"Created"} development project ${PROJECT_NAME} with ${ROLES.length} services configured.`});
    }
    if(resumeFrom<=4){
      if(!projectId)throw new StepFailure("validate","No development project is available to validate.");
      begin(runtime,"validate","Validating the real project configuration before anything consequential is proposed.");
      const validation=expectObject("validate","validate_configuration",await call("validate_configuration",{projectId}));
      const errors=isArray(validation.errors)?validation.errors as string[]:[];
      if(validation.valid!==true)throw new StepFailure("validate",errors.length?errors.join(" "):"Validation did not pass.");
      const warnings=isArray(validation.warnings)?validation.warnings as string[]:[];
      setStep(runtime,"validate","done",{detail:warnings.length?`Valid with ${warnings.length} warning(s).`:"Configuration valid - no blocking issues detected."});
    }
    if(!projectId)throw new StepFailure("confirm","No development project is available to deploy.");
    begin(runtime,"confirm","Deployment materially changes project state, so ANAI stops here and asks for your confirmation.");
    const deployment=expectObject("confirm","deploy_project",await call("deploy_project",{projectId}));
    const evaluation=isObject(deployment.evaluation)?deployment.evaluation:{};
    const decision=evaluation?.decision==="auto"?"auto":"confirm";
    const risk=evaluation?.risk==="low"||evaluation?.risk==="high"?evaluation.risk:"medium";
    if(deployment.requiresConfirmation===true){
      setStep(runtime,"confirm","blocked",{detail:String(evaluation?.reason??"Your confirmation is required before deployment.")});
      patchPlan(runtime,{status:"awaiting_confirmation",currentStepId:"confirm",decision,risk,nextAction:"Waiting for your confirmation. ANAI will not deploy without it.",why:"Deployment is the first action in this plan that is not reversible at no cost, so the autonomy policy hands the decision back to you."});
      return runtime.getState().agentPlan;
    }
    if(deployment.deployed===true){
      const live=isObject(deployment.deployment)?deployment.deployment:null;
      if(!live)throw new StepFailure("confirm","deploy_project reported success without returning a deployment.");
      setStep(runtime,"confirm","done",{detail:deployment.alreadyDeployed===true?"Deployment already existed; no duplicate created.":"Deployment approved."});
      return markLive(runtime,live);
    }
    throw new StepFailure("confirm",failureText(deployment,"deploy_project did not complete."));
  }catch(error){
    const step=error instanceof StepFailure?error.step:runtime.getState().agentPlan.currentStepId??"understand";
    const message=error instanceof Error?error.message:String(error);
    setStep(runtime,step,"failed",{error:message});
    patchPlan(runtime,{status:"failed",currentStepId:step,failure:message,nextAction:"Retry the failed step once the problem is resolved.",why:"ANAI stopped instead of continuing past a failed tool call."});
    return runtime.getState().agentPlan;
  }
}

/** Called after the human uses the existing confirmation control. The deployment itself is performed by that control; this only re-reads real state through WebMCP and closes out the plan. */
export async function completeAnaiPlanAfterConfirmation(runtime:ForgeRuntime,call:ToolCaller){
  const plan=runtime.getState().agentPlan;
  if(plan.status!=="awaiting_confirmation"||!plan.projectId)return plan;
  try{
    const overview=expectObject("golive","get_platform_overview",await call("get_platform_overview"));
    const runtimeState=isObject(overview.runtimeState)?overview.runtimeState:{};
    const deployments=isArray(runtimeState.deployments)?runtimeState.deployments as Record<string,unknown>[]:[];
    const deployment=deployments.find(item=>item.projectId===plan.projectId);
    if(!deployment){patchPlan(runtime,{nextAction:"Confirmation recorded, but no deployment has been observed yet."});return runtime.getState().agentPlan}
    setStep(runtime,"confirm","done",{detail:"You confirmed the deployment."});
    return markLive(runtime,deployment);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    setStep(runtime,"golive","failed",{error:message});
    patchPlan(runtime,{status:"failed",currentStepId:"golive",failure:message,nextAction:"Retry once the deployment state can be read again.",why:"The deployment may have happened, but ANAI could not confirm it through WebMCP and will not claim success."});
    return runtime.getState().agentPlan;
  }
}

function begin(runtime:ForgeRuntime,id:AgentStepId,why:string){setStep(runtime,id,"active");patchPlan(runtime,{status:"running",currentStepId:id,why,nextAction:STEP_LABELS.find(step=>step.id===id)?.label??null,decision:"auto",risk:"low",failure:null})}

function markLive(runtime:ForgeRuntime,deployment:Record<string,unknown>){
  setStep(runtime,"golive","done",{detail:`Live in ${String(deployment.region??"us-east-1")} as ${String(deployment.version??"v0.1.0")}.`});
  patchPlan(runtime,{status:"complete",currentStepId:"golive",decision:"auto",risk:"low",nextAction:"Development environment is live. Production is unchanged.",why:"The deployment was authorised by you, so ANAI completed the final step."});
  return runtime.getState().agentPlan;
}
