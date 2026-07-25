import { ToolDecorator as Tool, PromptDecorator as Prompt, Widget, Module, ExecutionContext, z } from '@nitrostack/core';
import { Engine } from '../../core/engine.js';
import { FinOpsAdapter, ledgerPlanner } from './ledger.adapter.js';
import { CostModel } from './cloud.js';
import { aegisGuard } from '../aegis/trust.js';

export class LedgerTools {
  @Tool({
    name: 'cloud_cost_report',
    description: 'Read the current cloud spend, the baseline, the anomaly size, and the top cost drivers.',
    inputSchema: z.object({}),
  })
  async costReport(_input: unknown, ctx: ExecutionContext) {
    ctx.logger.info('cloud_cost_report');
    return new CostModel().report();
  }

  @Tool({
    name: 'optimize_spend',
    description:
      'Autonomously heal a cloud spend anomaly: LEDGER reads the bill, finds idle/over-provisioned ' +
      'resources, stages a rightsizing plan, simulates the savings AND SLA impact, scores its ' +
      'confidence at the autonomy gate, applies the plan, and confirms spend dropped. Returns the ' +
      'full mission trace and the money saved. Runnable as a Task in NitroStudio.',
    inputSchema: z.object({}),
  })
  @Widget('mission-trace')
  async optimizeSpend(_input: unknown, ctx: ExecutionContext) {
    const trace: Array<{ type: string; title: string }> = [];
    const engine = new Engine(new FinOpsAdapter(), {
      planner: ledgerPlanner(),
      approvalGate: () => true,
      guard: aegisGuard,
      onEvent: (e) => {
        trace.push({ type: e.type, title: e.title });
        ctx.logger.info(`trace: ${e.type}`, { title: e.title });
      },
    });
    const report = new CostModel().report();
    const incident = await engine.runIncident(
      `Cloud spend $${report.current_monthly_usd.toLocaleString()}/mo vs $${report.baseline_monthly_usd.toLocaleString()}/mo baseline ` +
        `(+${report.anomaly_pct}%, +$${report.anomaly_monthly_usd.toLocaleString()}/mo).`,
    );
    return {
      incident_id: incident.id,
      status: incident.status,
      root_cause: incident.diagnosis,
      fix_summary: incident.fixSummary,
      verdict: incident.verdict,
      diff: incident.diff,
      actions: incident.actions,
      trace,
    };
  }
}

export class LedgerPrompts {
  @Prompt({
    name: 'finops_optimizer',
    description: 'Drive an autonomous cloud-cost optimization: investigate, rightsize, simulate, apply.',
    arguments: [{ name: 'symptom', description: 'The spend anomaly (report / alert)', required: true }],
  })
  async finopsOptimizer(args: { symptom: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'You are LEDGER, an autonomous FinOps commander. A cloud account has a spend anomaly:\n\n' +
          `${args.symptom}\n\n` +
          'Use read_cost_report and list_resources to find waste, stage_change to plan rightsizing ' +
          '(delete idle resources, downsize over-provisioned ones — never below the safe floor), ' +
          'simulate_savings until it passes (savings > 0, no SLA risk), then submit with a ' +
          'calibrated confidence.',
      },
    ];
  }
}

@Module({
  name: 'ledger',
  description: 'FinOps cloud-cost commander — finds waste, simulates savings, rightsizes safely.',
  controllers: [LedgerTools, LedgerPrompts],
})
export class LedgerModule {}
