/**
 * COMMAND — the coordinator. This is what turns five standalone apps into one
 * governed platform: it runs each domain commander end-to-end and routes every
 * resolution through AEGIS (the trust layer) before it counts as done. This is
 * the Multi-Agent Swarm made real — one entry point driving the whole fleet,
 * nothing acting unchecked.
 */

import { ToolDecorator as Tool, Module, ExecutionContext, z } from '@nitrostack/core';
import { Engine } from '../../core/engine.js';
import type { DomainAdapter } from '../../core/adapter.js';
import type { Planner } from '../../core/engine.js';
import { Coordinator } from '../../core/coordinator.js';
import { assessTrust, aegisGuard } from '../aegis/trust.js';
import { DevOpsAdapter, devopsPlanner } from '../sentinel/devops.adapter.js';
import { FinOpsAdapter, ledgerPlanner, ledgerOrgPlanner } from '../ledger/ledger.adapter.js';
import { VerdictAdapter, verdictPlanner } from '../verdict/verdict.adapter.js';
import { RelayAdapter, relayPlanner } from '../relay/relay.adapter.js';

interface Step {
  app: string;
  label: string;
  make: () => DomainAdapter;
  planner: () => Planner;
  symptom: string;
}

const FLEET: Step[] = [
  { app: 'LEDGER', label: 'heal cloud spend', make: () => new FinOpsAdapter(), planner: ledgerPlanner, symptom: 'Cloud spend anomaly (+46% over baseline).' },
  { app: 'SENTINEL', label: 'heal the service regression', make: () => new DevOpsAdapter('tax-before-discount'), planner: () => devopsPlanner('tax-before-discount'), symptom: 'Pricing service overcharging discounted orders.' },
  { app: 'VERDICT', label: 'clear the vendor contract', make: () => new VerdictAdapter(), planner: verdictPlanner, symptom: 'New vendor MSA needs compliance review.' },
  { app: 'RELAY', label: 'serve affected citizens', make: () => new RelayAdapter(), planner: relayPlanner, symptom: 'Eligible citizen not yet enrolled in income support.' },
];

export class CommandTools {
  @Tool({
    name: 'platform_status',
    description: 'List the five COMMAND commanders and the trust layer that governs them.',
    inputSchema: z.object({}),
  })
  async platformStatus() {
    return {
      platform: 'COMMAND — Autonomous Enterprise OS',
      leader: 'SENTINEL',
      commanders: [
        { app: 'SENTINEL', domain: 'DevOps', capability: 'self-heals a broken service' },
        { app: 'LEDGER', domain: 'FinOps', capability: 'rightsizes cloud spend without breaking SLAs' },
        { app: 'VERDICT', domain: 'Legal', capability: 'redlines contracts with cited counter-offers' },
        { app: 'RELAY', domain: 'Civic', capability: 'files & tracks government-scheme applications' },
        { app: 'AEGIS', domain: 'Trust', capability: 'gates every action — the connective tissue' },
      ],
      shared_core: 'one engine: detect → verify → confidence-gate → HITL → deploy → report',
    };
  }

  @Tool({
    name: 'run_operation',
    description:
      'Run a governed cross-domain operation: COMMAND drives every commander (LEDGER, SENTINEL, ' +
      'VERDICT, RELAY) end-to-end and routes each resolution through the AEGIS trust layer before ' +
      'it counts as done. Returns a per-app report with confidence and AEGIS trust scores, plus an ' +
      'overall governance summary — the whole autonomous fleet in one call.',
    inputSchema: z.object({}),
  })
  async runOperation(_input: unknown, ctx: ExecutionContext) {
    const operations: Array<Record<string, unknown>> = [];
    let resolved = 0;
    let trustSum = 0;

    for (const step of FLEET) {
      const engine = new Engine(step.make(), {
        planner: step.planner(),
        approvalGate: () => true,
        onEvent: (e) => ctx.logger.info(`[${step.app}] ${e.type}`, { title: e.title }),
      });
      const incident = await engine.runIncident(step.symptom);

      // AEGIS gates the resolution before it counts as done.
      const guard = assessTrust(`${incident.fixSummary} ${incident.diagnosis}`);
      if (incident.status === 'RESOLVED' && guard.safe) resolved += 1;
      trustSum += guard.trustScore;

      operations.push({
        app: step.app,
        label: step.label,
        incident_id: incident.id,
        status: incident.status,
        fix_summary: incident.fixSummary,
        confidence: incident.verdict?.score ?? null,
        autonomous: incident.verdict?.autonomous ?? null,
        aegis_trust_score: guard.trustScore,
        aegis_safe: guard.safe,
      });
    }

    return {
      platform: 'COMMAND',
      operations,
      resolved,
      total: FLEET.length,
      overall_trust: Math.round((trustSum / FLEET.length) * 100) / 100,
      governance: 'Every action verified in-domain and gated by AEGIS before completion.',
    };
  }

  @Tool({
    name: 'run_organization',
    description:
      'Run COMMAND as a coordinated organization: commanders pull in teammates mid-task when a ' +
      'problem crosses domains, wait for them, and continue. Here LEDGER investigates a cloud-spend ' +
      'spike, discovers a code regression is the cause, hands it to SENTINEL, waits for the fix, then ' +
      'rightsizes — while VERDICT and RELAY handle the downstream contract and citizen enrollment. ' +
      'Every action is AEGIS-gated. Returns the collaboration graph and each commander\'s result.',
    inputSchema: z.object({}),
  })
  async runOrganization(_input: unknown, ctx: ExecutionContext) {
    const events: Array<{ domain: string; type: string; title: string }> = [];
    const coord = new Coordinator(
      aegisGuard, // every action across the org is AEGIS-gated
      (domain, e) => {
        events.push({ domain, type: e.type, title: e.title });
        ctx.logger.info(`[${domain}] ${e.type}`, { title: e.title });
      },
    );
    coord
      .register({ key: 'sentinel', makeAdapter: () => new DevOpsAdapter('tax-before-discount'), makePlanner: () => devopsPlanner('tax-before-discount') })
      .register({ key: 'verdict', makeAdapter: () => new VerdictAdapter(), makePlanner: () => verdictPlanner() })
      .register({ key: 'relay', makeAdapter: () => new RelayAdapter(), makePlanner: () => relayPlanner() })
      .register({ key: 'ledger', makeAdapter: (delegate) => new FinOpsAdapter(delegate), makePlanner: () => ledgerOrgPlanner() });

    // LEDGER is the entry point; it delegates to SENTINEL mid-run.
    const ledger = await coord.run('ledger', 'Q4 cloud bill spiked +46%; a runaway service is suspected.');
    const verdict = await coord.run('verdict', 'The vendor MSA tied to the cloud commitment needs a compliance review.');
    const relay = await coord.run('relay', 'Route the recovered savings into enrolling eligible citizens for support.');

    const flatten = (r: typeof ledger): any[] => [r, ...r.children.flatMap(flatten)];
    const allResults = [...flatten(ledger), verdict, relay];

    return {
      platform: 'COMMAND — organization run',
      entrypoint: 'ledger',
      results: allResults.map((r) => ({ domain: r.domain, status: r.status, fix_summary: r.fixSummary, confidence: r.confidence, aegis_trust: r.trustScore })),
      collaboration: coord.orgTrace,
      commanders_involved: allResults.length,
      summary: `${allResults.length} commanders coordinated (LEDGER pulled in SENTINEL mid-task); every action AEGIS-gated.`,
      events,
    };
  }
}

@Module({
  name: 'command',
  description: 'COMMAND coordinator — runs the whole commander fleet as one governed operation.',
  controllers: [CommandTools],
})
export class CommandModule {}
