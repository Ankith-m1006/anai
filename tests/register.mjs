// Registers the alias hook with Node's module loader (see alias-hook.mjs).
import {register} from "node:module";
import {pathToFileURL} from "node:url";

register("./alias-hook.mjs",pathToFileURL("./tests/"));
