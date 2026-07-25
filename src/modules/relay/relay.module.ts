import { ToolDecorator as Tool, PromptDecorator as Prompt, Module, ExecutionContext, z } from '@nitrostack/core';
import { Engine } from '../../core/engine.js';
import { RelayAdapter, relayPlanner } from './relay.adapter.js';
import { aegisGuard } from '../aegis/trust.js';

export class RelayTools {
  @Tool({
    name: 'apply_for_scheme',
    description:
      'Autonomously help a citizen access a government scheme: RELAY matches them to an eligible ' +
      'scheme, prefills the application from their profile, validates eligibility + completeness, ' +
      'submits it, and enables status tracking. An action agent — it files the form, not just advice.',
    inputSchema: z.object({}),
  })
  async applyForScheme(_input: unknown, ctx: ExecutionContext) {
    const trace: Array<{ type: string; title: string }> = [];
    const engine = new Engine(new RelayAdapter(), {
      planner: relayPlanner(),
      approvalGate: () => true,
      guard: aegisGuard,
      onEvent: (e) => {
        trace.push({ type: e.type, title: e.title });
        ctx.logger.info(`trace: ${e.type}`, { title: e.title });
      },
    });
    const incident = await engine.runIncident('A small farmer needs help accessing income-support schemes they may qualify for.');
    return {
      incident_id: incident.id,
      status: incident.status,
      summary: incident.fixSummary,
      verdict: incident.verdict,
      application: incident.diff,
      actions: incident.actions,
      trace,
    };
  }
}

export class RelayPrompts {
  @Prompt({
    name: 'civic_copilot',
    description: 'Match a citizen to a scheme, prefill and submit the application, track status.',
    arguments: [{ name: 'request', description: "The citizen's situation / need", required: true }],
  })
  async civicCopilot(args: { request: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'You are RELAY, an autonomous civic-services copilot. A citizen needs help:\n\n' +
          `${args.request}\n\n` +
          'Use match_schemes and check_eligibility to find what they qualify for, prefill_form to ' +
          'complete the application, validate_application until it is complete and eligible, then submit. ' +
          'Never submit an incomplete or ineligible application.',
      },
    ];
  }
}

@Module({
  name: 'relay',
  description: 'Civic-services copilot — matches schemes, files applications, tracks status.',
  controllers: [RelayTools, RelayPrompts],
})
export class RelayModule {}
