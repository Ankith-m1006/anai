# ANAI — AI Operating Layer for WebMCP

## One-line pitch

State an infrastructure outcome in plain language; ANAI discovers the website's own WebMCP tools, performs the safe reversible work itself, and stops for your approval before anything consequential.

## The problem

Web applications already contain the functionality people need, but an AI agent cannot reliably use it. Agents either need a bespoke backend integration per application, or they drive the interface by scraping and clicking — brittle, unauditable, and impossible to gate safely. The user is left doing the operating themselves: choosing services, comparing prices, filling configuration screens, and clicking through wizards.

## The idea

WebMCP lets a web page publish its capabilities to the browser as structured tools. ANAI uses that: it discovers the tools the page registered, plans against them, and invokes them through the real browser API. Nothing is scraped, nothing is simulated, and no custom backend integration exists between ANAI and the application.

## What makes this different

This is not a chatbot calling a private API and describing what it did.

- **Forge itself registers the tools.** The application publishes 10 WebMCP tools from its own page.
- **ANAI discovers them at runtime** via `document.modelContext.getTools()` — it is not given a hardcoded client.
- **ANAI invokes them through the real API**, `executeTool(RegisteredTool, JSON.stringify(args))`, and the returned values feed the plan.
- **Forge's state changes because those tools executed** — the UI updates as a consequence, not as an animation.
- **The agent stops at the deployment boundary** and hands the decision to a human.

| Traditional AI chat | ANAI + WebMCP |
| --- | --- |
| "Here are the steps you should take." | "I performed the safe steps through this site's own tools, and stopped where your approval is required." |

## Golden demo

The requirement, entered in the page's requirement field:

> I need an AI backend under $50/month. Don't touch production.

ANAI parses it deterministically (no LLM, no network) into `{objective, budgetLimit: 50, environment: "development", productionConstraint: "unchanged"}`, then executes this sequence through real WebMCP calls:

1. **Understand requirement** — `get_platform_overview`
2. **Select services** — `search_services`, `get_service_details` ×4, `compare_services`
3. **Estimate cost** — `get_pricing` ×4, `estimate_cost` ×4 → **$42.02/month**, checked against the stated $50 limit
4. **Prepare environment** — `create_project`, `configure_service` ×4
5. **Validate configuration** — `validate_configuration`
6. **Confirm deployment** — `deploy_project` returns `requiresConfirmation: true`; **ANAI stops here**
7. **Go live** — only after the human clicks Confirm; ANAI then re-reads state and reports LIVE

Selected stack: Compute, Model Runtime, API Gateway, Database. Result: *Budget AI Backend · Development · us-east-1 · v0.1.0 · Healthy*. Production is untouched throughout.

The budget genuinely constrains the plan: with a `$10/month` requirement the plan fails honestly at Estimate cost and creates no project, no deployment, and no confirmation request.

## Architecture

```
User requirement
   → ANAI requirement parser (deterministic)
   → ANAI planner (7-step state machine)
   → WebMCP: getTools() → executeTool(RegisteredTool, JSON.stringify(args))
   → Forge tool handlers
   → Forge application state
   → human confirmation at the deployment boundary
   → deployment → ANAI verifies the result
```

A second, independent application, **Repo**, is included to show that this is a pattern rather than one bespoke integration. Repo has its own UI, state, types, registration layer and tool handlers, imports nothing from Forge, and exposes its own 5 WebMCP tools from its own page (`/repo`). The two registries are separate: Forge's page exposes only Forge's tools, Repo's page only Repo's.

See `ARCHITECTURE.md` for implementation detail and `DEMO.md` for the presentation script.

## WebMCP tools

### Forge — 10 tools

| Tool | Input |
| --- | --- |
| `get_platform_overview` | *(no input schema)* |
| `search_services` | `{ query: string }` |
| `get_service_details` | `{ serviceId: string }` |
| `compare_services` | `{ serviceIds: string[] }` |
| `get_pricing` | `{ serviceId: string }` |
| `estimate_cost` | `{ serviceId: string, configuration: object }` |
| `create_project` | `{ name: string }` |
| `configure_service` | `{ projectId: string, serviceId: string, configuration: object }` |
| `validate_configuration` | `{ projectId: string }` |
| `deploy_project` | `{ projectId: string }` |

### Repo — 5 tools

| Tool | Input |
| --- | --- |
| `create_repository` | `{ name: string }` |
| `get_repository` | `{ repositoryId: string }` |
| `configure_repository` | `{ repositoryId: string, configuration: object }` |
| `set_environment` | `{ repositoryId: string, environment: "development" }` |
| `validate_repository` | `{ repositoryId: string }` |

Every schema is `type: "object"` with `additionalProperties: false` and explicit `required` keys. Both contracts are frozen and machine-checked (`src/lib/webmcp-contract.ts`, `src/repo/contract.ts`).

## Safety model

**Automatic** — low-risk, reversible, no spend: discovery, search, service inspection, comparison, pricing, cost estimation, development project creation, development configuration, validation.

**Confirmation required** — consequential: deployment, production changes, and actions evaluated as significant spend.

The gate is real, not cosmetic. `deploy_project` refuses to deploy unless the project id is in `approvedDeployments`, which only the human confirmation action writes. Repeated agent calls, retries, replans and reloads cannot bypass it; each blocked call simply re-reports `requiresConfirmation: true` and creates nothing.

This is a **product-level autonomy policy and demo safety model, not a security boundary**. It is client-side and would not stop a determined attacker; it exists to model the human/agent authorization split.

## Verification

Verified in Chrome with the WebMCP local-development flag enabled:

- `document.modelContext.getTools()` returns **exactly 10 tools** on Forge and **exactly 5** on `/repo`, with unchanged names, titles, descriptions and schemas.
- Contract checkers return `{ok: true, count: 10, issues: []}` and `{ok: true, count: 5, issues: []}`.
- Every tool was executed through the real API using `executeTool(RegisteredTool, JSON.stringify(args))`. Chrome rejects a plain object (`UnknownError: Failed to parse input arguments`) and a tool name (`TypeError: … not of type 'RegisteredTool'`); results return as JSON strings and are parsed defensively.
- Golden path confirmed end to end, including 0 development deployments before approval, exactly 1 after, idempotent retries (`alreadyDeployed: true`), and production deployments `dep_01`/`dep_02`/`dep_03` unchanged.

Automated checks:

```bash
npm test          # 61 tests, 19 suites, 0 failures
npm run lint      # no ESLint warnings or errors
npx tsc --noEmit  # clean
npm run build     # succeeds
```

The test suite runs on Node's built-in test runner with no test-framework dependency, and covers plan transitions, failure handling, the confirmation gate, deployment idempotency, production isolation, agent-visible state sanitization, the requirement parser, and both WebMCP contracts.

## Limitations

- WebMCP is an experimental, draft-dependent browser capability. It requires Chrome with the local-development flag; elsewhere Forge shows "Browser support unavailable", registers nothing, and the ANAI run action is disabled rather than pretending to execute.
- Application state is client-side only. A reload returns to the seeded demo state; there is no persistence, database or authentication.
- Deployments are simulated. No cloud provider, credential, or network call is involved anywhere in the demo.
- The requirement parser is deterministic pattern matching over one supported scenario, not language understanding. Unsupported requests are refused explicitly rather than answered with an invented plan.
- The non-WebMCP path is verified by code inspection only, because the browser flag is global and `document.modelContext` cannot be removed before the page mounts.
- Repo runs as a separate page in the same dev server, so it is code- and state-independent but not a separate origin.

## Running locally

Requires Node 20+ (developed on Node 24) and Chrome with WebMCP enabled.

```bash
npm install
npm run dev
```

Then open:

- Forge + ANAI — http://localhost:3000
- Repo — http://localhost:3000/repo

To enable WebMCP in Chrome, turn on the WebMCP / model-context local-development flag in `chrome://flags` and restart the browser. The ANAI rail shows **WebMCP · Connected** when the API is present.

## Demo instructions

1. Open http://localhost:3000. The rail reads **WebMCP · Connected**; production shows **Healthy · Unchanged**.
2. The requirement field is prefilled with *"I need an AI backend under $50/month. Don't touch production."* — ANAI's structured reading appears beneath it.
3. Click **Run with ANAI** (or **Start golden demo** for a clean start). The agent plan advances through real WebMCP calls and the AGENT ACTIVITY rail fills with the tools that actually ran.
4. ANAI stops at **CONFIRMATION REQUIRED**, showing $42.02/month and "Configuration validated." No deployment exists yet.
5. Click **Confirm deployment**. The workflow completes to **LIVE**, *Budget AI Backend* appears in Recent deployments, and production remains unchanged.

`DEMO.md` contains a timed 60–90 second script and a 30-second short version.
