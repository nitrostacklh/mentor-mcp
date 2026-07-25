import { ToolDecorator as Tool, PromptDecorator as Prompt, Module, ExecutionContext, z } from '@nitrostack/core';
import { Engine } from '../../core/engine.js';
import { VerdictAdapter, verdictPlanner } from './verdict.adapter.js';
import { aegisGuard } from '../aegis/trust.js';

export class VerdictTools {
  @Tool({
    name: 'redline_contract',
    description:
      'Autonomously review the vendor contract, flag every non-compliant clause, and generate a ' +
      'cited redlined counter-offer. VERDICT does not just score — it rewrites the unsafe clauses ' +
      'with enforceable language and a regulation citation for each. Returns the trace and the redline.',
    inputSchema: z.object({}),
  })
  async redlineContract(_input: unknown, ctx: ExecutionContext) {
    const trace: Array<{ type: string; title: string }> = [];
    const engine = new Engine(new VerdictAdapter(), {
      planner: verdictPlanner(),
      approvalGate: () => true,
      guard: aegisGuard,
      onEvent: (e) => {
        trace.push({ type: e.type, title: e.title });
        ctx.logger.info(`trace: ${e.type}`, { title: e.title });
      },
    });
    const incident = await engine.runIncident('Vendor MSA with three flagged clauses (data processing, liability, auto-renewal).');
    return {
      incident_id: incident.id,
      status: incident.status,
      analysis: incident.diagnosis,
      summary: incident.fixSummary,
      verdict: incident.verdict,
      redline: incident.diff,
      actions: incident.actions,
      trace,
    };
  }
}

export class VerdictPrompts {
  @Prompt({
    name: 'compliance_counsel',
    description: 'Review a contract, flag non-compliant clauses, and draft a cited counter-offer.',
    arguments: [{ name: 'contract', description: 'The contract text to review', required: true }],
  })
  async complianceCounsel(args: { contract: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'You are VERDICT, autonomous compliance counsel. Review this contract:\n\n' +
          `${args.contract}\n\n` +
          'Use flag_risky_clauses to find non-compliant terms, apply_redline to rewrite each with a ' +
          'specific regulation citation, check_compliance until clean, then submit. Every change must cite a code.',
      },
    ];
  }
}

@Module({
  name: 'verdict',
  description: 'Compliance & contract orchestrator — flags unfair clauses and drafts a cited redline.',
  controllers: [VerdictTools, VerdictPrompts],
})
export class VerdictModule {}
