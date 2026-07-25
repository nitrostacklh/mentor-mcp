import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CommandTools } from './command.module.js';

const fakeCtx = { logger: { info() {}, error() {}, warn() {}, debug() {} } } as any;

test('run_operation drives the whole fleet, gated by AEGIS', async () => {
  const result: any = await new CommandTools().runOperation({}, fakeCtx);
  assert.equal(result.total, 4);
  assert.equal(result.resolved, 4); // all four domains resolve and pass the trust gate
  assert.ok(result.overall_trust >= 0.9);
  const apps = result.operations.map((o: any) => o.app).sort();
  assert.deepEqual(apps, ['LEDGER', 'RELAY', 'SENTINEL', 'VERDICT']);
  for (const op of result.operations) {
    assert.equal(op.status, 'RESOLVED');
    assert.equal(op.aegis_safe, true);
  }
});

test('platform_status lists five commanders', async () => {
  const s: any = await new CommandTools().platformStatus();
  assert.equal(s.commanders.length, 5);
});

test('run_organization: LEDGER pulls in SENTINEL mid-task, AEGIS-gated', async () => {
  const r: any = await new CommandTools().runOrganization({}, fakeCtx);
  // The collaboration graph records LEDGER delegating to SENTINEL and SENTINEL returning.
  const referral = r.collaboration.find((e: any) => e.kind === 'referral' && e.from === 'ledger' && e.to === 'sentinel');
  assert.ok(referral, 'expected a ledger→sentinel referral');
  assert.ok(r.collaboration.some((e: any) => e.kind === 'return' && e.from === 'sentinel'));
  // Both the delegated helper and the requester resolve.
  const byDomain = Object.fromEntries(r.results.map((x: any) => [x.domain, x]));
  assert.equal(byDomain.sentinel.status, 'RESOLVED');
  assert.equal(byDomain.ledger.status, 'RESOLVED');
  assert.ok(r.commanders_involved >= 4);
  for (const res of r.results) assert.ok(res.aegis_trust >= 0.6); // every action cleared AEGIS
});
