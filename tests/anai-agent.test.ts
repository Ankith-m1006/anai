import {describe,expect,it} from "./runner";
import {completeAnaiPlanAfterConfirmation,runAnaiPlan,type ToolCaller} from "@/lib/anai-agent";
import {confirmPendingDeployment,compareServices,configureService,createProject,deployProject,estimateCost,getPricing,validateConfiguration} from "@/lib/forge-state";
import {getPlatformOverview,getServiceDetails,searchServices} from "@/data/forge";
import type {ForgeRuntime} from "@/lib/forge-state";
import {createTestRuntime,PRODUCTION_DEPLOYMENT_IDS,productionSnapshot} from "./helpers";
import {DEFAULT_REQUIREMENT,parseRequirement} from "@/lib/anai-requirement";

/**
 * Stands in for the Chrome WebMCP transport: same handlers the registered tools wrap,
 * reached only through a name + JSON round-trip, so a planner bug cannot call a handler directly.
 */
function transport(runtime:ForgeRuntime,overrides:Record<string,()=>unknown>={}):ToolCaller{
  return async(name,args={})=>{
    if(overrides[name])return overrides[name]();
    const input=JSON.parse(JSON.stringify(args)) as Record<string,string&Record<string,unknown>>;
    const handlers:Record<string,()=>unknown>={
      get_platform_overview:()=>({...getPlatformOverview(),runtimeState:runtime.getState()}),
      search_services:()=>searchServices(String(input.query??"")),
      get_service_details:()=>getServiceDetails(String(input.serviceId??"")),
      compare_services:()=>compareServices((input.serviceIds as unknown as string[])??[]),
      get_pricing:()=>getPricing(String(input.serviceId??"")),
      estimate_cost:()=>estimateCost(String(input.serviceId??""),input.configuration??{}),
      create_project:()=>createProject(runtime,String(input.name??"")),
      configure_service:()=>configureService(runtime,String(input.projectId??""),String(input.serviceId??""),input.configuration??{}),
      validate_configuration:()=>validateConfiguration(runtime,String(input.projectId??"")),
      deploy_project:()=>deployProject(runtime,String(input.projectId??"")),
    };
    const handler=handlers[name];
    if(!handler)throw new Error(`${name} is not registered with WebMCP.`);
    return JSON.parse(JSON.stringify(handler()));
  };
}

const statuses=(plan:{steps:{id:string;status:string}[]})=>Object.fromEntries(plan.steps.map(step=>[step.id,step.status]));

describe("plan transitions",()=>{
  it("runs the golden path and stops at the confirmation gate",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const plan=await runAnaiPlan(runtime,transport(runtime));
    expect(plan.status).toBe("awaiting_confirmation");
    expect(statuses(plan)).toMatchObject({understand:"done",select:"done",estimate:"done",prepare:"done",validate:"done",confirm:"blocked",golive:"pending"});
    expect(plan.estimatedMonthlyCost).toBe(42.02);
    expect(plan.selection.map(item=>item.serviceId)).toEqual(["compute","model-runtime","api-gateway","database"]);
    expect(plan.decision).toBe("confirm");
    expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(0);
    expect(harness.state.pendingAction).not.toBeNull();
  });

  it("completes only after the human confirmation actually deployed",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    await runAnaiPlan(runtime,transport(runtime));
    confirmPendingDeployment(runtime);
    const plan=await completeAnaiPlanAfterConfirmation(runtime,transport(runtime));
    expect(plan.status).toBe("complete");
    expect(statuses(plan).confirm).toBe("done");
    expect(statuses(plan).golive).toBe("done");
    expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(1);
  });

  it("does not mark go-live when no deployment exists",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    await runAnaiPlan(runtime,transport(runtime));
    const plan=await completeAnaiPlanAfterConfirmation(runtime,transport(runtime));
    expect(plan.status).toBe("awaiting_confirmation");
    expect(statuses(plan).golive).toBe("pending");
  });

  it("is idempotent when replanned after a completed deployment",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    await runAnaiPlan(runtime,transport(runtime));
    confirmPendingDeployment(runtime);
    await completeAnaiPlanAfterConfirmation(runtime,transport(runtime));
    const replan=await runAnaiPlan(runtime,transport(runtime));
    expect(replan.status).toBe("complete");
    expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(1);
  });

  it("leaves production untouched across a full run",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const before=productionSnapshot(harness.state);
    await runAnaiPlan(runtime,transport(runtime));
    confirmPendingDeployment(runtime);
    await completeAnaiPlanAfterConfirmation(runtime,transport(runtime));
    expect(productionSnapshot(harness.state)).toBe(before);
  });
});

describe("requirement drives the plan",()=>{
  const demo=parseRequirement(DEFAULT_REQUIREMENT);
  const requirement=demo.supported?demo.requirement:null;

  it("carries the parsed requirement into the plan and stays within budget",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const plan=await runAnaiPlan(runtime,transport(runtime),{requirement:requirement!});
    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.requirement?.budgetLimit).toBe(50);
    expect(plan.objective).toBe("Build an inexpensive AI backend");
    expect(plan.estimatedMonthlyCost).toBe(42.02);
    expect(plan.steps.find(step=>step.id==="estimate")?.detail).toContain("within the $50/month limit");
  });

  it("refuses to prepare an environment that breaks the stated budget",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const plan=await runAnaiPlan(runtime,transport(runtime),{requirement:{...requirement!,budgetLimit:10}});
    expect(plan.status).toBe("failed");
    expect(plan.currentStepId).toBe("estimate");
    expect(plan.failure).toContain("exceeds your $10/month limit");
    expect(harness.state.projects.filter(p=>p.environment==="Development")).toHaveLength(0);
    expect(harness.state.pendingAction).toBeNull();
    expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(0);
  });

  it("runs the same development-safe plan when no budget is stated",async()=>{
    const parse=parseRequirement("I need an AI backend for development and want to keep production untouched.");
    const harness=createTestRuntime();const {runtime}=harness;
    const before=productionSnapshot(harness.state);
    const plan=await runAnaiPlan(runtime,transport(runtime),{requirement:parse.supported?parse.requirement:null!});
    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.estimatedMonthlyCost).toBe(42.02);
    expect(plan.requirement?.productionConstraint).toBe("unchanged");
    expect(productionSnapshot(harness.state)).toBe(before);
  });
});

describe("failure handling",()=>{
  const cases:[string,Record<string,()=>unknown>,string,string][]=[
    ["transport throws",{search_services:()=>{throw new Error("Injected transport fault")}},"select","Injected transport fault"],
    ["tool unavailable",{get_platform_overview:()=>{throw new Error("get_platform_overview is not registered with WebMCP.")}},"understand","not registered"],
    ["malformed JSON",{get_pricing:()=>"{not json"},"estimate","malformed"],
    ["structured error object",{create_project:()=>({created:false,error:"A project with this name already exists."})},"prepare","already exists"],
    ["missing expected fields",{compare_services:()=>({requestedServiceIds:[]})},"select","usable"],
    ["validation invalid",{validate_configuration:()=>({valid:false,errors:["Compute is required to run the AI backend."],warnings:[]})},"validate","Compute is required"],
    ["deploy reports success without a deployment",{deploy_project:()=>({deployed:true})},"confirm","without returning a deployment"],
  ];

  for(const [label,overrides,failedStep,message] of cases){
    it(`fails safely: ${label}`,async()=>{
      const harness=createTestRuntime();const {runtime}=harness;
      const plan=await runAnaiPlan(runtime,transport(runtime,overrides));
      expect(plan.status).toBe("failed");
      expect(plan.currentStepId).toBe(failedStep);
      expect(plan.failure).toContain(message);
      expect(statuses(plan)[failedStep]).toBe("failed");
      const failedIndex=plan.steps.findIndex(step=>step.id===failedStep);
      for(const step of plan.steps.slice(failedIndex+1))expect(step.status).toBe("pending");
      expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(0);
      if(failedStep!=="confirm")expect(harness.state.pendingAction).toBeNull();
      expect(productionSnapshot(harness.state)).toBe(productionSnapshot(createTestRuntime().state));
    });
  }

  it("never claims success when the deployment result is unusable",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const plan=await runAnaiPlan(runtime,transport(runtime,{deploy_project:()=>"not-json"}));
    expect(plan.status).toBe("failed");
    expect(statuses(plan).golive).toBe("pending");
  });

  it("retries a failed step and then reaches the gate",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    let fail=true;
    const flaky=transport(runtime,{});
    const call:ToolCaller=async(name,args)=>{
      if(name==="validate_configuration"&&fail){fail=false;throw new Error("Injected transport fault")}
      return flaky(name,args);
    };
    const failed=await runAnaiPlan(runtime,call);
    expect(failed.status).toBe("failed");
    expect(statuses(failed).validate).toBe("failed");
    const retried=await runAnaiPlan(runtime,call,{fromStep:"validate"});
    expect(retried.status).toBe("awaiting_confirmation");
    expect(statuses(retried).validate).toBe("done");
    expect(harness.state.deployments.filter(d=>!PRODUCTION_DEPLOYMENT_IDS.includes(d.id))).toHaveLength(0);
  });

  it("surfaces validation warnings without failing",async()=>{
    const harness=createTestRuntime();const {runtime}=harness;
    const plan=await runAnaiPlan(runtime,transport(runtime,{validate_configuration:()=>({valid:true,errors:[],warnings:["Database is optional."]})}));
    expect(plan.status).toBe("awaiting_confirmation");
    expect(plan.steps.find(step=>step.id==="validate")?.detail).toContain("1 warning");
  });
});
