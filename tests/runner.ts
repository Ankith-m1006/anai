/**
 * Minimal expect-style assertions over node:assert, so the suite runs on Node's built-in
 * test runner with zero extra dependencies (an added test framework hoisted a lightningcss
 * copy that broke Turbopack's Tailwind parsing, so the toolchain stays exactly as verified).
 */
import assert from "node:assert/strict";

type Matchers={
  toBe:(expected:unknown)=>void;
  toEqual:(expected:unknown)=>void;
  toMatchObject:(expected:Record<string,unknown>)=>void;
  toHaveLength:(expected:number)=>void;
  toContain:(expected:string)=>void;
  toMatch:(expected:RegExp)=>void;
  toBeDefined:()=>void;
  toBeNull:()=>void;
  toBeLessThanOrEqual:(expected:number)=>void;
  not:{toBeNull:()=>void;toContain:(expected:string)=>void};
};

export function expect(actual:unknown):Matchers{
  return {
    toBe:expected=>assert.strictEqual(actual,expected),
    toEqual:expected=>assert.deepStrictEqual(actual,expected),
    toMatchObject:expected=>{
      assert.ok(actual&&typeof actual==="object",`expected an object, received ${String(actual)}`);
      for(const [key,value] of Object.entries(expected))assert.deepStrictEqual((actual as Record<string,unknown>)[key],value,`mismatch on "${key}"`);
    },
    toHaveLength:expected=>{
      const length=(actual as {length?:number})?.length;
      assert.strictEqual(length,expected,`expected length ${expected}, received ${String(length)}`);
    },
    toContain:expected=>assert.ok(String(actual).includes(expected),`expected ${JSON.stringify(String(actual)).slice(0,200)} to contain ${expected}`),
    toMatch:expected=>assert.match(String(actual),expected),
    toBeDefined:()=>assert.notStrictEqual(actual,undefined),
    toBeNull:()=>assert.strictEqual(actual,null),
    toBeLessThanOrEqual:expected=>assert.ok(typeof actual==="number"&&actual<=expected,`expected ${String(actual)} <= ${expected}`),
    not:{
      toBeNull:()=>assert.notStrictEqual(actual,null),
      toContain:expected=>assert.ok(!String(actual).includes(expected),`expected value not to contain ${expected}`),
    },
  };
}

export {describe,it} from "node:test";
