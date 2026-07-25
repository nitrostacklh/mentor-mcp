/**
 * Bridge ② — `mentor.brief/v1`, the contract for one role on one project.
 *
 * This is the artifact that replaces a paragraph with a fact. `fixtures/pricing/README.md`
 * has always said *"You are the backend engineer who owns pricing"*, but that
 * sentence is markdown a human reads: nothing in the codebase could act on it,
 * so nothing could check whether what a student drew was actually their job.
 * Role-scoping was a claim. This makes it enforceable.
 *
 * ## `owns` vs `given` is the whole idea
 *
 * A real engineer joining a real team does not build the system. They build a
 * *slice* of it, against interfaces other people own. So the brief names both:
 *
 * - **`owns`** — the components this role is on the hook for. Your slice.
 * - **`given`** — components someone else owns, that you build *against*. You
 *   are expected to draw them (they are your boundary) but not to implement them.
 *
 * Everything else on the canvas is out of scope, and `checkScope` says so. That
 * check is the reason this schema exists rather than being three more prose
 * bullets: it turns "do only your part" into a thing the tool can be wrong about
 * out loud.
 *
 * ## The concept travels with the brief, not with the bug
 *
 * `concept` is the transferable idea the project exists to teach — and it is
 * declared *before* the student starts, not derived afterwards from whatever
 * broke. That ordering is deliberate. A lesson reverse-engineered from a failure
 * is a rationalisation; a lesson stated up front and then *demonstrated* by the
 * student's own failure is a curriculum. It is also what lets the flashcard
 * (`card.ts`) be about the idea rather than about the patch.
 */

import { normalizeComponent } from '../mentor/build.js';
import type { Plan } from '../mentor/plan.js';

export const BRIEF_SCHEMA = 'mentor.brief/v1';

/** A component this role is on the hook for. */
export interface OwnedComponent {
  readonly component: string;
  /** What it is for. Seeds the `intent` field of the student's Lumina node. */
  readonly intent: string;
  /** Why this one lands on this role rather than another. */
  readonly whyYours: string;
}

/** A component someone else owns, that this role builds against. */
export interface GivenComponent {
  readonly component: string;
  /** Which role really owns it — the person you would go and ask. */
  readonly ownedBy: string;
  /** The interface you can rely on. The only thing you are allowed to assume. */
  readonly contract: string;
}

/** One signed-off acceptance criterion. The definition of done, itemised. */
export interface AcceptanceCriterion {
  readonly id: string;
  /** The input condition, in the stakeholder's words. */
  readonly given: string;
  /** The required result. */
  readonly must: string;
}

/** The transferable idea, declared before the student starts. */
export interface Concept {
  readonly key: string;
  /** The flashcard front. A question, not a topic. */
  readonly question: string;
  /**
   * The flashcard back — the *principle*, never the corrected line. `card.ts`
   * depends on this distinction to keep the refusal (`MENTOR-CONCEPT.md` §2)
   * intact; see `assertNoFix`.
   */
  readonly answer: string;
  /** Where else this shows up, so the lesson outlives the project. */
  readonly transfersTo: string;
}

export interface Brief {
  readonly schema: string;
  readonly project: string;
  readonly role: string;
  readonly title: string;
  /** Second person, present tense. "You own the function finance reports off." */
  readonly youAre: string;
  /** Who is hurt when this is wrong. What makes it a job rather than an exercise. */
  readonly stakes: string;
  readonly deliverable: string;
  readonly concept: Concept;
  readonly owns: readonly OwnedComponent[];
  readonly given: readonly GivenComponent[];
  readonly acceptance: readonly AcceptanceCriterion[];
  /** Where the student's code goes, relative to the project root. */
  readonly entry: string;
  readonly tests: string;
  readonly warnings: readonly string[];
}

export class BriefParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function safeJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BriefParseError(
      `${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Parse a `mentor.brief/v1` document (object or JSON string).
 *
 * @throws BriefParseError when the envelope is unusable, or when `owns` is
 *   empty. A brief that gives a student nothing to own is not a role — every
 *   downstream bridge (scope, checkpoints, done-ness) is defined in terms of
 *   `owns`, so an empty one would silently produce a green "you're finished"
 *   for a student who has done nothing. That is the worst possible failure here.
 */
export function parseBrief(input: unknown): Brief {
  const raw: unknown = typeof input === 'string' ? safeJson(input, 'brief') : input;
  if (!isObj(raw)) throw new BriefParseError('brief must be a JSON object');

  const schema = str(raw.schema);
  if (schema !== BRIEF_SCHEMA) {
    throw new BriefParseError(
      `unsupported brief schema ${JSON.stringify(schema || '(missing)')} — expected ${BRIEF_SCHEMA}`,
    );
  }

  const warnings: string[] = [...toStringArray(raw.warnings)];

  const owns: OwnedComponent[] = [];
  const ownKeys = new Set<string>();
  for (const o of Array.isArray(raw.owns) ? raw.owns : []) {
    if (!isObj(o)) continue;
    const component = str(o.component).trim();
    if (!component) continue;
    const key = normalizeComponent(component);
    if (ownKeys.has(key)) {
      warnings.push(`brief.owns lists ${component} twice`);
      continue;
    }
    ownKeys.add(key);
    owns.push({
      component,
      intent: str(o.intent).trim(),
      whyYours: str(o.why_yours).trim(),
    });
  }
  if (owns.length === 0) {
    throw new BriefParseError(
      'brief.owns is empty — a role with nothing to own is not a role, and every ' +
        'downstream check (scope, checkpoints, done) is defined against it',
    );
  }

  const given: GivenComponent[] = [];
  for (const g of Array.isArray(raw.given) ? raw.given : []) {
    if (!isObj(g)) continue;
    const component = str(g.component).trim();
    if (!component) continue;
    const key = normalizeComponent(component);
    if (ownKeys.has(key)) {
      // Owning and being given the same component is a contradiction that would
      // make the scope check answer both ways depending on evaluation order.
      warnings.push(
        `${component} is in both owns and given — treating it as owned, since that is the stricter reading`,
      );
      continue;
    }
    given.push({
      component,
      ownedBy: str(g.owned_by).trim() || 'another role',
      contract: str(g.contract).trim(),
    });
  }

  const acceptance: AcceptanceCriterion[] = [];
  for (const [i, a] of (Array.isArray(raw.acceptance) ? raw.acceptance : []).entries()) {
    if (!isObj(a)) continue;
    const must = str(a.must).trim();
    if (!must) continue;
    acceptance.push({
      id: str(a.id).trim() || `a${i + 1}`,
      given: str(a.given).trim(),
      must,
    });
  }
  if (acceptance.length === 0) {
    warnings.push('brief has no acceptance criteria — done-ness cannot be judged against anything');
  }

  const rawConcept = isObj(raw.concept) ? raw.concept : {};
  const concept: Concept = {
    key: str(rawConcept.key).trim() || 'unnamed-concept',
    question: str(rawConcept.question).trim(),
    answer: str(rawConcept.answer).trim(),
    transfersTo: str(rawConcept.transfers_to).trim(),
  };
  if (!concept.question || !concept.answer) {
    warnings.push('brief.concept is incomplete — no flashcard can be earned from this project');
  }

  return {
    schema,
    project: str(raw.project).trim(),
    role: str(raw.role).trim(),
    title: str(raw.title).trim() || `${str(raw.role)} — ${str(raw.project)}`,
    youAre: str(raw.you_are).trim(),
    stakes: str(raw.stakes).trim(),
    deliverable: str(raw.deliverable).trim(),
    concept,
    owns,
    given,
    acceptance,
    entry: str(raw.entry).trim(),
    tests: str(raw.tests).trim(),
    warnings,
  };
}

// ── Bridge ②③ · the scope check ───────────────────────────────────────────────

/** One component's standing, judged against the brief. */
export type ScopeVerdict = 'covered' | 'boundary' | 'out_of_scope' | 'missing';

export interface ScopeEntry {
  /** The student's own word for it, when they drew it; the brief's, when they didn't. */
  readonly label: string;
  readonly verdict: ScopeVerdict;
  readonly note: string;
}

export interface ScopeReport {
  readonly project: string;
  readonly role: string;
  /** Owned components the student drew. */
  readonly covered: readonly string[];
  /** `given` components they drew — correct practice, not a problem. */
  readonly boundary: readonly string[];
  /** Drawn, but neither owned nor given. Someone else's job. */
  readonly outOfScope: readonly string[];
  /** Owned but never drawn. Their slice is not covered by their own design. */
  readonly missing: readonly string[];
  readonly entries: readonly ScopeEntry[];
  /** 0..1 — fraction of `owns` that appears on the canvas. */
  readonly coverage: number;
  /** True when every owned component is drawn and nothing foreign is. */
  readonly inScope: boolean;
  readonly summary: string;
}

/**
 * Compare the student's Lumina canvas against their role's brief.
 *
 * This is the bridge that was missing between ② and ③, and it produces a second
 * kind of drift to sit alongside the ordering drift MENTOR already finds:
 *
 * - **order drift** (`drift.ts`) — you built your own components in the wrong sequence
 * - **scope drift** (here) — you designed the wrong set of components
 *
 * They are independent failures and they want different conversations. Building
 * `tax` before `discount` is a reasoning error. Designing the payment gateway
 * when you own pricing is a *scope* error — and in a company it is the more
 * expensive of the two, because nobody notices until integration.
 *
 * Joined on `normalizeComponent`, the same key `drift.ts` uses, so a label that
 * matches for one check matches for the other. A student renaming a box does not
 * get told it is in scope by one tool and foreign by another.
 */
export function checkScope(brief: Brief, plan: Plan): ScopeReport {
  const ownByKey = new Map(brief.owns.map((o) => [normalizeComponent(o.component), o]));
  const givenByKey = new Map(brief.given.map((g) => [normalizeComponent(g.component), g]));

  const entries: ScopeEntry[] = [];
  const covered: string[] = [];
  const boundary: string[] = [];
  const outOfScope: string[] = [];
  const drawnKeys = new Set<string>();

  for (const node of plan.nodes) {
    const key = normalizeComponent(node.label);
    drawnKeys.add(key);

    const owned = ownByKey.get(key);
    if (owned) {
      covered.push(node.label);
      entries.push({
        label: node.label,
        verdict: 'covered',
        note: owned.whyYours || 'yours to build',
      });
      continue;
    }

    const lent = givenByKey.get(key);
    if (lent) {
      boundary.push(node.label);
      entries.push({
        label: node.label,
        verdict: 'boundary',
        note: `${lent.ownedBy} owns this — you build against it. ${lent.contract}`.trim(),
      });
      continue;
    }

    outOfScope.push(node.label);
    entries.push({
      label: node.label,
      verdict: 'out_of_scope',
      note:
        'not in your brief — either it belongs to another role, or your brief and your ' +
        'design disagree about what this project is',
    });
  }

  const missing: string[] = [];
  for (const owned of brief.owns) {
    if (drawnKeys.has(normalizeComponent(owned.component))) continue;
    missing.push(owned.component);
    entries.push({
      label: owned.component,
      verdict: 'missing',
      note: owned.intent
        ? `you own this but did not design it — ${owned.intent}`
        : 'you own this but did not design it',
    });
  }

  const coverage = brief.owns.length === 0 ? 0 : covered.length / brief.owns.length;
  const inScope = missing.length === 0 && outOfScope.length === 0;

  return {
    project: brief.project,
    role: brief.role,
    covered,
    boundary,
    outOfScope,
    missing,
    entries,
    coverage: Math.round(coverage * 1000) / 1000,
    inScope,
    summary: describeScope(missing, outOfScope, covered.length, brief.owns.length),
  };
}

function describeScope(
  missing: readonly string[],
  outOfScope: readonly string[],
  coveredCount: number,
  ownedCount: number,
): string {
  if (missing.length === 0 && outOfScope.length === 0) {
    return `Your design covers your slice exactly: all ${ownedCount} component(s) you own, nothing you don't.`;
  }
  const parts: string[] = [`${coveredCount} of ${ownedCount} owned component(s) designed`];
  if (missing.length) parts.push(`missing ${missing.join(', ')}`);
  if (outOfScope.length) {
    parts.push(
      `${outOfScope.join(', ')} ${outOfScope.length === 1 ? 'is' : 'are'} not yours to build`,
    );
  }
  return parts.join('; ') + '.';
}

/**
 * Guard the flashcard against becoming the patch.
 *
 * A concept answer is allowed to state a principle ("tax applies to what the
 * customer actually pays"). It is not allowed to be code. If a brief author
 * writes the corrected line into `concept.answer`, the flashcard would hand over
 * exactly what `withhold_fix` refuses to — and it would do it while wearing the
 * costume of a lesson, which is worse than refusing badly.
 *
 * Heuristic, and deliberately so: this cannot detect a well-worded fix, and it
 * is not trying to. It catches the mechanical case — someone pasting source in —
 * and `card.ts` gates on the student's tests being green regardless, which is the
 * real defence. Belt and braces on the one thing the product cannot get wrong.
 */
export function assertNoFix(concept: Concept): string[] {
  const problems: string[] = [];
  const code = /[;{}]|\b(const|let|var|function|return|=>)\b|\*=|\/=|\+=/;
  if (code.test(concept.answer)) {
    problems.push(
      `concept.answer for ${concept.key} looks like code, not a principle — a flashcard ` +
        'that contains the fix defeats withhold_fix',
    );
  }
  return problems;
}
