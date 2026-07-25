/**
 * DevOps vertical tests — the bundled fixture + a full self-heal through the
 * engine, offline (no model, no network). Proves the leader app's signature
 * flow end-to-end: broken → patched → verified → gated → deployed → resolved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../../core/engine.js';
import { DevOpsAdapter, devopsPlanner } from './devops.adapter.js';
import { PRISTINE_SOURCE, injectBug, runChecks } from './fixtures.js';

test('pristine source passes the golden suite', () => {
  assert.equal(runChecks(PRISTINE_SOURCE).passed, true);
});

test('injected bug fails the golden suite', () => {
  const broken = injectBug('tax-before-discount');
  assert.notEqual(broken, PRISTINE_SOURCE);
  assert.equal(runChecks(broken).passed, false);
});

test('applying the correct fix restores green', () => {
  const broken = injectBug('tax-before-discount');
  const fixed = broken.replace('const tax = subtotal * taxRate;', 'const tax = taxable * taxRate;');
  assert.equal(runChecks(fixed).passed, true);
});

test('engine self-heals the pricing service end-to-end', async () => {
  const engine = new Engine(new DevOpsAdapter('tax-before-discount'), {
    planner: devopsPlanner('tax-before-discount'),
    approvalGate: () => true,
  });
  const inc = await engine.runIncident('discounted orders overcharged');

  assert.equal(inc.status, 'RESOLVED');
  assert.equal(inc.domain, 'devops');
  assert.equal(inc.verdict?.autonomous, true);
  assert.ok(inc.iterations >= 1);
  assert.match(inc.diff, /taxable \* taxRate/); // the fix landed in the diff
  assert.ok(inc.actions.some((a) => a.kind === 'pull_request'));
});
