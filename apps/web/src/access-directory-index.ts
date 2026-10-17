export interface DirectoryRole {
  id: string;
  name: string;
  permissions: unknown[];
}
export interface DirectoryPerson {
  id: string;
  displayName: string;
  employeeCode: string;
  active: boolean;
  roleIds: string[];
}

// Display/search data only. Authority continues to come from backend decisions.
// Walk actual assignments once instead of scanning every role for every person.
export function indexAccessDirectory(people: DirectoryPerson[], roles: DirectoryRole[]) {
  const members = new Map<string, number[]>();
  const assignedNames = people.map(() => [] as string[]);
  const roleNames = new Map<string, string>();
  people.forEach((person, index) => {
    for (const id of new Set(person.roleIds)) {
      const entries = members.get(id);
      if (entries) entries.push(index);
      else members.set(id, [index]);
    }
  });
  const indexedRoles = roles.map(role => {
    if (!roleNames.has(role.id)) roleNames.set(role.id, role.name);
    const assigned = members.get(role.id) ?? [];
    for (const index of assigned) assignedNames[index].push(role.name);
    return {
      role,
      text: role.name.toLocaleLowerCase(),
      assignedPeople: assigned.length,
    };
  });
  return {
    people: people.map((person, index) => ({
      person,
      text: (
        person.displayName +
        ' ' +
        person.employeeCode +
        ' ' +
        assignedNames[index].join(' ')
      ).toLocaleLowerCase(),
    })),
    roles: indexedRoles,
    roleNames,
    memberCounts: new Map(
      indexedRoles.map(({ role, assignedPeople }) => [role.id, assignedPeople]),
    ),
  };
}
