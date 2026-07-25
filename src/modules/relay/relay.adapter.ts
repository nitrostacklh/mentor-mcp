/**
 * RELAY adapter — an autonomous civic-services copilot. It matches a citizen to
 * a government scheme, prefills the application from their profile, validates
 * eligibility + completeness (the verification step), submits (the deploy), and
 * tracks status (recovery). An ACTION agent, not advice. Self-contained
 * scheme catalog + a mock submission endpoint.
 */

import type { BlastRadius, Incident, ToolResult } from '../../core/types.js';
import type { DomainAdapter, EmitFn, IncidentContext } from '../../core/adapter.js';
import type { EngineAction, Planner } from '../../core/engine.js';

interface Applicant {
  name: string;
  occupation: string;
  land_ha: number;
  annual_income: number;
  aadhaar: string;
  bank_account: string;
}

const APPLICANT: Applicant = {
  name: 'R. Devi',
  occupation: 'farmer',
  land_ha: 1.2,
  annual_income: 80000,
  aadhaar: 'XXXX-XXXX-4021',
  bank_account: 'SBIN000****7788',
};

interface Scheme {
  id: string;
  name: string;
  eligible: (a: Applicant) => { ok: boolean; reason: string };
  requiredFields: string[];
}

const SCHEMES: Scheme[] = [
  {
    id: 'pm-kisan',
    name: 'PM-KISAN Income Support',
    eligible: (a) => ({
      ok: a.occupation === 'farmer' && a.land_ha <= 2 && a.annual_income <= 200000,
      reason: 'small/marginal farmer, ≤2 ha, income ≤ ₹2,00,000',
    }),
    requiredFields: ['name', 'aadhaar', 'bank_account', 'land_ha'],
  },
  {
    id: 'startup-grant',
    name: 'MSME Startup Grant',
    eligible: (a) => ({ ok: a.occupation === 'entrepreneur', reason: 'registered entrepreneur' }),
    requiredFields: ['name', 'aadhaar', 'business_reg'],
  },
];

interface RelayCtx extends IncidentContext {
  applicant: Applicant;
  scheme: Scheme;
  form: Record<string, string | number>;
}

function missing(ctx: RelayCtx): string[] {
  return ctx.scheme.requiredFields.filter((f) => ctx.form[f] === undefined || ctx.form[f] === '');
}

export class RelayAdapter implements DomainAdapter {
  readonly key = 'civic';
  readonly displayName = 'Civic · Services Copilot';
  readonly tagline = 'Matches the scheme, fills the form, submits and tracks — action, not advice.';
  readonly submitTool = 'submit_resolution';
  readonly verifyTool = 'validate_application';
  readonly mutationTools = new Set(['prefill_form']);

  systemPrompt(): string {
    return 'You are RELAY, an autonomous civic-services copilot. Match the citizen to an eligible scheme, prefill the application from their profile, validate eligibility and completeness, then submit and track it. Never submit an incomplete or ineligible application.';
  }

  framing(symptom: string): string {
    return `Citizen request:\n${symptom}\n\nMatch a scheme, prefill_form, validate_application until complete + eligible, then submit_resolution.`;
  }

  openContext(incidentId: string): RelayCtx {
    return { incidentId, emit: () => {}, applicant: { ...APPLICANT }, scheme: SCHEMES[0], form: {} };
  }

  async executeTool(ctx: IncidentContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const c = ctx as RelayCtx;
    switch (name) {
      case 'match_schemes': {
        const matches = SCHEMES.map((s) => ({ id: s.id, name: s.name, ...s.eligible(c.applicant) })).filter((s) => s.ok);
        if (matches[0]) c.scheme = SCHEMES.find((s) => s.id === matches[0].id)!;
        return { data: { applicant: c.applicant, matches } };
      }
      case 'check_eligibility': {
        const e = c.scheme.eligible(c.applicant);
        return { data: { scheme: c.scheme.name, ...e } };
      }
      case 'prefill_form': {
        for (const f of c.scheme.requiredFields) {
          if (f in c.applicant) c.form[f] = (c.applicant as any)[f];
        }
        const diff = c.scheme.requiredFields.map((f) => `+ ${f}: ${c.form[f] ?? '(missing)'}`).join('\n');
        await ctx.emit('patch.applied', `Prefilled ${c.scheme.name} application`, { path: c.scheme.id, diff });
        return { data: { filled: c.form, still_missing: missing(c) } };
      }
      case 'validate_application': {
        const gaps = missing(c);
        const elig = c.scheme.eligible(c.applicant);
        const passed = gaps.length === 0 && elig.ok;
        const output = passed ? `Application complete and eligible for ${c.scheme.name}.` : `Blocked: ${gaps.length ? `missing ${gaps.join(', ')}` : ''}${!elig.ok ? ' not eligible' : ''}`;
        await ctx.emit('tests.result', `${passed ? '✅' : '❌'} ${passed ? 'ready to submit' : 'not ready'}`, { passed, output });
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
    const n = Object.keys((ctx as RelayCtx).form).length;
    return { score: 1, reason: `${n} field(s) prefilled, single application` };
  }

  diff(ctx: IncidentContext): string {
    const c = ctx as RelayCtx;
    return `@@ ${c.scheme.name} application @@\n` + c.scheme.requiredFields.map((f) => `+ ${f}: ${c.form[f] ?? '(missing)'}`).join('\n');
  }

  async deploy(ctx: IncidentContext): Promise<string[]> {
    const c = ctx as RelayCtx;
    const ref = `${c.scheme.id.toUpperCase()}-${c.incidentId.slice(-6)}`;
    await ctx.emit('deploy.promoted', `Application submitted: ${ref}`, { reference: ref });
    (c as any).reference = ref;
    return [ref];
  }

  async awaitRecovery(ctx: IncidentContext): Promise<boolean> {
    const ref = (ctx as any).reference ?? 'pending';
    await ctx.emit('deploy.verified', `Application ${ref} received — status: UNDER_REVIEW (OCR-tracked)`, { reference: ref, status: 'UNDER_REVIEW' });
    return true;
  }

  async report(incident: Incident, ctx: IncidentContext): Promise<Array<Record<string, unknown>>> {
    const rec = { kind: 'application', mode: 'mock', reference: (ctx as any).reference };
    await ctx.emit('action.slack', `📨 ${incident.id} — application filed, tracking enabled`, rec);
    return [rec];
  }

  async notifyEscalation(incident: Incident, reason: string, emit: EmitFn): Promise<Array<Record<string, unknown>>> {
    const alert = { kind: 'slack_escalation', mode: 'mock', reason };
    await emit('action.slack', `🚨 ${incident.id} escalated: ${reason}`, alert);
    return [alert];
  }
}

export function relayPlanner(): Planner {
  const steps: Array<EngineAction | null> = [
    { type: 'tool', name: 'match_schemes' },
    { type: 'tool', name: 'check_eligibility' },
    { type: 'tool', name: 'prefill_form' },
    { type: 'tool', name: 'validate_application' },
    { type: 'submit', resolution: { rootCause: 'Eligible citizen had not applied for the scheme they qualify for.', fixSummary: 'Matched PM-KISAN, prefilled and submitted the application, tracking enabled.', confidence: 0.9 } },
  ];
  let i = 0;
  return () => (i < steps.length ? steps[i++] : null);
}
