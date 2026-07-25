/**
 * A bundled, self-contained "broken service" for the DevOps self-heal demo.
 *
 * On NitroCloud the MCP server can't patch/test a *separate* live service, so
 * the target lives inside the app: a small pricing function (as editable
 * source) plus deterministic golden test cases the server runs IN-PROCESS. This
 * ports the Python "Atlas pricing" demo (tax-before-discount regression).
 *
 * The source is our own fixture and the patch is an exact string replacement,
 * so evaluating it in-process is safe and deterministic (no child process, no
 * external code).
 */

export interface Bug {
  readonly name: string;
  readonly rootCause: string;
  readonly fixSummary: string;
  /** Pristine snippet (the correct code). */
  readonly find: string;
  /** Buggy snippet injected in its place. */
  readonly replace: string;
  /** Log excerpt the incident opens with. */
  readonly log: string;
}

/** The correct implementation. Tax is applied to the DISCOUNTED amount. */
export const PRISTINE_SOURCE = `function computeTotal(items, discountRate, taxRate) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const discount = subtotal * discountRate;
  const taxable = subtotal - discount;
  const tax = taxable * taxRate;
  return Math.round((taxable + tax) * 100) / 100;
}`;

export const BUGS: Record<string, Bug> = {
  'tax-before-discount': {
    name: 'tax-before-discount',
    rootCause:
      'Tax was computed on the pre-discount subtotal instead of the discounted amount, ' +
      'overcharging every order that used a discount code.',
    fixSummary: 'Compute tax on the discounted (taxable) amount, not the raw subtotal.',
    find: 'const tax = taxable * taxRate;',
    replace: 'const tax = subtotal * taxRate;',
    log:
      '[ERROR] pricing: order total 80.00 but expected 72.00 (items=$100, discount=40%, tax=20%)\n' +
      '[ERROR] pricing: 3 support tickets — "charged tax on the full price, not the sale price"\n' +
      '[WARN]  canary: golden order regression — discounted orders overcharged',
  },
};

export interface TestCase {
  name: string;
  items: Array<{ price: number; qty: number }>;
  discountRate: number;
  taxRate: number;
  expected: number;
}

export const TEST_CASES: TestCase[] = [
  { name: 'discounted order (canary)', items: [{ price: 100, qty: 1 }], discountRate: 0.4, taxRate: 0.2, expected: 72 },
  { name: 'no discount', items: [{ price: 50, qty: 2 }], discountRate: 0, taxRate: 0.1, expected: 110 },
  { name: 'multi-line + discount', items: [{ price: 20, qty: 3 }, { price: 10, qty: 1 }], discountRate: 0.25, taxRate: 0.18, expected: 61.95 },
];

export interface CheckResult {
  passed: boolean;
  summary: string;
  output: string;
}

/** Compile the (possibly patched) source in-process and run the golden cases. */
export function runChecks(source: string): CheckResult {
  let compute: (items: any[], d: number, t: number) => number;
  try {
    // Our own fixture source; returns the declared function.
    compute = new Function(`"use strict"; ${source}; return computeTotal;`)() as typeof compute;
  } catch (e) {
    return { passed: false, summary: 'compile error', output: `SyntaxError: ${(e as Error).message}` };
  }

  const lines: string[] = [];
  let failed = 0;
  for (const tc of TEST_CASES) {
    try {
      const got = compute(tc.items, tc.discountRate, tc.taxRate);
      const ok = Math.abs(got - tc.expected) < 1e-6;
      if (!ok) failed++;
      lines.push(`${ok ? 'PASS' : 'FAIL'}  ${tc.name}: expected ${tc.expected}, got ${got}`);
    } catch (e) {
      failed++;
      lines.push(`ERROR ${tc.name}: ${(e as Error).message}`);
    }
  }
  const total = TEST_CASES.length;
  const passed = failed === 0;
  return {
    passed,
    summary: passed ? `${total} passed` : `${failed} failed, ${total - failed} passed`,
    output: lines.join('\n'),
  };
}

/** Produce the buggy source for a given bug (injected into pristine code). */
export function injectBug(bugName: string): string {
  const bug = BUGS[bugName];
  if (!bug) throw new Error(`unknown bug: ${bugName}`);
  if (!PRISTINE_SOURCE.includes(bug.find)) {
    throw new Error(`bug template no longer matches source: ${bugName}`);
  }
  return PRISTINE_SOURCE.replace(bug.find, bug.replace);
}
