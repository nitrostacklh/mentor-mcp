/**
 * VERDICT adapter — reviews a vendor contract, flags non-compliant clauses, and
 * generates a cited redlined counter-offer. Same engine lifecycle: the risky
 * clauses are the "bug", `apply_redline` is the patch, `check_compliance` is the
 * verification. Deploy emits the counter-offer; recovery confirms no risky
 * clause remains. Self-contained sample contract (no external data).
 */

import type { BlastRadius, Incident, ToolResult } from '../../core/types.js';
import type { DomainAdapter, EmitFn, IncidentContext } from '../../core/adapter.js';
import type { EngineAction, Planner } from '../../core/engine.js';

interface Clause {
  id: string;
  title: string;
  text: string;
  risk: 'ok' | 'risky';
  issue?: string;
  saferText?: string;
  citation?: string;
  redlined?: boolean;
}

function sampleContract(): Clause[] {
  return [
    {
      id: 'data-processing', title: 'Data Processing', risk: 'risky',
      text: 'Vendor may process and share Customer personal data with third parties at its sole discretion.',
      issue: 'Unrestricted third-party data sharing without consent.',
      saferText: 'Vendor shall process personal data only on documented Customer instructions and shall not disclose it to third parties without prior written consent.',
      citation: 'GDPR Art. 28(3)(a)',
    },
    {
      id: 'liability', title: 'Limitation of Liability', risk: 'risky',
      text: "Vendor's total liability is limited to $1 and Vendor disclaims all warranties, express or implied.",
      issue: 'Nominal liability cap and blanket warranty disclaimer are likely unenforceable.',
      saferText: "Vendor's aggregate liability is capped at the fees paid in the preceding 12 months; statutory warranties are not excluded.",
      citation: 'Unfair Contract Terms Act 1977, s.3',
    },
    {
      id: 'auto-renewal', title: 'Term & Renewal', risk: 'risky',
      text: 'This agreement auto-renews for successive 3-year terms unless cancelled 180 days in advance.',
      issue: 'Long lock-in with an onerous cancellation window is an unfair term.',
      saferText: 'This agreement renews for successive 1-year terms; either party may cancel with 30 days written notice.',
      citation: 'Consumer Rights Act 2015, s.62',
    },
    { id: 'governing-law', title: 'Governing Law', risk: 'ok', text: 'This agreement is governed by the laws of India.' },
  ];
}

interface ContractCtx extends IncidentContext {
  clauses: Clause[];
  touched: number;
}

const risky = (cs: Clause[]): Clause[] => cs.filter((c) => c.risk === 'risky' && !c.redlined);

export class VerdictAdapter implements DomainAdapter {
  readonly key = 'legal';
  readonly displayName = 'Legal · Contract Redline';
  readonly tagline = 'Flags unfair clauses and drafts a cited counter-offer — it acts, not just scores.';
  readonly submitTool = 'submit_resolution';
  readonly verifyTool = 'check_compliance';
  readonly mutationTools = new Set(['apply_redline']);

  systemPrompt(): string {
    return 'You are VERDICT, an autonomous compliance counsel. Review the contract, flag every non-compliant clause, apply a cited redline to each, re-check compliance until clean, then submit. Cite a specific regulation for each change.';
  }

  framing(symptom: string): string {
    return `Contract under review:\n${symptom}\n\nFlag risky clauses, apply_redline to each with a citation, check_compliance until clean, then submit_resolution.`;
  }

  openContext(incidentId: string): ContractCtx {
    return { incidentId, emit: () => {}, clauses: sampleContract(), touched: 0 };
  }

  async executeTool(ctx: IncidentContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const c = ctx as ContractCtx;
    switch (name) {
      case 'read_contract':
        return { data: { clauses: c.clauses.map((x) => ({ id: x.id, title: x.title, text: x.redlined ? x.saferText : x.text, risk: x.redlined ? 'ok' : x.risk })) } };
      case 'flag_risky_clauses':
        return { data: { risky: risky(c.clauses).map((x) => ({ id: x.id, title: x.title, issue: x.issue, citation: x.citation })) } };
      case 'apply_redline': {
        const clause = c.clauses.find((x) => x.id === String(args.clause_id));
        if (!clause) return { data: { error: `unknown clause ${args.clause_id}` }, isError: true };
        if (clause.risk === 'ok') return { data: { error: `clause ${clause.id} is not flagged` }, isError: true };
        clause.redlined = true;
        c.touched += 1;
        const diff = `@@ ${clause.title} (${clause.id}) @@\n- ${clause.text}\n+ ${clause.saferText}   # ${clause.citation}`;
        await ctx.emit('patch.applied', `Redlined ${clause.title}`, { path: clause.id, diff });
        return { data: { redlined: true, clause_id: clause.id, citation: clause.citation } };
      }
      case 'check_compliance': {
        const remaining = risky(c.clauses);
        const passed = remaining.length === 0;
        const output = passed ? 'All flagged clauses redlined; contract is compliant.' : `${remaining.length} risky clause(s) remain: ${remaining.map((x) => x.id).join(', ')}`;
        await ctx.emit('tests.result', `${passed ? '✅' : '❌'} ${passed ? 'compliant' : `${remaining.length} risky remain`}`, { passed, output });
        return { data: { passed, output } };
      }
      default:
        return { data: { error: `unknown tool ${name}` }, isError: true };
    }
  }

  verificationPassed(result: Record<string, unknown>): boolean {
    return result.passed === true;
  }

  blastRadius(ctx: IncidentContext): BlastRadius {
    const changed = (ctx as ContractCtx).touched;
    // Redlining is the goal, so it's low-risk; only a very large rewrite is notable.
    const penalty = 0.05 * Math.max(changed - 5, 0);
    return { score: Math.max(0, 1 - penalty), reason: `${changed} clause(s) redlined` };
  }

  diff(ctx: IncidentContext): string {
    const c = ctx as ContractCtx;
    return c.clauses.filter((x) => x.redlined).map((x) => `@@ ${x.title} (${x.id}) @@\n- ${x.text}\n+ ${x.saferText}   # ${x.citation}`).join('\n');
  }

  async deploy(ctx: IncidentContext): Promise<string[]> {
    await ctx.emit('deploy.promoted', 'Counter-offer generated', {});
    return ['counter-offer.pdf'];
  }

  async awaitRecovery(ctx: IncidentContext): Promise<boolean> {
    const remaining = risky((ctx as ContractCtx).clauses);
    const ok = remaining.length === 0;
    if (ok) await ctx.emit('deploy.verified', 'Cited counter-offer clears every flagged clause', {});
    else await ctx.emit('deploy.failed', `${remaining.length} clause(s) still risky`, {});
    return ok;
  }

  async report(incident: Incident, ctx: IncidentContext): Promise<Array<Record<string, unknown>>> {
    const doc = { kind: 'counter_offer', mode: 'mock', file: `counter-offer-${incident.id}.pdf` };
    await ctx.emit('action.github', `Counter-offer (mock): ${doc.file}`, doc);
    const slack = { kind: 'slack_post', mode: 'mock', text: `⚖️ ${incident.id} — cited redline ready for review` };
    await ctx.emit('action.slack', 'Slack update posted (mock)', slack);
    return [doc, slack];
  }

  async notifyEscalation(incident: Incident, reason: string, emit: EmitFn): Promise<Array<Record<string, unknown>>> {
    const alert = { kind: 'slack_escalation', mode: 'mock', reason };
    await emit('action.slack', `🚨 ${incident.id} escalated: ${reason}`, alert);
    return [alert];
  }
}

export function verdictPlanner(): Planner {
  const steps: Array<EngineAction | null> = [
    { type: 'tool', name: 'read_contract' },
    { type: 'tool', name: 'flag_risky_clauses' },
    { type: 'tool', name: 'apply_redline', args: { clause_id: 'data-processing' } },
    { type: 'tool', name: 'apply_redline', args: { clause_id: 'liability' } },
    { type: 'tool', name: 'apply_redline', args: { clause_id: 'auto-renewal' } },
    { type: 'tool', name: 'check_compliance' },
    { type: 'submit', resolution: { rootCause: 'Three clauses were non-compliant: unrestricted data sharing, a nominal liability cap, and an unfair auto-renewal lock-in.', fixSummary: 'Redlined all three clauses with cited, enforceable replacements.', confidence: 0.88 } },
  ];
  let i = 0;
  return () => (i < steps.length ? steps[i++] : null);
}
