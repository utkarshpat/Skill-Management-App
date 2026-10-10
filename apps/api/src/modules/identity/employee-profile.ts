import { AccessError } from '../../shared/errors.js';
import type { Identity } from './auth.js';
import type { Profile } from './profile.js';
import { can, readActorAccess, type AccessStore } from '../access/index.js';
import {
  validateEmployeeDirectoryRecord,
  validateDirectoryBinding,
  type EmployeeDirectoryProvider,
  type EmployeeDirectoryRecord,
} from './employee-directory.js';

export interface EmployeeProfileDependencies {
  access?: AccessStore;
  resolveIdentity: (identity: Identity) => Promise<string | undefined>;
  directory: EmployeeDirectoryProvider;
  ownOrganization?: (actorId: string) => Promise<NonNullable<Profile['organizationDetails']>>;
  legacyProfile: (identity: Identity) => Promise<Profile | undefined>;
}

export function createEmployeeProfileReader(dependencies: EmployeeProfileDependencies) {
  const readContext = async (id: string) => {
    const state = await readActorAccess(dependencies.access, id);
    const actor = state?.people.find(person => person.id === id);
    if (!state || !actor?.active || !can(state, actor, 'profile.view', true)) return undefined;
    // External bindings require the persisted manager record, omitted by compact
    // actor projections. Keep this server-only and re-read after external I/O.
    if (dependencies.directory.source === 'external' && state.reporting === undefined) {
      const full = await dependencies.access?.snapshot({ includeAudit: false });
      if (!full || full.reporting === undefined)
        throw new AccessError(503, 'Canonical reporting information is unavailable.');
      return full;
    }
    return state;
  };
  const managerCode = (state: NonNullable<Awaited<ReturnType<typeof readContext>>>, id: string) => {
    const edges = state.reporting?.filter(edge => edge.personId === id);
    const manager = edges?.[0]?.managerId;
    const person = manager
      ? state.people.find(person => person.id === manager && person.active)
      : undefined;
    if (
      dependencies.directory.source === 'external' &&
      ((edges && edges.length > 1) || manager === id || (manager && !person))
    )
      throw new AccessError(409, 'Employee reporting changes need synchronization.');
    return person?.employeeCode ?? null;
  };
  return async (identity: Identity): Promise<Profile | undefined> => {
    const id = await dependencies.resolveIdentity(identity);
    if (!id) return dependencies.legacyProfile(identity);
    let state = await readContext(id);
    let person = state?.people.find(person => person.id === id);
    if (!state || !person || !person.active || !can(state, person, 'profile.view', true))
      return undefined;
    let organization = await dependencies.ownOrganization?.(id);
    const stored: EmployeeDirectoryRecord = {
      employeeCode: person.employeeCode,
      displayName: person.displayName,
      firstName: null,
      lastName: null,
      email: null,
      entraObjectId: person.entraObjectId ?? identity.objectId,
      active: person.active,
      managerEmployeeCode: managerCode(state, id),
      deliveryUnit: organization?.deliveryUnit ?? null,
      department: organization?.department ?? null,
      team: organization?.team ?? null,
    };
    const query = { identity, stored };
    const raw = await dependencies.directory.readEmployee(query);
    if (!raw) return undefined;
    const employee = validateEmployeeDirectoryRecord(raw);
    if (dependencies.directory.source === 'external') {
      // A slow source response is not a reusable permission snapshot.
      if ((await dependencies.resolveIdentity(identity)) !== id) return undefined;
      state = await readContext(id);
      person = state?.people.find(person => person.id === id);
      if (!state || !person || !person.active || !can(state, person, 'profile.view', true))
        return undefined;
      organization = await dependencies.ownOrganization?.(id);
      query.stored = {
        ...stored,
        employeeCode: person.employeeCode,
        entraObjectId: person.entraObjectId ?? identity.objectId,
        managerEmployeeCode: managerCode(state, id),
        deliveryUnit: organization?.deliveryUnit ?? null,
        department: organization?.department ?? null,
        team: organization?.team ?? null,
      };
    }
    validateDirectoryBinding(employee, query);
    if (!employee.active) return undefined;
    return {
      id: person.id,
      displayName: employee.displayName,
      employeeCode: person.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      jobTitle: person.jobTitle,
      grade: person.grade,
      primaryCapabilityId: person.primaryCapabilityId,
      primaryCapabilityName: person.primaryCapabilityName,
      primaryCapabilityStatus: person.primaryCapabilityStatus,
      organization: organization?.workspace ?? 'Development Workspace',
      ...(organization ? { organizationDetails: organization } : {}),
      status: 'ACTIVE',
      roles: state.roles.filter(role => person.roleIds.includes(role.id)).map(role => role.name),
      canManageAccess: can(state, person, 'permissions.manage'),
      canViewSkills:
        can(state, person, 'skill.view') || can(state, person, 'skill.catalogue.manage'),
    };
  };
}
