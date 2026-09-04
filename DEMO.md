# Demo script

**Setup before recording:** Chrome with the WebMCP flag enabled, `npm run dev` running, http://localhost:3000 open, and the demo in a fresh state (click **Reset demo** in the ANAI rail footer, or **Start golden demo** which resets and runs in one action). Confirm the rail reads **WebMCP · Connected**.

---

## Full version — 60–90 seconds

### 0:00–0:10 · The problem

> "This is Forge, an infrastructure workspace. Production is healthy and costs $842 a month. Normally, standing up a new environment means going through service catalogues, pricing pages and configuration screens by hand."

Show the dashboard: production metrics, the **PRODUCTION · Healthy · Unchanged** panel, and the service table.

### 0:10–0:20 · WebMCP and the requirement

> "Forge publishes its capabilities to the browser as WebMCP tools — the rail shows WebMCP Connected. So instead of operating Forge myself, I state the outcome."

Point at **WebMCP · Connected**, then read the requirement field:

> "I need an AI backend under $50 a month. Don't touch production."

Point at the structured reading underneath: **Goal**, **Budget ≤ $50/month**, **Environment Development**, **Production Unchanged**.

### 0:20–0:45 · ANAI runs

Click **Run with ANAI**.

> "ANAI is not guessing at the interface. It discovered this page's tools and is calling them for real."

Show the plan advancing and the **AGENT ACTIVITY** rail filling in:

```
A  search_services            Automatic · low risk
A  get_service_details ×4     Automatic · low risk
A  compare_services           Automatic · low risk
A  get_pricing ×4             Automatic · low risk
A  estimate_cost ×4           Automatic · low risk
A  create_project             Automatic · low risk
A  configure_service ×4       Automatic · low risk
A  validate_configuration     Automatic · low risk
A  deploy_project             Confirmation · medium risk
```

> "Everything low-risk and reversible happened automatically."

### 0:45–1:00 · Evidence

> "It selected Compute, Model Runtime, API Gateway and a Database, priced them through the pricing tools, and came to $42.02 a month — inside the $50 limit I stated. Validation passed with no blocking issues."

Point at **ESTIMATED COST $42.02 / month** and the *Validate configuration — Configuration valid* step.

### 1:00–1:10 · The confirmation boundary

> "And here it stops."

Show **CONFIRMATION REQUIRED / ANAI is ready** — project, environment, cost, "Configuration validated. No blocking issues detected."

> "ANAI can prepare the environment, but deployment is consequential, so it requires the human. Nothing has been deployed: there are zero development deployments right now."

Click **Confirm deployment**.

### 1:10–1:30 · The result

> "Now it's live."

Show **LIVE**, the workflow strip reading ✓ Prepare ✓ Validate ✓ Confirm ✓ Live, and *Budget AI Backend · v0.1.0 · us-east-1 · Healthy* at the top of Recent deployments.

> "And the point that matters: production is still Healthy and Unchanged. The activity feed separates what the agent did from what I approved — the deployment is attributed to me, not to ANAI."

Point at **PRODUCTION · Healthy · Unchanged** and the `You — Confirmed deployment` row.

---

## Short version — 30 seconds

1. **0:00–0:06** — "Forge is an infrastructure workspace. It publishes its capabilities to the browser as WebMCP tools." Point at **WebMCP · Connected**.
2. **0:06–0:12** — Read the requirement: *"I need an AI backend under $50/month. Don't touch production."* Click **Run with ANAI**.
3. **0:12–0:20** — "ANAI discovered this page's tools and called them for real." Point at the agent activity list and **$42.02 / month**.
4. **0:20–0:26** — "It stops before deployment, because that needs a human." Show **CONFIRMATION REQUIRED**, click **Confirm deployment**.
5. **0:26–0:30** — "Live — and production is untouched." Show **LIVE** and **PRODUCTION · Healthy · Unchanged**.

---

## Optional 15-second addendum — a second WebMCP application

Open http://localhost:3000/repo.

> "The pattern isn't specific to Forge. Repo is a separate application with its own state and its own five WebMCP tools. Same mechanism: the site publishes capabilities, an agent discovers and calls them, and the environment it can create is development-only."

---

## Talking points if asked

- **"Is the agent really calling the tools?"** Open DevTools and run `await document.modelContext.getTools()` — 10 tools on Forge, 5 on `/repo`. In development, `window.__forgeCheckWebMcpContract()` returns `{ok: true, count: 10, issues: []}`.
- **"Could it deploy without me?"** No. `deploy_project` only deploys when the project is in `approvedDeployments`, which only the human confirmation writes. Retries and replans re-report `requiresConfirmation: true`.
- **"What if a tool fails?"** The step is marked failed, the plan halts, the failure is explained, dependent steps stay pending, and a retry control appears. ANAI never reports success the tool result does not support.
- **"Does the budget actually matter?"** Change the requirement to `$10/month` and run: the plan fails at Estimate cost and creates nothing.
- **"Is this an LLM?"** No. The requirement parser and planner are deterministic, offline, and dependency-free; unsupported requests are refused rather than improvised.

## Recovery

If anything goes wrong mid-demo, click **Reset demo** in the ANAI rail footer (development only) and start again from the requirement field. A page reload also returns the demo to its seeded state.
