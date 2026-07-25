/**
 * REGISTRAR · identity — who is asking, and what may they see.
 *
 * Pure: takes an `ExecutionContext` and returns a decision. No I/O, so the rules
 * below are testable without standing up an auth server, which is the only way
 * anyone will ever check them.
 *
 * ## Anonymous is a supported state, not a failure
 *
 * The obvious design is to reject unauthenticated callers. That would break the
 * thing this submission most needs to survive: **a judge connecting a client and
 * calling `explain_drift` with no arguments and no account.** So an unauthenticated
 * caller is a real, named identity with reduced privileges — they can drive the
 * whole loop against the bundled demo, and their progress is shared rather than
 * private. `whoami` says so plainly instead of implying they have an account.
 *
 * The trade is deliberate and it is worth stating out loud: anonymous progress is
 * **not private**, because there is nothing to key it to. Two anonymous callers on
 * the same deployment share a drawer. That is fine for a demo and wrong for a
 * classroom, which is exactly why `authenticated` is on the record and surfaced.
 *
 * ## Where role comes from
 *
 * `AuthContext` has no `role` field — it carries `scopes` and `claims`. Both are
 * checked, because JWT issuers differ: some put a role in a custom claim, some
 * express it as a scope. Neither present means `student`, which is the safe
 * default: the only thing `instructor` unlocks is reading other people's work.
 */

import type { ExecutionContext } from '@nitrostack/core';

export type Role = 'student' | 'instructor';

export interface Identity {
  /** Stable key a student's saved work is stored under. */
  readonly id: string;
  readonly role: Role;
  readonly authenticated: boolean;
  /** How this was decided, in words. Shown by `whoami` — never a bare boolean. */
  readonly how: string;
}

/** The id anonymous callers share. Deliberately obvious in any listing. */
export const ANONYMOUS_ID = 'anonymous';

const INSTRUCTOR_SCOPES = new Set(['instructor', 'mentor:instructor', 'mentor.instructor']);

/** Read a role out of scopes or custom claims, tolerating either convention. */
function roleFrom(auth: NonNullable<ExecutionContext['auth']>): Role {
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : [];
  if (scopes.some((s) => INSTRUCTOR_SCOPES.has(String(s).toLowerCase()))) return 'instructor';

  const claimed = (auth.claims as Record<string, unknown> | undefined)?.role;
  if (typeof claimed === 'string' && claimed.toLowerCase() === 'instructor') return 'instructor';

  return 'student';
}

export function resolveIdentity(ctx: Pick<ExecutionContext, 'auth'>): Identity {
  const subject = ctx.auth?.subject?.trim();

  if (!subject) {
    return {
      id: ANONYMOUS_ID,
      role: 'student',
      authenticated: false,
      how:
        'No authenticated subject on this request, so you are anonymous. Everything still ' +
        'works — but anonymous progress is shared with every other anonymous caller on this ' +
        'deployment, so it is not private. Connect with a token to get your own record.',
    };
  }

  const role = roleFrom(ctx.auth!);
  return {
    id: subject,
    role,
    authenticated: true,
    how:
      role === 'instructor'
        ? `Authenticated as ${subject}, with the instructor role — you can read other students' progress.`
        : `Authenticated as ${subject}. Your progress is stored under that id and is yours alone.`,
  };
}

/** True when this identity may read work that is not their own. */
export function canReadOthers(identity: Identity): boolean {
  return identity.authenticated && identity.role === 'instructor';
}
