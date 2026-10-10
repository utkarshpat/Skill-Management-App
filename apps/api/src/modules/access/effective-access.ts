import { personalBaselinePermissions, systemAdminPermissions } from './business-policy.js';
import { permissionCatalogue } from './access-catalogue.js';
import { authorize, type Grant } from './domain/authorization.js';
import type { Assignment, LocalAccessState, LocalPerson } from './local-access-store.js';

// This registry describes implemented permission/scope combinations, not role names.
const supported: Record<string, Assignment['scope'][]> = {
  'profile.view': ['OWN'],
  'skill.view': ['OWN', 'ORGANIZATION'],
  'skill.claim': ['OWN'],
  'skill.verify': ['ORGANIZATION'],
  'skill.catalogue.manage': ['ORGANIZATION'],
  'learning.recommend': ['ORGANIZATION'],
  'learning.view': ['OWN'],
  'learning.manage': ['OWN'],
  'users.manage': ['ORGANIZATION'],
  'permissions.manage': ['ORGANIZATION'],
  'audit.view': ['ORGANIZATION'],
  ...Object.fromEntries(
    ['request', 'incident'].flatMap(kind =>
      ['view', 'create', 'assign', 'resolve'].map(action => [
        kind + '.' + action,
        ['OWN'] as Assignment['scope'][],
      ]),
    ),
  ),
};
export const actionRegistry = permissionCatalogue.map(([code, label]) => ({
  code,
  label,
  implemented:
    Boolean(supported[code]) ||
    [
      'reports.view',
      'reports.export',
      'demand.view',
      'demand.create',
      'matching.view',
      'matching.run',
      'matching.shortlist',
      'skill.catalogue.propose',
      'request.approve',
    ].includes(code),
  bindingScopes:
    code === 'request.approve'
      ? ['ORGANIZATION']
      : [
            'reports.view',
            'reports.export',
            'demand.view',
            'demand.create',
            'matching.view',
            'matching.run',
            'matching.shortlist',
            'skill.catalogue.propose',
            'request.approve',
          ].includes(code)
        ? ['ORGANIZATION', 'DELIVERY_UNIT', 'DEPARTMENT', 'PROJECT']
        : [],
  scopes: supported[code] ?? [],
}));
export const isAssignable = (assignment: Assignment) =>
  Boolean(supported[assignment.permission]?.includes(assignment.scope));
const businessActions = new Set([
  'reports.view',
  'reports.export',
  'demand.view',
  'demand.create',
  'matching.view',
  'matching.run',
  'matching.shortlist',
  'skill.catalogue.propose',
  'request.approve',
]);
const accountId = 'local-demo-workspace';
export function hasResolvedDirectReports(state: LocalAccessState, person: LocalPerson) {
  if (!person.active) return false;
  if (!state.reporting) return person.hasDirectReports === true;
  const validChain = (id: string) => {
    const seen = new Set<string>();
    for (let depth = 0; depth <= 200; depth++) {
      if (seen.has(id) || !state.people.some(p => p.id === id && p.active)) return false;
      seen.add(id);
      const edges = state.reporting!.filter(edge => edge.personId === id);
      if (edges.length > 1) return false;
      if (!edges[0]?.managerId) return true;
      id = edges[0].managerId;
    }
    return false;
  };
  return (
    validChain(person.id) &&
    state.reporting.some(
      edge =>
        edge.managerId === person.id && edge.personId !== person.id && validChain(edge.personId),
    )
  );
}
export interface EffectiveDecision {
  action: string;
  implemented: boolean;
  allowed: boolean;
  reasonCode: string;
  resolvedScope: {
    kind: 'OWN' | 'ORGANIZATION' | 'DIRECT_REPORTS' | 'BOUND_SCOPES';
    actorId: string;
  };
  sources: {
    kind: 'TEMPLATE' | 'EXCEPTION' | 'RELATIONSHIP' | 'POLICY' | 'RESPONSIBILITY';
    id: string;
    label: string;
    effect: 'ALLOW' | 'DENY';
    scope: string;
    validUntil?: string;
    reason?: string;
  }[];
  constraints: string[];
}
/** Resource fields are resolved by the account-bound claims store, never HTTP input. */
export interface ReviewResource {
  id: string;
  revision: number;
  personId?: string;
  reviewerId?: string;
  status: string;
}
export function effectiveClaimReview(
  state: LocalAccessState,
  actor: LocalPerson,
  claim: ReviewResource,
  at = new Date(),
) {
  const decision = effectiveAccess(state, actor, 'skill.verify', 'DIRECT_REPORTS', at);
  const deny = (reasonCode: string) => ({ ...decision, allowed: false, reasonCode });
  let result: EffectiveDecision = decision;
  if (decision.allowed) {
    const owner = state.people.find(person => person.id === claim.personId && person.active);
    const edges = state.reporting?.filter(edge => edge.personId === claim.personId);
    if (!claim.personId || !state.reporting) result = deny('UNRESOLVED_RESOURCE_SCOPE');
    else if (claim.personId === actor.id) result = deny('SELF_APPROVAL');
    else if (!owner) result = deny('INACTIVE_CLAIMANT');
    else if (edges?.length !== 1 || edges[0].managerId !== actor.id)
      result = deny('NOT_CURRENT_DIRECT_MANAGER');
    else if (claim.reviewerId !== actor.id) result = deny('NOT_ASSIGNED_REVIEWER');
    else if (claim.status !== 'SUBMITTED') result = deny('NOT_AWAITING_REVIEW');
  }
  return {
    ...result,
    summaryOnly: false as const,
    resource: { type: 'SKILL_CLAIM' as const, id: claim.id, revision: claim.revision },
  };
}

/**
 * Canonical access evaluation engine.
 *
 * Evaluates whether an actor has permission to perform an action within a given scope.
 * Conforms to the Access Management Baseline (AGENTS.md & ACCESS_MODEL_REDESIGN.md):
 * - Distinct evaluation of person, role, permission, scope, relationship, and workflow constraints
 * - Matching scoped DENY strictly overrides ALLOW
 * - Validates temporal expiration (validUntil) and active actor status
 * - Checks prerequisite dependencies and direct-report relationships
 */
export function effectiveAccess(
  state: LocalAccessState,
  person: LocalPerson,
  action: string,
  context: 'OWN' | 'WORKSPACE' | 'DIRECT_REPORTS' = 'OWN',
  at = new Date(),
): EffectiveDecision {
  if (businessActions.has(action)) {
    const projection = person.business,
      sources: EffectiveDecision['sources'] = (projection?.scopes ?? [])
        .filter(s => !s.validUntil || at.getTime() < Date.parse(s.validUntil))
        .map(s => ({
          kind: 'RESPONSIBILITY',
          id: s.id,
          label: s.label,
          effect: s.effect,
          scope: s.kind + (s.scopeId ? ':' + s.scopeId : ''),
          ...(s.validUntil ? { validUntil: s.validUntil } : {}),
          reason: s.reason,
        }));
    const denied = [
      ...state.roles
        .filter(r => person.roleIds.includes(r.id))
        .flatMap(r =>
          r.permissions.map(g => ({ g, id: r.id, label: r.name, kind: 'TEMPLATE' as const })),
        ),
      ...person.overrides.map(g => ({
        g,
        id: person.id,
        label: 'Individual exception',
        kind: 'EXCEPTION' as const,
      })),
    ].filter(
      ({ g }) =>
        g.permission === action &&
        g.scope === 'ORGANIZATION' &&
        g.effect === 'DENY' &&
        (!g.validUntil || at.getTime() < Date.parse(g.validUntil)),
    );
    sources.push(
      ...denied.map(({ g, id, label, kind }) => ({
        kind,
        id,
        label,
        effect: g.effect,
        scope: g.scope,
        validUntil: g.validUntil,
        reason: g.reason,
      })),
    );
    if (
      action === 'skill.catalogue.propose' &&
      projection?.amend &&
      hasResolvedDirectReports(state, person)
    )
      sources.push({
        kind: 'RELATIONSHIP',
        id: 'current-direct-manager-amendments',
        label: 'Current direct-manager amendment policy',
        effect: 'ALLOW',
        scope: 'DIRECT_REPORTS',
      });
    const currentBinding = sources.some(
      source => source.kind === 'RESPONSIBILITY' && source.effect === 'ALLOW',
    );
    const managerAmendment =
      action === 'skill.catalogue.propose' && hasResolvedDirectReports(state, person);
    const prerequisites =
      action === 'request.approve'
        ? ['permissions.manage', 'users.manage', 'audit.view', 'skill.catalogue.manage']
        : action === 'skill.catalogue.propose' || action === 'demand.create'
          ? ['skill.view']
          : [];
    if (action === 'request.approve')
      for (const permission of prerequisites)
        sources.push(
          ...effectiveAccess(state, person, permission, 'WORKSPACE', at).sources.map(source => ({
            ...source,
            label: permission + ' · ' + source.label,
          })),
        );
    const allowed =
      (action === 'request.approve' || currentBinding || managerAmendment) &&
      prerequisites.every(
        permission => effectiveAccess(state, person, permission, 'WORKSPACE', at).allowed,
      ) &&
      !denied.length &&
      context === 'WORKSPACE' &&
      person.active &&
      Number.isFinite(at.getTime()) &&
      Boolean(
        action === 'skill.catalogue.propose'
          ? projection?.amend
          : action === 'request.approve'
            ? projection?.approve
            : projection?.view,
      ) &&
      (action !== 'reports.export' || projection?.export === true) &&
      (action !== 'demand.view' || projection?.demandView === true) &&
      (action !== 'demand.create' || projection?.demandCreate === true) &&
      (action !== 'matching.view' || projection?.matchingView === true) &&
      (action !== 'matching.run' || projection?.matchingRun === true) &&
      (action !== 'matching.shortlist' || projection?.shortlist === true) &&
      effectiveAccess(state, person, 'profile.view', 'OWN', at).allowed;
    return {
      action,
      implemented: Boolean(projection),
      allowed,
      reasonCode: !projection
        ? 'UNAVAILABLE'
        : allowed
          ? 'BOUND_RESPONSIBILITY'
          : denied.length
            ? 'EXPLICIT_DENY'
            : context !== 'WORKSPACE'
              ? 'RESOURCE_SCOPE_REQUIRED'
              : 'NO_CURRENT_RESPONSIBILITY',
      resolvedScope: { kind: 'BOUND_SCOPES', actorId: person.id },
      sources,
      constraints: [
        'SUMMARY_ONLY',
        'SERVER_RESOLVED_ACTIVE_MEMBERSHIP',
        'MATCHING_SCOPED_DENY',
        'NO_PRIVATE_DRAFTS_OR_FILES',
        'NO_CLAIM_REVIEW_AUTHORITY',
        'RECHECK_BEFORE_DELIVERY',
      ],
    };
  }
  const implemented = Boolean(supported[action]);
  const resolvedScope = {
    kind: context === 'WORKSPACE' ? ('ORGANIZATION' as const) : context,
    actorId: person.id,
  };
  const candidates: {
    grant: Assignment;
    kind: EffectiveDecision['sources'][number]['kind'];
    id: string;
    label: string;
  }[] = [
    ...(person.business?.personalBaseline &&
    personalBaselinePermissions.has(action) &&
    (context === 'OWN' || action === 'skill.view')
      ? [
          {
            grant: {
              permission: action as Assignment['permission'],
              scope: (context === 'OWN' ? 'OWN' : 'ORGANIZATION') as Assignment['scope'],
              effect: 'ALLOW' as const,
              validUntil: undefined,
              reason: undefined,
            },
            kind: 'POLICY' as const,
            id: 'personal-baseline',
            label: 'Personal Workspace baseline',
          },
        ]
      : []),
    ...(person.business?.adminDenied && systemAdminPermissions.has(action)
      ? [
          {
            grant: {
              permission: action as Assignment['permission'],
              scope: 'ORGANIZATION' as const,
              effect: 'DENY' as const,
              validUntil: undefined,
              reason: undefined,
            },
            kind: 'RESPONSIBILITY' as const,
            id: 'system-admin-deny',
            label: 'Explicit System Admin deny',
          },
        ]
      : []),
    ...(person.business?.systemAdmin && systemAdminPermissions.has(action)
      ? [
          {
            grant: {
              permission: action as Assignment['permission'],
              scope: 'ORGANIZATION' as const,
              effect: 'ALLOW' as const,
              validUntil: undefined,
              reason: undefined,
            },
            kind: 'RESPONSIBILITY' as const,
            id: 'system-admin',
            label: 'Explicit System Admin responsibility',
          },
        ]
      : []),
    ...state.roles
      .filter(role => person.roleIds.includes(role.id))
      .flatMap(role =>
        role.permissions.map(grant => ({
          grant,
          kind: 'TEMPLATE' as const,
          id: role.id,
          label: role.name,
        })),
      ),
    ...person.overrides.map(grant => ({
      grant,
      kind: 'EXCEPTION' as const,
      id: person.id,
      label: 'Individual exception',
    })),
  ].filter(
    ({ grant }) =>
      grant.permission === action &&
      (grant.scope === 'ORGANIZATION' || context === 'OWN') &&
      (!grant.validUntil || at.getTime() < Date.parse(grant.validUntil)),
  );
  const sources: EffectiveDecision['sources'] = candidates.map(({ grant, kind, id, label }) => ({
    kind,
    id,
    label,
    effect: grant.effect,
    scope: grant.scope,
    ...(grant.validUntil ? { validUntil: grant.validUntil } : {}),
    ...(grant.reason ? { reason: grant.reason } : {}),
  }));
  const constraints =
    action === 'learning.recommend'
      ? ['CURRENT_DIRECT_MANAGER', 'ACTIVE_RECIPIENT', 'PUBLISHED_SKILL', 'RECIPIENT_ACCEPTANCE']
      : action === 'skill.verify'
        ? [
            'CURRENT_DIRECT_MANAGER',
            'ASSIGNED_REVIEWER',
            'NO_SELF_REVIEW',
            'ACTIVE_CLAIMANT',
            'REVIEWABLE_STATE',
          ]
        : action.startsWith('request.') || action.startsWith('incident.')
          ? ['CURRENT_PARTICIPANT', 'WORKFLOW_STATE', 'REVISION_RECHECK']
          : action === 'skill.claim'
            ? ['OWN_CLAIM', 'EDITABLE_STATE', 'PUBLISHED_SKILL']
            : action.startsWith('learning.')
              ? ['OWN_PLAN', 'WORKFLOW_STATE']
              : [];
  let reasonCode = 'DEFAULT_DENY',
    allowed = false;
  if (!implemented) reasonCode = 'UNAVAILABLE';
  else if (!Number.isFinite(at.getTime())) reasonCode = 'INVALID_TIME';
  else if (!person.active) reasonCode = 'INACTIVE_ACTOR';
  else if (context === 'DIRECT_REPORTS' && !['skill.verify', 'learning.recommend'].includes(action))
    reasonCode = 'UNSUPPORTED_SCOPE';
  else if (context === 'WORKSPACE' && action === 'learning.recommend')
    reasonCode = 'RESOURCE_SCOPE_REQUIRED';
  else if (context === 'DIRECT_REPORTS') {
    // SQL snapshots always resolve this flag. An unresolved relationship fails closed.
    if (sources.some(s => s.effect === 'DENY')) reasonCode = 'EXPLICIT_DENY';
    else if (!hasResolvedDirectReports(state, person)) reasonCode = 'NO_RESOLVED_DIRECT_REPORTS';
    else {
      allowed = true;
      reasonCode = 'REPORTING_POLICY';
      sources.push({
        kind: 'RELATIONSHIP',
        id: 'current-direct-manager',
        label: 'Current direct-manager policy',
        effect: 'ALLOW',
        scope: 'DIRECT_REPORTS',
      });
    }
  } else {
    const grants: Grant[] = candidates.map(({ grant }) => ({
      accountId,
      userId: person.id,
      permission: action,
      source: 'ROLE',
      effect: grant.effect,
      scope: { kind: grant.scope },
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: grant.validUntil,
    }));
    const result = authorize(
      { id: person.id, accountId, active: person.active },
      action,
      {
        id: context === 'OWN' ? person.id : accountId,
        type: context === 'OWN' ? 'profile' : 'workspace',
        accountId,
        ownerUserId: context === 'OWN' ? person.id : undefined,
      },
      grants,
      at,
    );
    allowed = result.allowed;
    reasonCode = result.reason;
  }
  const prerequisites: { action: string; context: 'OWN' | 'WORKSPACE' }[] = [];
  if (
    (action === 'skill.verify' && context === 'DIRECT_REPORTS') ||
    (action === 'skill.view' && context === 'OWN') ||
    action === 'skill.claim'
  )
    prerequisites.push({ action: 'profile.view', context: 'OWN' });
  if (action === 'skill.claim') prerequisites.push({ action: 'skill.view', context: 'WORKSPACE' });
  if (
    action === 'learning.recommend' &&
    allowed &&
    !effectiveAccess(state, person, 'skill.view', 'WORKSPACE', at).allowed &&
    !effectiveAccess(state, person, 'skill.catalogue.manage', 'WORKSPACE', at).allowed
  ) {
    allowed = false;
    reasonCode = 'CATALOGUE_ACCESS_DENIED';
  }
  if (action === 'learning.recommend')
    prerequisites.push(
      { action: 'profile.view', context: 'OWN' },
      { action: 'learning.view', context: 'OWN' },
    );
  if (action === 'learning.manage') prerequisites.push({ action: 'learning.view', context: 'OWN' });
  if (action === 'users.manage' || action === 'audit.view')
    prerequisites.push({ action: 'permissions.manage', context: 'WORKSPACE' });
  for (const kind of ['request', 'incident'])
    if (action.startsWith(kind + '.') && action !== kind + '.view')
      prerequisites.push({ action: kind + '.view', context: 'OWN' });
  for (const dependency of prerequisites) {
    constraints.push('REQUIRES ' + dependency.action + ' ' + dependency.context);
    if (
      allowed &&
      !effectiveAccess(state, person, dependency.action, dependency.context, at).allowed
    ) {
      allowed = false;
      reasonCode = 'PREREQUISITE_DENIED';
    }
  }
  return { action, implemented, allowed, reasonCode, resolvedScope, sources, constraints };
}

/**
 * Computes the complete effective access projection for a person across all registered platform actions.
 * Used by the UI and API to establish UI capability gates matching execution-time checks.
 */
export function effectiveAccessSummary(state: LocalAccessState, person: LocalPerson) {
  return {
    actorId: person.id,
    revision: state.revision,
    summaryOnly: true,
    decisions: actionRegistry.flatMap(action =>
      businessActions.has(action.code)
        ? [effectiveAccess(state, person, action.code, 'WORKSPACE')]
        : ['skill.verify', 'learning.recommend'].includes(action.code)
          ? [effectiveAccess(state, person, action.code, 'DIRECT_REPORTS')]
          : (action.scopes.length
              ? action.scopes.map(scope =>
                  scope === 'OWN' ? ('OWN' as const) : ('WORKSPACE' as const),
                )
              : ['OWN' as const]
            ).map(context => effectiveAccess(state, person, action.code, context)),
    ),
    unsupportedAssignments: [
      ...state.roles
        .filter(role => person.roleIds.includes(role.id))
        .flatMap(role => role.permissions),
      ...person.overrides,
    ].filter(grant => !isAssignable(grant)),
  };
}
