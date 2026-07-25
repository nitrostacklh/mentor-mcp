import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../../core/engine.js';
import { RelayAdapter, relayPlanner } from './relay.adapter.js';

test('validation fails before prefill, passes after', async () => {
  const adapter = new RelayAdapter();
  const ctx = adapter.openContext('INC-TEST');
  await adapter.executeTool(ctx, 'match_schemes', {});
  const before = await adapter.executeTool(ctx, 'validate_application', {});
  assert.equal(before.data.passed, false);
  await adapter.executeTool(ctx, 'prefill_form', {});
  const after = await adapter.executeTool(ctx, 'validate_application', {});
  assert.equal(after.data.passed, true);
});

test('engine files an application end-to-end', async () => {
  const engine = new Engine(new RelayAdapter(), { planner: relayPlanner(), approvalGate: () => true });
  const inc = await engine.runIncident('farmer needs income support');
  assert.equal(inc.status, 'RESOLVED');
  assert.equal(inc.domain, 'civic');
  assert.equal(inc.verdict?.autonomous, true);
  assert.ok(inc.actions.some((a) => a.kind === 'application'));
});
