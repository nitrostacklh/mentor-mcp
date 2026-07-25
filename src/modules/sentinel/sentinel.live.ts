import { ToolDecorator as Tool, Widget, ExecutionContext, z } from '@nitrostack/core';
import * as session from './session.js';
import { BUGS } from './fixtures.js';

/**
 * Client-driven SENTINEL tools. The connecting model (ChatGPT) orchestrates the
 * loop itself — one tool call per step — instead of the one-click `self_heal`
 * Task. Pair with the `incident_commander` prompt. State persists per incident_id.
 */
export class SentinelLiveTools {
  @Tool({
    name: 'open_incident',
    description: 'Open an incident on the pricing service (injects a demo regression) and get the symptom + logs. Returns an incident_id to pass to the other tools.',
    inputSchema: z.object({
      bug: z.enum(Object.keys(BUGS) as [string, ...string[]]).default('tax-before-discount').describe('Which regression to reproduce.'),
    }),
  })
  async openIncident(input: any, ctx: ExecutionContext) {
    ctx.logger.info('open_incident', { bug: input.bug });
    return session.openIncident(input.bug ?? 'tax-before-discount');
  }

  @Tool({
    name: 'read_logs',
    description: 'Read the service logs for an incident (call open_incident first).',
    inputSchema: z.object({ incident_id: z.string() }),
  })
  async readLogs(input: any) {
    return session.callTool(input.incident_id, 'read_logs', {});
  }

  @Tool({
    name: 'read_source',
    description: 'Read the pricing service source (with line numbers) for an incident.',
    inputSchema: z.object({ incident_id: z.string() }),
  })
  async readSource(input: any) {
    return session.callTool(input.incident_id, 'read_file', { path: 'pricing.js' });
  }

  @Tool({
    name: 'search_code',
    description: 'Regex-search the pricing source for an incident.',
    inputSchema: z.object({ incident_id: z.string(), pattern: z.string() }),
  })
  async searchCode(input: any) {
    return session.callTool(input.incident_id, 'search_code', { pattern: input.pattern });
  }

  @Tool({
    name: 'propose_patch',
    description: 'Apply an exact, unique string replacement to the source (the minimal fix). Must be re-verified with run_tests before resolving.',
    inputSchema: z.object({ incident_id: z.string(), old: z.string().describe('Exact text to replace (unique in the file)'), new: z.string().describe('Replacement text') }),
  })
  async proposePatch(input: any) {
    return session.callTool(input.incident_id, 'propose_patch', { path: 'pricing.js', old: input.old, new: input.new });
  }

  @Tool({
    name: 'run_tests',
    description: 'Run the golden test suite against the patched source. You must get a passing run before resolving.',
    inputSchema: z.object({ incident_id: z.string() }),
  })
  async runTests(input: any) {
    return session.callTool(input.incident_id, 'run_tests', {});
  }

  @Tool({
    name: 'resolve_incident',
    description: 'Submit your resolution. Runs the confidence gate + AEGIS trust check; if it clears the autonomy threshold it deploys and verifies recovery, otherwise it pauses for approval. Only call after run_tests passes. Be honest about confidence.',
    inputSchema: z.object({
      incident_id: z.string(),
      root_cause: z.string(),
      fix_summary: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  })
  @Widget('mission-trace')
  async resolveIncident(input: any) {
    return session.resolveIncident(input.incident_id, input.root_cause, input.fix_summary, input.confidence);
  }

  @Tool({
    name: 'approve_incident',
    description: 'Human-in-the-loop: approve or reject a fix that paused below the autonomy threshold. Approving deploys it; rejecting escalates.',
    inputSchema: z.object({ incident_id: z.string(), approve: z.boolean(), note: z.string().default('') }),
  })
  @Widget('mission-trace')
  async approveIncident(input: any) {
    return session.approveIncident(input.incident_id, input.approve, input.note ?? '');
  }
}
