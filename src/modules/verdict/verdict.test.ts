import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../../core/engine.js';
import { VerdictAdapter, verdictPlanner } from './verdict.adapter.js';

test('compliance fails until all risky clauses are redlined', async () => {
  const adapter = new VerdictAdapter();
  const ctx = adapter.openContext('INC-TEST');
  const before = await adapter.executeTool(ctx, 'check_compliance', {});
  assert.equal(before.data.passed, false);
  await adapter.executeTool(ctx, 'apply_redline', { clause_id: 'data-processing' });
  await adapter.executeTool(ctx, 'apply_redline', { clause_id: 'liability' });
  await adapter.executeTool(ctx, 'apply_redline', { clause_id: 'auto-renewal' });
  const after = await adapter.executeTool(ctx, 'check_compliance', {});
  assert.equal(after.data.passed, true);
});

test('redlining a non-flagged clause is rejected', async () => {
  const adapter = new VerdictAdapter();
  const ctx = adapter.openContext('INC-TEST');
  const r = await adapter.executeTool(ctx, 'apply_redline', { clause_id: 'governing-law' });
  assert.equal(r.isError, true);
});

test('engine produces a cited redline end-to-end', async () => {
  const engine = new Engine(new VerdictAdapter(), { planner: verdictPlanner(), approvalGate: () => true });
  const inc = await engine.runIncident('Vendor MSA under review');
  assert.equal(inc.status, 'RESOLVED');
  assert.equal(inc.domain, 'legal');
  assert.match(inc.diff, /GDPR Art\. 28/);
  assert.match(inc.diff, /Consumer Rights Act/);
});
