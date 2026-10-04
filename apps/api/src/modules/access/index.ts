export { can, canReviewAssigned, grantsFor, type AccessStore, type LocalAccessState, type LocalPerson, type Assignment, type CustomRole } from './local-access-store.js';
export { AccessError } from '../../shared/errors.js';
export { permissionCatalogue, type PermissionCode } from './access-catalogue.js';
export { rolePresets, type RolePreset } from './role-presets.js';
export { workspaceFor } from './workspace.js';

export {effectiveAccess,effectiveAccessSummary,actionRegistry} from './effective-access.js';
