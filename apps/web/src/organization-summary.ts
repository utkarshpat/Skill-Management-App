export interface OrganizationSummary {
  nodes: { id: string; kind: string; name: string; parentId: string | null; active: boolean }[];
  assignments: {
    personId: string;
    departmentId: string | null;
    teamId: string | null;
    managerId?: string | null;
  }[];
}

export async function readOrganizationSummary(response: Response): Promise<OrganizationSummary> {
  const body = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(body?.error?.message ?? 'Organization details could not be loaded. Try again.');
  if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.assignments))
    throw new Error('Organization details could not be loaded. Try again.');
  return body as OrganizationSummary;
}
