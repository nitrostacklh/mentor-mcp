/**
 * REGISTRAR — identity, and the drawer a student's work is kept in.
 *
 * The registrar's office holds student records, and decides who may read them.
 * That is exactly the job: resolve who is asking (`identity.ts`), keep their
 * checkpoint log somewhere it survives the conversation (`store.ts`), and let an
 * instructor — and only an instructor — see the class.
 *
 * ## Three tools, and why not more
 *
 * `GAPS.md` Gap 11 is the standing record of what a bloated tool surface costs:
 * in an MCP app the tool list *is* the interface, and the client's model picks
 * from it. Persistence could easily have added eight verbs. It adds none —
 * `record_progress` and `is_it_done` gained a server side **invisibly**, so
 * saving is a consequence of working rather than a thing to remember.
 *
 * What is left is the part a student genuinely has to ask for:
 *
 * - `whoami` — who am I, and *is my work actually being kept*
 * - `resume` — what was I in the middle of
 * - `class_progress` — instructor-only, the one thing roles exist for
 *
 * ## There is deliberately no query tool
 *
 * No `query`, no `execute_sql`, no `db_write`. A generic database tool hands the
 * client's model arbitrary access to every student's record, and "the model only
 * runs safe queries" is not a security model. Everything here is a named operation
 * with the identity check baked in, so there is no path from a prompt to a table.
 */

import {
  ToolDecorator as Tool,
  PromptDecorator as Prompt,
  Module,
  ExecutionContext,
  z,
} from '@nitrostack/core';
import { bundledBrief } from '../learn/fixtures.learn.js';
import { canReadOthers, resolveIdentity, type Identity } from './identity.js';
import { openStore, type ProgressStore } from './store.js';

/**
 * One store for the process, opened on first use.
 *
 * Lazy rather than at import time so a misconfigured `MENTOR_STORE` cannot stop
 * the server from starting — the whole point of `openStore` reporting instead of
 * throwing (see `store.ts`).
 */
let storePromise: Promise<{ store: ProgressStore; reason: string }> | null = null;
export function progressStore(): Promise<{ store: ProgressStore; reason: string }> {
  storePromise ??= openStore();
  return storePromise;
}

/** Test seam — swap in a fixed store, and reset between cases. */
export function __setProgressStore(value: { store: ProgressStore; reason: string } | null): void {
  storePromise = value ? Promise.resolve(value) : null;
}

/** Shared by REGISTRAR and COACH so both key a student's work identically. */
export async function saveRun(
  identity: Identity,
  project: string,
  role: string,
  log: unknown,
): Promise<{ saved: boolean; durable: boolean; note: string }> {
  const { store } = await progressStore();
  await store.save({ student: identity.id, project, role, log: log as never });
  return { saved: true, durable: store.durable, note: store.note };
}

export class RegistrarTools {
  @Tool({
    name: 'whoami',
    description:
      'Who the caller is, and — the part that matters — whether their progress is actually being ' +
      'kept. Reports the identity, the role, and whether storage is durable or will be lost on a ' +
      'restart. Call this before relying on progress surviving, rather than finding out afterwards.',
    inputSchema: z.object({}),
  })
  async whoami(_input: unknown, ctx: ExecutionContext) {
    const identity = resolveIdentity(ctx);
    const { store, reason } = await progressStore();
    const mine = await store.listForStudent(identity.id);
    ctx.logger.info('whoami', { id: identity.id, role: identity.role, backend: store.backend });

    return {
      you: { id: identity.id, role: identity.role, authenticated: identity.authenticated },
      how: identity.how,
      can_read_other_students: canReadOthers(identity),
      storage: {
        backend: store.backend,
        durable: store.durable,
        what_that_means: store.note,
        why_this_backend: reason,
      },
      your_runs: mine.map((r) => ({
        project: r.project,
        role: r.role,
        checkpoints_reached: r.reached,
        last_worked: r.updatedAt,
      })),
      next: mine.length
        ? 'Call resume to pick one back up.'
        : 'Nothing saved yet — browse_catalog to start.',
    };
  }

  @Tool({
    name: 'resume',
    description:
      "Load a student's saved checkpoint log so they can pick up where they left off. Returns the " +
      'progress log in exactly the shape record_progress and is_it_done expect, so the work ' +
      'continues rather than restarting. Call this at the start of a session.',
    inputSchema: z.object({
      project: z.string().describe('Project key, e.g. "pricing".'),
      role: z.string().describe('Role key, e.g. "backend".'),
    }),
  })
  async resume(input: { project: string; role: string }, ctx: ExecutionContext) {
    const identity = resolveIdentity(ctx);
    const { store } = await progressStore();
    const run = await store.load(identity.id, input.project, input.role);
    ctx.logger.info('resume', { id: identity.id, found: !!run });

    if (!run) {
      const mine = await store.listForStudent(identity.id);
      return {
        found: false,
        message: `Nothing saved for ${input.project}/${input.role} under ${identity.id}.`,
        // Not durable and nothing found is a different situation from simply not
        // having started, and the student deserves to know which one they are in.
        caveat: store.durable
          ? undefined
          : 'Storage here is not durable, so if you did work earlier it may have been lost in a ' +
            'restart rather than never happening.',
        your_other_runs: mine.map((r) => `${r.project}/${r.role}`),
      };
    }

    const brief = bundledBrief(input.project, input.role);
    return {
      found: true,
      project: run.project,
      role: run.role,
      last_worked: run.updatedAt,
      log: run.log,
      checkpoints_reached: new Set(
        run.log.events.filter((e) => e.outcome !== 'fail').map((e) => e.checkpoint),
      ).size,
      you_were_building: brief?.title,
      next: 'Pass this log to is_it_done, or keep going with record_progress.',
    };
  }

  @Tool({
    name: 'class_progress',
    description:
      'Instructor only. Every student who has started work on this deployment, what they are ' +
      'building, and how far they have got. Refuses for students — the refusal is the point of ' +
      'having roles at all.',
    inputSchema: z.object({
      project: z.string().optional().describe('Filter to one project.'),
    }),
  })
  async classProgress(input: { project?: string }, ctx: ExecutionContext) {
    const identity = resolveIdentity(ctx);

    // Checked here rather than only in a guard: this tool is the single place that
    // reads other people's records, so the check lives next to the thing it guards
    // where it cannot be lost by a decorator being dropped in a refactor.
    if (!canReadOthers(identity)) {
      ctx.logger.info('class_progress refused', { id: identity.id, role: identity.role });
      return {
        refused: true,
        reason: identity.authenticated
          ? `You are authenticated as ${identity.id} with the student role. Reading other ` +
            "students' work requires the instructor role."
          : 'You are anonymous. Reading other students\' work requires an authenticated ' +
            'instructor — otherwise anyone who found this URL could read the class.',
        your_own_progress: 'Call whoami or resume instead.',
      };
    }

    const { store } = await progressStore();
    const all = await store.listAll();
    const rows = input.project ? all.filter((r) => r.project === input.project) : all;
    ctx.logger.info('class_progress', { instructor: identity.id, rows: rows.length });

    return {
      instructor: identity.id,
      students: new Set(rows.map((r) => r.student)).size,
      runs: rows.map((r) => ({
        student: r.student,
        project: r.project,
        role: r.role,
        checkpoints_reached: r.reached,
        last_worked: r.updatedAt,
      })),
      caveat: store.durable
        ? undefined
        : 'Storage is not durable on this deployment, so this is only what has happened since ' +
          'the last restart. Absent students may simply have been lost.',
    };
  }
}

export class RegistrarPrompts {
  @Prompt({
    name: 'pick_up_where_i_left_off',
    description: 'Resume a student’s work: identify them, find their saved run, and continue it.',
    arguments: [
      { name: 'project', description: 'Project key, if they remember it', required: false },
      { name: 'role', description: 'Role key, if they remember it', required: false },
    ],
  })
  async pickUpWhereILeftOff(args: { project?: string; role?: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'A student is coming back to work they started earlier.\n\n' +
          '1. Call whoami. Tell them who they are signed in as and — importantly — whether ' +
          'their progress is actually durable. If it is not, say so plainly rather than ' +
          'letting them assume it is safe.\n' +
          '2. Call resume' +
          (args.project && args.role ? ` for ${args.project}/${args.role}` : ' for the run they name') +
          '. If nothing is found and storage is not durable, do not tell them they never ' +
          'started — say their earlier work may have been lost in a restart.\n' +
          '3. Carry on: pass the returned log to is_it_done to see what is outstanding.\n\n' +
          'Do not offer to write their code. If they ask, call withhold_fix.',
      },
    ];
  }
}

@Module({
  name: 'registrar',
  description:
    "Identity and records — who is asking, whether their progress is being kept, and (for instructors only) how the class is doing.",
  controllers: [RegistrarTools, RegistrarPrompts],
})
export class RegistrarModule {}
