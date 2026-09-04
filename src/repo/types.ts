/**
 * Repo is an independent WebMCP-native application. It shares no types, state, or code
 * with Forge, and it has no production concept at all: every repository it can create
 * lives in a development environment.
 */
export type RepoEnvironment="development";

export type RepoConfiguration={
  runtime?:string;
  packageManager?:string;
  testCommand?:string;
  [key:string]:unknown;
};

export type Repository={
  id:string;
  name:string;
  environment:RepoEnvironment|null;
  configuration:RepoConfiguration;
  createdAt:string;
  updatedAt:string;
};

export type RepoValidation={
  repositoryId:string;
  valid:boolean;
  errors:string[];
  warnings:string[];
  validatedAt:string;
};

export type RepoActivity={
  id:string;
  kind:"repository"|"configuration"|"environment"|"validation";
  message:string;
  timestamp:string;
  source:"agent"|"human";
};

export type RepoAppState={
  repositories:Repository[];
  selectedRepositoryId:string|null;
  validations:Record<string,RepoValidation>;
  activities:RepoActivity[];
};
