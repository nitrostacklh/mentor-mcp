/**
 * LEDGER adapter — heals a cloud bill by staging + simulating a rightsizing
 * plan, then applying it. Mirrors the DevOps lifecycle exactly, so the engine
 * drives it unchanged. Ported from the verified Python FinOps reference.
 */

import type { BlastRadius, Incident, ToolResult } from '../../core/types.js';
import type { DomainAdapter, EmitFn, IncidentContext } from '../../core/adapter.js';
import type { EngineAction, Planner } from '../../core/engine.js';
import { BASELINE_MONTHLY, CostModel } from './cloud.js';

interface CloudCtx extends IncidentContext {
  model: CostModel;
}

export class FinOpsAdapter implements DomainAdapter {
  readonly key = 'finops';
  readonly displayName = 'FinOps · Cloud Cost Healing';
  readonly tagline = 'Finds the waste, simulates the savings, rightsizes without breaking SLAs.';
  readonly submitTool = 'submit_resolution';
  readonly verifyTool = 'simulate_savings';
  readonly mutationTools = new Set(['stage_change']);

  /** When run under the Coordinator, this lets LEDGER pull in another commander. */
  constructor(private readonly delegate?: (toDomain: string, reason: string) => Promise<{ domain: string; status: string; summary: string; trustScore: number }>) {}

  systemPrompt(): string {
    return [
      'You are SENTINEL/LEDGER, an autonomous FinOps commander. A cloud account has a spend',
      'anomaly. Read the cost report, inspect the inventory, stage a rightsizing plan (resize,',
      'delete idle resources, or change tier), simulate it — it must show real savings AND no',
      'SLA risk — then submit. Never cut a resource below its safe floor; availability beats savings.',
    ].join(' ');
  }

  framing(symptom: string): string {
    return `Detected spend anomaly:\n${symptom}\n\nInvestigate the drivers, stage a rightsizing plan, simulate savings + SLA impact, then submit_resolution.`;
  }

  openContext(incidentId: string): CloudCtx {
    return { incidentId, emit: () => {}, model: new CostModel() };
  }

  async executeTool(ctx: IncidentContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const m = (ctx as CloudCtx).model;
    switch (name) {
      case 'read_cost_report':
        return { data: m.report() };
      case 'list_resources':
        return { data: { resources: m.listResources() } };
      case 'inspect_resource':
        return { data: m.inspect(String(args.resource_id)) };
      case 'stage_change': {
        const change = m.stage(String(args.resource_id), String(args.action), args.target_monthly_usd as number | undefined);
        await ctx.emit('patch.applied', `Staged ${change.action} on ${change.resource_id}`, { path: change.resource_id, diff: changeDiff(change) });
        return { data: { staged: true, ...change } };
      }
      case 'simulate_savings': {
        const sim = m.simulate();
        await ctx.emit('tests.result', `${sim.passed ? '✅' : '❌'} ${sim.summary}`, { passed: sim.passed, summary: sim.summary, output: sim.output });
        return { data: sim };
      }
      case 'request_assist': {
        // Cross-domain help: hand a sub-problem to another commander and wait.
        if (!this.delegate) return { data: { skipped: true, note: 'no coordinator attached — running solo' } };
        await ctx.emit('referral.requested', `Requesting ${args.to_domain} to handle: ${args.reason}`, { to_domain: args.to_domain, reason: args.reason });
        const r = await this.delegate(String(args.to_domain), String(args.reason));
        await ctx.emit('referral.resolved', `${r.domain} → ${r.status}: ${r.summary}`, r as unknown as Record<string, unknown>);
        return { data: r };
      }
      default:
        return { data: { error: `unknown tool ${name}` }, isError: true };
    }
  }

  verificationPassed(result: Record<string, unknown>): boolean {
    return result.passed === true;
  }

  blastRadius(ctx: IncidentContext): BlastRadius {
    const [resources, dollars] = (ctx as CloudCtx).model.blast();
    const penalty = 0.15 * Math.max(resources - 1, 0) + 0.05 * Math.max(dollars / 1000 - 1, 0);
    return { score: Math.max(0, 1 - penalty), reason: `${resources} resource(s), $${dollars.toLocaleString()}/mo change` };
  }

  diff(ctx: IncidentContext): string {
    return (ctx as CloudCtx).model.diff();
  }

  async deploy(ctx: IncidentContext): Promise<string[]> {
    return (ctx as CloudCtx).model.apply();
  }

  async awaitRecovery(ctx: IncidentContext): Promise<boolean> {
    const r = (ctx as CloudCtx).model.report();
    const recovered = r.current_monthly_usd <= r.baseline_monthly_usd * 1.05;
    if (recovered) await ctx.emit('deploy.verified', `Spend back within baseline — $${r.current_monthly_usd.toLocaleString()}/mo (baseline $${r.baseline_monthly_usd.toLocaleString()})`, r);
    else await ctx.emit('deploy.failed', `Spend still above baseline: $${r.current_monthly_usd.toLocaleString()}/mo`, r);
    return recovered;
  }

  async report(incident: Incident, ctx: IncidentContext): Promise<Array<Record<string, unknown>>> {
    const card = { kind: 'wekan_card', mode: 'mock', id: `card-${incident.id}`, title: incident.fixSummary };
    await ctx.emit('action.wekan', `WeKan card (mock): ${card.id}`, card);
    const slack = { kind: 'slack_post', mode: 'mock', text: `💰 ${incident.id} resolved — ${incident.fixSummary}` };
    await ctx.emit('action.slack', 'Slack update posted (mock)', slack);
    return [card, slack];
  }

  async notifyEscalation(incident: Incident, reason: string, emit: EmitFn): Promise<Array<Record<string, unknown>>> {
    const alert = { kind: 'slack_escalation', mode: 'mock', reason };
    await emit('action.slack', `🚨 ${incident.id} escalated: ${reason}`, alert);
    return [alert];
  }
}

/**
 * Organization planner: LEDGER investigates, realises the spend spike is caused
 * by a code regression, and pulls in SENTINEL to fix it BEFORE rightsizing —
 * then proceeds once SENTINEL reports back. Used by the Coordinator.
 */
export function ledgerOrgPlanner(): Planner {
  const steps: Array<EngineAction | null> = [
    { type: 'tool', name: 'read_cost_report' },
    { type: 'tool', name: 'request_assist', args: { to_domain: 'sentinel', reason: 'A pricing-service regression is driving runaway compute; fix it before we rightsize.' } },
    { type: 'tool', name: 'list_resources' },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'vol-orphaned-01', action: 'delete' } },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'vol-orphaned-02', action: 'delete' } },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'nodepool-web-prod', action: 'rightsize', target_monthly_usd: 1900 } },
    { type: 'tool', name: 'simulate_savings' },
    { type: 'submit', resolution: { rootCause: 'Runaway compute from a pricing regression, compounded by 2 idle volumes and an over-provisioned web pool.', fixSummary: 'Had SENTINEL fix the regression, then deleted idle volumes and rightsized the web pool.', confidence: 0.9 } },
  ];
  let i = 0;
  return () => (i < steps.length ? steps[i++] : null);
}

/** Rule-based planner for the one-click `optimize_spend` demo. */
export function ledgerPlanner(): Planner {
  const steps: Array<EngineAction | null> = [
    { type: 'tool', name: 'read_cost_report' },
    { type: 'tool', name: 'list_resources' },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'vol-orphaned-01', action: 'delete' } },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'vol-orphaned-02', action: 'delete' } },
    { type: 'tool', name: 'stage_change', args: { resource_id: 'nodepool-web-prod', action: 'rightsize', target_monthly_usd: 1900 } },
    { type: 'tool', name: 'simulate_savings' },
    { type: 'submit', resolution: { rootCause: 'Over-provisioned web node pool (22% util) plus two orphaned volumes drove a spend spike.', fixSummary: 'Delete 2 idle volumes and rightsize the web pool to its safe floor.', confidence: 0.9 } },
  ];
  let i = 0;
  return () => (i < steps.length ? steps[i++] : null);
}

function changeDiff(c: { resource_id: string; action: string; before_monthly_usd: number; projected_monthly_usd: number; rationale: string }): string {
  return `--- ${c.resource_id} (before)\n+++ ${c.resource_id} (after ${c.action})\n- $${c.before_monthly_usd.toLocaleString()}/mo\n+ $${c.projected_monthly_usd.toLocaleString()}/mo   # ${c.rationale}`;
}

export { BASELINE_MONTHLY };
