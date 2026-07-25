/**
 * Bridge ④ — checkpoints, the definition of done, and the *observed* build history.
 *
 * ## The bridge that retires a lie
 *
 * MENTOR's demo has always scored 0.91 instead of ~0.97 for one reason, stated in
 * `build.ts`: the build history is `provenance: "authored"` — a claim about the
 * past that nobody watched happen. MENTOR discounts it, honestly, and says so.
 *
 * Checkpoints fix that as a side effect rather than as a feature. If the student
 * marks a checkpoint as they reach it, the checkpoint log **is** the build
 * history — ordered by when things actually happened, recorded at the time. So
 * `buildFromProgress` emits a `mentor.build/v1` with `provenance: 'observed'`,
 * and the confidence rises because the evidence genuinely got better, not because
 * the number was tuned.
 *
 * ## The student's own design orders their checkpoints
 *
 * The checkpoint list is not authored per project. It is *derived* from the brief
 * (what you own) crossed with the plan (the order you said you'd do it in). That
 * is the join, and it is the point: you are held to the sequence **you** drew,
 * which is the same reason MENTOR's drift claim is yours rather than the tool's
 * opinion (`MENTOR-CONCEPT.md` §2).
 *
 * A consequence worth stating plainly: change your plan and your checkpoints
 * change. That is correct. Re-designing is allowed — silently drifting from a
 * design you still claim to hold is what isn't.
 *
 * ## Everything here is pure
 *
 * On NitroCloud this is a remote MCP server with no per-student storage, so
 * `recordProgress` takes the prior log plus what just happened and returns the
 * new one. The client holds the state. That is a constraint of the deployment
 * (`ARCHITECTURE.md` §15) and it also happens to be the right shape: the same
 * inputs always produce the same checkpoints, which is why they can be tested.
 */

import { BUILD_SCHEMA, normalizeComponent, type Build, type BuildStep } from '../mentor/build.js';
import { dependencyPath, labelOf, type Plan } from '../mentor/plan.js';
import { checkScope, type Brief, type ScopeReport } from './brief.js';

export const CHECKPOINTS_SCHEMA = 'mentor.checkpoints/v1';

export type CheckpointKind = 'implement' | 'verify';

export interface Checkpoint {
  readonly id: string;
  /** Position in the derived sequence. 1-based, so it reads like a list. */
  readonly seq: number;
  readonly kind: CheckpointKind;
  /** For `implement`, the component. For `verify`, the acceptance criterion id. */
  readonly subject: string;
  readonly title: string;
  /** What reaching this actually demonstrates. Not a restatement of the title. */
  readonly proves: string;
  /**
   * Checkpoint ids that must come first, taken from real edges in the student's
   * plan — not from adjacency in the list. A component with no drawn dependency
   * is genuinely unblocked, and pretending otherwise would invent an order the
   * student never committed to.
   */
  readonly blockedBy: readonly string[];
}

export interface CheckpointPlan {
  readonly schema: string;
  readonly project: string;
  readonly role: string;
  readonly checkpoints: readonly Checkpoint[];
  /** The done-ness rule, in words, so a student can read the bar they're held to. */
  readonly definitionOfDone: string;
  readonly warnings: readonly string[];
}

/**
 * Derive the checkpoint list from the brief and the plan.
 *
 * Two waves, in this order:
 *
 * 1. **implement** — one per owned component, sequenced by the plan's `order`.
 *    Components the student owns but never drew still get a checkpoint, at the
 *    end, flagged. Dropping them would let an incomplete design quietly shrink
 *    the definition of done, which is the one thing a progress tracker must
 *    never do.
 * 2. **verify** — one per acceptance criterion. These come last because a
 *    criterion is a statement about the finished slice.
 */
export function deriveCheckpoints(brief: Brief, plan: Plan): CheckpointPlan {
  const warnings: string[] = [];
  const scope = checkScope(brief, plan);

  if (plan.cyclic) {
    warnings.push(
      'your plan has a cycle, so it states no sequence — checkpoints are listed in ' +
        'canvas order and their order carries no weight',
    );
  }

  const ownedKeys = new Set(brief.owns.map((o) => normalizeComponent(o.component)));
  const intentByKey = new Map(brief.owns.map((o) => [normalizeComponent(o.component), o]));

  // Plan order, restricted to what this role owns. `given` components are on the
  // canvas legitimately but are somebody else's checkpoint.
  const orderedOwnedIds = plan.order.filter((id) => ownedKeys.has(normalizeComponent(labelOf(plan, id))));

  const checkpoints: Checkpoint[] = [];
  const idByComponentKey = new Map<string, string>();
  let seq = 0;

  for (const nodeId of orderedOwnedIds) {
    const label = labelOf(plan, nodeId);
    const key = normalizeComponent(label);
    const owned = intentByKey.get(key);
    const id = `cp-${++seq}`;
    idByComponentKey.set(key, id);
    checkpoints.push({
      id,
      seq,
      kind: 'implement',
      subject: label,
      title: `Implement ${label}`,
      proves: owned?.intent || `${label} exists and does its one job`,
      blockedBy: [], // filled in below, once every implement id is known
    });
  }

  for (const missing of scope.missing) {
    const id = `cp-${++seq}`;
    idByComponentKey.set(normalizeComponent(missing), id);
    checkpoints.push({
      id,
      seq,
      kind: 'implement',
      subject: missing,
      title: `Implement ${missing}`,
      proves:
        intentByKey.get(normalizeComponent(missing))?.intent ||
        `${missing} exists and does its one job`,
      blockedBy: [],
    });
    warnings.push(
      `${missing} is in your brief but not on your canvas — it still counts toward done`,
    );
  }

  // Dependencies, resolved from the plan graph rather than from list adjacency.
  const withDeps: Checkpoint[] = checkpoints.map((cp) => {
    const key = normalizeComponent(cp.subject);
    const selfId = plan.nodes.find((n) => normalizeComponent(n.label) === key)?.id;
    if (!selfId) return cp;
    const blockedBy: string[] = [];
    for (const other of plan.nodes) {
      const otherKey = normalizeComponent(other.label);
      if (otherKey === key) continue;
      const otherCpId = idByComponentKey.get(otherKey);
      if (!otherCpId) continue; // a `given` component — not a checkpoint of ours
      if (dependencyPath(plan, other.id, selfId) !== 'none') blockedBy.push(otherCpId);
    }
    return { ...cp, blockedBy };
  });

  for (const criterion of brief.acceptance) {
    const id = `cp-${++seq}`;
    withDeps.push({
      id,
      seq,
      kind: 'verify',
      subject: criterion.id,
      title: `Verify: ${criterion.must}`,
      proves: criterion.given ? `${criterion.given} produces ${criterion.must}` : criterion.must,
      // Every acceptance criterion depends on the whole slice being built.
      blockedBy: withDeps.filter((c) => c.kind === 'implement').map((c) => c.id),
    });
  }

  return {
    schema: CHECKPOINTS_SCHEMA,
    project: brief.project,
    role: brief.role,
    checkpoints: withDeps,
    definitionOfDone:
      `Done means all ${brief.owns.length} component(s) you own are implemented, all ` +
      `${brief.acceptance.length} acceptance criteria pass, and your design covers your slice ` +
      'and nothing outside it. Two of those three are about your code. The third is about ' +
      'whether you built the right thing.',
    warnings,
  };
}

// ── the observed history ──────────────────────────────────────────────────────

/** What the student reports when they reach a checkpoint. */
export interface ProgressEvent {
  readonly checkpoint: string;
  /** Where the work landed. Without this MENTOR cannot name a line. */
  readonly file: string;
  readonly line?: number | null;
  /** Offset from session start, e.g. "T+11m". Relative, never wall-clock. */
  readonly at?: string;
  readonly summary?: string;
  /**
   * For a `verify` checkpoint: did the criterion actually pass?
   *
   * This distinction is load-bearing and its absence was a bug. Running a test is
   * not the same event as passing it, and a tracker that conflated them would
   * count a red acceptance criterion toward "done" — the one answer this whole
   * module exists to get right.
   *
   * A failed verify is still **recorded**, because the history is what MENTOR
   * reads and a failure that appears nowhere in it cannot be linked to the work
   * that caused it. It simply does not count as reached. Defaults to `pass`,
   * which is the only sensible reading for an `implement` step.
   */
  readonly outcome?: 'pass' | 'fail';
}

export interface ProgressLog {
  readonly project: string;
  readonly role: string;
  /** In the order they happened — this is the axis MENTOR compares against. */
  readonly events: readonly ProgressEvent[];
}

export interface RecordResult {
  readonly log: ProgressLog;
  readonly accepted: readonly string[];
  readonly rejected: readonly { checkpoint: string; why: string }[];
  readonly remaining: readonly string[];
  /**
   * Reached a checkpoint whose `blockedBy` was not yet satisfied. Not an error —
   * it is *the* signal MENTOR exists to explain, so it is recorded and surfaced
   * rather than blocked. Stopping the student here would prevent the lesson.
   */
  readonly outOfOrder: readonly { checkpoint: string; shouldFollow: readonly string[] }[];
}

/**
 * Fold new progress events into the log.
 *
 * Deliberately does **not** enforce the order. A tracker that refused an
 * out-of-order checkpoint would prevent exactly the mistake this whole product
 * exists to teach from — the student would never build tax before discount, and
 * would never find out why that was tempting. So it accepts the work, records the
 * true sequence, and hands the divergence to MENTOR to explain later.
 *
 * It does reject unknown checkpoint ids and duplicates, because those are not
 * lessons, they are bad input.
 */
export function recordProgress(
  cps: CheckpointPlan,
  prior: ProgressLog | null,
  incoming: readonly ProgressEvent[],
): RecordResult {
  const byId = new Map(cps.checkpoints.map((c) => [c.id, c]));
  const events: ProgressEvent[] = [...(prior?.events ?? [])];
  const reached = passedCheckpoints(events);

  const accepted: string[] = [];
  const rejected: { checkpoint: string; why: string }[] = [];
  const outOfOrder: { checkpoint: string; shouldFollow: string[] }[] = [];

  for (const ev of incoming) {
    const cp = byId.get(ev.checkpoint);
    if (!cp) {
      rejected.push({ checkpoint: ev.checkpoint, why: 'no such checkpoint in this plan' });
      continue;
    }
    // Only a *passed* checkpoint is a duplicate. Re-running a criterion that
    // failed is exactly what a student does after fixing it, and rejecting the
    // second attempt would make the failure permanent.
    if (reached.has(ev.checkpoint)) {
      rejected.push({ checkpoint: ev.checkpoint, why: 'already recorded' });
      continue;
    }
    if (!ev.file) {
      rejected.push({
        checkpoint: ev.checkpoint,
        why: 'no file — a checkpoint without a location cannot support a file:line claim later',
      });
      continue;
    }

    const unmet = cp.blockedBy.filter((b) => !reached.has(b));
    if (unmet.length) {
      outOfOrder.push({
        checkpoint: cp.id,
        shouldFollow: unmet.map((id) => byId.get(id)?.subject ?? id),
      });
    }

    const outcome: 'pass' | 'fail' = ev.outcome === 'fail' ? 'fail' : 'pass';
    events.push({
      checkpoint: ev.checkpoint,
      file: ev.file,
      line: ev.line ?? null,
      at: ev.at ?? `T+${events.length * 7}m`,
      summary: ev.summary ?? cp.title,
      outcome,
    });
    if (outcome === 'pass') {
      reached.add(ev.checkpoint);
      accepted.push(ev.checkpoint);
    }
  }

  return {
    log: { project: cps.project, role: cps.role, events },
    accepted,
    rejected,
    remaining: cps.checkpoints.filter((c) => !reached.has(c.id)).map((c) => c.id),
    outOfOrder,
  };
}

/**
 * Checkpoints that actually *passed*.
 *
 * A recorded event proves the student did the work; only a non-failing outcome
 * proves it worked. Everything that judges completeness must go through here
 * rather than reading `events` directly, or a red test counts as done.
 */
export function passedCheckpoints(events: readonly ProgressEvent[]): Set<string> {
  // Last write wins per checkpoint, so a re-run supersedes an earlier attempt in
  // either direction. `recordProgress` will not currently let a passed
  // checkpoint be overwritten, but a log can also arrive from a client, and a
  // regression must not be masked by the older green event.
  const latest = new Map<string, 'pass' | 'fail'>();
  for (const e of events) latest.set(e.checkpoint, e.outcome === 'fail' ? 'fail' : 'pass');
  return new Set([...latest].filter(([, outcome]) => outcome === 'pass').map(([id]) => id));
}

/**
 * Turn a progress log into a `mentor.build/v1` — the artifact `explain_drift`
 * already consumes.
 *
 * This is the join that makes the chain a loop rather than five stages. The
 * student's checkpoint log, which existed to track progress, turns out to be
 * exactly the input MENTOR needs. Nothing new has to be authored, and the
 * provenance is `observed` rather than `authored` because these timestamps were
 * recorded as the work happened rather than reconstructed afterwards.
 */
export function buildFromProgress(
  cps: CheckpointPlan,
  brief: Brief,
  log: ProgressLog,
  failure: Build['failure'] = null,
): Build {
  const byId = new Map(cps.checkpoints.map((c) => [c.id, c]));

  const steps: BuildStep[] = log.events.map((ev, i) => {
    const cp = byId.get(ev.checkpoint);
    return {
      seq: i + 1,
      at: ev.at ?? `T+${i * 7}m`,
      // For a verify checkpoint the acceptance id is not a component name, so use
      // the tests file's own identity — `drift.ts` only derives component order
      // from `implement` steps, and mislabelling a verify step as a component
      // would inject a phantom into the actual order.
      component: cp?.kind === 'implement' ? cp.subject : (cp?.subject ?? ev.checkpoint),
      kind: cp?.kind === 'verify' ? 'verify' : 'implement',
      file: ev.file,
      line: ev.line ?? null,
      summary: ev.summary ?? cp?.title ?? ev.checkpoint,
    };
  });

  return {
    schema: BUILD_SCHEMA,
    project: brief.project,
    entry: brief.entry,
    tests: brief.tests,
    provenance: 'observed',
    steps,
    failure,
    warnings:
      steps.length === 0
        ? ['no checkpoints reached yet — there is no history to compare against a plan']
        : [],
  };
}

// ── the definition of done ────────────────────────────────────────────────────

export interface DoneVerdict {
  readonly done: boolean;
  readonly project: string;
  readonly role: string;
  readonly implemented: { readonly reached: number; readonly total: number };
  readonly verified: { readonly reached: number; readonly total: number };
  readonly scope: ScopeReport;
  /** Every unmet condition, in the words a student can act on. */
  readonly blocking: readonly string[];
  readonly definitionOfDone: string;
  readonly statement: string;
}

/**
 * Is this slice done?
 *
 * Three conditions, and the third is the one that makes this worth a tool call
 * rather than a checkbox count:
 *
 * 1. every owned component implemented
 * 2. every acceptance criterion verified
 * 3. **the design covers the slice and nothing outside it**
 *
 * (3) is why done-ness is judged against the brief and the plan rather than
 * against the checkpoints alone. A student can tick every checkpoint derived from
 * a design that was missing half their job — the checkpoints would be complete
 * and the work would not be. Counting only what was asked for cannot catch a
 * question that was asked wrong.
 */
export function judgeDone(
  brief: Brief,
  plan: Plan,
  cps: CheckpointPlan,
  log: ProgressLog | null,
): DoneVerdict {
  // Passed, not merely recorded — a criterion the student ran and watched fail is
  // in the log (MENTOR needs it there) but is emphatically not done.
  const reached = passedCheckpoints(log?.events ?? []);
  const failed = new Set(
    (log?.events ?? []).filter((e) => e.outcome === 'fail').map((e) => e.checkpoint),
  );
  const implement = cps.checkpoints.filter((c) => c.kind === 'implement');
  const verify = cps.checkpoints.filter((c) => c.kind === 'verify');
  const implemented = implement.filter((c) => reached.has(c.id));
  const verified = verify.filter((c) => reached.has(c.id));
  const scope = checkScope(brief, plan);

  const blocking: string[] = [];
  for (const c of implement) {
    if (!reached.has(c.id)) blocking.push(`${c.subject} is not implemented`);
  }
  for (const c of verify) {
    if (reached.has(c.id)) continue;
    blocking.push(
      failed.has(c.id)
        ? `failing: ${c.proves} — you ran this and it did not hold`
        : `not yet verified: ${c.proves}`,
    );
  }
  for (const m of scope.missing) {
    blocking.push(`${m} is in your brief but missing from your design`);
  }
  for (const o of scope.outOfScope) {
    blocking.push(`${o} is on your canvas but is not yours to build`);
  }
  if (verify.length === 0) {
    blocking.push(
      'this brief has no acceptance criteria, so nothing can confirm the slice works — ' +
        'done cannot be claimed',
    );
  }

  const done = blocking.length === 0;

  return {
    done,
    project: brief.project,
    role: brief.role,
    implemented: { reached: implemented.length, total: implement.length },
    verified: { reached: verified.length, total: verify.length },
    scope,
    blocking,
    definitionOfDone: cps.definitionOfDone,
    statement: done
      ? `Done. ${implemented.length} component(s) built, ${verified.length} criteria verified, ` +
        'and your design matched your slice exactly.'
      : `Not done — ${blocking.length} condition(s) outstanding.`,
  };
}
