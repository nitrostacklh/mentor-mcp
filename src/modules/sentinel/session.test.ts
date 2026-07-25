import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openIncident, callTool, resolveIncident, approveIncident } from './session.js';

const FIX_OLD = 'const tax = subtotal * taxRate;';
const FIX_NEW = 'const tax = taxable * taxRate;';

test('client-driven flow: open → test(fail) → patch → test(pass) → resolve', async () => {
  const o = openIncident('tax-before-discount');
  const id = o.incident_id;

  const fail: any = await callTool(id, 'run_tests', {});
  assert.equal(fail.passed, false);

  await callTool(id, 'propose_patch', { path: 'pricing.js', old: FIX_OLD, new: FIX_NEW });

  const pass: any = await callTool(id, 'run_tests', {});
  assert.equal(pass.passed, true);

  const r: any = await resolveIncident(id, 'tax on pre-discount subtotal', 'tax on discounted amount', 0.92);
  assert.equal(r.status, 'RESOLVED');
  assert.equal(r.verdict.autonomous, true);
  assert.match(r.diff, /taxable \* taxRate/);
});

test('resolve is blocked until a passing verify', async () => {
  const o = openIncident('tax-before-discount');
  const r: any = await resolveIncident(o.incident_id, 'x', 'y', 0.9);
  assert.equal(r.ok, false);
});

test('low confidence pauses for approval, then approve deploys', async () => {
  const o = openIncident('tax-before-discount');
  const id = o.incident_id;
  await callTool(id, 'run_tests', {});
  await callTool(id, 'propose_patch', { path: 'pricing.js', old: FIX_OLD, new: FIX_NEW });
  await callTool(id, 'run_tests', {});

  const paused: any = await resolveIncident(id, 'rc', 'risky', 0.1);
  assert.equal(paused.status, 'AWAITING_APPROVAL');
  assert.equal(paused.verdict.autonomous, false);

  const done: any = await approveIncident(id, true, 'looks correct');
  assert.equal(done.status, 'RESOLVED');
});
