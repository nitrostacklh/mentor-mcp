/**
 * COACH — bridges ②③ and ④. The half of the loop that happens while the student
 * is still working.
 *
 * Four tools, in the order a student meets them:
 *
 * - `check_scope` — did you design *your* job? (brief × plan)
 * - `checkpoints` — what are the steps, in the order you yourself chose?
 * - `record_progress` — I finished one. Also: here is your build history.
 * - `is_it_done` — am I finished? Judged, not self-assessed.
 *
 * ## `record_progress` is the load-bearing one, and not for the obvious reason
 *
 * Its visible job is ticking a box. Its real job is that the log it accumulates
 * *is* a `mentor.build/v1` — the artifact `explain_drift` already consumes. So the
 * demo's weakest link goes away as a side effect: MENTOR's pricing history is
 * `provenance: "authored"` and scores 0.91 because nobody watched it happen
 * (`mentor/build.ts`), whereas a checkpoint log was written as the work occurred
 * and scores `observed`. The confidence rises because the evidence improved.
 *
 * ## The client is still a valid store; the server is now also one
 *
 * These tools were written pure: `record_progress` took the prior log and returned
 * the new one, and the client held the state. That was right for a stateless
 * deploy and it had one real cost — close the conversation and the work was gone.
 *
 * REGISTRAR added a server-side drawer, and it is wired in **invisibly**: no save
 * tool, no extra call, no new verb on the surface. Saving is a consequence of
 * working. Two rules make that safe:
 *
 * 1. **The client log wins, and anonymous callers are fully stateless.** A caller
 *    that passes a log is the authority; the stored copy is only a fallback, and
 *    only for an *authenticated* identity. Anonymous never reads or writes storage
 *    — every anonymous caller would share one drawer, so one judge's run would
 *    surface in the next judge's session and the demo would stop being
 *    deterministic. `npm run walk` caught exactly that regression.
 * 2. **A storage failure never loses the student their work.** The log still comes
 *    back in full, and `saved` reports what actually happened — including when
 *    storage is not durable, which on NitroCloud's Node 20 image it will not be
 *    (see `registrar/store.ts`).
 *
 * So the pure path still works exactly as before, and nothing here requires a
 * database to exist.
 */

import {
  ToolDecorator as Tool,
  PromptDecorator as Prompt,
  Module,
  ExecutionContext,
  z,
} from '@nitrostack/core';
import { normalizeComponent } from '../mentor/build.js';
import { bundledPlan } from '../mentor/fixtures.js';
import { parsePlan, type Plan } from '../mentor/plan.js';
import { checkScope, type Brief } from './brief.js';
import {
  buildFromProgress,
  deriveCheckpoints,
  judgeDone,
  recordProgress,
  type ProgressEvent,
  type ProgressLog,
} from './checkpoints.js';
import { bundledBrief, bundledProjectArtifacts } from './fixtures.learn.js';
import { resolveIdentity } from '../registrar/identity.js';
import { progressStore, saveRun } from '../registrar/registrar.module.js';

const artifact = z
  .union([z.string(), z.record(z.unknown())])
  .optional()
  .describe('A JSON document, as a string or object. Omit to use the bundled demo project.');

const progressLog = z
  .union([z.string(), z.record(z.unknown())])
  .optional()
  .describe(
    'The log returned by a previous record_progress call. Omit on the first call. This server ' +
      'keeps no state, so pass back what it gave you.',
  );

/** Either the artifacts, or a structured error a client can act on. */
type Resolved = { brief: Brief; plan: Plan } | { error: string; hint?: unknown };

/**
 * Find the brief and the plan, falling back to bundled copies.
 *
 * The fallback is what makes the stage demo one click with nothing to upload,
 * and the explicit arguments are the path a real student's project takes
 * (`GAPS.md` Gap 6). `pricing`'s plan comes from `mentor/fixtures.ts` rather than
 * being duplicated here — it is the one artifact the whole test suite asserts
 * against, and a second copy would eventually disagree with the first.
 */
function resolve(project: string, role: string, planInput: unknown): Resolved {
  const brief = bundledBrief(project, role);
  if (!brief) {
    return {
      error: `no brief for ${project}/${role} — call browse_catalog to see the playable roles`,
    };
  }

  if (planInput !== undefined) {
    try {
      return { brief, plan: parsePlan(planInput) };
    } catch (err) {
      return {
        error: `could not read your plan: ${err instanceof Error ? err.message : String(err)}`,
        hint: 'Export it from the Lumina canvas with the Plan button — that produces lumina.plan/v1.',
      };
    }
  }

  if (project === 'pricing') return { brief, plan: bundledPlan() };
  const bundled = bundledProjectArtifacts(project);
  if (bundled) return { brief, plan: bundled.plan };

  return {
    error: `no bundled plan for ${project} — pass your exported lumina.plan/v1 as the plan argument`,
  };
}

const isError = (r: Resolved): r is { error: string; hint?: unknown } => 'error' in r;

function parseLog(input: unknown): ProgressLog | null {
  if (input === undefined || input === null) return null;
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const events = Array.isArray(obj.events) ? obj.events : [];
  return {
    project: typeof obj.project === 'string' ? obj.project : '',
    role: typeof obj.role === 'string' ? obj.role : '',
    events: events.filter((e): e is ProgressEvent => typeof e === 'object' && e !== null),
  };
}

export class CoachTools {
  @Tool({
    name: 'check_scope',
    description:
      "Compare the architecture a student drew in Lumina against their role's brief, and report " +
      'whether they designed their own slice. Returns four verdicts per component: covered (yours, ' +
      'and you drew it), boundary (someone else owns it, you correctly drew it as your edge), ' +
      'out_of_scope (you drew someone else\'s job), missing (you own it and did not design it). ' +
      'This is SCOPE drift, which is a different failure from the ordering drift explain_drift ' +
      'finds — and in a company it is the more expensive one, because nobody notices until ' +
      'integration. Call before the student writes any code.',
    inputSchema: z.object({
      project: z.string().describe('Project key, e.g. "pricing".'),
      role: z.string().describe('Role key, e.g. "backend".'),
      plan: artifact,
    }),
  })
  async checkScopeTool(
    input: { project: string; role: string; plan?: unknown },
    ctx: ExecutionContext,
  ) {
    const r = resolve(input.project, input.role, input.plan);
    if (isError(r)) return r;
    ctx.logger.info('check_scope', { project: input.project, role: input.role });

    const report = checkScope(r.brief, r.plan);
    return {
      project: report.project,
      role: report.role,
      in_scope: report.inScope,
      summary: report.summary,
      coverage: report.coverage,
      covered: report.covered,
      boundary: report.boundary,
      out_of_scope: report.outOfScope,
      missing: report.missing,
      per_component: report.entries.map((e) => ({
        component: e.label,
        verdict: e.verdict,
        note: e.note,
      })),
      next: report.inScope
        ? 'Your design matches your slice. Call checkpoints to turn it into a work plan.'
        : 'Fix the design before you write code. Changing a box now costs a drag; changing it ' +
          'after four components depend on it costs an afternoon.',
    };
  }

  @Tool({
    name: 'checkpoints',
    description:
      "Turn a student's brief and their own Lumina design into an ordered checkpoint list, plus the " +
      'definition of done. One checkpoint per component they own, sequenced by the order THEY drew, ' +
      'with dependencies taken from the real edges on their canvas — then one per acceptance ' +
      'criterion. The sequence is theirs, not the tool\'s, which is what makes it fair to hold them ' +
      'to it later.',
    inputSchema: z.object({
      project: z.string(),
      role: z.string(),
      plan: artifact,
    }),
  })
  async checkpointsTool(
    input: { project: string; role: string; plan?: unknown },
    ctx: ExecutionContext,
  ) {
    const r = resolve(input.project, input.role, input.plan);
    if (isError(r)) return r;
    ctx.logger.info('checkpoints', { project: input.project, role: input.role });

    const cps = deriveCheckpoints(r.brief, r.plan);
    return {
      project: cps.project,
      role: cps.role,
      definition_of_done: cps.definitionOfDone,
      checkpoints: cps.checkpoints.map((c) => ({
        id: c.id,
        seq: c.seq,
        kind: c.kind,
        subject: c.subject,
        title: c.title,
        proves: c.proves,
        blocked_by: c.blockedBy,
      })),
      how_to_use:
        'Work them in any order you like — nothing here stops you going out of sequence. If you ' +
        'do, that is recorded rather than blocked, because the divergence between the order you ' +
        'planned and the order you built is exactly what explain_drift needs in order to teach you ' +
        'anything.',
      next: 'Call record_progress each time you finish one, with the file it landed in.',
      warnings: cps.warnings,
    };
  }

  @Tool({
    name: 'record_progress',
    description:
      'Record that a student reached one or more checkpoints, and get back their build history. ' +
      'Returns a mentor.build/v1 document with provenance "observed" — which is exactly what ' +
      'explain_drift consumes, so a student who tracked their work never has to author a history. ' +
      'Deliberately accepts out-of-order work and flags it rather than refusing it: blocking the ' +
      'mistake would prevent the lesson. This server keeps no state — pass the log back each time.',
    inputSchema: z.object({
      project: z.string(),
      role: z.string(),
      plan: artifact,
      log: progressLog,
      reached: z
        .array(
          z.object({
            checkpoint: z.string().describe('A checkpoint id from the checkpoints tool, e.g. "cp-2".'),
            file: z.string().describe('Where the work landed. Required — a checkpoint with no location cannot support a file:line claim later.'),
            line: z.number().nullable().optional(),
            at: z.string().optional().describe('Relative offset from session start, e.g. "T+11m".'),
            summary: z.string().optional(),
            outcome: z
              .enum(['pass', 'fail'])
              .optional()
              .describe(
                'For a verify checkpoint: did the criterion hold? Pass "fail" when the student ' +
                  'ran it and it did not. The event is still recorded — MENTOR needs the failure ' +
                  'in the history to link it to the work that caused it — but it does not count ' +
                  'toward done. Defaults to "pass".',
              ),
          }),
        )
        .describe('The checkpoints just completed, in the order they actually happened.'),
    }),
  })
  async recordProgressTool(
    input: {
      project: string;
      role: string;
      plan?: unknown;
      log?: unknown;
      reached: ProgressEvent[];
    },
    ctx: ExecutionContext,
  ) {
    const r = resolve(input.project, input.role, input.plan);
    if (isError(r)) return r;

    const cps = deriveCheckpoints(r.brief, r.plan);

    // Prefer the log the client sent; fall back to whatever REGISTRAR has stored for
    // this identity. That ordering matters — the client is the authority when it has
    // state, so a caller that has been tracking its own log is never silently
    // overwritten by a staler server copy.
    const identity = resolveIdentity(ctx);
    let prior = parseLog(input.log);
    if (!prior && identity.authenticated) {
      const { store } = await progressStore();
      prior = (await store.load(identity.id, input.project, input.role))?.log ?? null;
    }

    const result = recordProgress(cps, prior, input.reached ?? []);
    const build = buildFromProgress(cps, r.brief, result.log);

    // Persistence is a consequence of working, not a thing to remember: no save tool,
    // no extra call. A storage failure must not lose the student the work they just
    // did, so it degrades to "we could not keep this" rather than throwing.
    let persisted: { saved: boolean; durable?: boolean; note: string };
    try {
      persisted = identity.authenticated
        ? await saveRun(identity, input.project, input.role, result.log)
        : {
            saved: false,
            note:
              'Not saved — you are anonymous. Anonymous callers are deliberately stateless: ' +
              'sharing one drawer between everyone who connects would leak one caller’s ' +
              'progress into the next, and make the demo non-deterministic. Keep the log below, ' +
              'or connect with a token to have it kept for you.',
          };
    } catch (err) {
      persisted = {
        saved: false,
        note:
          'Your progress was NOT saved server-side: ' +
          (err instanceof Error ? err.message : String(err)) +
          '. Keep the log below — it is the record.',
      };
    }

    ctx.logger.info('record_progress', {
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      outOfOrder: result.outOfOrder.length,
      student: identity.id,
      saved: persisted.saved,
    });

    return {
      // Still handed back in full. The server storing a copy does not make the client
      // stop being a valid store — and on a deployment without durable storage it is
      // the only one that survives a restart.
      log: result.log,
      saved: persisted,
      accepted: result.accepted,
      rejected: result.rejected,
      remaining: result.remaining,
      out_of_order: result.outOfOrder.map((o) => ({
        checkpoint: o.checkpoint,
        should_have_followed: o.shouldFollow,
        note:
          'Recorded, not blocked. Your own design put those first. Keep going — this is the ' +
          'thing explain_drift will be able to show you later.',
      })),
      build_history: build,
      provenance_note:
        'This history is provenance "observed": the sequence was recorded as the work happened ' +
        'rather than written up afterwards, so MENTOR trusts it more than a hand-authored one ' +
        '(0.8 vs 0.4 on that component) and less than one derived from real commits.',
      next:
        result.remaining.length === 0
          ? 'Everything is recorded. Call is_it_done.'
          : `${result.remaining.length} checkpoint(s) left. When a test fails, pass this ` +
            'build_history to explain_drift.',
    };
  }

  @Tool({
    name: 'is_it_done',
    description:
      "Judge whether a student's slice is finished. Three conditions: every component they own is " +
      'implemented, every acceptance criterion is verified, and their design covers their slice ' +
      'and nothing outside it. The third is why this is a judgement rather than a checkbox count — ' +
      'a student can tick every checkpoint derived from a design that was missing half their job, ' +
      'and counting only what was asked for cannot catch a question that was asked wrong.',
    inputSchema: z.object({
      project: z.string(),
      role: z.string(),
      plan: artifact,
      log: progressLog,
    }),
  })
  async isItDone(
    input: { project: string; role: string; plan?: unknown; log?: unknown },
    ctx: ExecutionContext,
  ) {
    const r = resolve(input.project, input.role, input.plan);
    if (isError(r)) return r;

    const cps = deriveCheckpoints(r.brief, r.plan);
    // Same precedence as record_progress: client log wins, stored log is the fallback,
    // so "am I done" can be asked in a fresh conversation without re-uploading anything.
    const identity = resolveIdentity(ctx);
    let log = parseLog(input.log);
    if (!log && identity.authenticated) {
      const { store } = await progressStore();
      log = (await store.load(identity.id, input.project, input.role))?.log ?? null;
    }
    const verdict = judgeDone(r.brief, r.plan, cps, log);
    ctx.logger.info('is_it_done', { done: verdict.done, blocking: verdict.blocking.length });

    return {
      done: verdict.done,
      statement: verdict.statement,
      definition_of_done: verdict.definitionOfDone,
      implemented: verdict.implemented,
      verified: verdict.verified,
      design_matches_slice: verdict.scope.inScope,
      blocking: verdict.blocking,
      // Reconciles the one thing `explain_drift` cannot know on its own: it will
      // report a `given` component as planned-but-never-implemented, which is
      // true and yet not a defect. Only the brief knows that box is somebody
      // else's, so only this tool can say so.
      expected_unbuilt: verdict.scope.boundary.map((c) => ({
        component: c,
        note:
          'You drew this as your boundary and correctly did not implement it. If explain_drift ' +
          'lists it as "planned but never implemented", that is expected here.',
      })),
      next: verdict.done
        ? 'Call flashcard to claim the concept you earned.'
        : 'Work the blocking list.',
    };
  }
}

/**
 * Which drawn components are the student's boundary — used by the prompt to warn
 * the model off treating them as missing work.
 */
export function boundaryComponents(brief: Brief, plan: Plan): string[] {
  const given = new Set(brief.given.map((g) => normalizeComponent(g.component)));
  return plan.nodes.filter((n) => given.has(normalizeComponent(n.label))).map((n) => n.label);
}

export class CoachPrompts {
  @Prompt({
    name: 'work_the_slice',
    description:
      'Coach a student through their assignment: check the design covers their slice, derive their checkpoints, and judge done-ness.',
    arguments: [
      { name: 'project', description: 'Project key, e.g. pricing', required: true },
      { name: 'role', description: 'Role key, e.g. backend', required: true },
      { name: 'plan', description: 'Their exported lumina.plan/v1, if not the demo', required: false },
    ],
  })
  async workTheSlice(
    args: { project: string; role: string; plan?: string },
    _ctx: ExecutionContext,
  ) {
    return [
      {
        role: 'user',
        content:
          `You are coaching a student working the ${args.role} role on ${args.project}.\n\n` +
          'In order:\n' +
          '1. check_scope — confirm the architecture they drew is their slice. If anything is ' +
          'out_of_scope or missing, stop and deal with that first; it is cheaper to move a box ' +
          'now than to unpick four components later.\n' +
          '2. checkpoints — give them the ordered list and read them the definition of done.\n' +
          '3. record_progress as they finish each one. Pass the log back every time; the server ' +
          'stores nothing.\n' +
          '4. is_it_done when they think they are finished. Do not agree that they are done ' +
          'because they say so — call the tool.\n\n' +
          'Two rules you must not break:\n' +
          '- If out_of_order comes back, do NOT tell them off and do NOT tell them how to unpick ' +
          'it. Note it and move on. That divergence is the material explain_drift needs, and ' +
          'pre-empting it destroys the lesson.\n' +
          '- Never write their code. If they ask, call withhold_fix.' +
          (args.plan ? `\n\nTheir plan:\n${args.plan}` : '\n\nNo plan passed — the bundled demo project is used.'),
      },
    ];
  }
}

@Module({
  name: 'coach',
  description:
    "Progress and done-ness — checks a student's design covers their role's slice, derives checkpoints from their own plan, and records an observed build history.",
  controllers: [CoachTools, CoachPrompts],
})
export class CoachModule {}
