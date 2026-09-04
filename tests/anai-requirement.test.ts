import {describe,expect,it} from "./runner";
import {DEFAULT_REQUIREMENT,parseRequirement,requirementFacts} from "@/lib/anai-requirement";

const supported=(text:string)=>{
  const parse=parseRequirement(text);
  if(!parse.supported)throw new Error(`expected "${text}" to be supported, got: ${parse.message}`);
  return parse.requirement;
};

describe("requirement parser",()=>{
  it("reads the demo requirement: AI backend, $50 budget, production untouched",()=>{
    const requirement=supported(DEFAULT_REQUIREMENT);
    expect(requirement.objective).toBe("Build an inexpensive AI backend");
    expect(requirement.budgetLimit).toBe(50);
    expect(requirement.environment).toBe("Development");
    expect(requirement.productionConstraint).toBe("unchanged");
  });

  it("supports the second demo phrasing without an explicit budget",()=>{
    const requirement=supported("I need an AI backend for development and want to keep production untouched.");
    expect(requirement.budgetLimit).toBeNull();
    expect(requirement.objective).toBe("Build an AI backend for development");
    expect(requirement.productionConstraint).toBe("unchanged");
  });

  it("rejects requests outside the supported scenario without inventing a plan",()=>{
    for(const text of ["Send an email to the team","Give me a Kubernetes cluster with 400 nodes","","   "]){
      const parse=parseRequirement(text);
      expect(parse.supported).toBe(false);
      if(!parse.supported)expect(parse.message.length>20).toBe(true);
    }
  });

  it("refuses to plan changes against production",()=>{
    const parse=parseRequirement("Deploy the new AI backend straight to production");
    expect(parse.supported).toBe(false);
    if(!parse.supported)expect(parse.message).toContain("will not plan changes to production");
  });

  it("reads budgets written in several ways",()=>{
    expect(supported("I need an AI backend, budget of $75 a month").budgetLimit).toBe(75);
    expect(supported("cheap ML inference service, no more than 30 dollars").budgetLimit).toBe(30);
    expect(supported("an AI api for $45/month").budgetLimit).toBe(45);
    expect(supported("I need an AI backend for a side project").budgetLimit).toBeNull();
  });

  it("is deterministic and side-effect free",()=>{
    const first=JSON.stringify(parseRequirement(DEFAULT_REQUIREMENT));
    for(let i=0;i<5;i+=1)expect(JSON.stringify(parseRequirement(DEFAULT_REQUIREMENT))).toBe(first);
  });

  it("exposes the structured reading shown before execution",()=>{
    const facts=requirementFacts(supported(DEFAULT_REQUIREMENT));
    expect(facts.map(fact=>fact.label)).toEqual(["GOAL","BUDGET","ENVIRONMENT","PRODUCTION"]);
    expect(facts[1].value).toContain("$50/month");
    expect(facts[3].value).toContain("Unchanged");
  });
});
