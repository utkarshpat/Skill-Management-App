import { createHash } from 'node:crypto';
import { AccessError } from '../access/index.js';
import {
  organizationChange,
  organizationPath,
  parentKind,
  reportingChain,
  type OrganizationState,
} from './organization.js';

export function previewOrganization(state: OrganizationState, actorId: string, input: unknown) {
  if (!input || typeof input !== 'object')
    throw new AccessError(400, 'Invalid organization change.');
  const { previewReceipt: _receipt, ...body } = input as Record<string, unknown>;
  const change = organizationChange(body);
  if (change.revision !== state.revision)
    throw new AccessError(409, 'Organization changed. Reload before previewing.');
  const candidate = structuredClone(state);
  let before: unknown, after: unknown;
  if (change.kind === 'assignment') {
    if (!state.people.some(p => p.id === change.targetId && p.active))
      throw new AccessError(400, 'Choose an active person.');
    before = state.assignments.find(edge => edge.personId === change.targetId) ?? null;
    const edge = { personId: change.targetId, ...change.payload };
    if (edge.managerId && !state.people.some(p => p.id === edge.managerId && p.active))
      throw new AccessError(400, 'Choose an active manager.');
    const nodeId = edge.teamId ?? edge.departmentId;
    if (
      nodeId &&
      !state.nodes.some(
        node =>
          node.id === nodeId && node.active && node.kind === (edge.teamId ? 'TEAM' : 'DEPARTMENT'),
      )
    )
      throw new AccessError(400, 'Choose an active matching organization node.');
    if (nodeId && !organizationPath(state, nodeId))
      throw new AccessError(
        400,
        'Placement needs an active Delivery Unit, Portfolio/Division and account/client path.',
      );
    candidate.assignments = [
      ...candidate.assignments.filter(old => old.personId !== edge.personId),
      edge,
    ];
    reportingChain(candidate, edge.personId);
    after = edge;
  } else {
    before = state.nodes.find(node => node.id === change.targetId) ?? null;
    if (!change.isNew && !before) throw new AccessError(404, 'Organization node unavailable.');
    if (
      before &&
      typeof before === 'object' &&
      'kind' in before &&
      before.kind !== change.payload.type
    )
      throw new AccessError(400, 'An existing organization level cannot change type.');
    if (
      !change.payload.active &&
      (state.nodes.some(node => node.parentId === change.targetId && node.active) ||
        state.assignments.some(
          edge => edge.teamId === change.targetId || edge.departmentId === change.targetId,
        ))
    )
      throw new AccessError(400, 'Move assigned people and archive active children first.');
    const parent = change.payload.parentId
      ? organizationPath(state, change.payload.parentId)?.[0]
      : undefined;
    if (
      change.payload.parentId &&
      (!parent?.active || parent.kind !== parentKind[change.payload.type])
    )
      throw new AccessError(400, 'Choose a valid active parent.');
    after = { id: change.isNew ? null : change.targetId, ...change.payload };
  }
  const receipt = createHash('sha256')
    .update(JSON.stringify({ actorId, body, state }))
    .digest('hex');
  return {
    receipt,
    revision: state.revision,
    before,
    after,
    warnings:
      change.kind === 'assignment'
        ? [
            'Changing reporting affects current direct-manager review scope. Existing assigned claims are not silently rerouted; routing mismatches must use the resubmission workflow.',
            'Membership and reporting placement do not automatically grant account/client or organization access.',
          ]
        : [
            'Organization placement does not automatically grant access.',
            'Changing ancestry re-evaluates existing Delivery Unit-scoped visibility and matching DENY rules. Stored responsibility IDs are not changed.',
          ],
  };
}
