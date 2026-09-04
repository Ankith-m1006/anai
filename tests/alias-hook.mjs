// Resolves the project's "@/..." TypeScript path alias for Node's test runner.
import {pathToFileURL} from "node:url";
import {resolve as resolvePath} from "node:path";

const SRC=pathToFileURL(resolvePath(process.cwd(),"src")+"/").href;

export function resolve(specifier,context,nextResolve){
  if(specifier.startsWith("@/")){
    const target=SRC+specifier.slice(2);
    return nextResolve(target.endsWith(".ts")?target:`${target}.ts`,context);
  }
  if((specifier.startsWith("./")||specifier.startsWith("../"))&&!/\.[a-z]+$/.test(specifier))return nextResolve(`${specifier}.ts`,context);
  return nextResolve(specifier,context);
}
