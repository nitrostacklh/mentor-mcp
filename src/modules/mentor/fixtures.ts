/**
 * The bundled demo project — MENTOR's default plan + build history.
 *
 * ## Why these are embedded rather than read from disk
 *
 * Same constraint that put SENTINEL's broken service in `sentinel/fixtures.ts`
 * (`ARCHITECTURE.md` §15): on NitroCloud this app is a remote MCP server. The
 * student's `plan.lumina.json` is on *their* laptop, and the monorepo's
 * `fixtures/pricing/` directory is not in the deployed bundle. A server that
 * needed a local file would work in Studio and fail live.
 *
 * So the demo project travels inside the app. `explain_drift` still accepts a
 * plan and build as tool arguments — that's the path a real student's project
 * takes (`GAPS.md` Gap 6) — and falls back to these when called with none, which
 * is what makes the stage demo a single click with nothing to upload.
 *
 * ## These are copies, and copies drift
 *
 * The strings below are verbatim `fixtures/pricing/plan.lumina.json` and
 * `fixtures/pricing/build.history.json`. `npm run fixture:check` at the monorepo
 * root compares them against those files and fails if they diverge, because a
 * demo that disagrees with the fixture it documents is worse than either alone.
 */

import { parseBuild, type Build } from './build.js';
import { parsePlan, type Plan } from './plan.js';

/** Verbatim copy of `fixtures/pricing/plan.lumina.json`. */
export const PRICING_PLAN_JSON = `{
  "schema": "lumina.plan/v1",
  "name": "Pricing service",
  "planId": "wf-pricing-fixture",
  "nodes": [
    {
      "id": "n-validate",
      "type": "script",
      "label": "validate",
      "position": { "x": 0, "y": 160 },
      "data": {
        "label": "validate",
        "component": "validate",
        "intent": "Reject malformed carts before any money is computed.",
        "code": "assertItems(items); assertRate(discountRate); assertRate(taxRate);"
      }
    },
    {
      "id": "n-discount",
      "type": "script",
      "label": "discount",
      "position": { "x": 260, "y": 160 },
      "data": {
        "label": "discount",
        "component": "discount",
        "intent": "Apply the discount code to the subtotal.",
        "code": "discount = subtotal * discountRate"
      }
    },
    {
      "id": "n-tax",
      "type": "script",
      "label": "tax",
      "position": { "x": 520, "y": 160 },
      "data": {
        "label": "tax",
        "component": "tax",
        "intent": "Tax the DISCOUNTED amount. Must run after discount.",
        "code": "tax = taxable * taxRate"
      }
    },
    {
      "id": "n-total",
      "type": "script",
      "label": "total",
      "position": { "x": 780, "y": 160 },
      "data": {
        "label": "total",
        "component": "total",
        "intent": "Sum and round to 2dp.",
        "code": "return round(taxable + tax, 2)"
      }
    }
  ],
  "edges": [
    { "id": "e1", "source": "n-validate", "target": "n-discount", "sourceHandle": null, "targetHandle": null },
    { "id": "e2", "source": "n-discount", "target": "n-tax", "sourceHandle": null, "targetHandle": null },
    { "id": "e3", "source": "n-tax", "target": "n-total", "sourceHandle": null, "targetHandle": null }
  ],
  "order": ["n-validate", "n-discount", "n-tax", "n-total"],
  "entry": ["n-validate"],
  "terminal": ["n-total"],
  "cyclic": false,
  "warnings": []
}`;

/** Verbatim copy of `fixtures/pricing/build.history.json` (minus its $comment). */
export const PRICING_BUILD_JSON = `{
  "schema": "mentor.build/v1",
  "project": "pricing",
  "planRef": "plan.lumina.json",
  "entry": "build/pricing.js",
  "tests": "build/pricing.test.js",

  "provenance": "authored",

  "steps": [
    {
      "seq": 1,
      "at": "T+03m",
      "component": "validate",
      "kind": "implement",
      "file": "build/pricing.js",
      "line": 8,
      "summary": "Summed the cart into \`subtotal\`."
    },
    {
      "seq": 2,
      "at": "T+11m",
      "component": "tax",
      "kind": "implement",
      "file": "build/pricing.js",
      "line": 12,
      "summary": "Computed tax from \`subtotal\`, before any discount existed.",
      "note": "Plan puts tax third, after discount. Implemented second. This is the drift."
    },
    {
      "seq": 3,
      "at": "T+19m",
      "component": "discount",
      "kind": "implement",
      "file": "build/pricing.js",
      "line": 14,
      "summary": "Added the discount — but tax had already been fixed against the undiscounted subtotal."
    },
    {
      "seq": 4,
      "at": "T+24m",
      "component": "total",
      "kind": "implement",
      "file": "build/pricing.js",
      "line": 17,
      "summary": "Summed \`taxable + tax\` and rounded to 2dp."
    },
    {
      "seq": 5,
      "at": "T+38m",
      "component": "tests",
      "kind": "verify",
      "file": "build/pricing.test.js",
      "line": 40,
      "summary": "Ran the golden tests: tests 1 and 2 green, test 3 red."
    }
  ],

  "failure": {
    "test": "test 3 — 40% discount, 20% tax",
    "file": "build/pricing.test.js",
    "line": 40,
    "expected": 72.0,
    "actual": 80.0,
    "message": "80 !== 72",
    "whyItHidUntilNow": "Tests 1 and 2 both use discountRate = 0, where taxing the subtotal and taxing the discounted amount produce the same number. Test 3 is the first case that distinguishes them."
  }
}`;

/**
 * The source the student wrote, for `read_build_source`.
 *
 * MENTOR shows this so the student can see the origin line in context. It is
 * read-only by construction: there is no tool on the adapter that writes it, and
 * `awaitRecovery` asserts it is unchanged at the end of every run.
 */
export const PRICING_BUILD_SOURCE = `/**
 * Pricing — computes the total for an order.
 *
 * Your role: you own pricing. Finance depends on these numbers being right.
 */

function computeTotal(items, discountRate, taxRate) {
  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);

  // Work out the tax first, then take the discount off.
  //                     ↑ this is the decision, and this is line 12.
  const tax = subtotal * taxRate;

  const discount = subtotal * discountRate;
  const taxable = subtotal - discount;

  return Math.round((taxable + tax) * 100) / 100;
}

module.exports = { computeTotal };
`;

/** The opening symptom — what the student arrives with. */
export const PRICING_SYMPTOM =
  'test 3 fails: computeTotal($100 cart, 40% discount, 20% tax) returned 80.00, expected 72.00 ' +
  '(build/pricing.test.js:40). Tests 1 and 2 pass.';

export function bundledPlan(): Plan {
  return parsePlan(PRICING_PLAN_JSON);
}

export function bundledBuild(): Build {
  return parseBuild(PRICING_BUILD_JSON);
}
