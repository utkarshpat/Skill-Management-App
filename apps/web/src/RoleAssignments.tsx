import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { FormDialog } from './FormDialog';
interface Person {
  id: string;
  displayName: string;
  employeeCode: string;
  active: boolean;
  roleIds: string[];
}
interface Role {
  id: string;
  name: string;
}
type Draft = Record<string, string[]>;
export function RoleAssignments({
  people,
  roles,
  departments,
  membership,
  department,
  onDepartmentChange,
  draft,
  setDraft,
  busy,
  canManage,
  onSave,
  actionsContainer,
  message,
}: {
  people: Person[];
  roles: Role[];
  departments: { id: string; name: string }[];
  membership: Record<string, string | undefined>;
  department: string;
  onDepartmentChange: (id: string) => void;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  busy: boolean;
  canManage: boolean;
  onSave: () => void;
  actionsContainer: HTMLElement | null;
  message?: ReactNode;
}) {
  const [search, setSearch] = useState(''),
    [open, setOpen] = useState(false),
    [personPage, setPersonPage] = useState(0),
    [rolePage, setRolePage] = useState(0);
  const visible = people.filter(
    person =>
      (person.displayName + ' ' + person.employeeCode)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!department || membership[person.id] === department),
  );
  const effectivePage = Math.min(personPage, Math.max(0, Math.ceil(visible.length / 3) - 1));
  const filters = (
    <div className="catalogue-filters">
      <label className="list-search">
        <input
          aria-label="Search role assignments"
          placeholder="Search people…"
          disabled={busy}
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setPersonPage(0);
          }}
        />
      </label>
      <label className="department-filter">
        Department
        <select
          disabled={busy}
          value={department}
          onChange={event => {
            onDepartmentChange(event.target.value);
            setPersonPage(0);
          }}
        >
          <option value="">All people</option>
          {departments.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  function matrix(editable: boolean) {
    const shownPeople = editable
        ? visible.slice(effectivePage * 3, effectivePage * 3 + 3)
        : visible,
      shownRoles = editable ? roles.slice(rolePage * 3, rolePage * 3 + 3) : roles;
    return (
      <table className={editable ? 'dialog-table assignment-table' : ''}>
        <thead>
          <tr>
            <th scope="col">Person</th>
            {shownRoles.map(role => (
              <th scope="col" key={role.id}>
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownPeople.map(person => (
            <tr key={person.id}>
              <th scope="row">
                <strong>{person.displayName}</strong>
                <small>
                  {person.employeeCode}
                  {!person.active ? ' · Suspended' : ''}
                </small>
              </th>
              {shownRoles.map(role => (
                <td key={role.id}>
                  <input
                    type="checkbox"
                    disabled={!editable || busy}
                    aria-label={
                      (editable ? 'Assign ' : 'Current ') + role.name + ' to ' + person.displayName
                    }
                    checked={(editable
                      ? (draft[person.id] ?? person.roleIds)
                      : person.roleIds
                    ).includes(role.id)}
                    onChange={event =>
                      setDraft(current => {
                        const ids = current[person.id] ?? person.roleIds,
                          next = event.target.checked
                            ? [...ids, role.id]
                            : ids.filter(id => id !== role.id),
                          result = { ...current };
                        if (
                          JSON.stringify([...next].sort()) ===
                          JSON.stringify([...person.roleIds].sort())
                        )
                          delete result[person.id];
                        else result[person.id] = next;
                        return result;
                      })
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <>
      {actionsContainer &&
        canManage &&
        createPortal(
          <button
            className="admin-primary"
            disabled={busy}
            onClick={() => {
              setPersonPage(0);
              setRolePage(0);
              setOpen(true);
            }}
          >
            Edit assignments
          </button>,
          actionsContainer,
        )}
      <section className="profile-panel">
        {filters}
        <div className="audit-scroll assignment-matrix">{matrix(false)}</div>
        {!visible.length && <p>No matching people.</p>}
      </section>
      {open && (
        <FormDialog
          title="Role assignments"
          message={message}
          busy={busy}
          onClose={() => setOpen(false)}
          footer={
            <>
              <span>{Object.keys(draft).length} people changed</span>
              <button className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>
                Close
              </button>
              <button
                className="microsoft-button"
                disabled={busy || !Object.keys(draft).length}
                onClick={onSave}
              >
                {busy ? 'Saving…' : 'Save assignments'}
              </button>
            </>
          }
        >
          {filters}
          <div className="compact-pagination">
            <span>
              Roles {rolePage * 3 + 1}–{Math.min(rolePage * 3 + 3, roles.length)} of {roles.length}
            </span>
            <button
              className="secondary-button"
              disabled={busy || rolePage === 0}
              onClick={() => setRolePage(value => value - 1)}
            >
              Previous roles
            </button>
            <button
              className="secondary-button"
              disabled={busy || (rolePage + 1) * 3 >= roles.length}
              onClick={() => setRolePage(value => value + 1)}
            >
              Next roles
            </button>
          </div>
          {matrix(true)}
          <div className="compact-pagination">
            <span>
              {visible.length ? effectivePage * 3 + 1 : 0}–
              {Math.min(effectivePage * 3 + 3, visible.length)} of {visible.length} people
            </span>
            <button
              className="secondary-button"
              disabled={busy || effectivePage === 0}
              onClick={() => setPersonPage(effectivePage - 1)}
            >
              Previous people
            </button>
            <button
              className="secondary-button"
              disabled={busy || (effectivePage + 1) * 3 >= visible.length}
              onClick={() => setPersonPage(effectivePage + 1)}
            >
              Next people
            </button>
          </div>
        </FormDialog>
      )}
    </>
  );
}
