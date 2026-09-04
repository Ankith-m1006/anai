/**
 * Frozen description of the WebMCP surface Repo promises to agents.
 * Used by the tests and by the development-only browser checker; never by production UI.
 */
export const REPO_TOOL_NAMES=["create_repository","get_repository","configure_repository","set_environment","validate_repository"] as const;

export const REPO_SCHEMAS:Record<string,{required:string[];properties:string[]}>={
  create_repository:{required:["name"],properties:["name"]},
  get_repository:{required:["repositoryId"],properties:["repositoryId"]},
  configure_repository:{required:["repositoryId","configuration"],properties:["repositoryId","configuration"]},
  set_environment:{required:["repositoryId","environment"],properties:["repositoryId","environment"]},
  validate_repository:{required:["repositoryId"],properties:["repositoryId"]},
};

export type RepoContractTool={name?:unknown;title?:unknown;description?:unknown;inputSchema?:unknown};
export type RepoContractIssue={tool:string;problem:string};
export type RepoContractReport={ok:boolean;count:number;issues:RepoContractIssue[]};

const asSchema=(value:unknown)=>{
  if(typeof value==="string"){try{return JSON.parse(value) as Record<string,unknown>}catch{return null}}
  return value&&typeof value==="object"?value as Record<string,unknown>:null;
};

export function verifyRepoContract(tools:RepoContractTool[]):RepoContractReport{
  const issues:RepoContractIssue[]=[];
  const names=tools.map(tool=>typeof tool.name==="string"?tool.name:"<unnamed>");
  for(const expected of REPO_TOOL_NAMES)if(!names.includes(expected))issues.push({tool:expected,problem:"missing from getTools()"});
  for(const name of names)if(!(REPO_TOOL_NAMES as readonly string[]).includes(name))issues.push({tool:name,problem:"unexpected tool registered"});
  if(tools.length!==REPO_TOOL_NAMES.length)issues.push({tool:"<registry>",problem:`expected ${REPO_TOOL_NAMES.length} tools, found ${tools.length}`});
  for(const tool of tools){
    const name=typeof tool.name==="string"?tool.name:"<unnamed>";
    if(typeof tool.title!=="string"||tool.title.trim()==="")issues.push({tool:name,problem:"missing title"});
    if(typeof tool.description!=="string"||tool.description.trim().length<10)issues.push({tool:name,problem:"missing or too-short description"});
    const expected=REPO_SCHEMAS[name];
    if(!expected)continue;
    const schema=asSchema(tool.inputSchema);
    if(!schema){issues.push({tool:name,problem:"missing inputSchema"});continue}
    if(schema.type!=="object")issues.push({tool:name,problem:'schema type must be "object"'});
    if(schema.additionalProperties!==false)issues.push({tool:name,problem:"schema must set additionalProperties:false"});
    const required=Array.isArray(schema.required)?schema.required.map(String):[];
    const properties=schema.properties&&typeof schema.properties==="object"?Object.keys(schema.properties as Record<string,unknown>):[];
    const missingRequired=expected.required.filter(key=>!required.includes(key));
    const extraRequired=required.filter(key=>!expected.required.includes(key));
    const missingProperties=expected.properties.filter(key=>!properties.includes(key));
    const extraProperties=properties.filter(key=>!expected.properties.includes(key));
    if(missingRequired.length)issues.push({tool:name,problem:`required keys missing: ${missingRequired.join(", ")}`});
    if(extraRequired.length)issues.push({tool:name,problem:`unexpected required keys: ${extraRequired.join(", ")}`});
    if(missingProperties.length)issues.push({tool:name,problem:`schema properties missing: ${missingProperties.join(", ")}`});
    if(extraProperties.length)issues.push({tool:name,problem:`unexpected schema properties: ${extraProperties.join(", ")}`});
  }
  return {ok:issues.length===0,count:tools.length,issues};
}
