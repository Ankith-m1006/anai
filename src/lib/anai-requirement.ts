/**
 * Deterministic requirement parser for the ANAI entry point.
 *
 * This is not a language model and does not pretend to be one: it recognises the
 * infrastructure scenario Forge actually supports and refuses everything else rather
 * than fabricating a plan. No network, no API key, no non-determinism.
 */
export type ProductionConstraint="unchanged"|"unspecified";
export type ParsedRequirement={
  text:string;
  objective:string;
  budgetLimit:number|null;
  environment:"Development";
  productionConstraint:ProductionConstraint;
};
export type RequirementParse={supported:true;requirement:ParsedRequirement}|{supported:false;message:string};

export const DEFAULT_REQUIREMENT="I need an AI backend under $50/month. Don't touch production.";
const UNSUPPORTED="ANAI currently supports this infrastructure scenario in the demo: creating an inexpensive AI backend in a separate development environment while production stays unchanged.";
const PRODUCTION_TARGET="ANAI will not plan changes to production. Ask for a development environment instead.";

/** "an AI backend", "an ML inference service", "a model runtime stack" — the scenario Forge can actually deliver. */
const BACKEND_INTENT=/\b(ai|a\.i\.|ml|machine learning|inference|model|llm)\b[\s\S]{0,40}?\b(backend|back[- ]end|api|service|stack|environment|workload|app|application|platform)\b/;
/** Explicit request to change production, unless it is the "leave it alone" phrasing. */
const PRODUCTION_TARGETED=/\b(?:deploy|ship|push|change|modify|update|scale|migrate|touch)\b[\s\S]{0,60}?\bproduction\b/;
const PRODUCTION_PROTECTED=/\b(?:don'?t|do not|never|without|avoid|no)\b[\s\S]{0,30}?\b(?:touch|change|modify|affect|disturb|impact)\b[\s\S]{0,20}?\bproduction\b|\bproduction\b[\s\S]{0,30}?\b(?:untouched|unchanged|unaffected|intact|as is|alone|safe)\b|\b(?:keep|leave|preserve|protect)\b[\s\S]{0,20}?\bproduction\b/;
const BUDGET_PATTERNS=[
  /\b(?:under|below|less than|cheaper than|no more than|at most|max(?:imum)?(?:\s+of)?|up to|budget(?:\s+of)?|within)\s*\$?\s*(\d+(?:\.\d+)?)/,
  /\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)?\s*(?:month|mo\b)/,
];

export function parseRequirement(input:string):RequirementParse{
  const text=input.trim();
  if(!text)return {supported:false,message:"Describe what you need, for example: an AI backend under $50/month that leaves production untouched."};
  const normalized=text.toLowerCase();
  const productionConstraint:ProductionConstraint=PRODUCTION_PROTECTED.test(normalized)?"unchanged":"unspecified";
  if(productionConstraint!=="unchanged"&&PRODUCTION_TARGETED.test(normalized))return {supported:false,message:PRODUCTION_TARGET};
  if(!BACKEND_INTENT.test(normalized))return {supported:false,message:UNSUPPORTED};
  let budgetLimit:number|null=null;
  for(const pattern of BUDGET_PATTERNS){
    const match=normalized.match(pattern);
    if(match){const value=Number(match[1]);if(Number.isFinite(value)&&value>0){budgetLimit=value;break}}
  }
  return {supported:true,requirement:{
    text,
    objective:budgetLimit!==null?"Build an inexpensive AI backend":"Build an AI backend for development",
    budgetLimit,
    environment:"Development",
    productionConstraint,
  }};
}

/** The structured reading shown to the user before anything executes. */
export function requirementFacts(requirement:ParsedRequirement){
  return [
    {label:"GOAL",value:requirement.objective},
    {label:"BUDGET",value:requirement.budgetLimit!==null?`≤ $${requirement.budgetLimit.toFixed(2).replace(/\.00$/,"")}/month`:"Not specified"},
    {label:"ENVIRONMENT",value:requirement.environment},
    {label:"PRODUCTION",value:requirement.productionConstraint==="unchanged"?"Unchanged":"Unchanged (default)"},
  ];
}
