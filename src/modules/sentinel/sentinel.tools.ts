import { ToolDecorator as Tool, Widget, ExecutionContext, z } from '@nitrostack/core';
import { assess } from '../../core/confidence.js';
import { Engine } from '../../core/engine.js';
import { DevOpsAdapter, devopsPlanner } from './devops.adapter.js';
import { BUGS } from './fixtures.js';
import { aegisGuard } from '../aegis/trust.js';

/**
 * SENTINEL tools — Day-1 slice.
 *
 * `sentinel_status`   trivial round-trip that proves the NitroCloud → ChatGPT
 *                     deploy path end-to-end before any real logic exists.
 * `assess_confidence` the explainable autonomy gate (pillar #2) exposed as a
 *                     tool, so the confidence-scoring works live in ChatGPT on
 *                     day one and every other app reuses the same core.
 */
export class SentinelTools {
  @Tool({
    name: 'sentinel_status',
    description:
      'Report SENTINEL / COMMAND platform status and the domains it can heal. ' +
      'Use this to confirm the incident commander is online.',
    inputSchema: z.object({}),
  })
  async status(_input: unknown, ctx: ExecutionContext) {
    ctx.logger.info('sentinel_status invoked');
    return {
      platform: 'COMMAND',
      leader: 'SENTINEL — autonomous incident commander',
      version: '0.1.0',
      ready: true,
      domains: ['devops', 'finops', 'trust (aegis)', 'contracts (verdict)', 'civic (relay)'],
      tagline: 'Detect → fix → verify → gate → deploy — with a human in the loop when it matters.',
    };
  }

  @Tool({
    name: 'assess_confidence',
    description:
      'Score a proposed fix with the explainable autonomy gate. Returns a 0-1 ' +
      'confidence with a full weighted breakdown and whether it clears the ' +
      'threshold for autonomous action (otherwise a human must approve). ' +
      'The blast-radius score is domain-normalised (1 = smallest/safest change).',
    inputSchema: z.object({
      verification_passed: z
        .boolean()
        .describe('Did the fix prove out? (tests green / simulation clean)'),
      agent_confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("The agent's own calibrated confidence, 0.0-1.0"),
      iterations_used: z
        .number()
        .int()
        .min(1)
        .describe('How many verification attempts the fix took (1 = first try)'),
      blast_score: z
        .number()
        .min(0)
        .max(1)
        .describe('Domain-normalised change size, 1 = smallest/safest'),
      blast_reason: z
        .string()
        .default('unspecified change')
        .describe('Human-readable justification for the blast score'),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Override the autonomy threshold (default 0.80)'),
    }),
    examples: {
      request: {
        verification_passed: true,
        agent_confidence: 0.9,
        iterations_used: 1,
        blast_score: 0.8,
        blast_reason: '1 file, 1 line changed',
      },
      response: {
        score: 0.945,
        threshold: 0.8,
        autonomous: true,
      },
    },
  })
  async assessConfidence(input: any, ctx: ExecutionContext) {
    const verdict = assess({
      verificationPassed: input.verification_passed,
      agentConfidence: input.agent_confidence,
      iterationsUsed: input.iterations_used,
      blastScore: input.blast_score,
      blastReason: input.blast_reason ?? 'unspecified change',
      threshold: input.threshold,
    });
    ctx.logger.info('assess_confidence', {
      score: verdict.score,
      autonomous: verdict.autonomous,
    });
    return verdict;
  }

  @Tool({
    name: 'self_heal',
    description:
      'Run the autonomous DevOps self-heal on the bundled pricing service: SENTINEL ' +
      'reads the logs, finds the regression in the source, patches it, proves it with ' +
      'the golden test suite, scores its confidence at the autonomy gate, deploys, and ' +
      'reports. Returns the full mission trace and the resolution. Runnable as a Task ' +
      'in NitroStudio for live async status.',
    inputSchema: z.object({
      bug: z
        .enum(Object.keys(BUGS) as [string, ...string[]])
        .default('tax-before-discount')
        .describe('Which regression to inject and heal (demo scenario).'),
    }),
  })
  @Widget('mission-trace')
  async selfHeal(input: any, ctx: ExecutionContext) {
    const bug = input.bug ?? 'tax-before-discount';
    const adapter = new DevOpsAdapter(bug);
    const trace: Array<{ type: string; title: string }> = [];

    const engine = new Engine(adapter, {
      planner: devopsPlanner(bug),
      approvalGate: () => true, // one-click autonomous demo; HITL is shown via assess_confidence + the client-driven flow
      guard: aegisGuard, // AEGIS vets the fix before deploy — self-governed
      onEvent: (e) => {
        trace.push({ type: e.type, title: e.title });
        ctx.logger.info(`trace: ${e.type}`, { title: e.title });
      },
    });

    const incident = await engine.runIncident(
      `The pricing service is overcharging discounted orders.\n${BUGS[bug].log}`,
    );

    return {
      incident_id: incident.id,
      status: incident.status,
      root_cause: incident.diagnosis,
      fix_summary: incident.fixSummary,
      iterations: incident.iterations,
      verdict: incident.verdict,
      diff: incident.diff,
      actions: incident.actions,
      trace,
    };
  }
}
