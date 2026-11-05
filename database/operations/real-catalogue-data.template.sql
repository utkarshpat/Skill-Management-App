/*
Company DEVELOPMENT catalogue only. Run the entire file in one connection/batch.
Requires an approved db_owner operator and installed migrations through 087.
Does NOT install migrations, delete data, change access or create employee claims.

1. Leave @execute=0. If @actor is NULL, eligible actor IDs are returned and execution
   stops. Set YOUR approved existing app-actor UUID; never attribute work to another
   person merely because their ID appears in that list. Run preview again.
2. Review every ADD / KEEP_EXISTING row and the source URLs below. Confirm the
   issuer titles, especially OPERATOR_RECHECK_REQUIRED sources, then set
   @issuer_sources_reviewed=1. This is your review acknowledgement, not a bypass.
3. Copy previewRevision and previewPlanHash into @expected_revision/@expected_plan;
   set @execute=1 and rerun the WHOLE unchanged file. A stale plan is rejected.
   Coordinate with other writers; canonical saves lock the workspace.

Existing matching active masters, metadata, IDs and mappings are kept unchanged.
Only NEW certifications receive the suggested skill mappings below. Archived,
inactive, ambiguous, different-issuer and old-framework matches block the batch.
Matching is case-insensitive, outer-whitespace-trimmed, NOT fuzzy/alias matching.
Name comparisons explicitly use DATABASE_DEFAULT; stored catalogue columns can
have a different collation. No database or column collation is changed.
Review issuer aliases in the preview; do not remove conflict guards to force a save.
All new skills are PUBLISHED with the installed common four-level rubric.
Business codes are deliberately omitted, not guessed from SKL-### sequences.

52 skills / 52 certification titles / 13 issuers; enough rows for 25-row pagination
in a fresh catalogue. Categories and mappings are application suggestions, not
issuer endorsements or proof that anyone holds these qualifications.
No fake Draft/Archived/Expired/Approved employee records, dates or files are added.
Employee expiry, renewal, review and upload flows need separate authorized data.
Official sources are recorded below. Oracle, PMI and Scrum.org pages could not be
retrieved; CompTIA A+/Security+ pages did not expose usable title content. Their
known certification titles REQUIRE operator rechecking before apply. Even for
readable sources, recheck issuer availability before a later run. App-active means
selectable catalogue content, not a claim that an issuer exam is currently open.
No exam versions/expiry rules are asserted. Descriptions are original summaries.
Live company SQL execution/acceptance has NOT been performed by the author.
An operator reported Msg 468 on the earlier file. This revision fixes mixed-
collation comparisons. The operator subsequently reported completion; the apply
outcome/counts and company acceptance have not been independently verified.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @execute bit=0;
DECLARE @account uniqueidentifier='0abd9bd3-7a7e-47b2-bea2-efbb86110cfa';
DECLARE @actor uniqueidentifier=NULL;
DECLARE @expected_revision int=NULL;
DECLARE @expected_plan varchar(64)=NULL;
DECLARE @issuer_sources_reviewed bit=0;

IF @@TRANCOUNT<>0 THROW 51000,'Run in a new connection without an existing transaction.',1;
IF @execute IS NULL THROW 51000,'Choose preview (0) or apply (1).',1;
IF ISNULL(DB_NAME(),N'')<>N'SS-SkillMgmtApp-SQL-Dev'
 OR ISNULL(LOWER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))),N'') NOT IN
 (N'ssskillmgmtappsqlsrvdev',N'ssskillmgmtappsqlsrvdev.database.windows.net')
 THROW 51003,'Wrong target. This operation is only for the approved company development database.',1;
IF ISNULL(IS_MEMBER('db_owner'),0)<>1
 THROW 51003,'An approved database owner must run this operator-only file.',1;
IF OBJECT_ID(N'dbo.SaveCatalogueMaster',N'P') IS NULL
 OR OBJECT_ID(N'dbo.SaveSkillCatalogue',N'P') IS NULL
 OR OBJECT_ID(N'dbo.CredentialSkillMapping',N'U') IS NULL
 THROW 51000,'Required catalogue schema/procedures are missing. Review installation through migration 087.',1;

DECLARE @seed nvarchar(max)=N'{
  "providers": [
    {"key":"microsoft","name":"Microsoft","sourceReview":"SOURCE_READ","sources":["https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/","https://learn.microsoft.com/en-us/credentials/certifications/azure-data-fundamentals/","https://learn.microsoft.com/en-us/credentials/certifications/security-compliance-and-identity-fundamentals/"]},
    {"key":"aws","name":"Amazon Web Services","sourceReview":"SOURCE_READ","sources":["https://aws.amazon.com/certification/"]},
    {"key":"google","name":"Google Cloud","sourceReview":"SOURCE_READ","sources":["https://cloud.google.com/learn/certification/cloud-digital-leader","https://cloud.google.com/learn/certification/cloud-engineer","https://cloud.google.com/learn/certification/cloud-architect","https://cloud.google.com/learn/certification/data-engineer","https://cloud.google.com/learn/certification/cloud-security-engineer"]},
    {"key":"cncf","name":"The Linux Foundation","sourceReview":"SOURCE_READ","sources":["https://www.cncf.io/training/certification/"]},
    {"key":"oracle","name":"Oracle","sourceReview":"OPERATOR_RECHECK_REQUIRED","sources":["https://education.oracle.com/java-se-17-developer/pexam_1Z0-829","https://education.oracle.com/oracle-database-sql/pexam_1Z0-071"]},
    {"key":"cisco","name":"Cisco","sourceReview":"SOURCE_READ","sources":["https://www.cisco.com/site/us/en/learn/training-certifications/certifications/enterprise/index.html"]},
    {"key":"comptia","name":"CompTIA","sourceReview":"OPERATOR_RECHECK_REQUIRED","sources":["https://www.comptia.org/en-us/certifications/a/","https://www.comptia.org/en-us/certifications/network/","https://www.comptia.org/en-us/certifications/security/","https://www.comptia.org/en-us/certifications/linux/","https://www.comptia.org/en-us/certifications/cloud/"]},
    {"key":"hashicorp","name":"HashiCorp","sourceReview":"SOURCE_READ","sources":["https://developer.hashicorp.com/certifications"]},
    {"key":"scrum","name":"Scrum.org","sourceReview":"OPERATOR_RECHECK_REQUIRED","sources":["https://www.scrum.org/professional-scrum-certifications"]},
    {"key":"istqb","name":"ISTQB","sourceReview":"SOURCE_READ","sources":["https://istqb.org/certifications/"]},
    {"key":"pmi","name":"Project Management Institute","sourceReview":"OPERATOR_RECHECK_REQUIRED","sources":["https://www.pmi.org/certifications"]},
    {"key":"databricks","name":"Databricks","sourceReview":"SOURCE_READ","sources":["https://www.databricks.com/learn/certification/data-engineer-associate","https://www.databricks.com/learn/certification/data-analyst-associate"]},
    {"key":"snowflake","name":"Snowflake","sourceReview":"SOURCE_READ","sources":["https://learn.snowflake.com/en/certifications/"]}
  ],
  "skills": [
    {"name":"Microsoft Azure","category":"Cloud Platforms","description":"Build and operate workloads using Microsoft Azure services."},
    {"name":"Amazon Web Services","category":"Cloud Platforms","description":"Deploy and operate workloads using AWS services."},
    {"name":"Google Cloud Platform","category":"Cloud Platforms","description":"Deploy and operate workloads using Google Cloud services."},
    {"name":"Kubernetes Administration","category":"Cloud Native","description":"Configure, maintain and troubleshoot Kubernetes clusters."},
    {"name":"Kubernetes Application Development","category":"Cloud Native","description":"Package, deploy and troubleshoot applications on Kubernetes."},
    {"name":"Kubernetes Security","category":"Security","description":"Protect Kubernetes workloads, cluster access and software delivery."},
    {"name":"Cloud Native Fundamentals","category":"Cloud Native","description":"Explain containers, orchestration and cloud-native operating patterns."},
    {"name":"Cloud Security","category":"Security","description":"Apply security controls to cloud services and workloads."},
    {"name":"Prometheus","category":"Observability","description":"Collect metrics, write queries and configure monitoring alerts."},
    {"name":"Istio","category":"Networking","description":"Configure service-mesh traffic, identity and workload connectivity."},
    {"name":"Cilium","category":"Networking","description":"Configure Kubernetes networking and network policy with Cilium."},
    {"name":"Argo CD","category":"DevOps","description":"Operate declarative GitOps delivery with Argo CD."},
    {"name":"Backstage","category":"Platform Engineering","description":"Maintain a developer portal and software catalogue with Backstage."},
    {"name":"OpenTelemetry","category":"Observability","description":"Instrument applications and route telemetry using OpenTelemetry."},
    {"name":"Kyverno","category":"Security","description":"Define and operate Kubernetes policies with Kyverno."},
    {"name":"Platform Engineering","category":"Platform Engineering","description":"Build supported internal platforms and developer self-service paths."},
    {"name":"Cloud Architecture","category":"Cloud Architecture","description":"Design resilient cloud solutions with explicit cost and reliability tradeoffs."},
    {"name":"Cloud Application Development","category":"Software Engineering","description":"Build and troubleshoot applications that use managed cloud services."},
    {"name":"Data Engineering","category":"Data and Analytics","description":"Build reliable ingestion, transformation and data delivery pipelines."},
    {"name":"Machine Learning","category":"AI and Machine Learning","description":"Develop and evaluate models with reproducible data and experiments."},
    {"name":"Identity and Access Management","category":"Security","description":"Design and review authentication, authorization and least-privilege access."},
    {"name":"Network Engineering","category":"Networking","description":"Design and troubleshoot network addressing, routing and connectivity."},
    {"name":"Python","category":"Software Engineering","description":"Write maintainable Python applications, automation and tests."},
    {"name":"TypeScript","category":"Software Engineering","description":"Build type-safe JavaScript applications and reusable components."},
    {"name":"SQL","category":"Data and Analytics","description":"Write relational queries and reason about data integrity and performance."},
    {"name":"Docker","category":"DevOps","description":"Build, inspect and run container images for application delivery."},
    {"name":"Git","category":"DevOps","description":"Manage source history, branching, merges and collaborative review."},
    {"name":"Continuous Integration and Delivery","category":"DevOps","description":"Build repeatable delivery pipelines with automated quality checks."},
    {"name":"Java","category":"Software Engineering","description":"Develop and test maintainable applications using the Java language and runtime."},
    {"name":"Oracle Database","category":"Database Administration","description":"Operate Oracle relational databases and their application-facing services."},
    {"name":"Database Administration","category":"Database Administration","description":"Maintain database reliability, recoverability, access and operational health."},
    {"name":"SQL Tuning","category":"Database Administration","description":"Investigate query plans, indexing and workload performance."},
    {"name":"Routing and Switching","category":"Networking","description":"Configure and troubleshoot routed and switched network connectivity."},
    {"name":"Enterprise Networking","category":"Networking","description":"Design and operate reliable enterprise network services."},
    {"name":"Network Automation","category":"Networking","description":"Automate network configuration and validation using repeatable workflows."},
    {"name":"Endpoint Support","category":"IT Support","description":"Diagnose endpoint hardware, operating systems and user connectivity issues."},
    {"name":"Linux Administration","category":"Cloud Operations","description":"Administer Linux services, storage, permissions and operational diagnostics."},
    {"name":"Cybersecurity Fundamentals","category":"Security","description":"Recognize threats and apply basic protective and incident-response practices."},
    {"name":"Infrastructure as Code","category":"Infrastructure Automation","description":"Manage infrastructure through versioned, reviewable and repeatable definitions."},
    {"name":"Terraform","category":"Infrastructure Automation","description":"Plan and manage infrastructure resources using Terraform configuration and state."},
    {"name":"HashiCorp Vault","category":"Security","description":"Operate Vault policies, authentication methods and secret-management workflows."},
    {"name":"Secrets Management","category":"Security","description":"Control secret distribution, rotation, access and lifecycle."},
    {"name":"Project Management","category":"Project Management","description":"Plan and coordinate delivery, stakeholders, dependencies and project controls."},
    {"name":"Risk Management","category":"Project Management","description":"Identify, assess and track delivery risks and response actions."},
    {"name":"Agile Delivery","category":"Agile and Product","description":"Deliver iteratively with short feedback loops and transparent priorities."},
    {"name":"Scrum","category":"Agile and Product","description":"Apply Scrum accountabilities, events and artifacts to iterative product delivery."},
    {"name":"Product Ownership","category":"Agile and Product","description":"Clarify product goals, order work and evaluate delivered value."},
    {"name":"Software Testing","category":"Quality Engineering","description":"Design and execute tests that expose product risks and verify expected behavior."},
    {"name":"Test Automation","category":"Quality Engineering","description":"Build reliable automated checks and maintain useful feedback in delivery pipelines."},
    {"name":"Databricks","category":"Data and Analytics","description":"Build and operate analytical and engineering workloads on Databricks."},
    {"name":"Apache Spark","category":"Data and Analytics","description":"Develop and troubleshoot distributed data transformations using Spark."},
    {"name":"Snowflake","category":"Data and Analytics","description":"Manage data, access and analytical workloads on Snowflake."}
  ],
  "certifications": [
    {"provider":"microsoft","name":"Microsoft Certified: Azure Fundamentals","category":"Cloud Fundamentals","description":"Foundational Azure service and cloud concepts.","skills":["Microsoft Azure","Cloud Native Fundamentals"]},
    {"provider":"microsoft","name":"Microsoft Certified: Azure Data Fundamentals","category":"Data and Analytics","description":"Foundational data concepts in the Azure ecosystem.","skills":["Microsoft Azure","Data Engineering","SQL"]},
    {"provider":"microsoft","name":"Microsoft Certified: Security, Compliance, and Identity Fundamentals","category":"Security","description":"Foundational Microsoft security, compliance and identity concepts.","skills":["Cloud Security","Identity and Access Management"]},
    {"provider":"aws","name":"AWS Certified Cloud Practitioner","category":"Cloud Fundamentals","description":"Foundational AWS service and cloud concepts.","skills":["Amazon Web Services"]},
    {"provider":"aws","name":"AWS Certified Solutions Architect - Associate","category":"Cloud Architecture","description":"Architecture considerations for workloads hosted on AWS.","skills":["Amazon Web Services","Cloud Architecture"]},
    {"provider":"aws","name":"AWS Certified Developer - Associate","category":"Software Engineering","description":"Application development and troubleshooting on AWS.","skills":["Amazon Web Services","Cloud Application Development"]},
    {"provider":"aws","name":"AWS Certified Data Engineer - Associate","category":"Data and Analytics","description":"Data pipeline and data-service engineering on AWS.","skills":["Amazon Web Services","Data Engineering"]},
    {"provider":"aws","name":"AWS Certified Security - Specialty","category":"Security","description":"Security engineering for AWS environments.","skills":["Amazon Web Services","Cloud Security","Identity and Access Management"]},
    {"provider":"aws","name":"AWS Certified AI Practitioner","category":"AI and Machine Learning","description":"Foundational artificial-intelligence and machine-learning concepts in the AWS ecosystem.","skills":["Amazon Web Services","Machine Learning"]},
    {"provider":"aws","name":"AWS Certified Machine Learning Engineer - Associate","category":"AI and Machine Learning","description":"Engineering and operating machine-learning workloads on AWS.","skills":["Amazon Web Services","Machine Learning","Data Engineering"]},
    {"provider":"google","name":"Cloud Digital Leader","category":"Cloud Fundamentals","description":"Business use cases and foundational Google Cloud concepts.","skills":[]},
    {"provider":"google","name":"Associate Cloud Engineer","category":"Cloud Operations","description":"Deployment and day-to-day operations on Google Cloud.","skills":["Google Cloud Platform"]},
    {"provider":"google","name":"Professional Cloud Architect","category":"Cloud Architecture","description":"Cloud architecture and solution design on Google Cloud.","skills":["Google Cloud Platform","Cloud Architecture"]},
    {"provider":"google","name":"Professional Data Engineer","category":"Data and Analytics","description":"Data platform and pipeline engineering on Google Cloud.","skills":["Google Cloud Platform","Data Engineering"]},
    {"provider":"google","name":"Professional Cloud Security Engineer","category":"Security","description":"Security design and operations on Google Cloud.","skills":["Google Cloud Platform","Cloud Security","Identity and Access Management"]},
    {"provider":"cncf","name":"Certified Kubernetes Administrator","category":"Cloud Operations","description":"Hands-on Kubernetes cluster administration.","skills":["Kubernetes Administration"]},
    {"provider":"cncf","name":"Certified Kubernetes Application Developer","category":"Software Engineering","description":"Hands-on application delivery on Kubernetes.","skills":["Kubernetes Application Development","Docker"]},
    {"provider":"cncf","name":"Certified Kubernetes Security Specialist","category":"Security","description":"Hands-on security for Kubernetes clusters and workloads.","skills":["Kubernetes Security","Cloud Security"]},
    {"provider":"cncf","name":"Kubernetes and Cloud Native Associate","category":"Cloud Fundamentals","description":"Foundational Kubernetes and cloud-native concepts.","skills":["Cloud Native Fundamentals","Kubernetes Administration"]},
    {"provider":"cncf","name":"Kubernetes and Cloud Security Associate","category":"Security","description":"Foundational security concepts for cloud-native systems.","skills":["Kubernetes Security","Cloud Security"]},
    {"provider":"cncf","name":"Prometheus Certified Associate","category":"Observability","description":"Prometheus monitoring, metrics and query concepts.","skills":["Prometheus"]},
    {"provider":"cncf","name":"Istio Certified Associate","category":"Networking","description":"Istio service-mesh configuration and operations.","skills":["Istio","Network Engineering"]},
    {"provider":"cncf","name":"Cilium Certified Associate","category":"Networking","description":"Cilium networking, connectivity and policy concepts.","skills":["Cilium","Network Engineering"]},
    {"provider":"cncf","name":"Certified Argo Project Associate","category":"DevOps","description":"Application delivery concepts in the Argo project ecosystem.","skills":["Argo CD","Continuous Integration and Delivery"]},
    {"provider":"cncf","name":"Certified Backstage Associate","category":"Platform Engineering","description":"Developer portal and software catalogue concepts in Backstage.","skills":["Backstage","Platform Engineering"]},
    {"provider":"cncf","name":"OpenTelemetry Certified Associate","category":"Observability","description":"OpenTelemetry instrumentation and telemetry concepts.","skills":["OpenTelemetry"]},
    {"provider":"cncf","name":"Kyverno Certified Associate","category":"Security","description":"Policy management for Kubernetes using Kyverno.","skills":["Kyverno","Kubernetes Security"]},
    {"provider":"cncf","name":"Cloud Native Platform Engineering Associate","category":"Platform Engineering","description":"Foundational practices for building cloud-native internal platforms.","skills":["Platform Engineering","Cloud Native Fundamentals"]},
    {"provider":"oracle","name":"Oracle Certified Professional: Java SE 17 Developer","category":"Software Engineering","description":"Java language and application development knowledge for the Java SE 17 credential.","skills":["Java"]},
    {"provider":"oracle","name":"Oracle Database SQL Certified Associate","category":"Database Administration","description":"Relational query and SQL knowledge in the Oracle database ecosystem.","skills":["Oracle Database","SQL"]},
    {"provider":"cisco","name":"CCNA","category":"Networking","description":"Foundational network connectivity, security and automation concepts.","skills":["Network Engineering","Routing and Switching"]},
    {"provider":"cisco","name":"CCNP Enterprise","category":"Networking","description":"Enterprise network implementation, operations and automation concepts.","skills":["Enterprise Networking","Network Automation","Routing and Switching"]},
    {"provider":"comptia","name":"CompTIA A+","category":"IT Support","description":"Endpoint hardware, operating systems and technical-support fundamentals.","skills":["Endpoint Support"]},
    {"provider":"comptia","name":"CompTIA Network+","category":"Networking","description":"Vendor-neutral networking concepts and troubleshooting practices.","skills":["Network Engineering","Routing and Switching"]},
    {"provider":"comptia","name":"CompTIA Security+","category":"Security","description":"Vendor-neutral cybersecurity controls, threats and operational practices.","skills":["Cybersecurity Fundamentals","Identity and Access Management"]},
    {"provider":"comptia","name":"CompTIA Linux+","category":"Cloud Operations","description":"Vendor-neutral Linux administration and operational troubleshooting.","skills":["Linux Administration"]},
    {"provider":"comptia","name":"CompTIA Cloud+","category":"Cloud Operations","description":"Vendor-neutral cloud operations, deployment and troubleshooting concepts.","skills":["Cloud Architecture","Cloud Security"]},
    {"provider":"hashicorp","name":"HashiCorp Certified: Terraform Associate","category":"Infrastructure Automation","description":"Terraform configuration, workflow and infrastructure-as-code fundamentals.","skills":["Terraform","Infrastructure as Code"]},
    {"provider":"hashicorp","name":"HashiCorp Certified: Vault Associate","category":"Security","description":"Vault authentication, policies and secret-management fundamentals.","skills":["HashiCorp Vault","Secrets Management"]},
    {"provider":"scrum","name":"Professional Scrum Master I","category":"Agile and Product","description":"Foundational Scrum framework and Scrum Master knowledge.","skills":["Scrum","Agile Delivery"]},
    {"provider":"scrum","name":"Professional Scrum Master II","category":"Agile and Product","description":"Application of Scrum Master practices in more complex situations.","skills":["Scrum","Agile Delivery"]},
    {"provider":"scrum","name":"Professional Scrum Product Owner I","category":"Agile and Product","description":"Foundational product ownership and value delivery within Scrum.","skills":["Product Ownership","Scrum"]},
    {"provider":"istqb","name":"Certified Tester Foundation Level (CTFL)","category":"Quality Engineering","description":"Foundational software-testing concepts, techniques and test processes.","skills":["Software Testing"]},
    {"provider":"istqb","name":"Certified Tester Advanced Level Test Automation Engineering (CTAL-TAE)","category":"Quality Engineering","description":"Engineering and maintenance of test-automation solutions.","skills":["Test Automation","Software Testing","Continuous Integration and Delivery"]},
    {"provider":"pmi","name":"Project Management Professional (PMP)","category":"Project Management","description":"Project leadership and delivery practices across project approaches.","skills":["Project Management","Risk Management"]},
    {"provider":"pmi","name":"Certified Associate in Project Management (CAPM)","category":"Project Management","description":"Foundational project-management concepts and delivery approaches.","skills":["Project Management"]},
    {"provider":"pmi","name":"PMI Agile Certified Practitioner (PMI-ACP)","category":"Agile and Product","description":"Agile principles and practices across iterative delivery approaches.","skills":["Agile Delivery"]},
    {"provider":"databricks","name":"Databricks Certified Data Engineer Associate","category":"Data and Analytics","description":"Data engineering workflows using the Databricks platform.","skills":["Databricks","Apache Spark","Data Engineering"]},
    {"provider":"databricks","name":"Databricks Certified Data Analyst Associate","category":"Data and Analytics","description":"Data exploration, queries and analytical workflows in Databricks.","skills":["Databricks","SQL"]},
    {"provider":"snowflake","name":"SnowPro Core Certification","category":"Data and Analytics","description":"Core Snowflake platform, data and operational concepts.","skills":["Snowflake","SQL"]},
    {"provider":"snowflake","name":"SnowPro Advanced: Architect","category":"Cloud Architecture","description":"Advanced solution-design considerations for Snowflake workloads.","skills":["Snowflake","Cloud Architecture"]},
    {"provider":"snowflake","name":"SnowPro Advanced: Data Engineer","category":"Data and Analytics","description":"Advanced data engineering and pipeline design on Snowflake.","skills":["Snowflake","Data Engineering"]}
  ]
}';

DECLARE @providers TABLE(provider_key varchar(20) PRIMARY KEY,name nvarchar(100) NOT NULL UNIQUE,source_review varchar(30) NOT NULL,sources nvarchar(max) NOT NULL,id uniqueidentifier NULL,is_new bit NOT NULL DEFAULT 1);
DECLARE @skills TABLE(name nvarchar(100) PRIMARY KEY,category nvarchar(80) NOT NULL,description nvarchar(2000) NOT NULL,id uniqueidentifier NULL,is_new bit NOT NULL DEFAULT 1);
DECLARE @certifications TABLE(provider_key varchar(20) NOT NULL,name nvarchar(100) NOT NULL,category nvarchar(80) NOT NULL,description nvarchar(2000) NOT NULL,skill_names nvarchar(max) NOT NULL,id uniqueidentifier NULL,is_new bit NOT NULL DEFAULT 1,PRIMARY KEY(provider_key,name));
INSERT @providers(provider_key,name,source_review,sources) SELECT JSON_VALUE(value,'$.key'),JSON_VALUE(value,'$.name'),JSON_VALUE(value,'$.sourceReview'),JSON_QUERY(value,'$.sources') FROM OPENJSON(@seed,'$.providers');
INSERT @skills(name,category,description) SELECT JSON_VALUE(value,'$.name'),JSON_VALUE(value,'$.category'),JSON_VALUE(value,'$.description') FROM OPENJSON(@seed,'$.skills');
INSERT @certifications(provider_key,name,category,description,skill_names) SELECT JSON_VALUE(value,'$.provider'),JSON_VALUE(value,'$.name'),JSON_VALUE(value,'$.category'),JSON_VALUE(value,'$.description'),JSON_QUERY(value,'$.skills') FROM OPENJSON(@seed,'$.certifications');
IF (SELECT COUNT(*) FROM @providers)<>13 OR (SELECT COUNT(*) FROM @skills)<>52 OR (SELECT COUNT(*) FROM @certifications)<>52
 THROW 51000,'Source counts changed. Review the dataset and this operation before using it.',1;
IF EXISTS(SELECT 1 FROM @certifications c LEFT JOIN @providers p ON p.provider_key=c.provider_key WHERE p.provider_key IS NULL)
 OR EXISTS(SELECT 1 FROM @certifications c CROSS APPLY OPENJSON(c.skill_names) j LEFT JOIN @skills s ON s.name COLLATE DATABASE_DEFAULT=j.value COLLATE DATABASE_DEFAULT WHERE j.type<>1 OR s.name IS NULL)
 OR EXISTS(SELECT 1 FROM @certifications c CROSS APPLY OPENJSON(c.skill_names) j GROUP BY c.provider_key,c.name HAVING COUNT(*)>20 OR COUNT(*)<>COUNT(DISTINCT j.value))
 THROW 51000,'Invalid source provider or related-skill mapping.',1;

BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a WITH(HOLDLOCK) ON a.account_id=w.account_id AND a.status='ACTIVE'
 WHERE w.account_id=@account;
 IF @revision IS NULL THROW 51004,'Approved company workspace is unavailable.',1;

 IF @actor IS NULL BEGIN
  SELECT p.person_id AS eligibleActorId FROM dbo.AccessPerson p
  WHERE p.account_id=@account AND p.active=1 AND p.entra_object_id IS NOT NULL
   AND dbo.AccessCan(@account,p.person_id,'profile.view',1)=1
   AND dbo.AccessCan(@account,p.person_id,'permissions.manage',0)=1
   AND dbo.AccessCan(@account,p.person_id,'users.manage',0)=1
   AND dbo.AccessCan(@account,p.person_id,'audit.view',0)=1
   AND dbo.AccessCan(@account,p.person_id,'skill.catalogue.manage',0)=1
   AND dbo.BusinessLegacyDenied(@account,p.person_id,'request.approve')=0
  ORDER BY p.person_id;
  THROW 51000,'Set your approved existing app-actor UUID, then run preview again. No actor is selected automatically.',1;
 END;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WITH(HOLDLOCK) WHERE account_id=@account AND person_id=@actor AND active=1 AND entra_object_id IS NOT NULL)
  OR ISNULL(dbo.AccessCan(@account,@actor,'profile.view',1),0)<>1
  OR ISNULL(dbo.AccessCan(@account,@actor,'permissions.manage',0),0)<>1
  OR ISNULL(dbo.AccessCan(@account,@actor,'users.manage',0),0)<>1
  OR ISNULL(dbo.AccessCan(@account,@actor,'audit.view',0),0)<>1
  OR ISNULL(dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0),0)<>1
  OR ISNULL(dbo.BusinessLegacyDenied(@account,@actor,'request.approve'),1)<>0
  THROW 51003,'An active Microsoft-linked actor with current full catalogue approval authority is required.',1;

 DECLARE @framework uniqueidentifier='00000000-0000-4000-8000-000000000003';
 IF (SELECT COUNT(*) FROM dbo.ProficiencyLevel WITH(HOLDLOCK) WHERE framework_id=@framework)<>4
  OR EXISTS(SELECT 1 FROM (VALUES(1,N'Foundation'),(2,N'Autonomous'),(3,N'Experienced'),(4,N'Expert')) e(rank,name)
   LEFT JOIN dbo.ProficiencyLevel l WITH(HOLDLOCK) ON l.framework_id=@framework AND l.rank=e.rank
   AND l.display_name COLLATE Latin1_General_100_BIN2=e.name COLLATE Latin1_General_100_BIN2
   WHERE l.rank IS NULL OR NULLIF(LTRIM(RTRIM(l.description)),'') IS NULL)
  THROW 51000,'The installed common four-level proficiency rubric is incomplete.',1;

 DECLARE @snapshot nvarchar(max)=(SELECT
  JSON_QUERY((SELECT skill_id,display_name,category,description,status,definition_revision,business_code FROM dbo.SkillCatalogue WITH(HOLDLOCK) WHERE account_id=@account ORDER BY skill_id FOR JSON PATH)) AS skills,
  JSON_QUERY((SELECT id,name,active,revision FROM dbo.CredentialProvider WITH(HOLDLOCK) WHERE account_id=@account ORDER BY id FOR JSON PATH)) AS providers,
  JSON_QUERY((SELECT id,name,provider_id,category,description,active,revision FROM dbo.CredentialDefinition WITH(HOLDLOCK) WHERE account_id=@account ORDER BY id FOR JSON PATH)) AS certifications,
  JSON_QUERY((SELECT credential_id,skill_id FROM dbo.CredentialSkillMapping WITH(HOLDLOCK) WHERE account_id=@account ORDER BY credential_id,skill_id FOR JSON PATH)) AS mappings,
  JSON_QUERY((SELECT rank,display_name,description FROM dbo.ProficiencyLevel WITH(HOLDLOCK) WHERE framework_id=@framework ORDER BY rank FOR JSON PATH)) AS criteria,
  JSON_QUERY((SELECT v.skill_id,v.definition_revision,v.framework_id FROM dbo.SkillDefinitionVersion v WITH(HOLDLOCK) JOIN dbo.SkillCatalogue c ON c.account_id=v.account_id AND c.skill_id=v.skill_id AND c.definition_revision=v.definition_revision WHERE v.account_id=@account ORDER BY v.skill_id FOR JSON PATH)) AS currentVersions
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @receipt nvarchar(max)=(SELECT DB_NAME() AS databaseName,@account AS accountId,@actor AS actorId,@revision AS revision,JSON_QUERY(@seed) AS source,JSON_QUERY(@snapshot) AS state FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @plan_hash varbinary(32)=HASHBYTES('SHA2_256',@receipt);

 IF EXISTS(SELECT 1 FROM @skills s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND LOWER(LTRIM(RTRIM(c.display_name))) COLLATE DATABASE_DEFAULT=LOWER(s.name) COLLATE DATABASE_DEFAULT GROUP BY s.name HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM @providers p JOIN dbo.CredentialProvider d ON d.account_id=@account AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(p.name) COLLATE DATABASE_DEFAULT GROUP BY p.name HAVING COUNT(*)>1)
  THROW 51009,'Ambiguous normalized skill/provider names. Review duplicates; nothing was saved.',1;
 UPDATE p SET id=d.id,is_new=0 FROM @providers p JOIN dbo.CredentialProvider d ON d.account_id=@account AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(p.name) COLLATE DATABASE_DEFAULT;
 UPDATE s SET id=c.skill_id,is_new=0 FROM @skills s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND LOWER(LTRIM(RTRIM(c.display_name))) COLLATE DATABASE_DEFAULT=LOWER(s.name) COLLATE DATABASE_DEFAULT;

 IF EXISTS(SELECT 1 FROM @providers p JOIN dbo.CredentialProvider d ON d.account_id=@account AND d.id=p.id WHERE d.active<>1)
 BEGIN
  SELECT p.name AS inactiveProvider FROM @providers p JOIN dbo.CredentialProvider d ON d.account_id=@account AND d.id=p.id WHERE d.active<>1;
  THROW 51009,'An existing provider is inactive. Review it explicitly; this script never reactivates masters.',1;
 END;
 IF EXISTS(SELECT 1 FROM @skills s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=s.id
  WHERE c.status<>'PUBLISHED' OR NOT EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id=@framework))
 BEGIN
  SELECT s.name AS conflictingSkill,c.status,c.definition_revision AS definitionRevision FROM @skills s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=s.id
   WHERE c.status<>'PUBLISHED' OR NOT EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id=@framework);
  THROW 51009,'A named skill is unpublished, archived or uses a historical framework. Review the listed skills; no history is rewritten.',1;
 END;
 IF EXISTS(SELECT 1 FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key
  JOIN dbo.CredentialDefinition d ON d.account_id=@account AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(c.name) COLLATE DATABASE_DEFAULT
  WHERE p.id IS NULL OR d.provider_id<>p.id)
 BEGIN
  SELECT c.name AS certification,p.name AS expectedProvider,d.provider_id AS existingProviderId
   FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key
   JOIN dbo.CredentialDefinition d ON d.account_id=@account AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(c.name) COLLATE DATABASE_DEFAULT
   WHERE p.id IS NULL OR d.provider_id<>p.id;
  THROW 51009,'A matching certification has another issuer. Review issuer aliases/bindings instead of creating duplicates.',1;
 END;
 IF EXISTS(SELECT 1 FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key
  JOIN dbo.CredentialDefinition d ON d.account_id=@account AND d.provider_id=p.id AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(c.name) COLLATE DATABASE_DEFAULT
  GROUP BY c.provider_key,c.name HAVING COUNT(*)>1)
  THROW 51009,'Ambiguous normalized certification names. Review duplicates; nothing was saved.',1;
 UPDATE c SET id=d.id,is_new=0 FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key
  JOIN dbo.CredentialDefinition d ON d.account_id=@account AND d.provider_id=p.id AND LOWER(LTRIM(RTRIM(d.name))) COLLATE DATABASE_DEFAULT=LOWER(c.name) COLLATE DATABASE_DEFAULT;
 IF EXISTS(SELECT 1 FROM @certifications c JOIN dbo.CredentialDefinition d ON d.account_id=@account AND d.id=c.id WHERE d.active<>1)
 BEGIN
  SELECT c.name AS inactiveCertification FROM @certifications c JOIN dbo.CredentialDefinition d ON d.account_id=@account AND d.id=c.id WHERE d.active<>1;
  THROW 51009,'An existing certification is inactive. Review it explicitly; no reactivation is performed.',1;
 END;
 IF (SELECT COUNT(*) FROM dbo.SkillCatalogue WHERE account_id=@account)+(SELECT COUNT(*) FROM @skills WHERE is_new=1)>10000
  THROW 51000,'Adding these skills would exceed the catalogue limit.',1;
 IF EXISTS(SELECT 1 FROM @skills s WHERE
  (SELECT COUNT(*) FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account AND m.skill_id=s.id)
  +(SELECT COUNT(*) FROM @certifications c CROSS APPLY OPENJSON(c.skill_names) j WHERE c.is_new=1 AND j.value COLLATE DATABASE_DEFAULT=s.name COLLATE DATABASE_DEFAULT)>20)
  THROW 51000,'The proposed mappings exceed twenty certifications for a skill. Review associations before applying.',1;

 DECLARE @new_skills int=(SELECT COUNT(*) FROM @skills WHERE is_new=1);
 DECLARE @new_providers int=(SELECT COUNT(*) FROM @providers WHERE is_new=1);
 DECLARE @new_certifications int=(SELECT COUNT(*) FROM @certifications WHERE is_new=1);
 DECLARE @planned_revision bigint=CONVERT(bigint,@revision)+@new_skills+@new_providers+@new_certifications;
 IF @planned_revision>2147483647 THROW 51000,'Insufficient workspace revision capacity for this batch.',1;

 SELECT name AS provider,CASE is_new WHEN 1 THEN 'ADD' ELSE 'KEEP_EXISTING' END AS action,source_review AS sourceReview,sources FROM @providers ORDER BY name;
 SELECT name AS skill,CASE is_new WHEN 1 THEN 'ADD' ELSE 'KEEP_EXISTING' END AS action,CASE is_new WHEN 1 THEN category ELSE NULL END AS proposedCategory FROM @skills ORDER BY name;
 SELECT c.name AS certification,p.name AS provider,CASE c.is_new WHEN 1 THEN 'ADD' ELSE 'KEEP_EXISTING' END AS action,
  CASE c.is_new WHEN 1 THEN c.category ELSE NULL END AS proposedCategory,CASE c.is_new WHEN 1 THEN c.skill_names ELSE NULL END AS newSkillSuggestions
  FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key ORDER BY p.name,c.name;
 SELECT @revision AS previewRevision,CONVERT(varchar(64),@plan_hash,2) AS previewPlanHash,
  @new_skills AS skillsToAdd,@new_providers AS providersToAdd,@new_certifications AS certificationsToAdd;
 IF @execute=0 BEGIN
  COMMIT TRANSACTION;
  PRINT 'PREVIEW ONLY. No persistent data changed. Existing metadata/mappings are preserved; proposed categories apply only to ADD rows.';
  RETURN;
 END;
 IF @expected_revision IS NULL OR @expected_revision<>@revision OR @expected_plan IS NULL
  OR DATALENGTH(@expected_plan)<>64 OR TRY_CONVERT(varbinary(32),@expected_plan,2) IS NULL
  OR TRY_CONVERT(varbinary(32),@expected_plan,2)<>@plan_hash
  THROW 51009,'Missing or stale preview receipt. Review a fresh preview and copy its revision and hash.',1;
 IF ISNULL(@issuer_sources_reviewed,0)<>1
  THROW 51000,'Review and confirm issuer sources before apply, including every OPERATOR_RECHECK_REQUIRED provider.',1;

 UPDATE @providers SET id=NEWID() WHERE is_new=1;
 UPDATE @skills SET id=NEWID() WHERE is_new=1;
 UPDATE @certifications SET id=NEWID() WHERE is_new=1;
 DECLARE @id uniqueidentifier,@definition nvarchar(max),@command nvarchar(max),@current_revision int,@kind varchar(20);
 DECLARE @pending TABLE(sequence int IDENTITY PRIMARY KEY,kind varchar(20) NOT NULL,id uniqueidentifier NOT NULL,definition nvarchar(max) NOT NULL);
 INSERT @pending(kind,id,definition)
  SELECT 'PROVIDER',p.id,(SELECT p.name AS name,CAST(1 AS bit) AS active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @providers p WHERE p.is_new=1;
 INSERT @pending(kind,id,definition)
  SELECT 'SKILL',s.id,(SELECT s.name AS name,s.category AS category,s.description AS description,'PUBLISHED' AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @skills s WHERE s.is_new=1;
 INSERT @pending(kind,id,definition)
  SELECT 'CERTIFICATION',c.id,(SELECT c.name AS name,c.category AS category,c.description AS description,p.id AS providerId,CAST(1 AS bit) AS active,
   JSON_QUERY(COALESCE((SELECT '['+STRING_AGG(CONVERT(nvarchar(max),'"'+CONVERT(varchar(36),s.id)+'"'),',') WITHIN GROUP(ORDER BY s.id)+']'
    FROM OPENJSON(c.skill_names) j JOIN @skills s ON s.name COLLATE DATABASE_DEFAULT=j.value COLLATE DATABASE_DEFAULT),'[]')) AS relatedSkillIds
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
  FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key WHERE c.is_new=1;

 DECLARE @step int=1,@steps int=(SELECT COUNT(*) FROM @pending);
 WHILE @step<=@steps BEGIN
  SELECT @kind=kind,@id=id,@definition=definition FROM @pending WHERE sequence=@step;
  SELECT @current_revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account;
  IF @kind='SKILL'
   EXEC dbo.SaveSkillCatalogue @account_id=@account,@actor_id=@actor,@expected_revision=@current_revision,@target_id=@id,@is_new=1,@payload=@definition;
  ELSE BEGIN
   SET @command=(SELECT @id AS id,@current_revision AS revision,@kind AS type,CAST(1 AS bit) AS isNew,JSON_QUERY(@definition) AS definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   EXEC dbo.SaveCatalogueMaster @account_id=@account,@actor_id=@actor,@operation='SAVE_MASTER',@payload=@command;
  END;
  SET @step=@step+1;
 END;
 IF EXISTS(SELECT 1 FROM @skills s LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=s.id AND c.status='PUBLISHED' WHERE c.skill_id IS NULL)
  OR EXISTS(SELECT 1 FROM @providers p LEFT JOIN dbo.CredentialProvider d ON d.account_id=@account AND d.id=p.id AND d.active=1 WHERE d.id IS NULL)
  OR EXISTS(SELECT 1 FROM @certifications c JOIN @providers p ON p.provider_key=c.provider_key LEFT JOIN dbo.CredentialDefinition d ON d.account_id=@account AND d.id=c.id AND d.provider_id=p.id AND d.active=1 WHERE d.id IS NULL)
  OR EXISTS(SELECT 1 FROM @certifications c CROSS APPLY OPENJSON(c.skill_names) j JOIN @skills s ON s.name COLLATE DATABASE_DEFAULT=j.value COLLATE DATABASE_DEFAULT WHERE c.is_new=1 AND NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account AND m.credential_id=c.id AND m.skill_id=s.id))
  THROW 51000,'Catalogue postcondition failed. The complete batch will roll back.',1;
 IF (SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account)<>@planned_revision
  OR (SELECT COUNT(*) FROM dbo.AccessAudit WHERE account_id=@account AND actor_id=@actor AND revision>@revision AND revision<=@planned_revision AND action IN('skill.created','catalogue.master.saved'))<>@steps
  THROW 51000,'Expected revision/audit receipts were not produced. The complete batch will roll back.',1;
 COMMIT TRANSACTION;
 SELECT 'COMMITTED' AS result,@new_skills AS skillsAdded,@new_providers AS providersAdded,@new_certifications AS certificationsAdded,@planned_revision AS finalRevision;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
