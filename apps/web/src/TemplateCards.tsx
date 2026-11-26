import { useState } from 'react';
import { ShieldCheck, BarChart3, Pencil, UserRound, Users } from 'lucide-react';
import type { FeatureTemplate } from './business/BusinessAdministration';
import {
  availableBundles,
  bundleSelected,
  type TemplatePermission,
} from './template-permission-bundles';

interface Role {
  id: string;
  name: string;
  permissions: TemplatePermission[];
}
interface Person {
  id: string;
  roleIds: string[];
}
export function TemplateCards({
  roles,
  people,
  catalogue,
  onEdit,
  onAssignments,
  onAssignPerson,
  onScopedAssignments,
  onEditModules,
  featureEditor,
  busy,
  canManagePeople,
  canManageScoped,
}: {
  roles: Role[];
  people: Person[];
  catalogue: Parameters<typeof availableBundles>[0];
  onEdit: (role: Role) => void;
  onAssignments: () => void;
  onAssignPerson: () => void;
  onScopedAssignments: () => void;
  onEditModules: (template: FeatureTemplate) => void;
  featureEditor?: FeatureTemplate;
  busy: boolean;
  canManagePeople: boolean;
  canManageScoped: boolean;
}) {
  const [query, setQuery] = useState('');
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const bundles = availableBundles(catalogue);
  const editModules = (template: FeatureTemplate, label: string) => (
    <button
      className="secondary-button"
      disabled={busy}
      aria-expanded={featureEditor === template}
      onClick={() => onEditModules(template)}
    >
      <Pencil size={15} />{' '}
      {featureEditor === template ? 'Close ' + label.toLowerCase() + ' settings' : 'Edit ' + label}
    </button>
  );
  return (
    <section className="template-workspace" aria-label="Access templates">
      <div className="template-toolbar">
        <h2>{roles.length + 3} templates</h2>
        <label className="list-search">
          <input
            type="search"
            aria-label="Search templates"
            placeholder="Search templates…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="template-card-grid">
        {matches('Employee') && (
          <article className="template-card">
            <UserRound size={24} aria-hidden="true" />
            <h3>Employee</h3>
            <p>Own profile, skill catalogue and personal skill and certification claims.</p>
            <p className="template-note">Applies automatically to active employees when enabled.</p>
            {canManageScoped && (
              <div className="template-card-actions">
                {editModules('EMPLOYEE', 'Employee access')}
              </div>
            )}
          </article>
        )}
        {matches('Business Analytics') && (
          <article className="template-card">
            <BarChart3 size={24} aria-hidden="true" />
            <h3>Business Analytics</h3>
            <p>Analytics, scoped exports and announcement publishing.</p>
            <span className="template-bundle-tag">Business Analytics bundle</span>
            <p className="template-note">
              Select a Delivery Unit, Portfolio, Account / Client or Business project at assignment
              time.
            </p>
            {canManageScoped && (
              <div className="template-card-actions">
                <button className="admin-primary" disabled={busy} onClick={onAssignPerson}>
                  Assign template
                </button>
                <button className="secondary-button" disabled={busy} onClick={onScopedAssignments}>
                  <Pencil size={15} /> Edit assignments
                </button>
                {editModules('BUSINESS_OPERATIONS', 'Business Analytics modules')}
              </div>
            )}
          </article>
        )}
        {matches('Admin') && (
          <article className="template-card">
            <ShieldCheck size={24} aria-hidden="true" />
            <h3>Admin</h3>
            <p>People and access, catalogue, audit, analytics and announcement publishing.</p>
            <span className="template-bundle-tag">Admin bundle</span>
            <p className="template-note">
              Administration applies to the workspace. Announcement audiences are selected when
              publishing.
            </p>
            {canManageScoped && (
              <div className="template-card-actions">
                <button className="admin-primary" disabled={busy} onClick={onAssignPerson}>
                  Assign template
                </button>
                <button className="secondary-button" disabled={busy} onClick={onScopedAssignments}>
                  <Pencil size={15} /> Edit assignments
                </button>
                {editModules('SYSTEM_ADMIN', 'Admin modules')}
              </div>
            )}
          </article>
        )}
        {roles
          .filter(role => matches(role.name))
          .map(role => {
            const assigned = people.filter(person => person.roleIds.includes(role.id)).length;
            const selectedBundles = bundles.filter(bundle =>
              bundleSelected(role.permissions, bundle.permissions),
            );
            const covered = new Set(
              selectedBundles.flatMap(bundle =>
                bundle.permissions.map(item => item.permission + ':' + item.scope),
              ),
            );
            const additional = role.permissions.filter(
              permission => !covered.has(permission.permission + ':' + permission.scope),
            );
            return (
              <article className="template-card" key={role.id}>
                <ShieldCheck size={24} aria-hidden="true" />
                <h3>{role.name}</h3>
                <div className="template-bundle-tags">
                  {selectedBundles.map(bundle => (
                    <span key={bundle.id} className="template-bundle-tag">
                      {bundle.name}
                    </span>
                  ))}
                  {additional.length > 0 && (
                    <span className="template-bundle-tag">
                      {additional.length} individual{' '}
                      {additional.length === 1 ? 'permission' : 'permissions'}
                    </span>
                  )}
                  {role.permissions.length === 0 && <span>No permissions selected</span>}
                </div>
                <p>
                  <Users size={15} aria-hidden="true" /> {assigned} assigned{' '}
                  {assigned === 1 ? 'person' : 'people'}
                </p>
                <div className="template-card-actions">
                  <button className="secondary-button" disabled={busy} onClick={() => onEdit(role)}>
                    <Pencil size={15} /> Edit template {role.name}
                  </button>
                  {canManagePeople && (
                    <button className="secondary-button" disabled={busy} onClick={onAssignments}>
                      Assign template {role.name}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      {query &&
        !['Employee', 'Business Analytics', 'Admin', ...roles.map(role => role.name)].some(
          matches,
        ) && <p role="status">No matching templates.</p>}
      {canManagePeople && roles.length > 0 && (
        <button className="secondary-button" disabled={busy} onClick={onAssignments}>
          Bulk template assignments
        </button>
      )}
      <p className="template-note">Manager access follows current direct reporting assignments.</p>
    </section>
  );
}
