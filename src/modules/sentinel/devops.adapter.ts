/**
 * DevOps adapter — heals the bundled pricing service by patching + verifying
 * its source in-process. Implements the framework-free core `DomainAdapter`;
 * the engine drives it identically to every other domain.
 */

import type { BlastRadius, Incident, ToolResult } from '../../core/types.js';
import type { DomainAdapter, EmitFn, IncidentContext } from '../../core/adapter.js';
import type { EngineAction, Planner } from '../../core/engine.js';
import { BUGS, injectBug, runChecks, type Bug } from './fixtures.js';

const FILE = 'pricing.js';

interface DevOpsCtx extends IncidentContext {
  bug: Bug;
  initialSource: string; // the broken source the incident opened with
  workingSource: string; // the sandbox copy being patched
  liveSource: string; // what's "deployed"
  touched: boolean;
}

export class DevOpsAdapter implements DomainAdapter {
  readonly key = 'devops';
  readonly displayName = 'DevOps · Service Healing';
  readonly tagline = 'Patches the regression, proves it with the suite, ships the fix.';
  readonly submitTool = 'submit_resolution';
  readonly verifyTool = 'run_tests';
  readonly mutationTools = new Set(['propose_patch']);

  constructor(private readonly bugName = 'tax-before-discount') {}

  systemPrompt(): string {
    return [
      'You are SENTINEL, an autonomous incident commander for production services.',
      'A service is unhealthy. Read the logs and source, find the root cause, apply the',
      'MINIMAL patch that fixes it, run the test suite until green, then submit your',
      'resolution with an honest, calibrated confidence. Fix root causes, never tests.',
      'Your confidence feeds a real autonomy gate — overstating it erodes trust.',
    ].join(' ');
  }

  framing(symptom: string): string {
    return (
      `Detected symptom:\n${symptom}\n\n` +
      'Diagnose the root cause, patch it, verify with run_tests, then submit_resolution.'
    );
  }

  openContext(incidentId: string): DevOpsCtx {
    const bug = BUGS[this.bugName];
    if (!bug) throw new Error(`unknown bug: ${this.bugName}`);
    const broken = injectBug(this.bugName);
    return {
      incidentId,
      emit: () => {},
      bug,
      initialSource: broken,
      workingSource: broken,
      liveSource: broken,
      touched: false,
    };
  }

  async executeTool(ctx: IncidentContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const c = ctx as DevOpsCtx;
    switch (name) {
      case 'read_logs':
        return { data: { log: c.bug.log } };
      case 'read_file':
        return { data: { path: FILE, content: numbered(c.workingSource) } };
      case 'search_code': {
        const rx = new RegExp(String(args.pattern), 'g');
        const matches = c.workingSource
          .split('\n')
          .map((line, i) => ({ line: i + 1, text: line.trim() }))
          .filter((row) => rx.test(row.text));
        return { data: { matches } };
      }
      case 'propose_patch': {
        const oldStr = String(args.old);
        const newStr = String(args.new);
        const count = c.workingSource.split(oldStr).length - 1;
        if (count === 0) return { data: { error: `old string not found in ${FILE}` }, isError: true };
        if (count > 1) return { data: { error: `old string matches ${count} places; make it unique` }, isError: true };
        c.workingSource = c.workingSource.replace(oldStr, newStr);
        c.touched = true;
        const diff = lineDiff(c.initialSource, c.workingSource);
        await c.emit('patch.applied', `Patch applied to ${FILE}`, { path: FILE, diff });
        return { data: { applied: true, diff } };
      }
      case 'run_tests': {
        const r = runChecks(c.workingSource);
        await c.emit('tests.result', `${r.passed ? '✅' : '❌'} ${r.summary}`, {
          passed: r.passed,
          summary: r.summary,
          output: r.output,
        });
        return { data: { passed: r.passed, summary: r.summary, output: r.output } };
      }
      default:
        return { data: { error: `unknown tool ${name}` }, isError: true };
    }
  }

  verificationPassed(result: Record<string, unknown>): boolean {
    return result.passed === true;
  }

  blastRadius(ctx: IncidentContext): BlastRadius {
    const c = ctx as DevOpsCtx;
    const changed = changedLineCount(c.initialSource, c.workingSource);
    const files = c.touched ? 1 : 0;
    const penalty = 0.15 * Math.max(files - 1, 0) + 0.02 * Math.max(changed - 10, 0);
    return { score: Math.max(0, 1 - penalty), reason: `${files} file(s), ${changed} line(s) changed` };
  }

  diff(ctx: IncidentContext): string {
    const c = ctx as DevOpsCtx;
    return lineDiff(c.initialSource, c.workingSource);
  }

  async deploy(ctx: IncidentContext): Promise<string[]> {
    const c = ctx as DevOpsCtx;
    c.liveSource = c.workingSource;
    return [FILE];
  }

  async awaitRecovery(ctx: IncidentContext): Promise<boolean> {
    const c = ctx as DevOpsCtx;
    const r = runChecks(c.liveSource);
    if (r.passed) await c.emit('deploy.verified', 'Live service recovered — golden suite green', { summary: r.summary });
    else await c.emit('deploy.failed', 'Service still failing after deploy', { output: r.output });
    return r.passed;
  }

  async report(incident: Incident, ctx: IncidentContext): Promise<Array<Record<string, unknown>>> {
    // Self-contained mock connectors (no external creds in the demo).
    const pr = { kind: 'pull_request', mode: 'mock', branch: `sentinel/fix-${incident.id}`, title: incident.fixSummary };
    await ctx.emit('action.github', `PR (mock): ${pr.branch}`, pr);
    const card = { kind: 'wekan_card', mode: 'mock', id: `card-${incident.id}` };
    await ctx.emit('action.wekan', `WeKan card (mock): ${card.id}`, card);
    const slack = { kind: 'slack_post', mode: 'mock', text: `✅ ${incident.id} resolved — ${incident.fixSummary}` };
    await ctx.emit('action.slack', 'Slack update posted (mock)', slack);
    return [pr, card, slack];
  }

  async notifyEscalation(incident: Incident, reason: string, emit: EmitFn): Promise<Array<Record<string, unknown>>> {
    const alert = { kind: 'slack_escalation', mode: 'mock', reason };
    await emit('action.slack', `🚨 ${incident.id} escalated: ${reason}`, alert);
    return [alert];
  }
}

/**
 * Deterministic, rule-based remediation planner for the one-click `self_heal`
 * Task. (In the client-driven flow, ChatGPT is the planner over the granular
 * tools — this is the reliable offline/demo path.)
 */
export function devopsPlanner(bugName = 'tax-before-discount'): Planner {
  const bug = BUGS[bugName];
  const steps: Array<EngineAction | null> = [
    { type: 'tool', name: 'read_logs' },
    { type: 'tool', name: 'read_file', args: { path: FILE } },
    { type: 'tool', name: 'run_tests' }, // observe the failure
    { type: 'tool', name: 'propose_patch', args: { path: FILE, old: bug.replace, new: bug.find } },
    { type: 'tool', name: 'run_tests' }, // now green
    { type: 'submit', resolution: { rootCause: bug.rootCause, fixSummary: bug.fixSummary, confidence: 0.92 } },
  ];
  let i = 0;
  return () => (i < steps.length ? steps[i++] : null);
}

// ── helpers ──
function numbered(src: string): string {
  const lines = src.split('\n');
  const w = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(w)}| ${l}`).join('\n');
}

function lineDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [`--- a/${FILE}`, `+++ b/${FILE}`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out.join('\n');
}

function changedLineCount(before: string, after: string): number {
  const a = before.split('\n');
  const b = after.split('\n');
  let n = 0;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) if (a[i] !== b[i]) n++;
  return n;
}
