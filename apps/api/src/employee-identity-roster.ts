interface Employee {
  employeeCode: string;
  workEmail: string;
}

export const directoryId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validEmail = /^[a-z0-9.!_+'%-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export function identityRoster(input: unknown): Employee[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000)
    throw Error('Provide a roster batch with 1–1000 employees.');
  const employees: Employee[] = input.map((row, index) => {
    const employeeCode = typeof row?.employeeCode === 'string' ? row.employeeCode.trim() : '';
    const workEmail = typeof row?.workEmail === 'string' ? row.workEmail.trim().toLowerCase() : '';
    if (
      !employeeCode ||
      employeeCode.length > 40 ||
      workEmail.length > 254 ||
      !validEmail.test(workEmail)
    )
      throw Error('Invalid employee code or work email at roster row ' + (index + 1) + '.');
    return { employeeCode, workEmail };
  });
  if (
    new Set(employees.map(row => row.employeeCode.toLowerCase())).size !== employees.length ||
    new Set(employees.map(row => row.workEmail)).size !== employees.length
  )
    throw Error('Roster has duplicate employee codes or work emails.');
  return employees.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

export async function resolveEmployeeIdentities(
  employees: Employee[],
  getToken: () => Promise<string>,
  transport = fetch,
) {
  const mappings: { employeeCode: string; objectId: string }[] = [];
  const objectIds = new Set<string>();
  for (const { employeeCode, workEmail } of employees) {
    const url = new URL('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(workEmail));
    url.searchParams.set('$select', 'id,userPrincipalName,userType,employeeId,accountEnabled');
    const response = await transport(url, {
      headers: { Authorization: 'Bearer ' + (await getToken()) },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(
        'Directory lookup returned HTTP ' + response.status + ' for employee ' + employeeCode + '.',
      );
    const user = await response.json();
    if (
      typeof user?.id !== 'string' ||
      !directoryId.test(user.id) ||
      user.id === '00000000-0000-0000-0000-000000000000' ||
      user.userType !== 'Member' ||
      user.accountEnabled !== true ||
      typeof user.userPrincipalName !== 'string' ||
      user.userPrincipalName.toLowerCase() !== workEmail ||
      (user.employeeId != null && user.employeeId !== employeeCode)
    )
      throw Error('Directory identity could not be confirmed for employee ' + employeeCode + '.');
    const objectId = user.id.toLowerCase();
    if (objectIds.has(objectId)) throw Error('Directory identity matched more than one employee.');
    objectIds.add(objectId);
    mappings.push({ employeeCode, objectId });
  }
  return mappings;
}
