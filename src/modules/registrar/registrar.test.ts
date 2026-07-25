/**
 * Tests for REGISTRAR — identity, roles, and the drawer student work is kept in.
 *
 * The cases worth writing are the ones where a plausible implementation is quietly
 * wrong in a way that costs a real person:
 *
 * - refusing anonymous callers would break the one-click judge demo, which is the
 *   single path this submission most needs to survive;
 * - a stale server copy silently overwriting a client's live log would lose work
 *   that the student is in the middle of;
 * - reporting `durable: true` on a runtime that cannot persist would tell a student
 *   their afternoon is safe when it is one restart from gone.
 *
 * The role check is tested as a *refusal*, not just as a permission, because the
 * only reason roles exist here is to stop one student reading another's work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nitrostack/core';

import {
  ANONYMOUS_ID,
  canReadOthers,
  resolveIdentity,
  type Identity,
} from './identity.js';
import { MemoryStore, openStore, type ProgressStore } from './store.js';
import type { ProgressLog } from '../learn/checkpoints.js';

const FIXED = () => '2026-07-25T12:00:00.000Z';

const log = (...checkpoints: string[]): ProgressLog => ({
  project: 'pricing',
  role: 'backend',
  events: checkpoints.map((c) => ({ checkpoint: c, file: 'build/pricing.js', outcome: 'pass' })),
});

const asCtx = (auth?: unknown): Pick<ExecutionContext, 'auth'> =>
  ({ auth } as Pick<ExecutionContext, 'auth'>);

// ── identity ──────────────────────────────────────────────────────────────────

test('identity: no auth is a supported state, not a rejection', () => {
  // The one-click judge path depends on this. If anonymous ever throws or returns
  // null, a judge connecting a client with no account cannot use the product.
  const id = resolveIdentity(asCtx(undefined));
  assert.equal(id.id, ANONYMOUS_ID);
  assert.equal(id.role, 'student');
  assert.equal(id.authenticated, false);
  assert.match(id.how, /not private/, 'must warn that anonymous progress is shared');
});

test('identity: an authenticated subject becomes the storage key', () => {
  const id = resolveIdentity(asCtx({ subject: 'student-42' }));
  assert.equal(id.id, 'student-42');
  assert.equal(id.authenticated, true);
  assert.equal(id.role, 'student', 'no role claim means student, which is the safe default');
});

test('identity: instructor role is read from either scopes or claims', () => {
  // JWT issuers differ; supporting only one convention would work in dev and fail
  // against whatever the organizers actually issue.
  for (const auth of [
    { subject: 'a', scopes: ['instructor'] },
    { subject: 'a', scopes: ['mentor:instructor'] },
    { subject: 'a', scopes: ['MENTOR.INSTRUCTOR'] },
    { subject: 'a', claims: { role: 'instructor' } },
    { subject: 'a', claims: { role: 'Instructor' } },
  ]) {
    assert.equal(resolveIdentity(asCtx(auth)).role, 'instructor', JSON.stringify(auth));
  }
});

test('identity: an unrelated scope does not grant instructor', () => {
  const id = resolveIdentity(asCtx({ subject: 'a', scopes: ['read', 'write', 'admin'] }));
  assert.equal(id.role, 'student', '"admin" is not the instructor scope and must not be treated as one');
});

test('canReadOthers: anonymous can never read other students, whatever it claims', () => {
  // The dangerous case: an unauthenticated caller presenting an instructor scope.
  const forged = resolveIdentity(asCtx({ scopes: ['instructor'] })); // no subject
  assert.equal(forged.authenticated, false);
  assert.equal(canReadOthers(forged), false);

  assert.equal(canReadOthers(resolveIdentity(asCtx({ subject: 'x' }))), false);
  assert.equal(
    canReadOthers(resolveIdentity(asCtx({ subject: 'x', scopes: ['instructor'] }))),
    true,
  );
});

// ── the store ─────────────────────────────────────────────────────────────────

/**
 * Registers the shared contract for every backend.
 *
 * Synchronous on purpose. An earlier version was `async` and `await`ed each
 * `test()`, which registers cases while the runner is already draining and dies as
 * `cancelledByParent: Promise resolution is still pending but the event loop has
 * already resolved` — under `--test-force-exit` that surfaces as a random unrelated
 * case failing. Register tests synchronously; only the bodies are async.
 */
function storeBehaviour(name: string, make: () => ProgressStore) {
  test(`${name}: saves, loads, and overwrites in place`, async () => {
    const store = make();
    await store.save({ student: 's1', project: 'pricing', role: 'backend', log: log('cp-1') });
    await store.save({ student: 's1', project: 'pricing', role: 'backend', log: log('cp-1', 'cp-2') });

    const got = await store.load('s1', 'pricing', 'backend');
    assert.equal(got?.log.events.length, 2, 'the second save must replace, not duplicate');
    assert.equal(got?.updatedAt, FIXED());
    store.close();
  });

  test(`${name}: keeps students apart`, async () => {
    const store = make();
    await store.save({ student: 's1', project: 'pricing', role: 'backend', log: log('cp-1') });
    await store.save({ student: 's2', project: 'pricing', role: 'backend', log: log('cp-1', 'cp-2') });

    assert.equal((await store.load('s1', 'pricing', 'backend'))?.log.events.length, 1);
    assert.equal((await store.listForStudent('s1')).length, 1, 's1 sees only their own');
    assert.equal((await store.listAll()).length, 2);
    store.close();
  });

  test(`${name}: a missing run is null, not a throw`, async () => {
    const store = make();
    assert.equal(await store.load('nobody', 'pricing', 'backend'), null);
    assert.deepEqual(await store.listForStudent('nobody'), []);
    store.close();
  });

  test(`${name}: reached counts distinct passing checkpoints only`, async () => {
    const store = make();
    await store.save({
      student: 's1',
      project: 'pricing',
      role: 'backend',
      log: {
        project: 'pricing',
        role: 'backend',
        events: [
          { checkpoint: 'cp-1', file: 'a', outcome: 'pass' },
          { checkpoint: 'cp-1', file: 'a', outcome: 'pass' }, // duplicate
          { checkpoint: 'cp-2', file: 'a', outcome: 'fail' }, // ran and failed
        ],
      },
    });
    const [row] = await store.listForStudent('s1');
    assert.equal(row.reached, 1, 'a failed criterion is not an accomplishment, and a repeat is not two');
    store.close();
  });
}

storeBehaviour('MemoryStore', () => new MemoryStore(FIXED));

// Only meaningful where node:sqlite exists (Node 22.5+). Skipped rather than failed
// elsewhere, because the deployed runtime is Node 20 and a red suite there would be
// reporting the environment, not a defect.
const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false,
);
if (sqliteAvailable) {
  const { SqliteStore } = await import('./store.js');
  const { DatabaseSync } = (await import('node:sqlite')) as never as {
    DatabaseSync: new (p: string) => never;
  };
  storeBehaviour('SqliteStore', () => new SqliteStore(new DatabaseSync(':memory:'), ':memory:', FIXED));

  test('SqliteStore: a saved log round-trips through JSON unchanged', async () => {
    const store = new SqliteStore(new DatabaseSync(':memory:'), ':memory:', FIXED);
    const original = log('cp-1', 'cp-2', 'cp-3');
    await store.save({ student: 's1', project: 'pricing', role: 'backend', log: original });
    assert.deepEqual((await store.load('s1', 'pricing', 'backend'))?.log, original);
    store.close();
  });
} else {
  test('SqliteStore tests skipped — node:sqlite unavailable on this runtime', () => {
    assert.ok(true);
  });
}

// ── backend selection ─────────────────────────────────────────────────────────

test('openStore: defaults to memory with no configuration at all', async () => {
  const { store, reason } = await openStore({}, FIXED);
  assert.equal(store.backend, 'memory');
  assert.equal(store.durable, false);
  assert.match(reason, /no configuration, no network and no secret/);
  store.close();
});

test('openStore: asking for sqlite on a runtime without it FALLS BACK, never throws', async () => {
  // The important one. This is what happens on NitroCloud's Node 20 image, and an
  // exception here would take the whole server down at startup to protect a feature
  // nobody had relied on yet.
  const { store, reason } = await openStore(
    { MENTOR_STORE: 'sqlite', MENTOR_DB_PATH: ':memory:' },
    FIXED,
  );
  assert.ok(['memory', 'sqlite'].includes(store.backend));
  if (store.backend === 'memory') {
    assert.equal(store.durable, false);
    assert.match(reason, /node:sqlite is unavailable/);
    assert.match(reason, /reported rather than thrown/);
  } else {
    assert.equal(store.durable, true);
    assert.match(reason, /progress persists/);
  }
  store.close();
});

test('durability is reported honestly, never assumed', async () => {
  const { store } = await openStore({}, FIXED);
  assert.equal(store.durable, false);
  assert.match(store.note, /not a server restart or redeploy/);
  store.close();
});

// ── the invariant the whole module exists to protect ──────────────────────────

test('a student cannot reach another student\'s work through any store call', async () => {
  const store = new MemoryStore(FIXED);
  await store.save({ student: 'alice', project: 'pricing', role: 'backend', log: log('cp-1') });

  // `load` is keyed by student, so bob asking for pricing/backend gets his own
  // (absent) run rather than alice's.
  assert.equal(await store.load('bob', 'pricing', 'backend'), null);
  assert.deepEqual(await store.listForStudent('bob'), []);

  // listAll DOES cross students — which is why the tool layer, not the store, is
  // where the instructor check lives. Asserted so nobody "fixes" it by filtering
  // here and quietly breaking class_progress.
  const all = await store.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].student, 'alice');
  store.close();
});

test('identity of an anonymous caller is stable, so their work is findable within a session', async () => {
  const a = resolveIdentity(asCtx(undefined));
  const b = resolveIdentity(asCtx({}));
  assert.equal(a.id, b.id, 'both must land in the same drawer or anonymous progress is unreachable');
});
