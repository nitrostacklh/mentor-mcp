/**
 * Tests for the four bridges that turn four separate layers into one loop.
 *
 * The cases worth writing here are the ones where a plausible implementation is
 * quietly wrong in a way a student would pay for:
 *
 * - a checkpoint tracker that *blocks* out-of-order work would delete the only
 *   material MENTOR can teach from;
 * - a done-ness check that counts ticked boxes would call a student finished
 *   when their design was missing half their job;
 * - a flashcard that ships its answer with an `earned: false` flag would hand
 *   over the reasoning `withhold_fix` exists to refuse.
 *
 * The last of those is the one this file guards hardest, because it is the point
 * where the product could betray its own thesis while every test still passed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findDrift } from '../mentor/drift.js';
import { parseBuild } from '../mentor/build.js';
import { parsePlan, type Plan } from '../mentor/plan.js';
import { bundledBuild, bundledPlan } from '../mentor/fixtures.js';

import { catalogCoverage, parseCatalog, projectsInDomain, CatalogParseError } from './catalog.js';
import { assertNoFix, checkScope, parseBrief, BriefParseError, type Brief } from './brief.js';
import {
  buildFromProgress,
  deriveCheckpoints,
  judgeDone,
  passedCheckpoints,
  recordProgress,
  type ProgressLog,
} from './checkpoints.js';
import { issueCard, readTestOutcome } from './card.js';
import {
  bundledBrief,
  bundledCatalog,
  bundledProjectArtifacts,
  EMBEDDED,
  SAFETY_BUILD_JSON,
} from './fixtures.learn.js';

const RED = '# fail 1';
const GREEN = '# fail 0';

const pricingBrief = () => bundledBrief('pricing', 'backend') as Brief;
const safetyBrief = () => bundledBrief('safety-gear', 'cv') as Brief;

/** A plan with arbitrary labels, wired as a strict chain. */
function chain(labels: string[]): Plan {
  return parsePlan({
    schema: 'lumina.plan/v1',
    name: 'test',
    nodes: labels.map((label, i) => ({
      id: `n${i}`,
      type: 'component',
      label,
      position: { x: i * 200, y: 0 },
      data: {},
    })),
    edges: labels.slice(1).map((_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}` })),
    order: labels.map((_, i) => `n${i}`),
    entry: ['n0'],
    terminal: [`n${labels.length - 1}`],
    cyclic: false,
    warnings: [],
  });
}

// ── bridge ① the catalog ──────────────────────────────────────────────────────

test('catalog: the bundled one parses and every briefed role really has a brief', () => {
  const catalog = bundledCatalog();
  assert.equal(catalog.warnings.length, 0, `catalog has warnings: ${catalog.warnings.join('; ')}`);

  for (const project of catalog.projects) {
    for (const role of project.roles) {
      const brief = bundledBrief(project.key, role.key);
      if (role.briefed) {
        assert.ok(brief, `${project.key}/${role.key} is marked briefed but has no brief`);
      } else {
        assert.equal(brief, null, `${project.key}/${role.key} has a brief but is not marked briefed`);
      }
    }
  }
});

test('catalog: coverage reports playable roles honestly rather than advertising all of them', () => {
  const coverage = catalogCoverage(bundledCatalog());
  assert.ok(coverage.roles > coverage.playableRoles, 'fixture should include roadmap roles');
  assert.equal(coverage.playableRoles, 2, 'pricing/backend and safety-gear/cv');
  assert.equal(coverage.domains, 3);
});

test('catalog: a project in a domain that does not exist is dropped, not silently kept', () => {
  const catalog = parseCatalog({
    schema: 'mentor.catalog/v1',
    domains: [{ key: 'web-service', title: 'Web' }],
    projects: [
      {
        key: 'orphan',
        domain: 'nope',
        why_exemplary: 'x',
        roles: [{ key: 'r', title: 'R' }],
      },
    ],
  });
  // Unreachable through the two-step choice, so keeping it would advertise a dead end.
  assert.equal(catalog.projects.length, 0);
  assert.match(catalog.warnings.join(' '), /domain "nope" is not in the catalog/);
});

test('catalog: a wrong schema throws rather than presenting an empty menu as a real one', () => {
  assert.throws(() => parseCatalog({ schema: 'nope/v1', domains: [], projects: [] }), CatalogParseError);
});

test('catalog: projectsInDomain finds the pricing project under web-service', () => {
  const found = projectsInDomain(bundledCatalog(), 'web-service');
  assert.deepEqual(found.map((p) => p.key), ['pricing']);
});

// ── bridge ② the brief ────────────────────────────────────────────────────────

test('brief: a role that owns nothing throws — every later check is defined against owns', () => {
  assert.throws(
    () => parseBrief({ schema: 'mentor.brief/v1', project: 'p', role: 'r', owns: [] }),
    BriefParseError,
  );
});

test('brief: owning and being given the same component resolves to owned, with a warning', () => {
  const brief = parseBrief({
    schema: 'mentor.brief/v1',
    project: 'p',
    role: 'r',
    owns: [{ component: 'tax' }],
    given: [{ component: 'Tax', owned_by: 'someone' }],
  });
  assert.equal(brief.owns.length, 1);
  assert.equal(brief.given.length, 0, 'the contradiction must resolve one way, not both');
  assert.match(brief.warnings.join(' '), /both owns and given/);
});

test('brief: neither bundled concept answer contains code', () => {
  // A concept answer that is really source would let `flashcard` hand over the
  // patch `withhold_fix` refuses.
  for (const brief of [pricingBrief(), safetyBrief()]) {
    assert.deepEqual(assertNoFix(brief.concept), [], `${brief.project} concept looks like code`);
  }
});

test('brief: assertNoFix does catch an author pasting the fix in', () => {
  const problems = assertNoFix({
    key: 'k',
    question: 'q',
    answer: 'const taxable = subtotal - discount; return taxable * taxRate;',
    transfersTo: '',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /looks like code/);
});

// ── bridge ②③ the scope check ─────────────────────────────────────────────────

test('scope: the fixture plan covers the backend slice exactly', () => {
  const report = checkScope(pricingBrief(), bundledPlan());
  assert.equal(report.inScope, true, report.summary);
  assert.equal(report.coverage, 1);
  assert.deepEqual([...report.missing], []);
  assert.deepEqual([...report.outOfScope], []);
});

test('scope: drawing the receipt is caught as somebody else\'s job', () => {
  // `receipt` is a real component of the pricing project and belongs to frontend.
  const report = checkScope(pricingBrief(), chain(['validate', 'discount', 'tax', 'total', 'receipt']));
  assert.equal(report.inScope, false);
  assert.deepEqual([...report.outOfScope], ['receipt']);
  assert.match(report.summary, /receipt is not yours to build/);
});

test('scope: omitting an owned component is caught as missing, with its intent', () => {
  const report = checkScope(pricingBrief(), chain(['validate', 'discount', 'total']));
  assert.deepEqual([...report.missing], ['tax']);
  assert.equal(report.coverage, 0.75);
  const entry = report.entries.find((e) => e.label === 'tax');
  assert.equal(entry?.verdict, 'missing');
  assert.match(entry?.note ?? '', /Apply tax to the amount/);
});

test('scope: a given component drawn as a boundary is correct practice, not a problem', () => {
  const report = checkScope(safetyBrief(), bundledProjectArtifacts('safety-gear')!.plan);
  assert.deepEqual([...report.boundary], ['camera feed'], 'camera feed is owned by platform');
  assert.equal(report.inScope, true, report.summary);
  const entry = report.entries.find((e) => e.label === 'camera feed');
  assert.equal(entry?.verdict, 'boundary');
  assert.match(entry?.note ?? '', /platform owns this/i);
});

test('scope: renaming a box with different spacing still matches — same key as drift uses', () => {
  const report = checkScope(safetyBrief(), chain(['Detect_Person', 'check helmet', 'ALERT']));
  assert.deepEqual([...report.missing], []);
  assert.deepEqual([...report.outOfScope], []);
});

// ── bridge ④ checkpoints ──────────────────────────────────────────────────────

test('checkpoints: sequenced by the order the student drew, not by the brief', () => {
  const brief = pricingBrief();
  // The brief lists validate, discount, tax, total. Draw them in a different order.
  const cps = deriveCheckpoints(brief, chain(['validate', 'tax', 'discount', 'total']));
  const implement = cps.checkpoints.filter((c) => c.kind === 'implement');
  assert.deepEqual(
    implement.map((c) => c.subject),
    ['validate', 'tax', 'discount', 'total'],
    'the checkpoint order must follow the plan, which is what makes it fair to hold them to it',
  );
});

test('checkpoints: dependencies come from real edges, so unconnected boxes are unblocked', () => {
  const brief = pricingBrief();
  const disconnected = parsePlan({
    schema: 'lumina.plan/v1',
    name: 'four islands',
    nodes: ['validate', 'discount', 'tax', 'total'].map((label, i) => ({
      id: `n${i}`,
      type: 'component',
      label,
      position: { x: i * 200, y: 0 },
      data: {},
    })),
    edges: [],
    order: ['n0', 'n1', 'n2', 'n3'],
    entry: [],
    terminal: [],
    cyclic: false,
    warnings: [],
  });
  const cps = deriveCheckpoints(brief, disconnected);
  for (const cp of cps.checkpoints.filter((c) => c.kind === 'implement')) {
    assert.deepEqual(
      [...cp.blockedBy],
      [],
      `${cp.subject} was reported as blocked, but the student never drew that dependency`,
    );
  }
});

test('checkpoints: a chain gives tax a dependency on validate and discount', () => {
  const cps = deriveCheckpoints(pricingBrief(), bundledPlan());
  const tax = cps.checkpoints.find((c) => c.subject === 'tax');
  const idOf = (subject: string) => cps.checkpoints.find((c) => c.subject === subject)?.id;
  assert.deepEqual([...(tax?.blockedBy ?? [])].sort(), [idOf('validate'), idOf('discount')].sort());
});

test('checkpoints: an owned component missing from the canvas still counts toward done', () => {
  const cps = deriveCheckpoints(pricingBrief(), chain(['validate', 'discount', 'total']));
  const subjects = cps.checkpoints.filter((c) => c.kind === 'implement').map((c) => c.subject);
  assert.ok(subjects.includes('tax'), 'an incomplete design must not shrink the definition of done');
  assert.match(cps.warnings.join(' '), /tax is in your brief but not on your canvas/);
});

test('checkpoints: acceptance criteria come last and depend on the whole slice', () => {
  const cps = deriveCheckpoints(pricingBrief(), bundledPlan());
  const verify = cps.checkpoints.filter((c) => c.kind === 'verify');
  const implement = cps.checkpoints.filter((c) => c.kind === 'implement');
  assert.equal(verify.length, 3, 'three signed-off criteria');
  assert.ok(verify.every((v) => v.seq > implement.length));
  assert.equal(verify[0].blockedBy.length, implement.length);
});

// ── bridge ④ the observed history ─────────────────────────────────────────────

test('recordProgress: out-of-order work is recorded and flagged, never blocked', () => {
  const cps = deriveCheckpoints(pricingBrief(), bundledPlan());
  const idOf = (s: string) => cps.checkpoints.find((c) => c.subject === s)!.id;

  // The fixture's real mistake: tax before discount.
  const result = recordProgress(cps, null, [
    { checkpoint: idOf('validate'), file: 'build/pricing.js', line: 8 },
    { checkpoint: idOf('tax'), file: 'build/pricing.js', line: 12 },
  ]);

  assert.equal(result.accepted.length, 2, 'both accepted — blocking would delete the lesson');
  assert.equal(result.rejected.length, 0);
  assert.equal(result.outOfOrder.length, 1);
  assert.equal(result.outOfOrder[0].checkpoint, idOf('tax'));
  assert.deepEqual([...result.outOfOrder[0].shouldFollow], ['discount']);
});

test('recordProgress: rejects unknown ids, duplicates, and events with no file', () => {
  const cps = deriveCheckpoints(pricingBrief(), bundledPlan());
  const id = cps.checkpoints[0].id;
  const first = recordProgress(cps, null, [{ checkpoint: id, file: 'a.js' }]);
  const second = recordProgress(cps, first.log, [
    { checkpoint: id, file: 'a.js' },
    { checkpoint: 'cp-999', file: 'a.js' },
    { checkpoint: cps.checkpoints[1].id, file: '' },
  ]);
  assert.equal(second.accepted.length, 0);
  assert.deepEqual(
    second.rejected.map((r) => r.why),
    [
      'already recorded',
      'no such checkpoint in this plan',
      'no file — a checkpoint without a location cannot support a file:line claim later',
    ],
  );
});

test('bridge ④→MENTOR: a checkpoint log becomes a build history that reproduces the drift', () => {
  // The join that makes the chain a loop: the student tracked their work for
  // progress, and it turns out to be exactly `explain_drift`'s input.
  const brief = pricingBrief();
  const plan = bundledPlan();
  const cps = deriveCheckpoints(brief, plan);
  const idOf = (s: string) => cps.checkpoints.find((c) => c.subject === s)!.id;

  const log = recordProgress(cps, null, [
    { checkpoint: idOf('validate'), file: 'build/pricing.js', line: 8, at: 'T+03m' },
    { checkpoint: idOf('tax'), file: 'build/pricing.js', line: 12, at: 'T+11m' },
    { checkpoint: idOf('discount'), file: 'build/pricing.js', line: 14, at: 'T+19m' },
    { checkpoint: idOf('total'), file: 'build/pricing.js', line: 17, at: 'T+24m' },
  ]).log;

  const build = buildFromProgress(cps, brief, log, {
    test: 'test 3',
    file: 'build/pricing.test.js',
    line: 40,
    message: '80 !== 72',
  });

  assert.equal(build.provenance, 'observed');
  const report = findDrift(plan, build);
  assert.equal(report.origin?.component, 'tax');
  assert.equal(report.origin?.file, 'build/pricing.js');
  assert.equal(report.origin?.line, 12);
  assert.equal(report.origin?.plannedPosition, 3);
  assert.equal(report.origin?.actualPosition, 2);
});

test('observed provenance scores above authored, and the reason says why', () => {
  const plan = bundledPlan();
  const authored = findDrift(plan, bundledBuild());
  const observed = findDrift(
    plan,
    parseBuild({ ...JSON.parse(JSON.stringify(bundledBuild())), provenance: 'observed' }),
  );

  assert.equal(authored.confidence.components.provenance.score, 0.4);
  assert.equal(observed.confidence.components.provenance.score, 0.8);
  assert.ok(
    observed.confidence.score > authored.confidence.score,
    'a witnessed sequence is better evidence than a remembered one',
  );
  assert.match(observed.confidence.components.provenance.reason, /self-reported rather than derived/);
  // Still short of a commit-derived history.
  assert.ok(observed.confidence.components.provenance.score < 1);
});

test('an unknown provenance value falls back to the least trusted reading', () => {
  const build = parseBuild({ ...JSON.parse(JSON.stringify(bundledBuild())), provenance: 'observedd' });
  assert.equal(build.provenance, 'authored', 'a typo must never be able to inflate confidence');
  assert.match(build.warnings.join(' '), /unknown provenance/);
});

test('a verify checkpoint that FAILED is recorded but does not count as done', () => {
  // Running a test is not the same event as passing it. Conflating them would let
  // a red acceptance criterion count toward done, which is the one answer this
  // module exists to get right.
  const brief = pricingBrief();
  const plan = bundledPlan();
  const cps = deriveCheckpoints(brief, plan);
  const implement = cps.checkpoints.filter((c) => c.kind === 'implement');
  const firstCriterion = cps.checkpoints.find((c) => c.kind === 'verify')!;

  let log = recordProgress(
    cps,
    null,
    implement.map((c) => ({ checkpoint: c.id, file: 'build/pricing.js', line: 1 })),
  ).log;
  const ran = recordProgress(cps, log, [
    { checkpoint: firstCriterion.id, file: 'build/pricing.test.js', line: 40, outcome: 'fail' },
  ]);

  assert.deepEqual([...ran.accepted], [], 'a failed criterion is not an accomplishment');
  assert.ok(
    ran.log.events.some((e) => e.checkpoint === firstCriterion.id),
    'but it must be in the log — MENTOR needs the failure to link it to the work',
  );
  assert.ok(ran.remaining.includes(firstCriterion.id));

  const verdict = judgeDone(brief, plan, cps, ran.log);
  assert.equal(verdict.done, false);
  assert.match(verdict.blocking.join(' '), /failing: .* you ran this and it did not hold/);
});

test('a criterion can be re-run after failing — the failure is not permanent', () => {
  const brief = pricingBrief();
  const cps = deriveCheckpoints(brief, bundledPlan());
  const criterion = cps.checkpoints.find((c) => c.kind === 'verify')!;
  const failed = recordProgress(cps, null, [
    { checkpoint: criterion.id, file: 't.js', outcome: 'fail' },
  ]);
  const fixed = recordProgress(cps, failed.log, [
    { checkpoint: criterion.id, file: 't.js', outcome: 'pass' },
  ]);
  assert.deepEqual([...fixed.accepted], [criterion.id], 'the retry must not be rejected as a duplicate');
  assert.ok(!fixed.remaining.includes(criterion.id));
});

test('passedCheckpoints is last-write-wins, so a regression is not masked', () => {
  const passed = passedCheckpoints([
    { checkpoint: 'cp-1', file: 'a', outcome: 'pass' },
    { checkpoint: 'cp-1', file: 'a', outcome: 'fail' },
  ]);
  assert.equal(passed.has('cp-1'), false);
});

// ── bridge ④ done-ness ────────────────────────────────────────────────────────

test('done: every box ticked is still NOT done if the design missed part of the slice', () => {
  // The case a checkbox count gets wrong. The student designs three of their four
  // components and completes every checkpoint derived from that design.
  const brief = pricingBrief();
  const plan = chain(['validate', 'discount', 'total']);
  const cps = deriveCheckpoints(brief, plan);
  const all = recordProgress(
    cps,
    null,
    cps.checkpoints.map((c) => ({ checkpoint: c.id, file: 'build/pricing.js', line: 1 })),
  ).log;

  const verdict = judgeDone(brief, plan, cps, all);
  assert.equal(verdict.done, false, 'counting what was asked cannot catch a question asked wrong');
  assert.match(verdict.blocking.join(' '), /tax is in your brief but missing from your design/);
});

test('done: drawing another role\'s component blocks done-ness', () => {
  const brief = pricingBrief();
  const plan = chain(['validate', 'discount', 'tax', 'total', 'receipt']);
  const cps = deriveCheckpoints(brief, plan);
  const all = recordProgress(
    cps,
    null,
    cps.checkpoints.map((c) => ({ checkpoint: c.id, file: 'build/pricing.js', line: 1 })),
  ).log;
  const verdict = judgeDone(brief, plan, cps, all);
  assert.equal(verdict.done, false);
  assert.match(verdict.blocking.join(' '), /receipt is on your canvas but is not yours to build/);
});

test('done: a correct, complete slice is done', () => {
  const brief = pricingBrief();
  const plan = bundledPlan();
  const cps = deriveCheckpoints(brief, plan);
  const all = recordProgress(
    cps,
    null,
    cps.checkpoints.map((c) => ({ checkpoint: c.id, file: 'build/pricing.js', line: 1 })),
  ).log;
  const verdict = judgeDone(brief, plan, cps, all);
  assert.equal(verdict.done, true, verdict.blocking.join('; '));
  assert.equal(verdict.implemented.reached, 4);
  assert.equal(verdict.verified.reached, 3);
});

test('done: nothing recorded is not done, and says what is outstanding', () => {
  const brief = pricingBrief();
  const cps = deriveCheckpoints(brief, bundledPlan());
  const empty: ProgressLog = { project: 'pricing', role: 'backend', events: [] };
  const verdict = judgeDone(brief, bundledPlan(), cps, empty);
  assert.equal(verdict.done, false);
  assert.equal(verdict.blocking.length, 7, '4 components + 3 criteria');
});

// ── bridge ⑤ the flashcard ────────────────────────────────────────────────────

test('flashcard: while the tests are red, the answer is ABSENT from the payload', () => {
  // The single most important assertion in this file. A card that ships its
  // answer with `earned: false` leaks on the first client that renders the whole
  // object, so the guarantee has to be structural: no field, not a flag.
  const card = issueCard({
    brief: pricingBrief(),
    drift: findDrift(bundledPlan(), bundledBuild()),
    testsGreen: false,
  });

  assert.equal(card.earned, false);
  assert.ok(!('back' in card), 'the answer must not be present at all, however it is labelled');
  assert.equal(
    JSON.stringify(card).includes(pricingBrief().concept.answer),
    false,
    'the answer text must not appear anywhere in the serialized payload',
  );
  // The question is still safe to show — it is what they should be able to answer.
  assert.ok(card.front.length > 0);
});

test('flashcard: earned once the tests are green, and it cites where they went wrong', () => {
  const drift = findDrift(bundledPlan(), bundledBuild());
  const card = issueCard({ brief: pricingBrief(), drift, testsGreen: true });

  assert.equal(card.earned, true);
  assert.ok(card.earned && card.back.includes('after the discount is taken off'));
  assert.equal(card.earnedBy.origin, 'build/pricing.js:12');
  assert.equal(card.earnedBy.surfaced, 'build/pricing.test.js:40');
  assert.equal(card.earned && card.confidence, drift.confidence.score);
});

test('flashcard: not having tried to say it yourself withholds it too', () => {
  const card = issueCard({
    brief: pricingBrief(),
    drift: null,
    testsGreen: true,
    explainedInOwnWords: false,
  });
  assert.equal(card.earned, false);
  assert.ok(!('back' in card));
  assert.match(card.earned === false ? card.blocking.join(' ') : '', /in your own words/);
});

test('test-output gate: unrecognised output is not treated as passing', () => {
  // The asymmetry is deliberate — wrongly withholding annoys a student, wrongly
  // issuing hands over the reasoning the product exists to withhold.
  for (const raw of ['', 'looks fine to me', 'all good, trust me', 'PASSED??']) {
    const outcome = readTestOutcome(raw);
    assert.equal(outcome.green, false, `"${raw}" was treated as green`);
  }
});

test('test-output gate: reads node:test, pytest and jest verdicts', () => {
  assert.deepEqual(
    [readTestOutcome('# pass 2\n# fail 1').green, readTestOutcome('# pass 3\n# fail 0').green],
    [false, true],
  );
  assert.equal(readTestOutcome('1 failed, 2 passed in 0.04s').green, false);
  assert.equal(readTestOutcome('3 passed in 0.04s').green, true);
  assert.equal(readTestOutcome('Tests:       1 failed, 2 passed, 3 total').green, false);
  assert.equal(readTestOutcome('# fail 0').runner, 'node:test');
});

test('flashcard: the real red fixture output withholds the card end to end', () => {
  // What a student actually has in front of them before they fix it.
  const outcome = readTestOutcome('# tests 3\n# pass 2\n# fail 1');
  const card = issueCard({
    brief: pricingBrief(),
    drift: findDrift(bundledPlan(), bundledBuild()),
    testsGreen: outcome.green,
  });
  assert.equal(card.earned, false);
  assert.match(
    card.earned === false ? card.blocking.join(' ') : '',
    /reward for fixing it yourself/,
  );
});

// ── the second instance ───────────────────────────────────────────────────────

test('safety-gear: the chain runs on a project with a different shape and a different bug', () => {
  const brief = safetyBrief();
  const { plan, build } = bundledProjectArtifacts('safety-gear')!;

  // Three owned components, not four — anything assuming pricing's shape breaks.
  assert.equal(brief.owns.length, 3);
  assert.equal(build.provenance, 'observed');

  const report = findDrift(plan, build);
  const expected = JSON.parse(SAFETY_BUILD_JSON).expectedDrift;
  assert.equal(report.origin?.component, expected.originComponent);
  assert.equal(report.origin?.file, expected.originFile);
  assert.equal(report.origin?.line, expected.originLine);
  assert.equal(report.origin?.plannedPosition, expected.plannedPosition);
  assert.equal(report.origin?.actualPosition, expected.actualPosition);
  assert.equal(report.failure?.file, expected.surfacedAtFile);
  assert.equal(report.failure?.line, expected.surfacedAtLine);
  // A different lesson from pricing's: acting on a condition before it exists.
  assert.equal(report.origin?.shouldFollow, 'check helmet');
});

test('safety-gear: the whole loop end to end, catalog through card', () => {
  const catalog = bundledCatalog();
  const project = projectsInDomain(catalog, 'vision')[0];
  assert.equal(project.key, 'safety-gear');

  const brief = bundledBrief(project.key, 'cv')!;
  const { plan } = bundledProjectArtifacts('safety-gear')!;

  const scope = checkScope(brief, plan);
  assert.equal(scope.inScope, true, scope.summary);

  const cps = deriveCheckpoints(brief, plan);
  const idOf = (s: string) => cps.checkpoints.find((c) => c.subject === s)!.id;

  // Build it wrong, the way the fixture records: alert before check helmet.
  const progress = recordProgress(cps, null, [
    { checkpoint: idOf('detect person'), file: 'detect.py', line: 14, at: 'T+00m' },
    { checkpoint: idOf('alert'), file: 'alert.py', line: 9, at: 'T+07m' },
    { checkpoint: idOf('check helmet'), file: 'detect.py', line: 31, at: 'T+21m' },
  ]);
  assert.deepEqual([...progress.outOfOrder.map((o) => o.checkpoint)], [idOf('alert')]);

  const build = buildFromProgress(cps, brief, progress.log, {
    test: 'a1',
    file: 'test_safety.py',
    line: 22,
    message: 'alerted on a compliant worker: expected 0 alerts, got 1',
  });
  const drift = findDrift(plan, build);
  assert.equal(drift.origin?.component, 'alert');

  // Red tests: no card.
  assert.equal(issueCard({ brief, drift, testsGreen: false }).earned, false);

  // Not done either — the acceptance criteria were never verified.
  const notDone = judgeDone(brief, plan, cps, progress.log);
  assert.equal(notDone.done, false);
  assert.equal(notDone.implemented.reached, 3);
  assert.equal(notDone.verified.reached, 0);
  // The boundary box is expected to be unbuilt, and only the brief knows that.
  assert.deepEqual([...notDone.scope.boundary], ['camera feed']);

  // Fix it, verify it, finish it.
  const finished = recordProgress(
    cps,
    progress.log,
    cps.checkpoints.filter((c) => c.kind === 'verify').map((c) => ({ checkpoint: c.id, file: 'test_safety.py', line: 22 })),
  );
  const done = judgeDone(brief, plan, cps, finished.log);
  assert.equal(done.done, true, done.blocking.join('; '));

  const card = issueCard({ brief, drift, testsGreen: readTestOutcome('3 passed in 0.1s').green });
  assert.equal(card.earned, true);
  assert.equal(card.earnedBy.origin, 'alert.py:9');
  assert.ok(card.earned && card.back.includes('condition has to be established'));
});

// ── the embedded copies ───────────────────────────────────────────────────────

test('every embedded fixture is valid JSON and declares the schema it claims', () => {
  const expected: Record<string, string> = {
    CATALOG_JSON: 'mentor.catalog/v1',
    PRICING_BRIEF_JSON: 'mentor.brief/v1',
    SAFETY_BRIEF_JSON: 'mentor.brief/v1',
    SAFETY_PLAN_JSON: 'lumina.plan/v1',
    SAFETY_BUILD_JSON: 'mentor.build/v1',
  };
  assert.equal(EMBEDDED.length, 5);
  for (const doc of EMBEDDED) {
    const parsed = JSON.parse(doc.json);
    assert.equal(parsed.schema, expected[doc.name], `${doc.file} declares the wrong schema`);
  }
});
