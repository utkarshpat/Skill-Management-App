import { readActorAccess } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';

import {
  can,
  canReviewAssigned,
  permissionCatalogue,
  actionRegistry,
  effectiveAccessSummary,
  type AccessStore,
  type LocalAccessState,
  type LocalPerson,
} from '../access/index.js';

import type { OrganizationStore } from '../organization/index.js';

import type { WorkflowStore } from '../workflows/index.js';

import type { LearningStore } from '../learning/index.js';

import {
  teamGapArguments,
  teamGapReport,
  type ClaimsStore,
  type CatalogueStore,
} from '../skills/index.js';

import { assistantCapabilities } from './capabilities.js';

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

interface Source {
  label: string;
  url: string;
}

interface ToolContext {
  state: LocalAccessState;
  person: LocalPerson;
  signal: AbortSignal;
  args: Record<string, unknown>;
}

interface RegisteredTool {
  definition: ToolDefinition;

  permission: (state: LocalAccessState, person: LocalPerson) => boolean;

  source: Source;

  validate?: (args: unknown) => Record<string, unknown>;

  read: (context: ToolContext) => Promise<object>;
}

const definition = (name: string, description: string): ToolDefinition => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
});

function searchArguments(value: unknown, allowSkill = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(400, 'Enter valid search arguments.');

  const args = value as Record<string, unknown>;

  if (
    Object.keys(args).some(
      key => !['search', 'page', ...(allowSkill ? ['skillId'] : [])].includes(key),
    ) ||
    (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 100)) ||
    (args.page !== undefined &&
      (!Number.isSafeInteger(args.page) || Number(args.page) < 1 || Number(args.page) > 100))
  )
    throw new AccessError(400, 'Choose a valid search and page.');

  if (
    args.skillId !== undefined &&
    (typeof args.skillId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.skillId))
  )
    throw new AccessError(400, 'Choose a valid published skill.');

  return {
    search: typeof args.search === 'string' ? args.search.trim().replace(/\s+/g, ' ') : '',
    page: args.page ?? 1,
    ...(args.skillId !== undefined ? { skillId: String(args.skillId).toLowerCase() } : {}),
  };
}

const searchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    search: { type: 'string', maxLength: 100 },
    page: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

// Provider-independent tool registry and policy gateway. No tool can choose an actor,

// workspace, SQL query, URL or write action; the authenticated application supplies these.

export class ToolRegistry {
  private entries = new Map<string, RegisteredTool>();

  constructor(
    private access: AccessStore,
    organization?: OrganizationStore,
    claims?: ClaimsStore,
    catalogue?: CatalogueStore,
    learning?: LearningStore,
    workflows?: WorkflowStore,
  ) {
    this.entries.set('my_permissions', {
      definition: definition(
        'my_permissions',
        'Explain the signed-in person’s current effective own/workspace permissions. Role labels confer no authority; does not alter access.',
      ),
      permission: () => true,
      source: { label: 'Your current permissions', url: '/workspace' },

      read: async ({ state, person }) => ({
        decisions: effectiveAccessSummary(state, person)
          .decisions.filter(d => d.allowed || d.reasonCode === 'EXPLICIT_DENY')
          .map(({ action, allowed, reasonCode, resolvedScope, constraints, sources }) => ({
            action,
            allowed,
            reasonCode,
            scope: resolvedScope.kind,
            constraints,
            sources: sources.map(({ kind, label, effect, scope, validUntil }) => ({
              kind,
              label,
              effect,
              scope,
              validUntil,
            })),
          })),
        permissions: permissionCatalogue
          .filter(([code]) => can(state, person, code, true) || can(state, person, code))
          .map(([code, label]) => ({
            code,
            label,
            own: can(state, person, code, true),
            workspace: can(state, person, code),
          })),
        guide: assistantCapabilities(state, person),
      }),
    });

    this.entries.set('permission_design_options', {
      definition: definition(
        'permission_design_options',
        'Read role definitions, supported permission codes and scopes for permission design. No access changes are executed. Individual overrides and expiry must be reviewed in People.',
      ),
      permission: (state, person) => can(state, person, 'permissions.manage'),
      source: { label: 'Access templates', url: '/access?view=roles' },

      read: async ({ state }) => ({
        catalogue: actionRegistry,
        scopes: ['OWN', 'ORGANIZATION'],
        effects: ['ALLOW', 'DENY'],
        roles: state.roles.slice(0, 5).map(role => ({
          name: role.name,
          permissions: role.permissions.slice(0, 20),
          totalPermissions: role.permissions.length,
          hasMore: role.permissions.length > 20,
        })),
        hasMore: state.roles.length > 5,
        save: 'Review and save explicitly in Access templates. DENY and expiry affect effective access. Permission codes for future modules do not make those modules implemented.',
      }),
    });

    if (workflows) {
      this.entries.set('my_requests', {
        definition: {
          type: 'function',
          function: {
            name: 'my_requests',
            description:
              'Read your own requests or explicit recipient inbox, ten results/page. Cannot choose another actor or workspace. Filters and counts use current participant access.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                search: { type: 'string', maxLength: 80 },
                page: { type: 'integer', minimum: 1, maximum: 100 },
                inbox: { type: 'boolean' },
              },
            },
          },
        },

        permission: (state, person) =>
          can(state, person, 'request.view', true) || can(state, person, 'incident.view', true),
        source: { label: 'Your requests and incidents', url: '/requests' },

        validate: value => {
          const a = value as Record<string, unknown>;
          if (
            !a ||
            Array.isArray(a) ||
            Object.keys(a).some(k => !['search', 'page', 'inbox'].includes(k)) ||
            (a.inbox !== undefined && typeof a.inbox !== 'boolean') ||
            (a.search !== undefined && (typeof a.search !== 'string' || a.search.length > 80))
          )
            throw new AccessError(400, 'Invalid request search.');
          const { inbox, ...search } = a;
          return { ...searchArguments(search), inbox: inbox ?? false };
        },

        read: async ({ person, args }) => {
          const result = await workflows.list(person.id, Number(args.page), Boolean(args.inbox), {
            query: String(args.search),
            kind: '',
            status: '',
            priority: '',
            category: '',
          });
          return {
            ...result,
            items: result.items.map(r => ({
              id: r.id,
              reference: r.reference,
              category: r.category,
              kind: r.kind,
              title: r.title,
              status: r.status,
              priority: r.priority,
              requester: r.requesterName,
              recipient: r.recipientName,
            })),
            hasMore: result.page * result.pageSize < result.total,
          };
        },
      });

      this.entries.set('request_detail', {
        definition: {
          type: 'function',
          function: {
            name: 'request_detail',
            description:
              'Read a request/incident you own or explicitly received, by ID returned from my_requests. Current participant authority is rechecked by the workflow store.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['id'],
              properties: { id: { type: 'string', format: 'uuid' } },
            },
          },
        },

        permission: (state, person) =>
          can(state, person, 'request.view', true) || can(state, person, 'incident.view', true),
        source: { label: 'Your request activity', url: '/requests' },

        validate: value => {
          const a = value as Record<string, unknown>;
          if (
            !a ||
            Array.isArray(a) ||
            Object.keys(a).length !== 1 ||
            typeof a.id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id)
          )
            throw new AccessError(400, 'Choose an available request.');
          return { id: a.id };
        },

        read: async ({ person, args }) => {
          const d = await workflows.detail(person.id, String(args.id));
          return {
            record: {
              reference: d.record.reference,
              title: d.record.title,
              description: d.record.description.slice(0, 600),
              descriptionShortened: d.record.description.length > 600,
              kind: d.record.kind,
              status: d.record.status,
              category: d.record.category,
              recipient: d.record.recipientName,
              canComment: d.record.canComment,
              canCancel: d.record.canCancel,
              canStart: d.record.canStart,
              canResolve: d.record.canResolve,
              canReassign: d.record.canReassign,
            },
            events: d.events.slice(-3).map(e => ({
              action: e.action,
              body: e.body.slice(0, 300),
              actor: e.actorName,
              at: e.at,
            })),
            totalEvents: d.events.length,
          };
        },
      });

      this.entries.set('request_recipients', {
        definition: {
          type: 'function',
          function: {
            name: 'request_recipients',
            description:
              'Search eligible recipients by name for the signed-in requester; returns real IDs, names, supported kinds and actual reporting-manager flag. Names do not prove administrator/department authority.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: { search: { type: 'string', maxLength: 100 } },
            },
          },
        },

        validate: value => {
          const a = value as Record<string, unknown>;
          if (!a || Array.isArray(a) || Object.keys(a).some(k => k !== 'search'))
            throw new AccessError(400, 'Invalid recipient search.');
          return searchArguments(a);
        },

        permission: (state, person) => {
          const c = assistantCapabilities(state, person);
          return c.canDraftRequest || c.canDraftIncident;
        },
        source: { label: 'Named request recipients', url: '/requests' },

        read: async ({ person, args }) => workflows.options(person.id, String(args.search)),
      });
    }

    this.entries.set('workspace_guide', {
      definition: definition(
        'workspace_guide',
        'Get current permitted pages, action guides and explicitly pending workflows. Role labels never authorize actions.',
      ),

      permission: () => true,
      source: { label: 'Your permitted workspace actions', url: '/workspace' },

      read: async ({ state, person }) => assistantCapabilities(state, person),
    });

    this.entries.set('own_profile', {
      definition: definition(
        'own_profile',
        "Read the signed-in person's own work information, primary capability and role labels. Descriptive only; not verified proficiency or authority. The full completeness checklist is on My profile.",
      ),

      permission: () => true,
      source: { label: 'My profile', url: '/profile' },

      read: async ({ state, person }) => ({
        displayName: person.displayName,
        employeeCode: person.employeeCode,
        jobTitle: person.jobTitle,
        grade: person.grade,
        primaryCapabilityId: person.primaryCapabilityId,
        primaryCapabilityName: person.primaryCapabilityName,
        primaryCapabilityStatus: person.primaryCapabilityStatus,
        roles: state.roles.filter(role => person.roleIds.includes(role.id)).map(role => role.name),
        policy:
          'Work information, capability selection and role labels do not establish proficiency or authority. Missing or archived capability needs administrator review. See My profile for the server-derived completeness checklist.',
        source: 'My profile',
      }),
    });

    if (organization)
      this.entries.set('workspace_summary', {
        definition: definition(
          'workspace_summary',
          'Read workspace people, role and department counts, if administration is permitted.',
        ),

        permission: (state, person) =>
          can(state, person, 'permissions.manage') && can(state, person, 'users.manage'),
        source: { label: 'Workspace summary', url: '/access?view=overview' },

        read: async ({ state }) => {
          const structure = await organization.snapshot();
          return {
            people: state.people.length,
            activePeople: state.people.filter(item => item.active).length,
            roles: state.roles.length,
            departments: structure.nodes.filter(node => node.active && node.kind === 'DEPARTMENT')
              .length,
            source: 'Workspace summary',
          };
        },
      });

    if (learning)
      this.entries.set('my_learning_task', {
        definition: {
          type: 'function',
          function: {
            name: 'my_learning_task',
            description:
              'Read one exact task from your own saved learning plan. Use the supplied planId/taskId rather than matching titles. Read-only: cannot complete, reschedule, save or select another person.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['planId', 'taskId'],
              properties: {
                planId: { type: 'string', format: 'uuid' },
                taskId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
        validate: value => {
          const args = value as Record<string, unknown>;
          if (
            !args ||
            typeof args !== 'object' ||
            Array.isArray(args) ||
            Object.keys(args).some(k => !['planId', 'taskId'].includes(k)) ||
            ['planId', 'taskId'].some(
              k =>
                typeof args[k] !== 'string' ||
                !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(args[k])),
            )
          )
            throw new AccessError(400, 'Choose a valid learning task.');
          return {
            planId: String(args.planId).toLowerCase(),
            taskId: String(args.taskId).toLowerCase(),
          };
        },
        permission: (state, person) => can(state, person, 'learning.view', true),
        source: { label: 'Your selected learning task', url: '/learning' },
        read: async ({ person, args }) => {
          const own = await learning.read(person.id),
            plan = own.plans.find(p => p.id.toLowerCase() === args.planId),
            task = plan?.tasks.find(t => t.id.toLowerCase() === args.taskId);
          if (!plan || !task) throw new AccessError(404, 'This learning task is unavailable.');
          return {
            plan: {
              id: plan.id,
              title: plan.title,
              goal: plan.goal.slice(0, 500),
              status: plan.status,
              timezone: plan.timezone,
              skillName: plan.skillName,
            },
            task: {
              id: task.id,
              title: task.title,
              plannedDate: task.plannedDate,
              estimatedMinutes: task.estimatedMinutes,
              completedAt: task.completedAt,
            },
            canManage: own.canManage && plan.status === 'ACTIVE',
            source: 'Your selected learning task',
          };
        },
      });
    if (learning)
      this.entries.set('my_learning', {
        definition: definition(
          'my_learning',
          'Read a compact summary of your own learning plans and pending tasks. Cannot select another person, log completion or save a plan.',
        ),

        permission: (state, person) => can(state, person, 'learning.view', true),
        source: { label: 'Your learning plans', url: '/learning' },

        read: async ({ person }) => {
          const result = await learning.read(person.id);
          return {
            totalPlans: result.plans.length,
            canManage: result.canManage,
            plans: result.plans.slice(0, 5).map(plan => ({
              title: plan.title,
              goal: plan.goal.slice(0, 300),
              focus: plan.focus,
              skillName: plan.skillName,
              status: plan.status,
              timezone: plan.timezone,
              targetDate: plan.targetDate,
              dailyMinutes: plan.dailyMinutes,
              completed: plan.tasks.filter(task => task.completedAt).length,
              totalTasks: plan.tasks.length,
              pendingTasks: plan.tasks
                .filter(task => !task.completedAt)
                .slice(0, 5)
                .map(task => ({
                  title: task.title,
                  plannedDate: task.plannedDate,
                  estimatedMinutes: task.estimatedMinutes,
                })),
            })),
            hasMore: result.plans.length > 5,
            source: 'Your learning plans',
          };
        },
      });

    if (claims)
      this.entries.set('my_skills', {
        definition: definition(
          'my_skills',
          'Read your own skill claim totals and a bounded first-page preview. Manager-reviewed, pending, draft, changes-requested and rejected states are distinct. No other person can be selected.',
        ),
        permission: (state, person) => can(state, person, 'skill.view', true),
        source: { label: 'My skill claims', url: '/my-skills' },
        read: async ({ person }) => {
          const [own, summary] = await Promise.all([
            claims.read(person.id, 1),
            claims.summary?.(person.id),
          ]);
          return {
            total: own.total,
            summary,
            page: own.page,
            pageSize: own.pageSize,
            canClaim: own.canClaim,
            hasMore: own.total > own.pageSize,
            skills: own.claims.map(claim => ({
              skill: claim.skillName,
              proficiency: claim.levelName,
              status: claim.status,
              verification: claim.status === 'APPROVED' ? 'MANAGER_REVIEWED' : 'UNVERIFIED',
            })),
            source: 'My skill claims',
          };
        },
      });

    if (claims?.reviews)
      this.entries.set('assigned_skill_reviews', {
        definition: definition(
          'assigned_skill_reviews',
          'Read a compact summary of your pending assigned skill reviews, limited to your current direct reports. Cannot choose another reviewer or approve anything.',
        ),

        permission: (state, person) => canReviewAssigned(state, person),
        source: { label: 'Assigned skill reviews', url: '/skill-reviews' },

        read: async ({ person }) => {
          const queue = await claims.reviews!(person.id, 1);
          return {
            total: queue.total,
            page: queue.page,
            hasMore: queue.total > queue.pageSize,
            claims: queue.claims.slice(0, 10).map(claim => ({
              skill: claim.skillName,
              person: claim.personName,
              proficiency: claim.levelName,
              status: claim.status,
            })),
            source: 'Assigned skill reviews',
          };
        },
      });

    if (claims?.team)
      this.entries.set('team_skill_gaps', {
        definition: {
          type: 'function',
          function: {
            name: 'team_skill_gaps',
            description:
              'Analyse your current active direct reports’ manager-reviewed skill coverage. Pass the manager’s stated demand as requirements (skill name, minimum level 1-5, headcount) to get who qualifies, shortfall and people one level below. Without requirements, returns team skill strengths, level mix and thinnest coverage. Requirements are not saved. Cannot choose another manager, person or workspace.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                search: {
                  type: 'string',
                  maxLength: 100,
                  description: 'Optional name or employee-code filter within your direct reports.',
                },
                requirements: {
                  type: 'array',
                  maxItems: 10,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['skill', 'level'],
                    properties: {
                      skill: { type: 'string', maxLength: 80 },
                      level: { type: 'integer', minimum: 1, maximum: 5 },
                      headcount: { type: 'integer', minimum: 1, maximum: 500 },
                    },
                  },
                },
              },
            },
          },
        },
        validate: teamGapArguments,
        permission: (state, person) =>
          can(state, person, 'skill.view') && canReviewAssigned(state, person),
        source: { label: 'Team capability · direct reports', url: '/skill-reviews' },
        read: async ({ state, person, args }) => {
          const team = await claims.team!(person.id, {
            search: String(args.search),
            page: 1,
            person: undefined,
          });
          if (!team.analytics)
            throw new AccessError(
              503,
              'Full-team analytics are unavailable. Refresh team capability and retry.',
            );
          const after = await this.access.snapshot({ includeAudit: false });
          if (after.revision !== state.revision)
            throw new AccessError(409, 'Team assignments changed. Ask again for current results.');
          const names = new Map(after.people.map(p => [p.id.toLowerCase(), p.displayName]));
          return {
            ...teamGapReport(
              team.analytics,
              args.requirements as Parameters<typeof teamGapReport>[1],
              id => names.get(id) ?? 'Direct report',
            ),
            search: String(args.search) || 'All direct reports',
            source: 'Team capability · direct reports',
          };
        },
      });

    if (catalogue)
      this.entries.set('catalogue_search', {
        definition: {
          type: 'function',
          function: {
            name: 'catalogue_search',
            description:
              'Search published skills by name/category, 25 compact results per page. No drafts/archived skills or arbitrary people. Use full proficiency criteria before suggesting a level.',
            parameters: searchSchema,
          },
        },

        validate: args => searchArguments(args),

        permission: (state, person) =>
          can(state, person, 'skill.view') || can(state, person, 'skill.catalogue.manage'),
        source: { label: 'Published skill catalogue', url: '/skills' },

        read: async ({ person, args }) => {
          const result = await catalogue.read(person.id, {
            search: String(args.search),
            page: Number(args.page),
            status: 'PUBLISHED',
          });
          return {
            revision: result.revision,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            hasMore: result.page * result.pageSize < result.total,
            skills: result.skills
              .filter(skill => skill.status === 'PUBLISHED')
              .map(skill => ({
                id: skill.id,
                name: skill.name,
                category: skill.category,
                proficiencyLevels: skill.levels.length,
              })),
            source: 'Published skill catalogue',
          };
        },
      });

    if (claims)
      this.entries.set('skill_claim_options', {
        definition: {
          type: 'function',
          function: {
            name: 'skill_claim_options',
            description:
              "Search published skills eligible for your own skill draft (5 options/page). Pass an option skillId with the same search/page to read that skill's full proficiency criteria. Never invent levels or personal experience. This does not save anything.",
            parameters: {
              ...searchSchema,
              properties: {
                ...searchSchema.properties,
                skillId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },

        validate: args => searchArguments(args, true),

        permission: (state, person) => assistantCapabilities(state, person).canDraftOwnSkill,
        source: { label: 'My skills · Published choices and criteria', url: '/my-skills' },

        read: async ({ person, args }) => {
          const result = await claims.options(person.id, String(args.search), Number(args.page));
          const selected = args.skillId
            ? result.skills.find(skill => skill.id.toLowerCase() === args.skillId)
            : undefined;
          if (args.skillId && !selected)
            throw new AccessError(
              404,
              'Skill is unavailable in these published choices. Search again.',
            );
          return {
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            hasMore: result.page * result.pageSize < result.total,
            skills: result.skills.map(skill => ({
              id: skill.id,
              name: skill.name,
              category: skill.category,
              proficiencyLevels: skill.levels.length,
            })),
            ...(selected
              ? {
                  selectedSkill: {
                    id: selected.id,
                    name: selected.name,
                    category: selected.category,
                    definitionRevision: selected.definitionRevision,
                    levels: selected.levels.map(level => ({
                      rank: level.rank,
                      name: level.name,
                      description: level.description,
                    })),
                  },
                }
              : {}),
            source: 'My skills · Published choices and criteria',
          };
        },
      });
  }

  permits(state: LocalAccessState, person: LocalPerson, name: string): boolean {
    return (
      person.active &&
      can(state, person, 'profile.view', true) &&
      Boolean(this.entries.get(name)?.permission(state, person))
    );
  }

  available(state: LocalAccessState, person: LocalPerson): ToolDefinition[] {
    return [...this.entries.values()]
      .filter(tool => this.permits(state, person, tool.definition.function.name))
      .map(tool => tool.definition);
  }

  async execute(
    actorId: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<{ data: object; source: Source }> {
    const tool = this.entries.get(name);

    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      (!tool?.validate && Object.keys(args).length)
    )
      throw new AccessError(400, 'Assistant tools cannot choose another person or workspace.');

    const validated = tool?.validate ? tool.validate(args) : {};

    const check = async () => {
      signal.throwIfAborted();

      const state = await (['permission_design_options', 'workspace_summary'].includes(name)
          ? this.access.snapshot({ includeAudit: false })
          : readActorAccess(this.access, actorId)),
        person = state.people.find(item => item.id === actorId);

      if (!tool || !person || !this.permits(state, person, name))
        throw new AccessError(403, 'Current permission does not allow this assistant action.');

      return { state, person, signal, args: validated };
    };

    const context = await check();

    const data = await tool!.read(context);

    await check(); // Revocation during retrieval must prevent context reaching the model.

    return { data, source: tool!.source };
  }
}
