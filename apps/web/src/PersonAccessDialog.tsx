import { useRef, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Users,
  FolderTree,
  History,
  Trash2,
  Plus,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Info,
} from 'lucide-react';
import { FormDialog } from './FormDialog';
import { EffectiveAccess } from './EffectiveAccess';
import { EmploymentSummary } from './EmploymentDetails';
import { AccessAudit } from './AccessAudit';
import type { OrganizationSummary } from './organization-summary';
import {
  exceptionPermissions,
  exceptionSelection,
  exceptionExpiry,
  localDate,
  templateAssignable,
} from './person-access-model';

interface Assignment {
  permission: string;
  scope: 'OWN' | 'ORGANIZATION';
  effect: 'ALLOW' | 'DENY';
  validUntil?: string;
  reason?: string;
}

interface Role {
  id: string;
  name: string;
  permissions: Assignment[];
}

interface Person {
  id: string;
  displayName: string;
  employeeCode: string;
  jobTitle?: string | null;
  grade?: string | null;
  active: boolean;
  roleIds: string[];
  overrides: Assignment[];
}

interface CatalogueItem {
  code: string;
  label: string;
  implemented?: boolean;
  scopes?: ('OWN' | 'ORGANIZATION')[];
}

export function PersonAccessDialog({
  person,
  roles,
  catalogue,
  organization,
  people,
  canManageUsers,
  canViewAudit = false,
  endpoint,
  revision,
  busy = false,
  onClose,
  onApplyChange,
  onFullEdit,
  onManageOrganization,
  businessAdministrationNode,
  error,
  onReload,
}: {
  person: Person;
  roles: Role[];
  catalogue: CatalogueItem[];
  organization?: OrganizationSummary;
  people: Person[];
  canManageUsers: boolean;
  canViewAudit?: boolean;
  endpoint: string;
  revision: number;
  busy?: boolean;
  onClose: () => void;
  onApplyChange: (updatedPerson: Person) => Promise<void>;
  onFullEdit: (person: Person) => void;
  onManageOrganization?: () => void;
  businessAdministrationNode?: React.ReactNode;
  error?: string;
  onReload?: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<
    'effective' | 'roles' | 'exceptions' | 'organization' | 'audit'
  >('effective');

  // Role addition state
  const [selectedRoleToAdd, setSelectedRoleToAdd] = useState('');

  // Exception addition form state
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 30);
  const defaultExpiryStr = localDate(tomorrow);
  const assignablePermissions = exceptionPermissions(catalogue);

  const [newPermission, setNewPermission] = useState(assignablePermissions[0]?.code ?? '');
  const [newEffect, setNewEffect] = useState<'ALLOW' | 'DENY'>('ALLOW');
  const [newScope, setNewScope] = useState<'OWN' | 'ORGANIZATION'>(
    assignablePermissions[0]?.scopes?.[0] ?? 'OWN',
  );
  const [newReason, setNewReason] = useState('');
  const [newExpiry, setNewExpiry] = useState(defaultExpiryStr);
  const [formError, setFormError] = useState('');

  const edge = organization?.assignments.find(item => item.personId === person.id);
  const manager = people.find(item => item.id === edge?.managerId);
  const unassignedRoles = roles.filter(
    role => !person.roleIds.includes(role.id) && templateAssignable(role.permissions, catalogue),
  );

  const selection = exceptionSelection(catalogue, newPermission, newScope);
  const supportedScopes = selection.permission?.scopes ?? [];
  const pending = useRef(false);
  async function preview(updatedPerson: Person) {
    if (busy || pending.current) return;
    pending.current = true;
    setFormError('');
    try {
      await onApplyChange(updatedPerson);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'The preview could not be loaded.');
    } finally {
      pending.current = false;
    }
  }
  async function reload() {
    if (busy || pending.current || !onReload) return;
    pending.current = true;
    setFormError('');
    try {
      await onReload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Current access could not be loaded.');
    } finally {
      pending.current = false;
    }
  }

  // Handle removing a role
  const handleRemoveRole = async (roleId: string) => {
    const updatedRoleIds = person.roleIds.filter(id => id !== roleId);
    await preview({ ...person, roleIds: updatedRoleIds });
  };

  // Handle assigning a role
  const handleAssignRole = async () => {
    if (!unassignedRoles.some(r => r.id === selectedRoleToAdd)) return;
    const updatedRoleIds = [...person.roleIds, selectedRoleToAdd];
    await preview({ ...person, roleIds: updatedRoleIds });
  };

  // Handle removing an exception
  const handleRemoveOverride = async (index: number) => {
    const updatedOverrides = person.overrides.filter((_, idx) => idx !== index);
    await preview({ ...person, overrides: updatedOverrides });
  };

  // Handle adding/amending an exception
  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newReason.trim()) {
      setFormError('A valid business reason is required for permission overrides.');
      return;
    }
    if (!newExpiry) {
      setFormError('An expiration date is required for permission overrides.');
      return;
    }

    if (!selection.permission || !selection.scope) {
      setFormError('No supported permission and scope are available for an exception.');
      return;
    }
    let validUntil: string;
    try {
      validUntil = exceptionExpiry(newExpiry);
    } catch (e) {
      setFormError((e as Error).message);
      return;
    }

    const newOverrideItem: Assignment = {
      permission: selection.permission.code,
      effect: newEffect,
      scope: selection.scope,
      reason: newReason.trim(),
      validUntil,
    };

    // Replace if exists for same permission+scope, else append
    const existingIndex = person.overrides.findIndex(
      o => o.permission === selection.permission?.code && o.scope === selection.scope,
    );
    let updatedOverrides: Assignment[];
    if (existingIndex >= 0) {
      updatedOverrides = person.overrides.map((o, idx) =>
        idx === existingIndex ? newOverrideItem : o,
      );
    } else {
      updatedOverrides = [...person.overrides, newOverrideItem];
    }

    await preview({ ...person, overrides: updatedOverrides });
  };

  return (
    <FormDialog
      className="access-view-dialog"
      title={`Access profile · ${person.displayName}`}
      subtitle={`${person.employeeCode} · ${person.active ? 'Active account' : 'Suspended'}`}
      onClose={onClose}
      busy={busy}
      message={
        (formError || error) && (
          <div role="alert" className="access-form-error">
            <p>{formError || error}</p>
            {onReload && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload current configuration
              </button>
            )}
          </div>
        )
      }
      footer={
        <div className="access-dialog-footer">
          {canManageUsers && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onFullEdit(person)}
            >
              <Pencil size={14} /> Full person edit
            </button>
          )}
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="access-dialog-body">
        {/* Top Summary Banner */}
        <section className="access-person-banner">
          <div className="access-avatar-circle" aria-hidden="true">
            {person.displayName
              .split(' ')
              .map(n => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div className="access-banner-info">
            <div className="access-banner-title-row">
              <h2 className="access-banner-name">{person.displayName}</h2>
              <span className={`access-status-badge ${person.active ? 'active' : 'suspended'}`}>
                {person.active ? '● Active' : '✕ Suspended'}
              </span>
            </div>
            <div className="access-banner-meta-row">
              <span className="access-meta-chip">ID: {person.employeeCode}</span>
              {manager && (
                <span className="access-meta-chip" title="Direct reporting manager">
                  Manager: {manager.displayName}
                </span>
              )}
              {edge && (
                <span className="access-meta-chip" title="Organizational unit">
                  {organization?.nodes.find(node => node.id === (edge.teamId ?? edge.departmentId))
                    ?.name ?? 'Assigned unit'}
                </span>
              )}
              <span className="access-meta-chip highlight">
                {person.roleIds.length}{' '}
                {person.roleIds.length === 1 ? 'additional template' : 'additional templates'}
              </span>
              {person.overrides.length > 0 && (
                <span className="access-meta-chip warning">
                  {person.overrides.length}{' '}
                  {person.overrides.length === 1 ? 'override' : 'overrides'}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Tab Navigation */}
        <nav className="access-tabs-bar" aria-label="Person access sections">
          <button
            type="button"
            className={`access-tab-btn ${activeTab === 'effective' ? 'active' : ''}`}
            aria-pressed={activeTab === 'effective'}
            onClick={() => setActiveTab('effective')}
          >
            <ShieldCheck size={16} /> Effective Access
          </button>
          <button
            type="button"
            className={`access-tab-btn ${activeTab === 'roles' ? 'active' : ''}`}
            aria-pressed={activeTab === 'roles'}
            onClick={() => setActiveTab('roles')}
          >
            <Users size={16} /> Assigned access
          </button>
          <button
            type="button"
            className={`access-tab-btn ${activeTab === 'exceptions' ? 'active' : ''}`}
            aria-pressed={activeTab === 'exceptions'}
            onClick={() => setActiveTab('exceptions')}
          >
            <ShieldAlert size={16} /> Permission Exceptions ({person.overrides.length})
          </button>
          <button
            type="button"
            className={`access-tab-btn ${activeTab === 'organization' ? 'active' : ''}`}
            aria-pressed={activeTab === 'organization'}
            onClick={() => setActiveTab('organization')}
          >
            <FolderTree size={16} /> Organization
          </button>
          {canViewAudit && (
            <button
              type="button"
              className={`access-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              aria-pressed={activeTab === 'audit'}
              onClick={() => setActiveTab('audit')}
            >
              <History size={16} /> Audit History
            </button>
          )}
        </nav>

        {/* Tab 1: Effective Access */}
        {activeTab === 'effective' && (
          <div className="access-tab-content">
            <EffectiveAccess
              key={revision}
              endpoint={endpoint + '/effective/' + person.id}
              actorId={person.id}
            />
          </div>
        )}

        {/* Tab 2: Assigned Roles & Templates (With Amendment & Removal) */}
        {activeTab === 'roles' && (
          <div className="access-tab-content">
            {businessAdministrationNode && (
              <div className="access-business-admin-wrap" style={{ marginBottom: '1.25rem' }}>
                {businessAdministrationNode}
              </div>
            )}
            <div className="access-section-header">
              <div>
                <h3 className="access-section-title">Assigned Access Templates</h3>
                <p className="access-section-desc">
                  Roles bundle standard reusable permissions. Current direct-manager skill review is
                  derived by current direct-report and assigned-reviewer checks, not a role
                  template.
                </p>
              </div>
            </div>

            {/* Current Roles List */}
            <div className="access-cards-grid">
              {person.roleIds.map(roleId => {
                const roleObj = roles.find(r => r.id === roleId);
                const roleName = roleObj?.name ?? 'Custom role';
                const permissionCount = roleObj?.permissions.length ?? 0;
                return (
                  <div key={roleId} className="access-role-card">
                    <div className="access-role-card-left">
                      <div className="access-role-icon">
                        <Users size={18} />
                      </div>
                      <div>
                        <h4 className="access-role-title">{roleName}</h4>
                        <span className="access-role-sub">
                          {permissionCount} configured permission rules
                        </span>
                      </div>
                    </div>
                    {canManageUsers && (
                      <button
                        type="button"
                        className="danger-ghost-button"
                        disabled={busy}
                        onClick={() => handleRemoveRole(roleId)}
                        title={`Remove ${roleName} from ${person.displayName}`}
                      >
                        <Trash2 size={14} /> Remove role
                      </button>
                    )}
                  </div>
                );
              })}
              {!person.roleIds.length && (
                <div className="access-empty-card">
                  <Info size={18} />
                  <p>
                    No additional access templates assigned. Effective access shows the current
                    baseline, reporting responsibilities and applicable blocks.
                  </p>
                </div>
              )}
            </div>

            {/* Amendment Feature: Assign New Role */}
            {canManageUsers && (
              <div className="access-amend-box">
                <h4 className="access-amend-title">+ Assign New Access Template</h4>
                <div className="access-role-assign-row">
                  <select
                    className="access-select"
                    aria-label="Additional access template"
                    value={selectedRoleToAdd}
                    disabled={busy || unassignedRoles.length === 0}
                    onChange={e => setSelectedRoleToAdd(e.target.value)}
                  >
                    <option value="">
                      {unassignedRoles.length === 0
                        ? 'No supported additional templates available'
                        : 'Select role to assign…'}
                    </option>
                    {unassignedRoles.map(role => (
                      <option key={role.id} value={role.id}>
                        {role.name} ({role.permissions.length} configured rules)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !unassignedRoles.some(r => r.id === selectedRoleToAdd)}
                    onClick={handleAssignRole}
                  >
                    <Plus size={15} /> Review assignment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Permission Exceptions (Allow / Remove Feature) */}
        {activeTab === 'exceptions' && (
          <div className="access-tab-content">
            <div className="access-section-header">
              <div>
                <h3 className="access-section-title">Individual Permission Overrides</h3>
                <p className="access-section-desc">
                  An explicit <strong>ALLOW</strong> is a scoped rule; current eligibility and
                  prerequisites still apply. Explicit <strong>DENY</strong> blocks access and
                  overrides role allowances. Every exception requires a business reason and future
                  expiry date.
                </p>
              </div>
            </div>

            {/* Current Overrides List */}
            <div className="access-cards-grid">
              {person.overrides.map((override, index) => {
                const catalogueEntry = catalogue.find(c => c.code === override.permission);
                const permLabel = catalogueEntry?.label ?? override.permission;
                const isAllow = override.effect === 'ALLOW';

                return (
                  <div
                    key={override.permission + override.scope + index}
                    className="access-override-card"
                  >
                    <div className="access-override-card-body">
                      <div className="access-override-top">
                        <span className={`override-effect-pill ${isAllow ? 'allow' : 'deny'}`}>
                          {isAllow ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {override.effect}
                        </span>
                        <h4 className="access-override-title">{permLabel}</h4>
                        <span className="override-scope-pill">{override.scope.toLowerCase()}</span>
                      </div>
                      <p className="access-override-reason">
                        Reason: {override.reason || 'Legacy exception: reason missing'}
                      </p>
                      <div className="access-override-meta">
                        <span className="override-expiry">
                          <Calendar size={13} />{' '}
                          {override.validUntil
                            ? `Valid until ${new Date(override.validUntil).toLocaleString()}`
                            : 'No expiration date'}
                        </span>
                        <code className="override-code">{override.permission}</code>
                      </div>
                    </div>
                    {canManageUsers && (
                      <button
                        type="button"
                        className="danger-ghost-button"
                        disabled={busy}
                        onClick={() => handleRemoveOverride(index)}
                        title={`Remove ${override.permission} override`}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                );
              })}
              {!person.overrides.length && (
                <div className="access-empty-card">
                  <Info size={18} />
                  <p>
                    No individual permission exceptions configured. Standard template and reporting
                    policies apply.
                  </p>
                </div>
              )}
            </div>

            {/* Amendment Feature: Add / Amend Permission Override */}
            {canManageUsers && assignablePermissions.length === 0 && (
              <p>
                No direct exception permissions are available. Scoped Business Analytics and Admin
                responsibilities are managed under Assigned access.
              </p>
            )}
            {canManageUsers && assignablePermissions.length > 0 && (
              <form onSubmit={handleSaveOverride} className="access-amend-box access-override-form">
                <h4 className="access-amend-title">+ Add or Amend Permission Exception</h4>
                <p className="access-amend-help">
                  Configure an explicit Allow or Deny permission override with mandatory audit
                  reason and expiry date.
                </p>

                <div className="access-form-grid">
                  {/* Permission Selection */}
                  <label className="access-field">
                    <span>Permission</span>
                    <select
                      className="access-select"
                      value={selection.permission?.code ?? ''}
                      onChange={e => {
                        setNewPermission(e.target.value);
                        const selectedItem = assignablePermissions.find(
                          c => c.code === e.target.value,
                        );
                        if (selectedItem?.scopes && !selectedItem.scopes.includes(newScope)) {
                          setNewScope(selectedItem.scopes[0]);
                        }
                      }}
                    >
                      {assignablePermissions.map(cat => (
                        <option key={cat.code} value={cat.code}>
                          {cat.label} ({cat.code})
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Effect Selection: Allow vs Deny */}
                  <label className="access-field">
                    <span>Permission effect</span>
                    <select
                      className="access-select"
                      value={newEffect}
                      onChange={e => setNewEffect(e.target.value as 'ALLOW' | 'DENY')}
                    >
                      <option value="ALLOW">ALLOW (Grant permission)</option>
                      <option value="DENY">DENY (Block permission)</option>
                    </select>
                  </label>

                  {/* Scope Selection */}
                  <label className="access-field">
                    <span>Target scope</span>
                    <select
                      className="access-select"
                      value={selection.scope ?? ''}
                      onChange={e => setNewScope(e.target.value as 'OWN' | 'ORGANIZATION')}
                    >
                      {supportedScopes.map(sc => (
                        <option key={sc} value={sc}>
                          {sc === 'OWN'
                            ? 'Own records (OWN)'
                            : 'Entire organization (ORGANIZATION)'}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* Expiry Date */}
                  <label className="access-field">
                    <span>Expiry date (your local time)</span>
                    <input
                      type="date"
                      required
                      className="access-input"
                      value={newExpiry}
                      onChange={e => setNewExpiry(e.target.value)}
                    />
                  </label>

                  {/* Business Reason */}
                  <label className="access-field full-width">
                    <span>Business reason (Mandatory for audit compliance)</span>
                    <input
                      required
                      maxLength={200}
                      className="access-input"
                      placeholder="e.g. Special audit requirement, project verification authority"
                      value={newReason}
                      onChange={e => setNewReason(e.target.value)}
                    />
                  </label>
                </div>

                <div className="access-form-actions">
                  <button type="submit" className="primary-button" disabled={busy}>
                    <ShieldCheck size={16} /> Review exception
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Tab 4: Organization Context */}
        {activeTab === 'organization' && (
          <div className="access-tab-content">
            <EmploymentSummary value={person} />
            <div className="access-person-context">
              <div>
                <small>Direct reporting manager</small>
                <strong>
                  {manager?.displayName ??
                    (organization ? 'Not assigned' : 'Organization details unavailable')}
                </strong>
                {manager?.employeeCode && <span>ID: {manager.employeeCode}</span>}
              </div>
              <div>
                <small>Department / Assigned Unit</small>
                <strong>
                  {organization?.nodes.find(
                    node => node.id === (edge?.teamId ?? edge?.departmentId),
                  )?.name ?? (organization ? 'Not assigned' : 'Unavailable')}
                </strong>
              </div>
            </div>
            {canManageUsers && onManageOrganization && (
              <button type="button" className="secondary-button" onClick={onManageOrganization}>
                Manage reporting & membership
              </button>
            )}
          </div>
        )}

        {/* Tab 5: Audit History */}
        {activeTab === 'audit' && canViewAudit && (
          <div className="access-tab-content">
            <AccessAudit
              key={person.id + revision}
              endpoint={endpoint}
              personId={person.id}
              revision={revision}
            />
          </div>
        )}
      </div>
    </FormDialog>
  );
}
