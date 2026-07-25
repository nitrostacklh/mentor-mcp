import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../../core/engine.js';
import { FinOpsAdapter, ledgerPlanner } from './ledger.adapter.js';
import { BASELINE_MONTHLY, CostModel } from './cloud.js';

test('report flags the anomaly with the right top driver', () => {
  const r = new CostModel().report();
  assert.ok(r.current_monthly_usd > BASELINE_MONTHLY);
  assert.ok(r.anomaly_monthly_usd > 0);
  assert.equal(r.top_cost_drivers[0].id, 'nodepool-web-prod');
});

test('deleting an idle volume is safe; a busy resource is risky', () => {
  const m = new CostModel();
  assert.equal(m.stage('vol-orphaned-01', 'delete').sla_risk, false);
  assert.equal(m.stage('db-analytics-replica', 'delete').sla_risk, true);
});

test('rightsizing below the safe floor flags SLA risk', () => {
  const m = new CostModel();
  assert.equal(m.stage('nodepool-web-prod', 'rightsize', 2000).sla_risk, false);
  assert.equal(m.stage('nodepool-web-prod', 'rightsize', 1500).sla_risk, true);
});

test('canonical safe plan simulates clean and clears the anomaly', () => {
  const m = new CostModel();
  m.stage('vol-orphaned-01', 'delete');
  m.stage('vol-orphaned-02', 'delete');
  m.stage('nodepool-web-prod', 'rightsize', 1900);
  const sim = m.simulate();
  assert.equal(sim.passed, true);
  assert.equal(sim.sla_risk, false);
  assert.ok(sim.projected_monthly_usd <= BASELINE_MONTHLY);
});

test('engine optimizes spend end-to-end (autonomous)', async () => {
  const engine = new Engine(new FinOpsAdapter(), { planner: ledgerPlanner(), approvalGate: () => true });
  const inc = await engine.runIncident('cloud spend +46% over baseline');
  assert.equal(inc.status, 'RESOLVED');
  assert.equal(inc.domain, 'finops');
  assert.equal(inc.verdict?.autonomous, true);
  assert.match(inc.diff, /\$/);
});
