# Architecture

Two independent WebMCP applications in one Next.js 15 project (App Router, React 19, Turbopack). No backend, no database, no network calls at runtime, no LLM.

```
src/
  app/
    page.tsx            Forge + ANAI UI (client component, holds all Forge state)
    globals.css         Forge styles
    repo/page.tsx       Repo UI (independent)
    repo/repo.css       Repo styles
  data/forge.ts         Forge seed data + pure read functions
  types/forge.ts        Forge domain types
  lib/
    forge-state.ts      Forge state transitions + ForgeRuntime + agent telemetry
    anai-decision.ts    Autonomy policy (pure)
    anai-requirement.ts Deterministic requirement parser
    anai-agent.ts       ANAI planner (7-step state machine)
    webmcp.ts           Forge WebMCP registration / discovery / transport
    webmcp-contract.ts  Frozen Forge contract + checker
  repo/
    types.ts state.ts webmcp.ts contract.ts   Repo, importing nothing from Forge
tests/                  Node built-in test runner suites
```

## WebMCP registration

`registerForgeWebMcpTools(runtime)` in `src/lib/webmcp.ts`:

- Resolves the model context as `document.modelContext ?? navigator.modelContext`; `supportsWebMcp()` is `typeof context()?.registerTool === "function"` and drives the Connected / unavailable badge.
- Builds one array of 10 tool descriptors, each `{name, title, description, inputSchema, execute}`. Schemas are strict JSON Schema: `type: "object"`, explicit `required`, `additionalProperties: false`. `get_platform_overview` intentionally declares no input schema.
- Registers each with `mc.registerTool(tool, {signal: controller.signal})`, logging per-tool failures rather than aborting the batch.
- Returns `() => controller.abort()`, wired to the React effect cleanup, so unmount deregisters every tool. Strict Mode's double mount therefore registers → aborts → registers.

Handlers coerce every input defensively (`typeof x === "string" ? x : ""`, array filtering, object narrowing), so a malformed agent call returns a structured error object instead of throwing.

## Tool discovery and the execution contract

Verified against Chrome:

```js
const tools = await document.modelContext.getTools();
const tool  = tools.find(t => t.name === "estimate_cost");
const raw   = await document.modelContext.executeTool(tool, JSON.stringify({ serviceId: "compute", configuration: { tier: "starter", monthlyUnits: 160 } }));
const result = JSON.parse(raw);
```

- Argument 1 **must be the `RegisteredTool` object** returned by `getTools()`. Passing the tool name throws `TypeError: … not of type 'RegisteredTool'`.
- Argument 2 **must be a JSON string**. Passing a plain object throws `UnknownError: Failed to parse input arguments`.
- The return value is a JSON **string**; `callForgeToolThroughWebMcp` parses it and falls back to the raw value if parsing fails.
- `getTools()` ordering is not registration order — tools are always addressed by name.
- Descriptor fields exposed by Chrome: `name`, `title`, `description`, `inputSchema`, `origin`, `window`.

`callForgeToolThroughWebMcp(name, args)` is the single transport used by the planner. There is no direct-handler fallback: if WebMCP is unavailable the call throws and the plan fails visibly rather than simulating progress.

## Requirement parser

`src/lib/anai-requirement.ts` — pure, synchronous, offline, no dependencies. It returns `{supported: true, requirement}` or `{supported: false, message}`:

- **Intent**: an AI/ML/inference/model term near a backend/api/service/stack/environment term; anything else is refused.
- **Production guard**: a request to deploy or change *to* production (absent protective phrasing) is refused outright.
- **Budget**: `under|below|no more than|at most|up to|budget of|within $N`, or `$N/month`; otherwise `null`.
- **Environment**: always `Development` — the parser cannot emit a production target.

Output: `{text, objective, budgetLimit, environment, productionConstraint}`.

## Planner state machine

`runAnaiPlan(runtime, call, {fromStep?, requirement?})` in `src/lib/anai-agent.ts` runs seven steps: `understand → select → estimate → prepare → validate → confirm → golive`. Each step status is `pending | active | done | failed | blocked`, and a step only becomes `done` after its WebMCP calls returned usable results.

Per step, the real calls are:

| Step | Calls |
| --- | --- |
| understand | `get_platform_overview` |
| select | `search_services`, `get_service_details` ×4, `compare_services` |
| estimate | `get_pricing` ×4, `estimate_cost` ×4 |
| prepare | `create_project`, `configure_service` ×4 |
| validate | `validate_configuration` |
| confirm | `deploy_project` |
| golive | `get_platform_overview` (after human confirmation) |

Service roles are derived from the validator's own rules: `compute` and `model-runtime` are hard requirements, `api-gateway` and `database` are its recommendations. Costs come from real `estimate_cost` returns, never from constants.

**Result guards.** `expectObject` rejects a string (malformed JSON), a non-object, or a structured `error` field; `expectField` requires specific keys with type guards. Any violation raises `StepFailure(step, message)`, which marks that step failed, halts the plan, records the reason, leaves later steps `pending`, and offers a retry from the failed step. `create_project` is the single exception that tolerates an `error` alongside a returned project, so a re-run reuses the existing project instead of failing.

**Budget enforcement.** If `requirement.budgetLimit` is set and the real total exceeds it, the estimate step fails before any project is created.

## Confirmation gate

`deployProject` in `src/lib/forge-state.ts`:

1. Validates; refuses with an error if invalid.
2. Returns an existing non-failed deployment as `{deployed: true, alreadyDeployed: true, deployment, evaluation, validation}` — idempotency comes before the gate, so retries never re-enter it.
3. Evaluates the action; if confirmation is required and `approvedDeployments` does not contain the project id, writes `pendingAction` and returns `{deployed: false, requiresConfirmation: true}` **without creating a deployment**.
4. Only past that point does it append a deployment.

`approvedDeployments` is written by exactly one function, `confirmPendingDeployment`, which the human confirmation control calls. The planner cannot write it. On reaching the gate the planner sets status `awaiting_confirmation` and returns; `completeAnaiPlanAfterConfirmation` runs after the human action, re-reads state through `get_platform_overview`, and marks Go live **only if a deployment for that project actually exists**.

`evaluateAction(action, context)` in `anai-decision.ts` is pure and unchanged: seven read/validate actions plus `create_project` and non-production `configure_service` are `auto`; `deploy_project` is always `confirm` (`high` risk in Production, `medium` otherwise); a `monthlyCost > 100` rule and a confirm-by-default fallback cover anything else.

*Known policy detail:* every one of the 10 tool names matches an earlier rule, so the `monthlyCost > 100` branch is only reachable for action names outside the tool set. Consequential spend is still gated, because `deploy_project` always requires confirmation. This is asserted in the tests rather than silently changed.

## Agent attribution and telemetry

Each registered `execute` is wrapped once at registration time:

```
evaluateAction(tool.name) → runAsAgent(() => tool.execute(input)) → recordAgentInvocation(...)
```

- `runAsAgent` increments a depth counter that `stamp()` reads, so any activity written during a WebMCP invocation is tagged `source: "agent"`; human-initiated activity is tagged `"human"` and rendered as a `You` chip.
- `recordAgentInvocation` appends `{toolName, status, decision, risk, timestamp, count, error?}`. Repeats of the same tool+status merge into one counted entry moved to the front, and the list is capped at 12 — so polling `get_platform_overview` cannot flood the rail.
- The page also wraps the transport, so a failure that never reaches a handler (a transport-level fault) is still recorded as a failed agent event.
- Recording happens *after* the handler returns, so `get_platform_overview` never contains its own event.

**Sanitization.** `agentVisibleState()` strips `agentEvents` and `agentPlan` entirely and re-projects activities to `{id, kind, message, timestamp}`, dropping `source`. An agent reading `get_platform_overview` therefore sees only platform and project state: `activities, approvedDeployments, configurations, deployments, goal, pendingAction, projects, recommendation, selectedProjectId, validationResults, why`. This is asserted by a test that pins the exact key set.

## Production isolation

Seed data contains two production projects (`atlas`, `signal`) and three production deployments (`dep_01`, `dep_02`, `dep_03`). No tool handler can target them destructively: `create_project` always creates `environment: "Development"`, `configure_service` only appends to the named project, and production deployment would in any case evaluate to `confirm` at `high` risk. Tests snapshot the production slice as JSON and assert byte-equality across full runs, failures, retries and reset.

## Contract verification

`src/lib/webmcp-contract.ts` freezes the Forge surface: the 10 names, and per tool the exact `required` and `properties` key sets. `verifyWebMcpContract(tools)` checks count, exact names, absence of extras, non-empty title, meaningful description, schema presence, `type: "object"`, `additionalProperties: false`, and required/property sets — accepting Chrome's JSON-string schema form. It is exposed in development only as `window.__forgeCheckWebMcpContract()` and is never rendered in the UI. `src/repo/contract.ts` does the same for Repo's 5 tools via `window.__repoCheckWebMcpContract()`.

## State and the React bridge

All Forge state lives in one `useState` in `src/app/page.tsx`, mirrored into a `useRef` so tool handlers always read fresh state:

```ts
const runtime = { getState: () => ref.current, commit: next => { ref.current = next; setState(next) } };
```

That single `ForgeRuntime` is what makes an external agent's tool call re-render the UI: handlers commit through it, React re-renders, and the plan, activity rail and dashboard update as a consequence of real execution. Development-only helpers `window.__forgeResetDemo()` and the rail's **Reset demo** control restore the seeded state; both are gated on `NODE_ENV === "development"`.

## Repo's independent registry

`src/repo/*` duplicates none of Forge's code and imports none of it. It registers 5 tools from its own page with its own `AbortController`, has its own state tree seeded empty, and has no production concept: `set_environment` accepts only `"development"` and refuses anything else. Because WebMCP registration is per-document, Forge's page exposes only Forge's 10 tools and Repo's page only Repo's 5 — verified in Chrome from both pages.

## Testing

`npm test` runs Node's built-in test runner over `tests/*.test.ts` with no test-framework dependency: `tests/register.mjs` registers a small resolver hook that maps the `@/` alias and adds `.ts` extensions, and `tests/runner.ts` provides a minimal `expect` shim over `node:assert/strict`. A test framework was deliberately removed after an installed copy hoisted a conflicting `lightningcss` that broke Turbopack's CSS pipeline.

Coverage: plan transitions, requirement-driven planning and budget refusal, ten failure modes (transport throw, tool unavailable, malformed JSON, structured error, missing fields, invalid validation, warnings, deploy-without-deployment, retry), the confirmation gate, deployment idempotency, production isolation, agent-trace dedupe, agent-visible state sanitization, the requirement parser, and both WebMCP contracts including drift rejection.
