/**
 * Frozen description of the WebMCP surface Forge promises to external agents.
 * Phase 4 verified this contract in Chrome; anything that drifts from it is a regression,
 * so this file is the reference used by the tests and the development-only checker.
 * It is never imported by production UI.
 */
export const EXPECTED_TOOL_NAMES=["get_platform_overview","search_services","get_service_details","compare_services","get_pricing","estimate_cost","create_project","configure_service","validate_configuration","deploy_project"] as const;

/** Required top-level input properties per tool. get_platform_overview intentionally takes no input schema. */
export const EXPECTED_SCHEMAS:Record<string,{required:string[];properties:string[]}|null>={
  get_platform_overview:null,
  search_services:{required:["query"],properties:["query"]},
  get_service_details:{required:["serviceId"],properties:["serviceId"]},
  compare_services:{required:["serviceIds"],properties:["serviceIds"]},
  get_pricing:{required:["serviceId"],properties:["serviceId"]},
  estimate_cost:{required:["serviceId","configuration"],properties:["serviceId","configuration"]},
  create_project:{required:["name"],properties:["name"]},
  configure_service:{required:["projectId","serviceId","configuration"],properties:["projectId","serviceId","configuration"]},
  validate_configuration:{required:["projectId"],properties:["projectId"]},
  deploy_project:{required:["projectId"],properties:["projectId"]},
};

export type ContractTool={name?:unknown;title?:unknown;description?:unknown;inputSchema?:unknown};
export type ContractIssue={tool:string;problem:string};
export type ContractReport={ok:boolean;count:number;issues:ContractIssue[]};

const asSchema=(value:unknown):{type?:unknown;properties?:Record<string,unknown>;required?:unknown;additionalProperties?:unknown}|null=>{
  if(typeof value==="string"){try{return JSON.parse(value)}catch{return null}}
  return value&&typeof value==="object"?value as Record<string,unknown>:null;
};

/** Verifies a live getTools() result against the frozen contract. Pure, so the tests and the browser checker share one implementation. */
export function verifyWebMcpContract(tools:ContractTool[]):ContractReport{
  const issues:ContractIssue[]=[];
  const names=tools.map(tool=>typeof tool.name==="string"?tool.name:"<unnamed>");
  for(const expected of EXPECTED_TOOL_NAMES)if(!names.includes(expected))issues.push({tool:expected,problem:"missing from getTools()"});
  for(const name of names)if(!(EXPECTED_TOOL_NAMES as readonly string[]).includes(name))issues.push({tool:name,problem:"unexpected tool registered"});
  if(tools.length!==EXPECTED_TOOL_NAMES.length)issues.push({tool:"<registry>",problem:`expected ${EXPECTED_TOOL_NAMES.length} tools, found ${tools.length}`});
  for(const tool of tools){
    const name=typeof tool.name==="string"?tool.name:"<unnamed>";
    if(typeof tool.title!=="string"||tool.title.trim()==="")issues.push({tool:name,problem:"missing title"});
    if(typeof tool.description!=="string"||tool.description.trim().length<10)issues.push({tool:name,problem:"missing or too-short description"});
    const expectedSchema=EXPECTED_SCHEMAS[name];
    if(expectedSchema===undefined)continue;
    const schema=asSchema(tool.inputSchema);
    if(expectedSchema===null){
      if(schema)issues.push({tool:name,problem:"unexpected inputSchema; contract declares none"});
      continue;
    }
    if(!schema){issues.push({tool:name,problem:"missing inputSchema"});continue}
    if(schema.type!=="object")issues.push({tool:name,problem:`schema type must be "object"`});
    if(schema.additionalProperties!==false)issues.push({tool:name,problem:"schema must set additionalProperties:false"});
    const required=Array.isArray(schema.required)?schema.required.map(String):[];
    const properties=schema.properties&&typeof schema.properties==="object"?Object.keys(schema.properties):[];
    const missingRequired=expectedSchema.required.filter(key=>!required.includes(key));
    const extraRequired=required.filter(key=>!expectedSchema.required.includes(key));
    const missingProperties=expectedSchema.properties.filter(key=>!properties.includes(key));
    const extraProperties=properties.filter(key=>!expectedSchema.properties.includes(key));
    if(missingRequired.length)issues.push({tool:name,problem:`required keys missing: ${missingRequired.join(", ")}`});
    if(extraRequired.length)issues.push({tool:name,problem:`unexpected required keys: ${extraRequired.join(", ")}`});
    if(missingProperties.length)issues.push({tool:name,problem:`schema properties missing: ${missingProperties.join(", ")}`});
    if(extraProperties.length)issues.push({tool:name,problem:`unexpected schema properties: ${extraProperties.join(", ")}`});
  }
  return {ok:issues.length===0,count:tools.length,issues};
}
