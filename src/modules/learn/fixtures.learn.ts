/**
 * The bundled learning-loop artifacts — GENERATED, do not edit by hand.
 *
 * Written by `scripts/embed_learn_fixtures.mjs` from the JSON in `fixtures/`,
 * because the deployed bundle is `sentinel/` alone and cannot read that
 * directory at runtime (`ARCHITECTURE.md` §15). Same reasoning as
 * `mentor/fixtures.ts`, which predates this and is still hand-maintained.
 *
 * To change any of these, edit the JSON under `fixtures/` and re-run:
 *
 *   node scripts/embed_learn_fixtures.mjs
 *
 * `npm run fixture:check` fails if this file and those files disagree.
 */

/* eslint-disable */
import { parseCatalog, type Catalog } from './catalog.js';
import { parseBrief, type Brief } from './brief.js';
import { parsePlan, type Plan } from '../mentor/plan.js';
import { parseBuild, type Build } from '../mentor/build.js';

/** Verbatim copy of `fixtures/catalog.json`. */
export const CATALOG_JSON = `{
  "schema": "mentor.catalog/v1",
  "name": "MENTOR curated catalog",
  "domains": [
    {
      "key": "web-service",
      "title": "Web service / API",
      "blurb": "Something other teams call over HTTP and then depend on. The work is mostly correctness under inputs you did not choose, and the failures are quiet — a wrong number ships and nobody notices for a week."
    },
    {
      "key": "vision",
      "title": "Vision system",
      "blurb": "A camera, a model, and a decision. The hard part is almost never the model: it is deciding what counts as a detection, and what you do when you are not sure."
    },
    {
      "key": "data-pipeline",
      "title": "Data pipeline",
      "blurb": "Move data, reshape it, and be able to prove afterwards what it looked like on the way through. Ordering and idempotency are the entire job."
    }
  ],
  "projects": [
    {
      "key": "pricing",
      "domain": "web-service",
      "title": "Checkout pricing service",
      "why_exemplary": "Every commerce company has this exact function, and it is the one place where an off-by-a-little bug turns into refunds and a finance escalation rather than a stack trace. It is also small enough to hold in your head, which is what makes the ordering mistake inside it so instructive.",
      "components": [
        "cart API",
        "validate",
        "discount",
        "tax",
        "total",
        "receipt",
        "payment gateway"
      ],
      "roles": [
        {
          "key": "backend",
          "title": "Backend engineer — pricing",
          "one_liner": "You own the four steps between a cart and a number finance reports off.",
          "briefed": true
        },
        {
          "key": "frontend",
          "title": "Frontend engineer — checkout",
          "one_liner": "You own the cart the pricing service is called with, and the receipt the customer reads.",
          "briefed": false
        }
      ]
    },
    {
      "key": "safety-gear",
      "domain": "vision",
      "title": "Site safety-gear check",
      "why_exemplary": "A real deployment shape: a camera on a site entrance, a decision per person, and a consequence for being wrong in either direction. False negatives are a safety incident and false positives get the system switched off by the people it is meant to protect — so the interesting engineering is entirely in the ordering of the checks.",
      "components": [
        "camera feed",
        "detect person",
        "check helmet",
        "alert",
        "incident log",
        "dashboard"
      ],
      "roles": [
        {
          "key": "cv",
          "title": "CV engineer — detection and decision",
          "one_liner": "You own who is in frame, whether they are wearing a helmet, and when to raise an alert.",
          "briefed": true
        },
        {
          "key": "platform",
          "title": "Platform engineer — capture and storage",
          "one_liner": "You own the camera feed the detector reads and the incident log it writes to.",
          "briefed": false
        }
      ]
    },
    {
      "key": "event-ingest",
      "domain": "data-pipeline",
      "title": "Idempotent event ingest",
      "why_exemplary": "The canonical distributed-systems lesson in a form small enough to finish: the same event arrives twice and your job is for that to be boring. Almost every candidate can describe idempotency and almost none have implemented it.",
      "components": ["receive", "deduplicate", "normalise", "persist", "replay"],
      "roles": [
        {
          "key": "data",
          "title": "Data engineer — ingest",
          "one_liner": "You own everything between the webhook and the table.",
          "briefed": false
        }
      ]
    }
  ]
}
`;

/** Verbatim copy of `fixtures/pricing/brief.backend.json`. */
export const PRICING_BRIEF_JSON = `{
  "schema": "mentor.brief/v1",
  "project": "pricing",
  "role": "backend",
  "title": "Backend engineer — pricing",
  "you_are": "You own the pricing function. Finance reports off your numbers, support answers tickets about your numbers, and when a customer says \\"you charged me wrong,\\" it is your function they are talking about.",
  "stakes": "You are not doing an exercise. You own a thing other people depend on, and the people who depend on it will not read your code — they will read a total on an invoice and decide whether to trust the company.",
  "deliverable": "computeTotal(items, discountRate, taxRate) → the order total, rounded to 2dp.",
  "concept": {
    "key": "order-of-operations-in-money-math",
    "question": "When a cart has both a discount and a tax, which one has to be applied first, and how would you know if you got it backwards?",
    "answer": "Tax is charged on what the customer actually pays, so it has to be computed after the discount is taken off. Getting it backwards is invisible whenever the discount is zero, because taxing the subtotal and taxing the discounted amount are then the same number — which is exactly why this class of bug survives the first few tests and ships.",
    "transfers_to": "Any calculation where one step reduces the base another step is a percentage of: refunds and partial credits, commission on a net figure, tips after a voucher, interest on a balance after a payment posts."
  },
  "owns": [
    {
      "component": "validate",
      "intent": "Reject malformed carts before any money is computed.",
      "why_yours": "Nobody downstream can defend against a cart you already accepted."
    },
    {
      "component": "discount",
      "intent": "Apply the discount code to the subtotal.",
      "why_yours": "The discount rules are pricing policy, and pricing policy lives with the pricing service."
    },
    {
      "component": "tax",
      "intent": "Apply tax to the amount the customer is actually paying.",
      "why_yours": "Tax depends on the discounted figure, so it cannot be computed anywhere that does not already know the discount."
    },
    {
      "component": "total",
      "intent": "Round once, at the end, and return the number the customer is charged.",
      "why_yours": "Rounding in more than one place is how two systems end up a cent apart, so exactly one component may do it — this one."
    }
  ],
  "given": [
    {
      "component": "cart API",
      "owned_by": "frontend",
      "contract": "Gives you items as [{ sku, qty, unitPrice }]. unitPrice is already in minor units and is never null."
    },
    {
      "component": "payment gateway",
      "owned_by": "payments",
      "contract": "Takes the total you return, in minor units. It will not re-derive it, and it will not check it."
    }
  ],
  "acceptance": [
    { "id": "a1", "given": "$100 cart, 0% discount, 20% tax", "must": "120.00" },
    { "id": "a2", "given": "$100 cart, 0% discount, 0% tax", "must": "100.00" },
    { "id": "a3", "given": "$100 cart, 40% discount, 20% tax", "must": "72.00" }
  ],
  "entry": "build/pricing.js",
  "tests": "build/pricing.test.js"
}
`;

/** Verbatim copy of `fixtures/safety-gear/brief.cv.json`. */
export const SAFETY_BRIEF_JSON = `{
  "schema": "mentor.brief/v1",
  "project": "safety-gear",
  "role": "cv",
  "title": "CV engineer — detection and decision",
  "you_are": "You own the decision. A camera watches a site entrance, and you are the one who decides whether the person walking through it is wearing a helmet — and whether that is worth interrupting somebody over.",
  "stakes": "Both directions of being wrong cost something real. Miss a bare head and you have a safety incident nobody was warned about. Alert on a compliant worker often enough and the site supervisor mutes the system, at which point you have built nothing.",
  "deliverable": "check_frame(frame) → zero or more alerts, one per person who is in frame and not wearing a helmet.",
  "concept": {
    "key": "establish-the-condition-before-acting-on-it",
    "question": "Your system alerts on workers without helmets. What has to be true before the alert can be raised, and why would building the alert first still look like it works?",
    "answer": "An alert is a claim about a condition, so the condition has to be established before the alert exists — otherwise the alert is really firing on the last thing you did evaluate, which here is just \\"a person is in frame\\". It looks correct for as long as everyone in your test footage happens to be non-compliant, and the first compliant worker is the first time you find out.",
    "transfers_to": "Anything that acts on a predicate you have not computed yet: authorising before checking a permission, retrying before classifying the error, sending a notification before confirming the state change it describes."
  },
  "owns": [
    {
      "component": "detect person",
      "intent": "Find the people in the frame. No people, no decision to make.",
      "why_yours": "Every downstream decision is per-person, so the set of people is the input to all of them."
    },
    {
      "component": "check helmet",
      "intent": "For each person found, decide whether they are wearing a helmet — and admit when the answer is uncertain.",
      "why_yours": "This is the actual judgement the system exists to make. It cannot be delegated to a threshold somebody else owns."
    },
    {
      "component": "alert",
      "intent": "Raise one alert per person who is in frame and established as not wearing a helmet.",
      "why_yours": "The alert is only as trustworthy as the check behind it, so whoever owns the check owns the alert."
    }
  ],
  "given": [
    {
      "component": "camera feed",
      "owned_by": "platform",
      "contract": "Hands you decoded frames as BGR arrays at 5fps. Frames may be dropped; they are never out of order."
    },
    {
      "component": "incident log",
      "owned_by": "platform",
      "contract": "Accepts an alert and stores it durably. It will not deduplicate for you."
    }
  ],
  "acceptance": [
    { "id": "a1", "given": "a worker wearing a helmet walks through frame", "must": "0 alerts" },
    { "id": "a2", "given": "a worker with no helmet walks through frame", "must": "exactly 1 alert" },
    { "id": "a3", "given": "an empty frame", "must": "0 alerts" }
  ],
  "entry": "detect.py",
  "tests": "test_safety.py"
}
`;

/** Verbatim copy of `fixtures/safety-gear/plan.lumina.json`. */
export const SAFETY_PLAN_JSON = `{
  "schema": "lumina.plan/v1",
  "name": "Site safety-gear check",
  "planId": "wf-safety-gear-fixture",
  "nodes": [
    {
      "id": "n-camera",
      "type": "component",
      "label": "camera feed",
      "position": {
        "x": 0,
        "y": 160
      },
      "data": {
        "label": "camera feed",
        "component": "camera feed",
        "intent": "Frames arrive here. Platform owns this — I only read it."
      }
    },
    {
      "id": "n-person",
      "type": "component",
      "label": "detect person",
      "position": {
        "x": 260,
        "y": 160
      },
      "data": {
        "label": "detect person",
        "component": "detect person",
        "intent": "Find the people in the frame. No people, no decision to make."
      }
    },
    {
      "id": "n-helmet",
      "type": "component",
      "label": "check helmet",
      "position": {
        "x": 520,
        "y": 160
      },
      "data": {
        "label": "check helmet",
        "component": "check helmet",
        "intent": "Per person: helmet or no helmet. MUST run before anything alerts."
      }
    },
    {
      "id": "n-alert",
      "type": "component",
      "label": "alert",
      "position": {
        "x": 780,
        "y": 160
      },
      "data": {
        "label": "alert",
        "component": "alert",
        "intent": "One alert per person established as not wearing a helmet."
      }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "n-camera",
      "target": "n-person",
      "sourceHandle": "output",
      "targetHandle": "input"
    },
    {
      "id": "e2",
      "source": "n-person",
      "target": "n-helmet",
      "sourceHandle": "output",
      "targetHandle": "input"
    },
    {
      "id": "e3",
      "source": "n-helmet",
      "target": "n-alert",
      "sourceHandle": "output",
      "targetHandle": "input"
    }
  ],
  "order": [
    "n-camera",
    "n-person",
    "n-helmet",
    "n-alert"
  ],
  "entry": [
    "n-camera"
  ],
  "terminal": [
    "n-alert"
  ],
  "cyclic": false,
  "warnings": []
}
`;

/** Verbatim copy of `fixtures/safety-gear/build.history.json`. */
export const SAFETY_BUILD_JSON = `{
  "$comment": [
    "schema mentor.build/v1 — the second instance, and the reason it exists.",
    "",
    "\`fixtures/pricing/\` proves the loop runs. This one proves the loop is not",
    "*about pricing*. Three things are deliberately different from it, and each one",
    "would have caught a hardcoded assumption:",
    "",
    "  1. Three owned components, not four. Anything that assumed a 4-step chain",
    "     breaks here.",
    "  2. A different drift shape: \`alert\` was built ahead of \`check helmet\`, so",
    "     the mistake is acting on a condition that did not exist yet — not, as in",
    "     pricing, computing a value from a stale base.",
    "  3. \`provenance: observed\` rather than \`authored\`. This history was produced",
    "     by the checkpoint tracker (learn/checkpoints.ts) from a progress log",
    "     rather than written by hand, which is why its confidence is higher than",
    "     pricing's 0.91. See the provenance note in mentor/build.ts.",
    "",
    "The plan also draws \`camera feed\`, which this role does not own — it is a",
    "\`given\` in brief.cv.json. So MENTOR reports it as planned-but-never-built,",
    "which is correct but incomplete on its own: only the brief knows that box was",
    "somebody else's. \`learn/coach.module.ts\` reconciles the two."
  ],

  "schema": "mentor.build/v1",
  "project": "safety-gear",
  "planRef": "plan.lumina.json",
  "entry": "detect.py",
  "tests": "test_safety.py",

  "provenance": "observed",

  "steps": [
    {
      "seq": 1,
      "at": "T+00m",
      "component": "detect person",
      "kind": "implement",
      "file": "detect.py",
      "line": 14,
      "summary": "Ran the detector and kept the boxes classified as person."
    },
    {
      "seq": 2,
      "at": "T+07m",
      "component": "alert",
      "kind": "implement",
      "file": "alert.py",
      "line": 9,
      "summary": "Raised an alert for each detected person.",
      "note": "Plan puts alert last, after check helmet. Built second. This is the drift — at this point 'not wearing a helmet' was not yet a thing the code could know, so the alert is really firing on 'a person is present'."
    },
    {
      "seq": 3,
      "at": "T+21m",
      "component": "check helmet",
      "kind": "implement",
      "file": "detect.py",
      "line": 31,
      "summary": "Added the helmet check — but alert.py was already deciding without it."
    },
    {
      "seq": 4,
      "at": "T+29m",
      "component": "tests",
      "kind": "verify",
      "file": "test_safety.py",
      "line": 22,
      "summary": "Ran the acceptance tests: empty frame and bare head pass, helmeted worker fails."
    }
  ],

  "failure": {
    "test": "a1 — a worker wearing a helmet walks through frame",
    "file": "test_safety.py",
    "line": 22,
    "expected": 0,
    "actual": 1,
    "message": "alerted on a compliant worker: expected 0 alerts, got 1",
    "whyItHidUntilNow": "The other two criteria are an empty frame (no people, so no alerts either way) and a bare head (an alert is correct). Both pass whether or not the helmet check is wired in. a1 is the only case where alerting on presence and alerting on non-compliance differ."
  },

  "expectedDrift": {
    "$comment": "What a correct MENTOR run must produce for this project. Asserted by learn/learn.test.ts.",
    "originComponent": "alert",
    "originFile": "alert.py",
    "originLine": 9,
    "surfacedAtFile": "test_safety.py",
    "surfacedAtLine": 22,
    "plannedPosition": 3,
    "actualPosition": 2,
    "$positionNote": "3 of 3, not 4 of 4. Positions are counted over the components present in BOTH artifacts, so \`camera feed\` — drawn as this role's boundary and correctly never implemented by them — is excluded. Comparing a position in the plan against a position in the build is only meaningful over components that appear in each.",
    "explanation": "You designed alert as the step after check helmet. You implemented it before check helmet.",
    "refusesToFix": true
  }
}
`;

/** Every embedded document, for the sync guard to walk. */
export const EMBEDDED: ReadonlyArray<{ name: string; file: string; json: string }> = [
  { name: 'CATALOG_JSON', file: 'fixtures/catalog.json', json: CATALOG_JSON },
  { name: 'PRICING_BRIEF_JSON', file: 'fixtures/pricing/brief.backend.json', json: PRICING_BRIEF_JSON },
  { name: 'SAFETY_BRIEF_JSON', file: 'fixtures/safety-gear/brief.cv.json', json: SAFETY_BRIEF_JSON },
  { name: 'SAFETY_PLAN_JSON', file: 'fixtures/safety-gear/plan.lumina.json', json: SAFETY_PLAN_JSON },
  { name: 'SAFETY_BUILD_JSON', file: 'fixtures/safety-gear/build.history.json', json: SAFETY_BUILD_JSON },
];

export function bundledCatalog(): Catalog {
  return parseCatalog(CATALOG_JSON);
}

/** The briefs that exist, keyed `project/role` — the catalog's `briefed: true` set. */
const BRIEFS: Readonly<Record<string, string>> = {
  'pricing/backend': PRICING_BRIEF_JSON,
  'safety-gear/cv': SAFETY_BRIEF_JSON,
};

/** null for a role the catalog advertises but has no brief for yet. */
export function bundledBrief(project: string, role: string): Brief | null {
  const raw = BRIEFS[`${project}/${role}`];
  return raw ? parseBrief(raw) : null;
}

export function bundledBriefKeys(): string[] {
  return Object.keys(BRIEFS);
}

/**
 * The plan + build for a project, when one is bundled.
 *
 * `pricing` deliberately is not here: its plan and build live in
 * `mentor/fixtures.ts` and are `explain_drift`'s default. Duplicating them
 * would create a second copy of the one demo everything else asserts against.
 */
export function bundledProjectArtifacts(project: string): { plan: Plan; build: Build } | null {
  if (project !== 'safety-gear') return null;
  return { plan: parsePlan(SAFETY_PLAN_JSON), build: parseBuild(SAFETY_BUILD_JSON) };
}
