import {describe,expect,it} from "./runner";
import {configureRepository,createRepository,getRepository,initialRepoState,setEnvironment,validateRepository,type RepoRuntime} from "@/repo/state";
import type {RepoAppState} from "@/repo/types";

function createRepoHarness(){
  let state:RepoAppState=initialRepoState();
  const runtime:RepoRuntime={getState:()=>state,commit:next=>{state=next}};
  return {runtime,get state(){return state}};
}

const record=(value:unknown)=>value as Record<string,unknown>;

describe("repo seed state",()=>{
  it("starts with no repositories and no production concept",()=>{
    const harness=createRepoHarness();
    expect(harness.state.repositories).toHaveLength(0);
    expect(harness.state.selectedRepositoryId).toBeNull();
    expect(harness.state.activities).toHaveLength(0);
    expect(JSON.stringify(harness.state)).not.toContain("production");
  });
});

describe("create_repository",()=>{
  it("creates a real repository and selects it",()=>{
    const harness=createRepoHarness();
    const result=record(createRepository(harness.runtime,"Agent Service"));
    expect(result.created).toBe(true);
    expect(record(result.repository).id).toBe("repo_agent-service");
    expect(harness.state.repositories).toHaveLength(1);
    expect(harness.state.selectedRepositoryId).toBe("repo_agent-service");
    expect(harness.state.repositories[0].environment).toBeNull();
    expect(harness.state.activities[0].message).toContain("Created repository Agent Service");
  });

  it("rejects an empty name and refuses duplicates",()=>{
    const harness=createRepoHarness();
    expect(record(createRepository(harness.runtime,"   ")).created).toBe(false);
    createRepository(harness.runtime,"Agent Service");
    const duplicate=record(createRepository(harness.runtime,"agent service"));
    expect(duplicate.created).toBe(false);
    expect(String(duplicate.error)).toContain("already exists");
    expect(harness.state.repositories).toHaveLength(1);
  });
});

describe("get_repository",()=>{
  it("reads the actual current state",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    configureRepository(harness.runtime,"repo_agent-service",{runtime:"node"});
    const result=record(getRepository(harness.runtime,"repo_agent-service"));
    expect(result.found).toBe(true);
    expect(record(record(result.repository).configuration).runtime).toBe("node");
    expect(result.validation).toBeNull();
  });

  it("reports unknown ids without inventing a repository",()=>{
    const harness=createRepoHarness();
    const result=record(getRepository(harness.runtime,"repo_missing"));
    expect(result.found).toBe(false);
    expect(String(result.error)).toContain("Unknown repository id");
    expect(harness.state.repositories).toHaveLength(0);
  });
});

describe("configure_repository",()=>{
  it("merges configuration into real state",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    configureRepository(harness.runtime,"repo_agent-service",{runtime:"node"});
    const result=record(configureRepository(harness.runtime,"repo_agent-service",{packageManager:"npm"}));
    expect(result.configured).toBe(true);
    const configuration=harness.state.repositories[0].configuration;
    expect(configuration.runtime).toBe("node");
    expect(configuration.packageManager).toBe("npm");
  });

  it("refuses an unknown repository",()=>{
    const harness=createRepoHarness();
    const result=record(configureRepository(harness.runtime,"repo_missing",{runtime:"node"}));
    expect(result.configured).toBe(false);
    expect(harness.state.repositories).toHaveLength(0);
  });
});

describe("set_environment",()=>{
  it("sets the development environment",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    const result=record(setEnvironment(harness.runtime,"repo_agent-service","development"));
    expect(result.set).toBe(true);
    expect(result.environment).toBe("development");
    expect(harness.state.repositories[0].environment).toBe("development");
  });

  it("never creates a production environment",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    for(const environment of ["production","prod","staging","PRODUCTION",""]){
      const result=record(setEnvironment(harness.runtime,"repo_agent-service",environment));
      expect(result.set).toBe(false);
      expect(String(result.error)).toContain("development environments");
      expect(harness.state.repositories[0].environment).toBeNull();
    }
    expect(JSON.stringify(harness.state)).not.toContain("production");
  });
});

describe("validate_repository",()=>{
  it("fails a repository with no environment or runtime",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    const validation=record(validateRepository(harness.runtime,"repo_agent-service"));
    expect(validation.valid).toBe(false);
    expect((validation.errors as string[]).length).toBe(2);
    expect(harness.state.validations["repo_agent-service"].valid).toBe(false);
  });

  it("passes with warnings once the environment and runtime are set",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    setEnvironment(harness.runtime,"repo_agent-service","development");
    configureRepository(harness.runtime,"repo_agent-service",{runtime:"node"});
    const validation=record(validateRepository(harness.runtime,"repo_agent-service"));
    expect(validation.valid).toBe(true);
    expect((validation.errors as string[])).toHaveLength(0);
    expect((validation.warnings as string[]).length).toBe(2);
  });

  it("passes cleanly with a full configuration",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    setEnvironment(harness.runtime,"repo_agent-service","development");
    configureRepository(harness.runtime,"repo_agent-service",{runtime:"node",packageManager:"npm",testCommand:"npm test"});
    const validation=record(validateRepository(harness.runtime,"repo_agent-service"));
    expect(validation.valid).toBe(true);
    expect((validation.warnings as string[])).toHaveLength(0);
  });

  it("reports an unknown repository without mutating state",()=>{
    const harness=createRepoHarness();
    const validation=record(validateRepository(harness.runtime,"repo_missing"));
    expect(validation.valid).toBe(false);
    expect(harness.state.validations).toEqual({});
  });
});

describe("state transitions",()=>{
  it("walks create → configure → set environment → validate",()=>{
    const harness=createRepoHarness();
    createRepository(harness.runtime,"Agent Service");
    expect(record(validateRepository(harness.runtime,"repo_agent-service")).valid).toBe(false);
    configureRepository(harness.runtime,"repo_agent-service",{runtime:"node",packageManager:"npm",testCommand:"npm test"});
    expect(record(validateRepository(harness.runtime,"repo_agent-service")).valid).toBe(false);
    setEnvironment(harness.runtime,"repo_agent-service","development");
    expect(record(validateRepository(harness.runtime,"repo_agent-service")).valid).toBe(true);
    expect(harness.state.activities.map(a=>a.kind)).toContain("environment");
  });
});
