# SENTINEL — leader app of the COMMAND platform

**SENTINEL** is an autonomous incident commander built as a **NitroStack MCP app**: it detects a broken system, fixes it, proves the fix, scores its own confidence, deploys — or pauses for a human when unsure — and reports. It is the flagship of **COMMAND**, a set of five standalone MCP apps that share one engine and compose into a governed "autonomous enterprise OS."

Built for the Amrita Vishwa Vidyapeetham × NitroStack Agentic AI Hackathon.

> **New to this project? Read [`ARCHITECTURE.md`](./ARCHITECTURE.md)** — a complete,
> from-zero walkthrough: what every file does, how the pieces work together at runtime,
> an FAQ, and exactly what's left to finish. This README is the quick overview;
> `ARCHITECTURE.md` is the deep guide; [`DEPLOY.md`](./DEPLOY.md) is the deploy runbook.

---

## Architecture

The value is the **domain-agnostic engine core** (`src/core/`, zero framework dependency) plus thin **domain adapters**. Every app is `core + one adapter`.

```
src/
├── index.ts                 # bootstrap (McpApplicationFactory)
├── app.module.ts            # @McpApp root — registers feature modules
├── core/                    # THE SHARED SPINE (framework-free, unit-tested)
│   ├── types.ts             # Incident, Verdict, ToolResult, BlastRadius
│   ├── confidence.ts        # explainable autonomy gate (the HITL threshold)
│   ├── adapter.ts           # DomainAdapter interface — implement this per domain
│   ├── engine.ts            # detect→verify→gate→deploy→report lifecycle
│   └── engine.test.ts       # offline spine tests (no model, no network)
├── modules/
│   ├── sentinel/            # SENTINEL · DevOps — self-heal a broken service
│   ├── ledger/              # LEDGER   · FinOps — rightsize cloud spend
│   ├── verdict/             # VERDICT  · Legal  — cited contract redline
│   ├── relay/               # RELAY    · Civic  — file & track scheme applications
│   ├── aegis/               # AEGIS    · Trust  — guardrail all actions route through
│   └── command/             # COMMAND         — coordinator: runs the whole fleet, governed
├── health/                  # system health check
└── widgets/                 # React widgets (glass-box UI)
```

Five standalone commanders + a coordinator, all on one engine. Each `*/` module
is independently usable (its own tools + prompt) and could be split into its own
deploy; together, `command` runs them as one AEGIS-governed operation.

**Why the engine has no LLM loop:** in MCP, the connecting client model (ChatGPT / NitroStudio AI Chat) *is* the agent. The engine exposes a `planner` seam (client-driven, a Task strategy, or a test script drive it) and an `approvalGate` seam (mapped to MCP's native tool-approval for HITL). It never calls a model directly — so it's fully testable offline.

---

## Current status

- ✅ Shared engine core + explainable confidence gate (framework-free, unit-tested).
- ✅ **All five commanders + the COMMAND coordinator** implemented and self-contained — but
  **not registered** in `app.module.ts`. Only MENTOR is exposed as MCP tools; see
  `../GAPS.md` Gap 11. Their tests still run and still pass.
- ✅ **AEGIS guards every commander** (injected engine `guard`, runs before any deploy) — an unsafe action is blocked even at high confidence.
- ✅ **Organization mode** (`run_organization`): a commander pulls in a teammate mid-task and waits — LEDGER hits a code-caused spike, hands it to SENTINEL, continues after the fix; VERDICT + RELAY handle downstream. Real delegation + synchronization, all AEGIS-gated.
- ✅ **MissionTrace glass-box widget** — renders status, the confidence gate, the live trace, and the diff (bundles cleanly).
- ✅ **Two ways to drive SENTINEL:** the one-click `self_heal` Task **and** the client-driven granular tools (`open_incident` → `read_source`/`run_tests` → `propose_patch` → `resolve_incident` → `approve_incident`) so ChatGPT orchestrates the loop itself — per-incident state persisted server-side, same gate + AEGIS + HITL.
- ✅ `npm run build` compiles + bundles → `dist/`; **`npm test` → 32/32 passing**; org run + client-driven flow verified end-to-end.
- 📗 **Deploy runbook:** see [`DEPLOY.md`](./DEPLOY.md) (NitroCloud + ChatGPT, ~15 min).
- ⏳ Remaining: **only** the first NitroCloud deploy + ChatGPT connection (interactive — needs the organizer account). All code is deploy-ready.

### Headline tools (per commander)

| Commander | One-click Task | Read/observe |
|---|---|---|
| SENTINEL | `self_heal` (one-click); `open_incident`→`propose_patch`→`run_tests`→`resolve_incident`→`approve_incident` (client-driven) | `sentinel_status`, `assess_confidence`, `read_source`, `read_logs` |
| LEDGER | `optimize_spend` | `cloud_cost_report` |
| VERDICT | `redline_contract` | — |
| RELAY | `apply_for_scheme` | — |
| AEGIS | `guard` | `verify_output` |
| COMMAND | `run_operation`, `run_organization` | `platform_status` |

Each commander also ships an MCP **prompt** for the client-driven autonomy flow.

---

## Setup

Requires **Node 20.x** and npm.

```bash
npm install          # root deps (widgets install on first build)
npm run dev          # run locally; open in NitroStudio (App Canvas / AI Chat)
npm run build        # production bundle → dist/
npm test             # build + run the offline engine tests
```

## Deploy (NitroCloud → ChatGPT)

1. Push this repo to GitHub.
2. NitroCloud → **Create App** → **Connect Repository** → enable **auto-deploy** (every push redeploys).
3. When the deployment is **Live**, copy the Service URL and connect `{serviceUrl}/sse` to **ChatGPT** (Developer Mode).

> Never commit secrets. `.env` and keys are git-ignored; put credentials in NitroCloud / NitroStudio, not in the repo.

---

## Adding a domain (for teammates)

Each sibling app is one file's worth of real work against the core:

1. Implement `DomainAdapter` (`src/core/adapter.ts`) — `openContext`, `executeTool`, `verificationPassed`, `blastRadius`, `diff`, `deploy`, `awaitRecovery`, `report`, plus the `submitTool` / `verifyTool` / `mutationTools` metadata.
2. Wrap it in a NitroStack module: expose the actuators as `@Tool`s, the self-heal loop as a Task that runs `new Engine(adapter, { planner, approvalGate, onEvent })`, and a widget for the trace.
3. Reuse `core/confidence.ts` for the gate — do not reinvent scoring.

The engine, gate, and HITL are inherited; only the domain logic is new.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `SENTINEL_CONFIDENCE_THRESHOLD` | `0.80` | Score at/above which fixes act autonomously; below pauses for human approval. |
