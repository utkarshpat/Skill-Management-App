import { AccessError } from '../../shared/errors.js';
export type WorkflowKind = 'REQUEST' | 'INCIDENT';
export const workflowCategories = [
  'LEARNING',
  'SKILL',
  'ASSESSMENT',
  'PROJECT',
  'PROFILE_ACCESS',
  'OTHER',
] as const;
export type WorkflowCategory = (typeof workflowCategories)[number];
export interface WorkflowFilters {
  query: string;
  kind: string;
  status: string;
  priority: string;
  category: string;
}
export interface WorkflowSummary {
  total: number;
  submitted: number;
  cancelled: number;
  inProgress?: number;
  resolved?: number;
  incidents: number;
  highPriority: number;
  myTotal: number;
  assignedTotal: number;
}
export interface WorkflowRecord {
  id: string;
  reference?: string;
  category?: WorkflowCategory;
  kind: WorkflowKind;
  title: string;
  description: string;
  priority: 'NORMAL' | 'HIGH';
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';
  revision: number;
  requesterId: string;
  requesterName: string;
  recipientId: string;
  recipientName: string;
  createdAt: string;
  updatedAt: string;
  canComment: boolean;
  canCancel: boolean;
  canStart?: boolean;
  canResolve?: boolean;
  canReassign?: boolean;
}
export interface WorkflowEvent {
  id: string;
  action: string;
  body: string;
  actorName: string;
  at: string;
  revision: number;
}
export interface WorkflowOptions {
  canRequest: boolean;
  canIncident: boolean;
  recipients: { id: string; name: string; kind: WorkflowKind; reportingManager: boolean }[];
}
export interface WorkflowStore {
  options(actor: string, query?: string): Promise<WorkflowOptions>;
  list(
    actor: string,
    page: number,
    inbox: boolean,
    filters?: WorkflowFilters,
  ): Promise<{
    items: WorkflowRecord[];
    total: number;
    page: number;
    pageSize: number;
    summary?: WorkflowSummary;
  }>;
  detail(actor: string, id: string): Promise<{ record: WorkflowRecord; events: WorkflowEvent[] }>;
  reassignmentOptions?(
    actor: string,
    id: string,
    query?: string,
  ): Promise<WorkflowOptions['recipients']>;
  change(actor: string, input: WorkflowChange): Promise<void>;
  notifications(
    actor: string,
  ): Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
}
function uuid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new AccessError(400, 'Invalid record identifier.');
  return value.toLowerCase();
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new AccessError(400, `Enter text between 1 and ${max} characters.`);
  return value.trim();
}
export type WorkflowChange =
  | {
      action: 'CREATE';
      id: string;
      kind: WorkflowKind;
      category: WorkflowCategory;
      title: string;
      description: string;
      priority: 'NORMAL' | 'HIGH';
      recipientId: string;
    }
  | {
      action: 'COMMENT' | 'CANCEL' | 'START' | 'RESOLVE';
      id: string;
      eventId: string;
      revision: number;
      body: string;
    }
  | {
      action: 'REASSIGN';
      id: string;
      eventId: string;
      revision: number;
      body: string;
      recipientId: string;
    };
export function workflowChange(input: unknown): WorkflowChange {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AccessError(400, 'Invalid workflow change.');
  const b = input as Record<string, unknown>,
    create = b.action === 'CREATE',
    fields = create
      ? ['action', 'id', 'kind', 'title', 'description', 'priority', 'recipientId']
      : [
          'action',
          'id',
          'eventId',
          'revision',
          'body',
          ...(b.action === 'REASSIGN' ? ['recipientId'] : []),
        ];
  if (
    Object.keys(b).some(k => !fields.includes(k) && !(create && k === 'category')) ||
    fields.some(k => !(k in b))
  )
    throw new AccessError(400, 'Only editable workflow fields are accepted.');
  const id = uuid(b.id);
  if (create) {
    const category = b.category ?? 'OTHER';
    if (
      !['REQUEST', 'INCIDENT'].includes(String(b.kind)) ||
      !['NORMAL', 'HIGH'].includes(String(b.priority)) ||
      !workflowCategories.includes(category as WorkflowCategory)
    )
      throw new AccessError(400, 'Choose a request type, category and priority.');
    return {
      action: 'CREATE',
      id,
      kind: b.kind as WorkflowKind,
      category: category as WorkflowCategory,
      title: text(b.title, 160),
      description: text(b.description, 2000),
      priority: b.priority as 'NORMAL' | 'HIGH',
      recipientId: uuid(b.recipientId),
    };
  }
  if (
    !['COMMENT', 'CANCEL', 'START', 'RESOLVE', 'REASSIGN'].includes(String(b.action)) ||
    !Number.isInteger(b.revision) ||
    Number(b.revision) < 1
  )
    throw new AccessError(400, 'Reload the current record before changing it.');
  const change = {
    id,
    eventId: uuid(b.eventId),
    revision: Number(b.revision),
    body: text(b.body, 1000),
  };
  if (b.action === 'REASSIGN')
    return { ...change, action: 'REASSIGN', recipientId: uuid(b.recipientId) };
  return { ...change, action: b.action as 'COMMENT' | 'CANCEL' | 'START' | 'RESOLVE' };
}
export function workflowId(value: unknown) {
  return uuid(value);
}
export function workflowPage(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value) || Number(value) < 1)
    throw new AccessError(400, 'Invalid page.');
  return Number(value);
}
export function workflowFilters(input: Record<string, unknown>): WorkflowFilters {
  if (
    Object.keys(input).some(
      k => !['page', 'inbox', 'q', 'kind', 'status', 'priority', 'category'].includes(k),
    ) ||
    (input.inbox !== undefined && input.inbox !== 'true' && input.inbox !== 'false')
  )
    throw new AccessError(400, 'Invalid list filters.');
  const choices = {
    kind: ['', 'REQUEST', 'INCIDENT'],
    status: ['', 'SUBMITTED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
    priority: ['', 'NORMAL', 'HIGH'],
    category: ['', ...workflowCategories],
  };
  const result: WorkflowFilters = { query: '', kind: '', status: '', priority: '', category: '' };
  for (const key of ['kind', 'status', 'priority', 'category'] as const) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || !choices[key].includes(value))
      throw new AccessError(400, 'Invalid ' + key + ' filter.');
    result[key] = value;
  }
  if (input.q !== undefined && (typeof input.q !== 'string' || input.q.length > 80))
    throw new AccessError(400, 'Search using up to 80 characters.');
  result.query = typeof input.q === 'string' ? input.q.trim() : '';
  return result;
}
