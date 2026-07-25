/**
 * Bridge ① — `mentor.catalog/v1`, the thing a student meets first.
 *
 * Before any of the rest of this repo means anything, a student has to answer two
 * questions: *what do I want to build*, and *who am I on the team that builds it*.
 * This artifact is the menu for both, in that order — a **product type** (a web
 * service, a vision system) and then a **role inside it** (the backend engineer
 * who owns pricing, the CV engineer who owns the detector).
 *
 * ## Why the catalog is deliberately thin
 *
 * It carries only what you need to *choose*: a title, a blurb, a one-liner per
 * role. It does not carry `owns` / `given` / acceptance criteria — those live in
 * `mentor.brief/v1` (`brief.ts`), one file per project×role.
 *
 * That split matters because the alternative is duplication that rots. If the
 * catalog also listed the components a role owns, it would be a second copy of
 * the brief's `owns` array, and the two would disagree within a week. So counts
 * shown at selection time are **derived** from the brief at call time
 * (`describeRole`), never stored here.
 *
 * ## Why "curated" is a property of the schema, not a wish
 *
 * `why_exemplary` is required on every project. A catalog of projects nobody can
 * say anything specific about is a list of homework, and the pitch
 * (`MENTOR-CONCEPT.md` §1) is that these are the projects a company would
 * actually have you do. If a project can't justify its place in one sentence, it
 * doesn't get an entry.
 */

export const CATALOG_SCHEMA = 'mentor.catalog/v1';

/** A product type — the first choice a student makes. */
export interface CatalogDomain {
  readonly key: string;
  readonly title: string;
  /** One or two sentences: what building this kind of thing is actually like. */
  readonly blurb: string;
}

/** A role on a project. Thin on purpose — the contract is in the brief. */
export interface CatalogRole {
  readonly key: string;
  readonly title: string;
  /** What this person is on the hook for, in one line. */
  readonly oneLiner: string;
  /**
   * True when a `mentor.brief/v1` exists for this project×role. A role without a
   * brief is advertised but unplayable, so tools surface this rather than
   * letting a student pick it and hit an empty screen.
   */
  readonly briefed: boolean;
}

export interface CatalogProject {
  readonly key: string;
  readonly domain: string;
  readonly title: string;
  /** Why this project earns a place in a *curated* list. Required. */
  readonly whyExemplary: string;
  /**
   * Every component in the whole system — not just the student's. The point of
   * role-scoping is that you can see the parts you are *not* doing.
   */
  readonly components: readonly string[];
  readonly roles: readonly CatalogRole[];
}

export interface Catalog {
  readonly schema: string;
  readonly name: string;
  readonly domains: readonly CatalogDomain[];
  readonly projects: readonly CatalogProject[];
  readonly warnings: readonly string[];
}

export class CatalogParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function safeJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CatalogParseError(
      `${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Parse a `mentor.catalog/v1` document (object or JSON string).
 *
 * Strict about the envelope, forgiving about entries — same stance as
 * `plan.ts`. A malformed project is dropped with a warning rather than taking
 * the whole catalog down, because one bad entry should not stop a student
 * browsing the other nine. But a wrong `schema` or a missing `projects` array
 * throws: presenting an empty menu as a real one wastes the only moment the
 * student is deciding whether this tool is worth their afternoon.
 *
 * @throws CatalogParseError on an unusable envelope.
 */
export function parseCatalog(input: unknown): Catalog {
  const raw: unknown = typeof input === 'string' ? safeJson(input, 'catalog') : input;
  if (!isObj(raw)) throw new CatalogParseError('catalog must be a JSON object');

  const schema = str(raw.schema);
  if (schema !== CATALOG_SCHEMA) {
    throw new CatalogParseError(
      `unsupported catalog schema ${JSON.stringify(schema || '(missing)')} — expected ${CATALOG_SCHEMA}`,
    );
  }
  if (!Array.isArray(raw.domains)) throw new CatalogParseError('catalog.domains must be an array');
  if (!Array.isArray(raw.projects)) throw new CatalogParseError('catalog.projects must be an array');

  const warnings: string[] = [...toStringArray(raw.warnings)];

  const domains: CatalogDomain[] = [];
  const domainKeys = new Set<string>();
  for (const d of raw.domains) {
    if (!isObj(d)) continue;
    const key = str(d.key).trim();
    if (!key || domainKeys.has(key)) continue;
    domainKeys.add(key);
    domains.push({ key, title: str(d.title).trim() || key, blurb: str(d.blurb).trim() });
  }

  const projects: CatalogProject[] = [];
  const projectKeys = new Set<string>();
  for (const p of raw.projects) {
    if (!isObj(p)) continue;
    const key = str(p.key).trim();
    if (!key) {
      warnings.push('dropped a project with no key');
      continue;
    }
    if (projectKeys.has(key)) {
      warnings.push(`dropped duplicate project ${key}`);
      continue;
    }

    const domain = str(p.domain).trim();
    if (!domainKeys.has(domain)) {
      // An orphaned project is unreachable through the two-step choice, so
      // silently keeping it would advertise a path that dead-ends.
      warnings.push(`dropped project ${key} — domain ${JSON.stringify(domain)} is not in the catalog`);
      continue;
    }

    const whyExemplary = str(p.why_exemplary).trim();
    if (!whyExemplary) {
      warnings.push(`project ${key} has no why_exemplary — it is listed but not justified`);
    }

    const roles: CatalogRole[] = [];
    const roleKeys = new Set<string>();
    for (const r of Array.isArray(p.roles) ? p.roles : []) {
      if (!isObj(r)) continue;
      const roleKey = str(r.key).trim();
      if (!roleKey || roleKeys.has(roleKey)) continue;
      roleKeys.add(roleKey);
      roles.push({
        key: roleKey,
        title: str(r.title).trim() || roleKey,
        oneLiner: str(r.one_liner).trim(),
        briefed: r.briefed === true,
      });
    }
    if (roles.length === 0) {
      warnings.push(`dropped project ${key} — no roles, so there is nothing for a student to be`);
      continue;
    }

    projectKeys.add(key);
    projects.push({
      key,
      domain,
      title: str(p.title).trim() || key,
      whyExemplary,
      components: toStringArray(p.components).map((c) => c.trim()).filter(Boolean),
      roles,
    });
  }

  return {
    schema,
    name: str(raw.name, 'Untitled catalog'),
    domains,
    projects,
    warnings,
  };
}

/** Projects in one product type. Empty array for an unknown domain. */
export function projectsInDomain(catalog: Catalog, domainKey: string): CatalogProject[] {
  return catalog.projects.filter((p) => p.domain === domainKey);
}

export function findProject(catalog: Catalog, projectKey: string): CatalogProject | null {
  return catalog.projects.find((p) => p.key === projectKey) ?? null;
}

export function findRole(
  catalog: Catalog,
  projectKey: string,
  roleKey: string,
): { project: CatalogProject; role: CatalogRole } | null {
  const project = findProject(catalog, projectKey);
  const role = project?.roles.find((r) => r.key === roleKey);
  return project && role ? { project, role } : null;
}

/**
 * How many domains actually lead somewhere playable.
 *
 * Used by `browse_catalog` to tell a student the truth up front rather than
 * after two clicks. A catalog can legitimately advertise roadmap entries — but
 * it should say so at the top, not spring it.
 */
export function catalogCoverage(catalog: Catalog): {
  domains: number;
  projects: number;
  roles: number;
  playableRoles: number;
} {
  const roles = catalog.projects.flatMap((p) => p.roles);
  return {
    domains: catalog.domains.length,
    projects: catalog.projects.length,
    roles: roles.length,
    playableRoles: roles.filter((r) => r.briefed).length,
  };
}
