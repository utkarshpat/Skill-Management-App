import { can, canReviewAssigned, type LocalAccessState, type LocalPerson } from './local-access-store.js';

// Navigation describes effective authority; it never grants that authority.
// Future workflows remain explicitly unavailable until their services exist.
export function workspaceFor(state: LocalAccessState, person: LocalPerson) {
  const ownProfile = can(state, person, 'profile.view', true);
  const ownSkills = ownProfile && can(state, person, 'skill.view', true);
  const catalogue = can(state, person, 'skill.view') || can(state, person, 'skill.catalogue.manage');
  const administration = can(state, person, 'permissions.manage');
  const available = (permission: string) => can(state, person, permission, true) || can(state, person, permission);
  return {
    person: { id: person.id, displayName: person.displayName, employeeCode: person.employeeCode,
      roles: state.roles.filter(role => person.roleIds.includes(role.id)).map(role => role.name) },
    capabilities: {
      ownProfile, ownSkills, learning: can(state,person,'learning.view',true), claimSkills: ownSkills && can(state, person, 'skill.claim', true) && can(state, person, 'skill.view'),
      reviewSkills:ownProfile&&canReviewAssigned(state,person), catalogue, administration, manageCatalogue: can(state, person, 'skill.catalogue.manage'),
    },
    upcoming: [
      { id: 'assessment', label: 'Team & assessment', assigned: available('assessment.view'), implemented: false },
      { id: 'learning', label: 'Learning & development', assigned: available('learning.view'), implemented: true },
      { id: 'requests', label: 'Requests & incidents', assigned: available('request.view') || available('incident.view') || available('request.create') || available('incident.create'), implemented: false },
      { id: 'demand', label: 'Projects & demand', assigned: available('demand.view') || available('demand.create'), implemented: false },
      { id: 'matching', label: 'Supply & matching', assigned: available('matching.view'), implemented: false },
      { id: 'reports', label: 'Insights', assigned: available('reports.view'), implemented: false },
    ].filter(item => item.assigned),
  };
}
