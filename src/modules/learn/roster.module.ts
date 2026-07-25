/**
 * ROSTER — the front door. Bridges ① and ②.
 *
 * Two tools, because a student makes two choices before any of this means
 * anything: *what am I building*, and *who am I on the team building it*.
 *
 * ## Why this is a separate module rather than two more MENTOR tools
 *
 * `GAPS.md` Gap 11 is the record of what happens when a server offers twenty-odd
 * tools across unrelated domains: in an MCP app the tool list *is* the interface,
 * and a client's model choosing from a menu of six products picks wrong. The fix
 * was to cut the surface to the one story the app actually tells.
 *
 * This adds tools back, and the test it has to pass is whether they are the same
 * story. They are — a student cannot reach `explain_drift` without first having a
 * project, a role, and a design, and until now the first two of those were a
 * paragraph in a README that no code could read. Splitting them into their own
 * module is what keeps the *shape* of the surface legible: three agents, one per
 * stage of one loop, rather than ten loose tools on MENTOR.
 *
 * ROSTER holds no state. `browse_catalog` and `open_brief` are pure reads of the
 * bundled catalog, which is why they work on NitroCloud with nothing uploaded.
 */

import {
  ToolDecorator as Tool,
  PromptDecorator as Prompt,
  Module,
  ExecutionContext,
  z,
} from '@nitrostack/core';
import { assertNoFix } from './brief.js';
import {
  catalogCoverage,
  findProject,
  findRole,
  projectsInDomain,
  type CatalogProject,
} from './catalog.js';
import { bundledBrief, bundledCatalog } from './fixtures.learn.js';

export class RosterTools {
  @Tool({
    name: 'browse_catalog',
    description:
      'Browse the curated project catalog a student picks from. Call with no arguments to list the ' +
      'product types they can build (a web service, a vision system, a data pipeline). Call with a ' +
      'domain to see the projects in it and the roles available on each. This is step one of the ' +
      'learning loop: choose what to build, then choose who you are on the team that builds it.',
    inputSchema: z.object({
      domain: z
        .string()
        .optional()
        .describe('A domain key from a previous call, e.g. "web-service". Omit to list domains.'),
    }),
  })
  async browseCatalog(input: { domain?: string }, ctx: ExecutionContext) {
    const catalog = bundledCatalog();
    const coverage = catalogCoverage(catalog);
    ctx.logger.info('browse_catalog', { domain: input.domain ?? '(all domains)' });

    // Said up front, not after two clicks. A catalog that advertises roles it
    // cannot actually run should admit the ratio at the top.
    const honesty =
      coverage.playableRoles === coverage.roles
        ? `All ${coverage.roles} roles are playable.`
        : `${coverage.playableRoles} of ${coverage.roles} roles have a brief written and are ` +
          'playable today; the rest are listed so you can see the shape of the team, and are ' +
          'roadmap.';

    if (!input.domain) {
      return {
        step: '1 of 2 — pick what you want to build',
        catalog: catalog.name,
        coverage,
        honesty,
        domains: catalog.domains.map((d) => ({
          domain: d.key,
          title: d.title,
          what_its_like: d.blurb,
          projects: projectsInDomain(catalog, d.key).length,
        })),
        next: 'Call browse_catalog again with a domain key to see its projects and roles.',
        warnings: catalog.warnings,
      };
    }

    const domain = catalog.domains.find((d) => d.key === input.domain);
    if (!domain) {
      return {
        error: `no domain ${JSON.stringify(input.domain)} in this catalog`,
        available: catalog.domains.map((d) => d.key),
      };
    }

    return {
      step: '2 of 2 — pick your role',
      domain: domain.key,
      title: domain.title,
      what_its_like: domain.blurb,
      projects: projectsInDomain(catalog, domain.key).map((p) => describeProject(p)),
      next:
        'Call open_brief with a project and a role to get the actual assignment — what you own, ' +
        'what other people hand you, and what "done" means.',
    };
  }

  @Tool({
    name: 'open_brief',
    description:
      'Open the assignment for one role on one project. Returns what this role OWNS (their slice, ' +
      'the components they must build), what is GIVEN to them (components other roles own, which ' +
      'they build against but do not implement), the signed-off acceptance criteria, and the ' +
      'concept the project exists to teach. This is the artifact that makes "do only the part you ' +
      "would do in a company as that role\" a checkable fact rather than a suggestion — check_scope " +
      'compares it against the architecture the student draws.',
    inputSchema: z.object({
      project: z.string().describe('A project key from browse_catalog, e.g. "pricing".'),
      role: z.string().describe('A role key on that project, e.g. "backend".'),
    }),
  })
  async openBrief(input: { project: string; role: string }, ctx: ExecutionContext) {
    const catalog = bundledCatalog();
    ctx.logger.info('open_brief', { project: input.project, role: input.role });

    const found = findRole(catalog, input.project, input.role);
    if (!found) {
      const project = findProject(catalog, input.project);
      return {
        error: project
          ? `project ${input.project} has no role ${JSON.stringify(input.role)}`
          : `no project ${JSON.stringify(input.project)} in this catalog`,
        available: project
          ? project.roles.map((r) => r.key)
          : catalog.projects.map((p) => p.key),
      };
    }

    const brief = bundledBrief(input.project, input.role);
    if (!brief) {
      return {
        error:
          `${found.role.title} is in the catalog but has no brief written yet, so there is ` +
          'nothing to hold you to. Pick a role marked briefed.',
        playable: catalog.projects.flatMap((p) =>
          p.roles.filter((r) => r.briefed).map((r) => ({ project: p.key, role: r.key })),
        ),
      };
    }

    // A brief whose concept contains code would let `flashcard` hand over the
    // patch `withhold_fix` refuses. Reported here, at the point of authorship,
    // rather than discovered when a card is issued.
    const conceptProblems = assertNoFix(brief.concept);

    return {
      step: 'your assignment',
      project: brief.project,
      role: brief.role,
      title: brief.title,
      you_are: brief.youAre,
      stakes: brief.stakes,
      deliverable: brief.deliverable,
      you_own: brief.owns.map((o) => ({
        component: o.component,
        intent: o.intent,
        why_yours: o.whyYours,
      })),
      given_to_you: brief.given.map((g) => ({
        component: g.component,
        owned_by: g.ownedBy,
        contract: g.contract,
        note: 'Draw it as your boundary. Do not implement it.',
      })),
      not_yours: notYours(found.project, brief.owns.map((o) => o.component), brief.given.map((g) => g.component)),
      acceptance: brief.acceptance.map((a) => ({ id: a.id, given: a.given, must: a.must })),
      concept_you_are_here_to_learn: {
        key: brief.concept.key,
        question: brief.concept.question,
        // The answer is NOT included. It is the flashcard's back, and it is
        // earned by finishing (`card.ts`) — handing it over with the assignment
        // would be handing over the reasoning before the student has done it.
        answer: 'withheld — earn it with the flashcard tool once your tests are green',
      },
      files: { entry: brief.entry, tests: brief.tests },
      next:
        'Draw your slice in Lumina (drag Component nodes, wire them in the order you intend to ' +
        'build), hit Plan, then call check_scope with the exported lumina.plan/v1 to confirm you ' +
        'designed your job and not somebody else\'s.',
      warnings: [...brief.warnings, ...conceptProblems],
    };
  }
}

/** Components in the project that this role neither owns nor is handed. */
function notYours(
  project: CatalogProject,
  owns: readonly string[],
  given: readonly string[],
): string[] {
  const mine = new Set([...owns, ...given].map((c) => c.trim().toLowerCase()));
  return project.components.filter((c) => !mine.has(c.trim().toLowerCase()));
}

function describeProject(p: CatalogProject) {
  return {
    project: p.key,
    title: p.title,
    why_its_worth_your_afternoon: p.whyExemplary,
    // The whole system, so the student can see the parts they are NOT doing.
    // That visibility is the point of role-scoping.
    all_components: p.components,
    roles: p.roles.map((r) => ({
      role: r.key,
      title: r.title,
      on_the_hook_for: r.oneLiner,
      playable: r.briefed,
      // Derived from the brief at call time, never stored on the catalog — a
      // second copy of `owns` would disagree with the first within a week.
      owns_count: r.briefed ? (bundledBrief(p.key, r.key)?.owns.length ?? null) : null,
    })),
  };
}

export class RosterPrompts {
  @Prompt({
    name: 'pick_a_project',
    description:
      'Walk a student from nothing to an assignment: choose a product type, a project, and a role.',
    arguments: [
      {
        name: 'interest',
        description: 'What the student says they want to build or learn',
        required: false,
      },
    ],
  })
  async pickAProject(args: { interest?: string }, _ctx: ExecutionContext) {
    return [
      {
        role: 'user',
        content:
          'You are helping a student choose their first real assignment.\n\n' +
          (args.interest
            ? `They said: ${args.interest}\n\n`
            : 'They have not said what they want yet — ask, briefly.\n\n') +
          'Call browse_catalog to list the product types, then again with the domain that fits ' +
          'them, and describe the projects in the terms the catalog gives you — especially why ' +
          'each one is worth their afternoon. Then call open_brief for the role they pick.\n\n' +
          'Two things to be clear about, because they are the point of the product:\n' +
          '1. They own a SLICE, not the project. Read them the given_to_you list and the ' +
          'not_yours list explicitly — knowing what you are not building is half of knowing ' +
          'what you are.\n' +
          '2. Do not answer the concept question for them. It is withheld on purpose and they ' +
          'earn it at the end.',
      },
    ];
  }
}

@Module({
  name: 'roster',
  description:
    'Front door — the curated catalog of exemplary projects, and the role-scoped brief that tells a student which slice of one is theirs.',
  controllers: [RosterTools, RosterPrompts],
})
export class RosterModule {}
