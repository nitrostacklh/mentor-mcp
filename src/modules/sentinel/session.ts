/**
 * Client-driven incident sessions (framework-free, testable).
 *
 * The one-click `self_heal` Task drives the loop with a built-in planner. This
 * module is the OTHER mode: the connecting model (ChatGPT / Studio AI Chat)
 * drives the loop itself, one granular tool call at a time. Because MCP tool
 * calls are independent, we persist per-incident state here, keyed by
 * incident_id, and reuse the SAME adapter, confidence gate, and AEGIS guard.
 */

import { DevOpsAdapter } from './devops.adapter.js';
import { assess } from '../../core/confidence.js';
import { aegisGuard } from '../aegis/trust.js';
import { BUGS } from './fixtures.js';
import type { IncidentContext } from '../../core/adapter.js';
import type { Incident } from '../../core/types.js';

interface Session {
  incident: Incident;
  adapter: DevOpsAdapter;
  ctx: IncidentContext;
  lastVerified: boolean;
  trace: Array<{ type: string; title: string }>;
}

const sessions = new Map<string, Session>();

function newId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `INC-${stamp}-${rand}`;
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown incident_id: ${id} (call open_incident first)`);
  return s;
}

export function openIncident(bug = 'tax-before-discount') {
  if (!BUGS[bug]) throw new Error(`unknown bug: ${bug}`);
  const adapter = new DevOpsAdapter(bug);
  const incident: Incident = {
    id: newId(), symptom: `The pricing service is overcharging discounted orders.\n${BUGS[bug].log}`,
    domain: 'devops', status: 'DIAGNOSING', diagnosis: '', fixSummary: '', diff: '',
    iterations: 0, verdict: null, actions: [], approvalNote: '', openedAt: Date.now(), closedAt: null,
  };
  const ctx = adapter.openContext(incident.id);
  const session: Session = { incident, adapter, ctx, lastVerified: false, trace: [] };
  ctx.emit = (type, title) => { session.trace.push({ type, title }); };
  sessions.set(incident.id, session);
  return { incident_id: incident.id, status: incident.status, symptom: incident.symptom, log: BUGS[bug].log,
    next: 'Use read_source / run_tests to diagnose, propose_patch to fix, then resolve_incident.' };
}

export async function callTool(incidentId: string, name: string, args: Record<string, unknown>) {
  const s = get(incidentId);
  const r = await s.adapter.executeTool(s.ctx, name, args);
  if (name === 'run_tests') {
    s.incident.iterations += 1;
    s.lastVerified = s.adapter.verificationPassed(r.data);
  } else if (name === 'propose_patch' && !r.isError) {
    s.lastVerified = false;
  }
  return r.data;
}

export async function resolveIncident(incidentId: string, rootCause: string, fixSummary: string, confidence: number) {
  const s = get(incidentId);
  if (!s.lastVerified) {
    return { ok: false, error: 'run_tests must pass since your last patch before resolving.' };
  }
  s.incident.diagnosis = rootCause;
  s.incident.fixSummary = fixSummary;
  s.incident.diff = s.adapter.diff(s.ctx);
  s.incident.iterations = Math.max(s.incident.iterations, 1);
  const blast = s.adapter.blastRadius(s.ctx);
  const verdict = assess({ verificationPassed: true, agentConfidence: confidence, iterationsUsed: s.incident.iterations, blastScore: blast.score, blastReason: blast.reason });
  s.incident.verdict = verdict;

  // AEGIS gate — mandatory.
  const guard = aegisGuard(s.incident);
  if (!guard.safe) {
    s.incident.status = 'ESCALATED';
    return { ok: false, status: 'ESCALATED', reason: `AEGIS blocked the fix — ${guard.reason}`, verdict, aegis: guard };
  }
  if (!verdict.autonomous) {
    s.incident.status = 'AWAITING_APPROVAL';
    return { ok: true, status: 'AWAITING_APPROVAL', needs_approval: true, verdict, aegis: guard, diff: s.incident.diff,
      next: 'Confidence is below the autonomy threshold — call approve_incident to deploy or reject.' };
  }
  return finalize(s, verdict, guard);
}

export async function approveIncident(incidentId: string, approve: boolean, note = '') {
  const s = get(incidentId);
  if (s.incident.status !== 'AWAITING_APPROVAL') {
    return { ok: false, error: `incident ${incidentId} is not awaiting approval (status ${s.incident.status})` };
  }
  s.incident.approvalNote = note;
  if (!approve) {
    s.incident.status = 'ESCALATED';
    return { ok: true, status: 'ESCALATED', note };
  }
  return finalize(s, s.incident.verdict!, aegisGuard(s.incident));
}

async function finalize(s: Session, verdict: unknown, guard: unknown) {
  s.incident.status = 'DEPLOYING';
  const promoted = await s.adapter.deploy(s.ctx);
  const recovered = await s.adapter.awaitRecovery(s.ctx);
  if (!recovered) {
    s.incident.status = 'ESCALATED';
    return { ok: false, status: 'ESCALATED', reason: 'service did not recover after deploy' };
  }
  s.incident.actions = await s.adapter.report(s.incident, s.ctx);
  s.incident.status = 'RESOLVED';
  s.incident.closedAt = Date.now();
  return {
    ok: true, status: 'RESOLVED', incident_id: s.incident.id, deployed: promoted,
    fix_summary: s.incident.fixSummary, root_cause: s.incident.diagnosis, diff: s.incident.diff,
    verdict, aegis: guard, actions: s.incident.actions, trace: s.trace,
  };
}

/** For the widget: the running trace + current state of a session. */
export function sessionView(incidentId: string) {
  const s = get(incidentId);
  return { status: s.incident.status, fix_summary: s.incident.fixSummary, verdict: s.incident.verdict, diff: s.incident.diff, trace: s.trace };
}
