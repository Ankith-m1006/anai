import {describe,expect,it} from "./runner";
import {configureService,confirmPendingDeployment,createProject,deployProject,recordAgentInvocation,validateConfiguration} from "@/lib/forge-state";
import {evaluateAction} from "@/lib/anai-decision";
import {createTestRuntime,PRODUCTION_DEPLOYMENT_IDS,productionSnapshot} from "./helpers";

const STACK=[["compute",160],["model-runtime",100],["api-gateway",100],["database",20]] as const;

function prepared(){
  const harness=createTestRuntime();
  const created=createProject(harness.runtime,"Budget AI Backend");
  const projectId=created.project!.id;
  for(const [serviceId,monthlyUnits] of STACK)configureService(harness.runtime,projectId,serviceId,{tier:"starter",monthlyUnits});
  return {harness,projectId};
}

describe("confirmation gate",()=>{
  it("refuses to deploy until a human confirms",()=>{
    const {harness,projectId}=prepared();
    expect(validateConfiguration(harness.runtime,projectId).valid).toBe(true);
    const first=deployProject(harness.runtime,projectId) as Record<string,unknown>;
    expect(first.deployed).toBe(false);
    expect(first.requiresConfirmation).toBe(true);
    expect(harness.state.pendingAction?.projectId).toBe(projectId);
    expect(harness.state.deployments.filter(d=>d.projectId===projectId)).toHaveLength(0);
  });

  it("cannot be bypassed by repeated agent calls",()=>{
    const {harness,projectId}=prepared();
    for(let i=0;i<5;i+=1)deployProject(harness.runtime,projectId);
    expect(harness.state.deployments.filter(d=>d.projectId===projectId)).toHaveLength(0);
    expect(harness.state.approvedDeployments).toHaveLength(0);
  });

  it("deploys only after the human confirmation transition",()=>{
    const {harness,projectId}=prepared();
    deployProject(harness.runtime,projectId);
    const confirmed=confirmPendingDeployment(harness.runtime) as Record<string,unknown>;
    expect(confirmed.deployed).toBe(true);
    expect(harness.state.pendingAction).toBeNull();
    expect(harness.state.deployments.filter(d=>d.projectId===projectId)).toHaveLength(1);
  });

  it("rejects confirmation when nothing is pending",()=>{
    const {harness}=prepared();
    expect((confirmPendingDeployment(harness.runtime) as Record<string,unknown>).confirmed).toBe(false);
  });

  it("refuses to deploy an invalid configuration",()=>{
    const harness=createTestRuntime();
    const created=createProject(harness.runtime,"Incomplete Backend");
    const result=deployProject(harness.runtime,created.project!.id) as Record<string,unknown>;
    expect(result.deployed).toBe(false);
    expect(String(result.error)).toMatch(/validation/i);
    expect(harness.state.pendingAction).toBeNull();
  });
});

describe("deployment idempotency",()=>{
  it("never creates a duplicate deployment",()=>{
    const {harness,projectId}=prepared();
    deployProject(harness.runtime,projectId);
    confirmPendingDeployment(harness.runtime);
    for(let i=0;i<4;i+=1){
      const retry=deployProject(harness.runtime,projectId) as Record<string,unknown>;
      expect(retry.deployed).toBe(true);
      expect(retry.alreadyDeployed).toBe(true);
      expect(retry.deployment).toBeDefined();
      expect(retry.evaluation).toBeDefined();
      expect(retry.validation).toBeDefined();
    }
    expect(harness.state.deployments.filter(d=>d.projectId===projectId)).toHaveLength(1);
  });

  it("repeated confirmations do not add deployments",()=>{
    const {harness,projectId}=prepared();
    deployProject(harness.runtime,projectId);
    confirmPendingDeployment(harness.runtime);
    confirmPendingDeployment(harness.runtime);
    confirmPendingDeployment(harness.runtime);
    expect(harness.state.deployments.filter(d=>d.projectId===projectId)).toHaveLength(1);
  });
});

describe("production isolation",()=>{
  it("leaves production projects and deployments untouched through the whole workflow",()=>{
    const harness=createTestRuntime();
    const before=productionSnapshot(harness.state);
    const created=createProject(harness.runtime,"Budget AI Backend");
    const projectId=created.project!.id;
    for(const [serviceId,monthlyUnits] of STACK)configureService(harness.runtime,projectId,serviceId,{tier:"starter",monthlyUnits});
    validateConfiguration(harness.runtime,projectId);
    deployProject(harness.runtime,projectId);
    confirmPendingDeployment(harness.runtime);
    deployProject(harness.runtime,projectId);
    expect(productionSnapshot(harness.state)).toBe(before);
    expect(harness.state.deployments.filter(d=>PRODUCTION_DEPLOYMENT_IDS.includes(d.id)).map(d=>d.id)).toEqual(PRODUCTION_DEPLOYMENT_IDS);
    expect(harness.state.projects.filter(p=>p.environment==="Production")).toHaveLength(2);
  });

  it("keeps production deployment decisions behind confirmation",()=>{
    expect(evaluateAction("deploy_project",{environment:"Production"})).toMatchObject({decision:"confirm",risk:"high"});
    expect(evaluateAction("configure_service",{environment:"Production"}).decision).toBe("confirm");
    // estimate_cost is read-only, so it stays automatic even at a high figure.
    expect(evaluateAction("estimate_cost",{monthlyCost:250}).decision).toBe("auto");
    // Documented policy gap: every one of the 10 tools matches an earlier rule, so the
    // monthlyCost>100 branch is only reachable for action names outside the tool set.
    // Consequential spend is still gated, because deploy_project always requires confirmation.
    expect(evaluateAction("unknown_expensive_action",{monthlyCost:250})).toMatchObject({decision:"confirm",risk:"high"});
    expect(evaluateAction("deploy_project",{environment:"Development"}).decision).toBe("confirm");
  });
});

describe("agent trace",()=>{
  it("collapses repeated invocations and caps the list",()=>{
    const harness=createTestRuntime();
    for(let i=0;i<4;i+=1)recordAgentInvocation(harness.runtime,{toolName:"get_pricing",status:"success",decision:"auto",risk:"low"});
    for(let i=0;i<4;i+=1)recordAgentInvocation(harness.runtime,{toolName:"estimate_cost",status:"success",decision:"auto",risk:"low"});
    recordAgentInvocation(harness.runtime,{toolName:"get_pricing",status:"success",decision:"auto",risk:"low"});
    const pricing=harness.state.agentEvents.find(event=>event.toolName==="get_pricing");
    expect(pricing?.count).toBe(5);
    expect(harness.state.agentEvents).toHaveLength(2);
    for(let i=0;i<20;i+=1)recordAgentInvocation(harness.runtime,{toolName:`tool_${i}`,status:"success",decision:"auto",risk:"low"});
    expect(harness.state.agentEvents.length).toBeLessThanOrEqual(12);
  });

  it("keeps failures distinct from successes",()=>{
    const harness=createTestRuntime();
    recordAgentInvocation(harness.runtime,{toolName:"validate_configuration",status:"success",decision:"auto",risk:"low"});
    recordAgentInvocation(harness.runtime,{toolName:"validate_configuration",status:"error",decision:"auto",risk:"low",error:"boom"});
    expect(harness.state.agentEvents).toHaveLength(2);
    expect(harness.state.agentEvents[0]).toMatchObject({status:"error",error:"boom"});
  });
});
