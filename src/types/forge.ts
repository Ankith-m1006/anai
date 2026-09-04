export type UserProfile={id:string;name:string;role:string;organization:string;preferences:{priorities:string[];deliveryCadence:string}};
export type ServiceStatus="Operational"|"Degraded"|"Maintenance";
export type ServicePricing={currency:"USD";baseMonthly:number;unit:string;unitPrice:number;defaultUnits:number};
export type Service={id:string;name:string;description:string;status:ServiceStatus;usage:string;monthlyCost:string;category:string;icon:string;details:string;pricing:ServicePricing};
export type Project={id:string;name:string;environment:"Production"|"Staging"|"Development";serviceIds:string[]};
export type Configuration={id:string;projectId:string;serviceId:string;configuration:Record<string,unknown>;updatedAt:string};
export type Deployment={id:string;projectId:string;projectName:string;version:string;region:string;status:"Healthy"|"Building"|"Failed";relativeTime:string};
export type AutonomyPolicy={mode:"guided";readOnlyActions:"automatic";consequentialActions:"confirmation_required";explanation:string};
export type ActionRisk="low"|"medium"|"high";export type ActionDecision="auto"|"confirm";export type ActionEvaluation={decision:ActionDecision;risk:ActionRisk;reason:string};
export type ActivitySource="human"|"agent";
export type Activity={id:string;kind:"project"|"configuration"|"validation"|"deployment"|"confirmation";message:string;timestamp:string;source?:ActivitySource};
export type AgentEvent={id:string;toolName:string;status:"success"|"error";decision:ActionDecision;risk:ActionRisk;timestamp:string;count:number;error?:string};
export type ValidationResult={valid:boolean;warnings:string[];errors:string[];validatedAt:string};
export type PendingAction={action:"deploy_project";projectId:string;reason:string}|null;
export type AgentStepId="understand"|"select"|"estimate"|"prepare"|"validate"|"confirm"|"golive";
export type AgentStepStatus="pending"|"active"|"done"|"failed"|"blocked";
export type AgentStep={id:AgentStepId;label:string;status:AgentStepStatus;detail?:string;error?:string};
export type AgentSelection={serviceId:string;name:string;monthlyCost:number;reason:string};
export type AgentPlanStatus="idle"|"running"|"awaiting_confirmation"|"complete"|"failed";
export type PlanRequirement={text:string;objective:string;budgetLimit:number|null;environment:string;productionConstraint:string};
export type AgentPlan={requirement:PlanRequirement|null;objective:string;status:AgentPlanStatus;steps:AgentStep[];currentStepId:AgentStepId|null;nextAction:string|null;decision:ActionDecision|null;risk:ActionRisk|null;estimatedMonthlyCost:number|null;selection:AgentSelection[];recommendationReason:string|null;why:string|null;projectId:string|null;failure:string|null};
export type ForgeAppState={projects:Project[];configurations:Configuration[];deployments:Deployment[];selectedProjectId:string|null;goal:string;recommendation:string;why:string;validationResults:Record<string,ValidationResult>;pendingAction:PendingAction;approvedDeployments:string[];activities:Activity[];agentEvents:AgentEvent[];agentPlan:AgentPlan};


