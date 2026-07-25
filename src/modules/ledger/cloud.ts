/**
 * LEDGER — a self-contained, deterministic cloud-cost model (ported from the
 * verified Python FinOps reference). Stands in for a billing + inventory API
 * (Cost Explorer / Kubecost): a spend report, an inventory with utilisation, a
 * staging area for rightsizing changes, and a savings/SLA simulator used as the
 * verification step. No clocks, no randomness — reproducible every run.
 */

export interface Resource {
  id: string;
  kind: string; // node_pool | volume | object_store | database
  monthlyCost: number;
  utilization: number; // 0..1
  minSafeCost: number; // floor below which SLA/headroom is at risk
  note: string;
}

function seedInventory(): Resource[] {
  return [
    { id: 'nodepool-web-prod', kind: 'node_pool', monthlyCost: 4200, utilization: 0.22, minSafeCost: 1900, note: '24×m5.2xlarge, avg CPU 22% — heavily over-provisioned' },
    { id: 'nodepool-batch', kind: 'node_pool', monthlyCost: 1600, utilization: 0.61, minSafeCost: 1200, note: 'right-sized for nightly batch; little headroom' },
    { id: 'vol-orphaned-01', kind: 'volume', monthlyCost: 240, utilization: 0, minSafeCost: 0, note: 'unattached gp3 volume, 0 IOPS for 40 days' },
    { id: 'vol-orphaned-02', kind: 'volume', monthlyCost: 180, utilization: 0, minSafeCost: 0, note: 'unattached gp3 volume, 0 IOPS for 31 days' },
    { id: 'bucket-logs-archive', kind: 'object_store', monthlyCost: 900, utilization: 0.03, minSafeCost: 120, note: '18 TB in STANDARD; access pattern is cold/archive' },
    { id: 'db-analytics-replica', kind: 'database', monthlyCost: 1500, utilization: 0.71, minSafeCost: 1300, note: 'read replica serving live dashboards; near capacity' },
  ];
}

// Chosen so the canonical safe plan (delete the two idle volumes = 420 + rightsize
// the 22%-utilised web pool 4200→1900 = 2300) clears the anomaly exactly: 8620−2720=5900.
export const BASELINE_MONTHLY = 5900;

export interface StagedChange {
  resourceId: string;
  action: 'rightsize' | 'delete' | 'tier_change';
  projectedCost: number;
  beforeCost: number;
  utilization: number;
  minSafeCost: number;
  rationale: string;
}

const savingsOf = (c: StagedChange): number => Math.round((c.beforeCost - c.projectedCost) * 100) / 100;

function slaRisk(c: StagedChange): boolean {
  if (c.action === 'delete') return c.utilization > 0.01; // deleting a used resource is risky
  return c.projectedCost < c.minSafeCost; // cutting below the floor is risky
}

export class CostModel {
  private resources = new Map<string, Resource>(seedInventory().map((r) => [r.id, r]));
  private staged = new Map<string, StagedChange>();

  get currentMonthly(): number {
    let sum = 0;
    for (const r of this.resources.values()) sum += r.monthlyCost;
    return Math.round(sum * 100) / 100;
  }

  report() {
    const cur = this.currentMonthly;
    const drivers = [...this.resources.values()].sort((a, b) => b.monthlyCost - a.monthlyCost);
    return {
      current_monthly_usd: cur,
      baseline_monthly_usd: BASELINE_MONTHLY,
      anomaly_monthly_usd: Math.round((cur - BASELINE_MONTHLY) * 100) / 100,
      anomaly_pct: Math.round(((cur - BASELINE_MONTHLY) / BASELINE_MONTHLY) * 1000) / 10,
      top_cost_drivers: drivers.slice(0, 4).map((r) => ({ id: r.id, kind: r.kind, monthly_usd: r.monthlyCost, utilization: r.utilization })),
    };
  }

  listResources() {
    return [...this.resources.values()].map((r) => ({
      id: r.id, kind: r.kind, monthly_usd: r.monthlyCost, utilization: r.utilization, min_safe_monthly_usd: r.minSafeCost, note: r.note,
    }));
  }

  inspect(id: string) {
    const r = this.get(id);
    return { id: r.id, kind: r.kind, monthly_usd: r.monthlyCost, utilization: r.utilization, min_safe_monthly_usd: r.minSafeCost, safe_headroom_usd: Math.round((r.monthlyCost - r.minSafeCost) * 100) / 100, note: r.note };
  }

  stage(id: string, action: string, targetMonthlyUsd?: number) {
    const r = this.get(id);
    const act = action.trim().toLowerCase();
    let projected: number;
    if (act === 'delete') projected = 0;
    else if (act === 'rightsize' || act === 'tier_change') {
      if (targetMonthlyUsd === undefined) throw new Error(`${act} requires target_monthly_usd`);
      projected = Math.round(targetMonthlyUsd * 100) / 100;
    } else throw new Error(`unknown action ${action} (use rightsize | delete | tier_change)`);
    if (projected > r.monthlyCost) throw new Error('target cost exceeds current cost — that would increase spend');

    const change: StagedChange = {
      resourceId: r.id, action: act as StagedChange['action'], projectedCost: projected,
      beforeCost: r.monthlyCost, utilization: r.utilization, minSafeCost: r.minSafeCost,
      rationale: rationale(r, act, projected),
    };
    this.staged.set(r.id, change);
    return this.view(change);
  }

  simulate() {
    if (this.staged.size === 0) {
      return { passed: false, summary: 'no changes staged', output: 'Stage at least one change before simulating.', savings_monthly_usd: 0, projected_monthly_usd: this.currentMonthly, sla_risk: false };
    }
    const changes = [...this.staged.values()];
    const savings = Math.round(changes.reduce((s, c) => s + savingsOf(c), 0) * 100) / 100;
    const projected = Math.round((this.currentMonthly - savings) * 100) / 100;
    const atRisk = changes.filter(slaRisk);
    const passed = savings > 0 && atRisk.length === 0;
    const lines = [`Projected monthly spend: $${projected.toLocaleString()}  (−$${savings.toLocaleString()}/mo, −${((savings / this.currentMonthly) * 100).toFixed(1)}%)`];
    for (const c of changes) lines.push(`  ${c.resourceId}: ${c.action} $${c.beforeCost} → $${c.projectedCost}/mo${slaRisk(c) ? '  ⚠ SLA RISK' : ''}`);
    lines.push(atRisk.length ? 'FAIL: one or more changes cut below the resource safe floor.' : 'OK: all changes keep resources above their safe floor.');
    return { passed, summary: passed ? `$${savings.toLocaleString()}/mo savings, no SLA risk` : 'simulation failed — SLA risk or no savings', output: lines.join('\n'), savings_monthly_usd: savings, projected_monthly_usd: projected, sla_risk: atRisk.length > 0 };
  }

  apply(): string[] {
    const changed: string[] = [];
    for (const c of this.staged.values()) {
      if (c.action === 'delete') this.resources.delete(c.resourceId);
      else this.get(c.resourceId).monthlyCost = c.projectedCost;
      changed.push(c.resourceId);
    }
    return changed;
  }

  diff(): string {
    if (this.staged.size === 0) return '';
    const out = ['--- cloud spend (before)', '+++ cloud spend (after staged plan)'];
    for (const c of this.staged.values()) {
      out.push(`@@ ${c.resourceId} (${c.action}) @@`, `- $${c.beforeCost.toLocaleString()}/mo`, `+ $${c.projectedCost.toLocaleString()}/mo   # ${c.rationale}`);
    }
    const total = Math.round([...this.staged.values()].reduce((s, c) => s + savingsOf(c), 0) * 100) / 100;
    out.push('@@ total @@', `- $${this.currentMonthly.toLocaleString()}/mo`, `+ $${(this.currentMonthly - total).toLocaleString()}/mo   # −$${total.toLocaleString()}/mo`);
    return out.join('\n');
  }

  /** (#resources changed, total monthly $ delta) */
  blast(): [number, number] {
    const dollars = Math.round([...this.staged.values()].reduce((s, c) => s + savingsOf(c), 0) * 100) / 100;
    return [this.staged.size, dollars];
  }

  private get(id: string): Resource {
    const r = this.resources.get(id);
    if (!r) throw new Error(`unknown resource ${id}`);
    return r;
  }

  private view(c: StagedChange) {
    return { resource_id: c.resourceId, action: c.action, before_monthly_usd: c.beforeCost, projected_monthly_usd: c.projectedCost, savings_monthly_usd: savingsOf(c), sla_risk: slaRisk(c), rationale: c.rationale };
  }
}

function rationale(r: Resource, action: string, projected: number): string {
  if (action === 'delete') return `${r.kind} at ${Math.round(r.utilization * 100)}% utilisation — safe to delete`;
  if (action === 'tier_change') return `move ${r.kind} to a colder/cheaper tier (util ${Math.round(r.utilization * 100)}%)`;
  return `rightsize ${r.kind} from $${r.monthlyCost} to $${projected}/mo (util ${Math.round(r.utilization * 100)}%)`;
}
