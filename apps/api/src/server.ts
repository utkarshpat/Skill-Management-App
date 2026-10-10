import { SqlBusinessStore } from './modules/business/index.js';
import { SqlAiBudget } from './modules/ai/budget.js';
import { KnowledgeTransferService } from './modules/knowledge-transfer/index.js';
import { SqlRecommendationStore } from './modules/recommendations/index.js';
import { SqlOrganizationStore } from './modules/organization/sql-store.js';
import { createApp } from './create-app.js';
import { SqlWorkflowStore } from './modules/workflows/index.js';
import { identityConfig, tokenVerifier } from './modules/identity/index.js';
import { ownProfile } from './modules/identity/index.js';
import { closeRuntimeDatabase } from './shared/database.js';
import { developmentLoginEnabled, hostedDemoConfig } from './modules/identity/index.js';
import { SqlAccessStore } from './modules/access/sql-access-store.js';
import { createEmployeeProfileReader } from './modules/identity/employee-profile.js';
import { StoredEmployeeDirectoryProvider } from './modules/identity/employee-directory.js';
import { AssistantService, configuredProvider } from './modules/ai/index.js';
import { SqlCatalogueStore } from './modules/skills/sql-store.js';
import { SqlClaimsStore } from './modules/skills/sql-claims-store.js';
import { SqlCertificationStore } from './modules/skills/sql-certification-store.js';
import { SqlCertificationRecommendationStore } from './modules/skills/sql-certification-recommendation-store.js';
import { configuredEvidence } from './modules/skills/evidence.js';
import { SqlConversationsStore } from './modules/ai/conversations.js';
import {
  SqlLearningStore,
  SqlPracticeStore,
  LearningPracticeService,
  LearningPlannerService,
  LearningRecoveryService,
  SqlRecoveryStore,
  type QuizGenerator,
} from './modules/learning/index.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be between 1 and 65535.');
const config = identityConfig(process.env);
const access = process.env.ACCESS_ACCOUNT_ID
  ? new SqlAccessStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const hostedDemo = hostedDemoConfig(process.env);
const developmentStore = hostedDemo || developmentLoginEnabled(process.env) ? access : undefined;
const organization = process.env.ACCESS_ACCOUNT_ID
  ? new SqlOrganizationStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const employeeDirectory = new StoredEmployeeDirectoryProvider();
const employeeProfile = createEmployeeProfileReader({
  access,
  resolveIdentity: async identity => access?.resolveIdentity(identity),
  directory: employeeDirectory,
  ownOrganization: organization?.ownOrganization.bind(organization),
  legacyProfile: ownProfile,
});
const claims = process.env.ACCESS_ACCOUNT_ID
  ? new SqlClaimsStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const evidenceStore = configuredEvidence(process.env);
const certificationImages = configuredEvidence(process.env, 'certification');
const certifications = process.env.ACCESS_ACCOUNT_ID
  ? new SqlCertificationStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const certificationRecommendations = process.env.ACCESS_ACCOUNT_ID
  ? new SqlCertificationRecommendationStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const catalogue = process.env.ACCESS_ACCOUNT_ID
  ? new SqlCatalogueStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const learning = process.env.ACCESS_ACCOUNT_ID
  ? new SqlLearningStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const recommendations = process.env.ACCESS_ACCOUNT_ID
  ? new SqlRecommendationStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const workflows = process.env.ACCESS_ACCOUNT_ID
  ? new SqlWorkflowStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const business = process.env.ACCESS_ACCOUNT_ID
  ? new SqlBusinessStore(process.env.ACCESS_ACCOUNT_ID)
  : undefined;
const provider = configuredProvider(process.env),
  aiBudget = access ? new SqlAiBudget(process.env.ACCESS_ACCOUNT_ID!) : undefined;
const knowledgeTransfer =
  access && aiBudget && process.env.KNOWLEDGE_TRANSFER_ENABLED !== 'false'
    ? new KnowledgeTransferService(access, aiBudget, provider)
    : undefined;
const assistant = access
  ? new AssistantService(
      access,
      organization,
      provider,
      claims,
      usage => console.info(JSON.stringify({ event: 'ai.usage', ...usage })),
      catalogue,
      process.env.ACCESS_ACCOUNT_ID
        ? new SqlConversationsStore(process.env.ACCESS_ACCOUNT_ID)
        : undefined,
      learning,
      workflows,
      aiBudget!,
      business,
    )
  : undefined;
const learningGenerator: QuizGenerator | undefined = assistant
  ? async (actor, prompt, signal, task) => {
      const result = await assistant.learningOutput(
        actor,
        prompt,
        signal,
        task ?? { kind: 'quiz' },
      );
      return {
        artifact: result.artifact,
        reply: result.reply,
        provider: assistant.status().provider ?? 'AI',
      };
    }
  : undefined;
const practice =
  learning && process.env.ACCESS_ACCOUNT_ID
    ? new LearningPracticeService(
        learning,
        new SqlPracticeStore(process.env.ACCESS_ACCOUNT_ID),
        learningGenerator,
      )
    : undefined;
const planner = learning ? new LearningPlannerService(learning, learningGenerator) : undefined;
const recovery =
  learning && process.env.ACCESS_ACCOUNT_ID
    ? new LearningRecoveryService(
        learning,
        new SqlRecoveryStore(process.env.ACCESS_ACCOUNT_ID),
        learningGenerator,
      )
    : undefined;
const app = createApp(
  config
    ? {
        verify: tokenVerifier(config),
        access,
        organization,
        business,
        ownOrganization: organization?.ownOrganization.bind(organization),
        assistant,
        knowledgeTransfer,
        catalogue,
        claims,
        certifications,
        certificationRecommendations,
        evidenceStore,
        certificationImages,
        learning,
        practice,
        planner,
        recovery,
        workflows,
        recommendations,
        resolveAccess: access ? identity => access.resolveIdentity(identity) : undefined,
        profile: employeeProfile,
      }
    : undefined,
  {
    developmentStore,
    hostedDemo,
    ...(process.env.HTTP_TIMING_ENABLED === 'true'
      ? {
          onRequestTiming: (metric: object) =>
            console.info(JSON.stringify({ event: 'http.timing', ...metric })),
        }
      : {}),
  },
);
// Vercel owns the listener and lifecycle; local/Azure Node hosting keeps its server.
export default app;
if (process.env.VERCEL !== '1') {
  const host = process.env.HOST ?? '127.0.0.1';
  const server = app.listen(port, host, () => {
    console.log(`Capability API: http://${host}:${port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () =>
      server.close(() => {
        closeRuntimeDatabase()
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      }),
    );
  }
}
