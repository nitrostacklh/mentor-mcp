/**
 * Bridge ⑤ — `mentor.card/v1`, the concept the student walks away with.
 *
 * The loop has to close somewhere. A student who fixes their own bug and gets
 * nothing but a green test has learned the *project*; the point of all four
 * layers is that they learn the *idea*, and can still state it three projects
 * later. So the last bridge converts one debugging session into one card.
 *
 * ## The card is the sharpest place this product could betray itself
 *
 * MENTOR's whole claim is that it will not write the fix
 * (`MENTOR-CONCEPT.md` §2). A flashcard whose back reads *"compute tax on the
 * discounted subtotal, not the sticker price"* **is the fix**, wearing a
 * lesson's clothes. Shipping that would make `withhold_fix` theatre: the client
 * model would simply call `flashcard` instead and read the answer out.
 *
 * Two defences, and they are structural rather than advisory:
 *
 * 1. **The back is gated on the student's tests being green.** You earn the card
 *    by having already fixed it yourself. Before that it cannot be a shortcut,
 *    because there is nothing left to short-cut to.
 * 2. **When unearned, `back` is absent from the payload — not present with a
 *    flag.** This matters more than it looks. A field the model can read is a
 *    field the model will read out, however it is labelled; `{ earned: false,
 *    back: "…" }` leaks on the first client that renders the whole object. The
 *    only reliable way to withhold a string from a language model is to not send
 *    it. So the return type is a union, and the unearned branch has no `back`.
 *
 * `assertNoFix` in `brief.ts` covers the third case — a brief author pasting code
 * into `concept.answer` — at parse time.
 */

import type { DriftReport } from '../mentor/drift.js';
import type { Brief } from './brief.js';

export const CARD_SCHEMA = 'mentor.card/v1';

/** What the card was earned against — the student's own session, not a topic list. */
export interface CardProvenance {
  readonly project: string;
  readonly role: string;
  /** Where the mistake was actually made. */
  readonly origin: string | null;
  /** Where it showed up, which is somewhere else. That gap is the lesson. */
  readonly surfaced: string | null;
  /** The design decision in one clause. */
  readonly drift: string | null;
}

interface CardBase {
  readonly schema: string;
  readonly concept: string;
  /** The question. Always safe to show — it is what the student should be able to answer. */
  readonly front: string;
  readonly earnedBy: CardProvenance;
}

export interface EarnedCard extends CardBase {
  readonly earned: true;
  /** The principle. Present only on this branch of the union. */
  readonly back: string;
  readonly transfersTo: string;
  /** Carried from the drift report — a card is only as sound as the claim behind it. */
  readonly confidence: number;
  readonly note: string;
}

export interface UnearnedCard extends CardBase {
  readonly earned: false;
  /** No `back` field at all. See the header — this absence is the mechanism. */
  readonly blocking: readonly string[];
  readonly note: string;
}

export type Card = EarnedCard | UnearnedCard;

export interface IssueInput {
  readonly brief: Brief;
  readonly drift: DriftReport | null;
  /**
   * Did the student's own acceptance tests pass? The gate. Derive it from
   * `readTestOutcome` on real runner output — never from a boolean, because a
   * boolean parameter is one the client's model can simply decide is `true` when
   * the student asks nicely, and that is the whole defence gone.
   */
  readonly testsGreen: boolean;
  /** Did the student state the concept in their own words first? */
  readonly explainedInOwnWords?: boolean;
}

export interface TestOutcome {
  /** True only when a runner was recognised AND it reported no failures. */
  readonly green: boolean;
  /** Which runner's output shape matched, or null if none did. */
  readonly runner: string | null;
  readonly failures: number | null;
  /** The line the verdict was read from, quoted back so a human can check it. */
  readonly evidence: string;
}

/**
 * Read a pass/fail verdict out of real test-runner output.
 *
 * This exists so `flashcard` can gate on evidence instead of on trust. The
 * alternative — a `tests_green: boolean` argument — puts the gate inside the
 * client's model, and a model being pressed by a student for the answer is
 * exactly the wrong place to keep it.
 *
 * **Unrecognised output is not green.** If no runner shape matches, the outcome
 * is a refusal to judge rather than a pass. That asymmetry is deliberate: the
 * cost of wrongly withholding a flashcard is a mildly annoyed student, and the
 * cost of wrongly issuing one is handing over the reasoning the entire product
 * exists to withhold. Those are not comparable, so the tie does not go to the
 * student.
 *
 * Recognises `node --test` (TAP-ish), pytest, jest/vitest, and go test.
 */
export function readTestOutcome(raw: string): TestOutcome {
  const text = (raw ?? '').trim();
  if (!text) {
    return { green: false, runner: null, failures: null, evidence: 'no test output provided' };
  }

  const shapes: Array<{ runner: string; re: RegExp; failIndex: number }> = [
    // node:test summary — "# fail 0"
    { runner: 'node:test', re: /^#\s*fail\s+(\d+)\s*$/im, failIndex: 1 },
    // pytest — "1 failed, 2 passed" / "3 passed in 0.04s"
    { runner: 'pytest', re: /(\d+)\s+failed/i, failIndex: 1 },
    // jest / vitest — "Tests: 1 failed, 2 passed"
    { runner: 'jest/vitest', re: /tests?:\s*(?:.*?)(\d+)\s+failed/i, failIndex: 1 },
  ];

  for (const shape of shapes) {
    const m = shape.re.exec(text);
    if (!m) continue;
    const failures = Number(m[shape.failIndex]);
    return {
      green: failures === 0,
      runner: shape.runner,
      failures,
      evidence: m[0].trim(),
    };
  }

  // Green shapes that report no failure count at all.
  const cleanPytest = /(\d+)\s+passed(?:[^,]*)\s+in\s+[\d.]+s/i.exec(text);
  if (cleanPytest && !/fail|error/i.test(text)) {
    return { green: true, runner: 'pytest', failures: 0, evidence: cleanPytest[0].trim() };
  }
  const goOk = /^ok\s+\S+/im.exec(text);
  if (goOk && !/^(FAIL|---\s*FAIL)/im.test(text)) {
    return { green: true, runner: 'go test', failures: 0, evidence: goOk[0].trim() };
  }

  return {
    green: false,
    runner: null,
    failures: null,
    evidence:
      'could not recognise this as test-runner output, so it is not treated as passing — ' +
      'paste the full output of your test command',
  };
}

/**
 * Issue the card, or explain what is still owed.
 *
 * Order of checks matters: the concept must exist before the gate is worth
 * evaluating, because a brief with no concept can never yield a card no matter
 * how green the tests are, and telling a student "keep going" when the answer is
 * "this project has no lesson authored" would be a lie about their progress.
 */
export function issueCard(input: IssueInput): Card {
  const { brief, drift, testsGreen, explainedInOwnWords } = input;
  const { concept } = brief;

  const earnedBy: CardProvenance = {
    project: brief.project,
    role: brief.role,
    origin: drift?.origin ? `${drift.origin.file}:${drift.origin.line}` : null,
    surfaced: drift?.failure ? `${drift.failure.file}:${drift.failure.line}` : null,
    drift: drift?.origin
      ? `${drift.origin.component} was designed after ${drift.origin.shouldFollow}, but built before it`
      : null,
  };

  const front = concept.question || `What did ${brief.project} teach you?`;

  const blocking: string[] = [];
  if (!concept.question || !concept.answer) {
    blocking.push(
      `${brief.project} has no concept authored in its brief, so there is no card to earn — ` +
        'this is a gap in the curriculum, not in your work',
    );
  }
  if (!testsGreen) {
    blocking.push(
      'your acceptance tests are not passing yet — the card is the reward for fixing it ' +
        'yourself, so it stays shut until they are green',
    );
  }
  if (explainedInOwnWords === false) {
    blocking.push(
      'say the idea back in your own words first — reading an answer you have not tried to ' +
        'produce is the one study method that reliably does nothing',
    );
  }

  if (blocking.length) {
    return {
      schema: CARD_SCHEMA,
      concept: concept.key,
      front,
      earnedBy,
      earned: false,
      blocking,
      note:
        'The answer is deliberately not included in this response. MENTOR does not hand over ' +
        'the reasoning before the student has done it — that is the same refusal as ' +
        'withhold_fix, applied to the lesson instead of the patch.',
    };
  }

  return {
    schema: CARD_SCHEMA,
    concept: concept.key,
    front,
    earnedBy,
    earned: true,
    back: concept.answer,
    transfersTo: concept.transfersTo,
    confidence: drift?.confidence.score ?? 0,
    note:
      earnedBy.origin && earnedBy.surfaced
        ? `You earned this by fixing a bug that surfaced at ${earnedBy.surfaced} but was made at ` +
          `${earnedBy.origin}. Keep the card; the distance between those two is the point.`
        : 'You earned this by fixing it yourself.',
  };
}
