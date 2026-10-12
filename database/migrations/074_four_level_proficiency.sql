-- Four-level framework is a new version. No historical claim or rubric is rewritten.
ALTER TABLE dbo.ProficiencyFramework DROP CONSTRAINT CK_ProficiencyFramework_Common;
ALTER TABLE dbo.ProficiencyFramework ADD CONSTRAINT CK_ProficiencyFramework_Common
 CHECK(account_id IS NOT NULL OR framework_key IN ('enterprise-v1','enterprise-v2','enterprise-v3'));
INSERT dbo.ProficiencyFramework(framework_id,account_id,framework_key)
 VALUES('00000000-0000-4000-8000-000000000003',NULL,'enterprise-v3');
INSERT dbo.ProficiencyLevel(framework_id,rank,display_name,description) VALUES
 ('00000000-0000-4000-8000-000000000003',1,N'Foundation',N'Understands fundamentals and completes routine work with guidance.'),
 ('00000000-0000-4000-8000-000000000003',2,N'Autonomous',N'Handles standard tasks independently and explains decisions.'),
 ('00000000-0000-4000-8000-000000000003',3,N'Experienced',N'Resolves complex issues, evaluates trade-offs and guides colleagues.'),
 ('00000000-0000-4000-8000-000000000003',4,N'Expert',N'Defines standards and strategy and mentors experienced practitioners.');
GO
CREATE OR ALTER PROCEDURE dbo.SaveSkillCatalogue
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,
 @target_id uniqueidentifier,@is_new bit,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int,@before nvarchar(max),@after nvarchar(max);
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 THROW 51003,'Skill catalogue permission is not assigned.',1;
 IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Workspace changed. Reload the catalogue.',1;
 IF ISJSON(@payload)<>1 OR @target_id IS NULL OR @is_new IS NULL THROW 51000,'Invalid skill change.',1;
 DECLARE @name nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),@category nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.category'))),@description nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description'))),@status varchar(20)=JSON_VALUE(@payload,'$.status');
 IF @name IS NULL OR LEN(@name)=0 OR DATALENGTH(@name)>200 OR @category IS NULL OR LEN(@category)=0 OR DATALENGTH(@category)>160 OR @description IS NULL OR DATALENGTH(@description)>4000 OR @status IS NULL OR @status NOT IN ('DRAFT','PUBLISHED','ARCHIVED') THROW 51000,'Invalid skill name, category, description or status.',1;
 IF @status='PUBLISHED' AND LEN(@description)=0 THROW 51000,'Describe the skill before publishing.',1;
 IF LEFT(LTRIM(JSON_QUERY(@payload,'$.levels')),1)<>'[' OR JSON_QUERY(@payload,'$.levels') IS NULL THROW 51000,'Define proficiency levels.',1;
 DECLARE @levels TABLE(rank int,name nvarchar(4000),description nvarchar(4000));
 INSERT @levels SELECT TRY_CONVERT(int,JSON_VALUE(value,'$.rank')),LTRIM(RTRIM(JSON_VALUE(value,'$.name'))),LTRIM(RTRIM(JSON_VALUE(value,'$.description'))) FROM OPENJSON(@payload,'$.levels');
 IF (SELECT COUNT(*) FROM @levels)<>4 OR EXISTS(SELECT 1 FROM @levels WHERE rank IS NULL OR rank NOT BETWEEN 1 AND 4 OR name IS NULL OR LEN(name)=0 OR DATALENGTH(name)>120 OR description IS NULL OR DATALENGTH(description)>2000 OR (@status='PUBLISHED' AND LEN(description)=0)) THROW 51000,'Define four levels with valid names and criteria; criteria are required before publishing.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.levels') WHERE type<>5 OR TRY_CONVERT(int,JSON_VALUE(value,'$.rank'))<>TRY_CONVERT(int,[key])+1) OR EXISTS(SELECT rank FROM @levels GROUP BY rank HAVING COUNT(*)>1) THROW 51000,'Use sequential proficiency levels.',1;
 DECLARE @framework uniqueidentifier='00000000-0000-4000-8000-000000000003';
 IF EXISTS(SELECT 1 FROM @levels x LEFT JOIN dbo.ProficiencyLevel l ON l.framework_id=@framework AND l.rank=x.rank AND l.display_name COLLATE Latin1_General_100_BIN2=x.name COLLATE Latin1_General_100_BIN2 WHERE l.rank IS NULL)
 THROW 51000,'Use exactly four levels: Foundation, Autonomous, Experienced and Expert.',1;
 IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id) THROW 51004,'Skill unavailable.',1;
 IF @is_new=1 AND (SELECT COUNT(*) FROM dbo.SkillCatalogue WHERE account_id=@account_id)>=10000 THROW 51000,'Catalogue limit reached.',1;
 SELECT @before=(SELECT skill_id AS id,display_name AS name,category,description,status,business_code AS businessCode,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @code varchar(20)=JSON_VALUE(@payload,'$.businessCode');
 IF @code IS NOT NULL AND (LEN(@code)<>7 OR @code COLLATE Latin1_General_100_BIN2 NOT LIKE 'SKL-[0-9][0-9][0-9]') THROW 51000,'Invalid business code.',1;
 IF @is_new=0 AND @code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id AND business_code=@code) THROW 51000,'Business codes are immutable.',1;
 IF @is_new=1 INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision,business_code) VALUES(@account_id,@target_id,@name,@category,@description,@status,@revision+1,@code);
 ELSE UPDATE dbo.SkillCatalogue SET display_name=@name,category=@category,description=@description,status=@status,definition_revision=@revision+1 WHERE account_id=@account_id AND skill_id=@target_id;
 INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status)
 VALUES(@account_id,@target_id,@revision+1,@framework,@name,@category,@description,@status);
 INSERT dbo.SkillVersionCriterion SELECT @account_id,@target_id,@revision+1,@framework,rank,description FROM @levels;
 SELECT @after=(SELECT skill_id AS id,display_name AS name,category,description,status,business_code AS businessCode,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,CASE @is_new WHEN 1 THEN 'skill.created' ELSE 'skill.updated' END,@target_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SaveSkillCatalogue TO [skill_management_runtime];

GO
-- Published-only category discovery; existing unfiltered callers remain compatible.
CREATE OR ALTER PROCEDURE dbo.ReadClaimSkills
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1,@category nvarchar(80)=N'',@page_size int=25
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page_size IS NULL OR @page_size<1 OR @page_size>25 OR @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own skill claim access denied.',1;
 DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @visible SELECT skill_id FROM dbo.SkillCatalogue WHERE account_id=@account_id AND status='PUBLISHED' AND EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=SkillCatalogue.account_id AND v.skill_id=SkillCatalogue.skill_id AND v.definition_revision=SkillCatalogue.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') AND (ISNULL(@category,N'')=N'' OR category=@category) AND (ISNULL(@query,N'')=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,category)>0);
 SELECT COUNT(*) AS total FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*@page_size) ROWS FETCH NEXT @page_size ROWS ONLY;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.description,s.business_code AS businessCode,s.definition_revision AS definitionRevision FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 SELECT TOP(100) category AS name,COUNT(*) AS count FROM dbo.SkillCatalogue WHERE account_id=@account_id AND status='PUBLISHED' AND EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=SkillCatalogue.account_id AND v.skill_id=SkillCatalogue.skill_id AND v.definition_revision=SkillCatalogue.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') GROUP BY category ORDER BY category;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadClaimSkills TO [skill_management_runtime];

GO
-- Aggregate only current active direct reports; no additional grants or scope support.
CREATE OR ALTER PROCEDURE dbo.ReadDirectReportCapability
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1,@person_id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 OR @query IS NULL THROW 51000,'Invalid team query.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Team capability denied.',1;
 SELECT p.person_id,p.display_name,p.employee_code INTO #scope FROM dbo.AccessPerson p
 JOIN dbo.AccessOrgAssignment o ON o.account_id=p.account_id AND o.person_id=p.person_id
 WHERE p.account_id=@account_id AND p.active=1 AND o.manager_id=@actor_id AND p.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,p.person_id)=1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM #scope WHERE person_id=@person_id) THROW 51004,'Team member unavailable.',1;
 SELECT * INTO #filtered FROM #scope WHERE (@person_id IS NULL OR person_id=@person_id) AND (@query=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0);
 SELECT COUNT(*) AS total FROM #filtered;
 SELECT * INTO #paged FROM #filtered ORDER BY display_name,person_id OFFSET ((@page-1)*12) ROWS FETCH NEXT 12 ROWS ONLY;
 SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,
 COUNT(CASE WHEN c.status='APPROVED' THEN 1 END) AS reviewed,
 COUNT(CASE WHEN c.status='SUBMITTED' AND c.reviewer_id=@actor_id THEN 1 END) AS pending
 FROM #paged p LEFT JOIN dbo.SkillClaimDraft c ON c.account_id=@account_id AND c.person_id=p.person_id
 GROUP BY p.person_id,p.display_name,p.employee_code ORDER BY p.display_name,p.person_id;
 SELECT c.person_id AS personId,c.skill_name AS skillName,c.category,c.claimed_rank AS rank,c.level_name AS levelName,c.status
 FROM dbo.SkillClaimDraft c JOIN #paged p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND @person_id IS NOT NULL
 AND (c.status='APPROVED' OR (c.status='SUBMITTED' AND c.reviewer_id=@actor_id)) ORDER BY p.display_name,c.skill_name,c.claim_id;

 -- Analytics use the same server-resolved, filtered direct-report scope, never private draft details.
 SELECT (SELECT COUNT(*) FROM #filtered) AS members,
 COUNT(CASE WHEN c.status='APPROVED' THEN 1 END) AS reviewed,
 COUNT(CASE WHEN c.status='SUBMITTED' AND c.reviewer_id=@actor_id THEN 1 END) AS pending
 FROM dbo.SkillClaimDraft c JOIN #filtered p ON p.person_id=c.person_id WHERE c.account_id=@account_id;
 ;WITH coverage AS (
 SELECT DISTINCT c.skill_name,c.person_id,t.rank
 FROM dbo.SkillClaimDraft c JOIN #filtered p ON p.person_id=c.person_id
 CROSS JOIN (VALUES(1),(2),(3),(4)) t(rank)
 WHERE c.account_id=@account_id AND c.status='APPROVED' AND EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') AND c.claimed_rank>=t.rank
 ) SELECT skill_name AS skillName,rank,COUNT(*) AS people,
 STRING_AGG(CONVERT(nvarchar(max),person_id),',') AS memberIds
 FROM coverage GROUP BY skill_name,rank ORDER BY rank,people DESC,skill_name;
 SELECT c.claimed_rank AS rank,COUNT(*) AS count,
 STRING_AGG(CONVERT(nvarchar(max),c.person_id),',') AS memberIds
 FROM dbo.SkillClaimDraft c JOIN #filtered p ON p.person_id=c.person_id
 WHERE c.account_id=@account_id AND c.status='APPROVED' AND EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') GROUP BY c.claimed_rank ORDER BY c.claimed_rank;
 SELECT c.category,COUNT(*) AS count
 FROM dbo.SkillClaimDraft c JOIN #filtered p ON p.person_id=c.person_id
 WHERE c.account_id=@account_id AND c.status='APPROVED' GROUP BY c.category ORDER BY count DESC,c.category;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadDirectReportCapability TO [skill_management_runtime];
GO

GO
-- Preserve immutable activity and require established framework equivalence.
CREATE OR ALTER FUNCTION dbo.BusinessMatchRequirements(@account uniqueidentifier,@person uniqueidentifier,@requirements nvarchar(max)) RETURNS TABLE AS RETURN (
 SELECT 'SKILL' AS type,CONVERT(varchar(36),TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))) AS id,c.display_name COLLATE DATABASE_DEFAULT AS name,
 CONVERT(bit,CASE WHEN c.status='PUBLISHED' AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft d JOIN dbo.SkillDefinitionVersion v ON v.account_id=d.account_id AND v.skill_id=d.skill_id AND v.definition_revision=d.definition_revision JOIN dbo.SkillDefinitionVersion currentVersion ON currentVersion.account_id=c.account_id AND currentVersion.skill_id=c.skill_id AND currentVersion.definition_revision=c.definition_revision WHERE d.account_id=@account AND d.person_id=@person AND d.skill_id=c.skill_id AND d.status='APPROVED' AND v.framework_id='00000000-0000-4000-8000-000000000003' AND currentVersion.framework_id=v.framework_id AND d.claimed_rank BETWEEN 1 AND 4 AND TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) BETWEEN 1 AND 4 AND d.claimed_rank>=TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank'))) THEN 1 ELSE 0 END) AS matched,
 'Four-level framework manager-reviewed proficiency L'+ISNULL(JSON_VALUE(s.value,'$.minRank'),'')+' or above' AS criterion
 FROM OPENJSON(@requirements,'$.skills') s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))
 UNION ALL SELECT 'CERTIFICATION',CONVERT(varchar(36),c.id),c.name COLLATE DATABASE_DEFAULT,
 CONVERT(bit,CASE WHEN c.active=1 AND provider.active=1 AND EXISTS(SELECT 1 FROM dbo.CertificationRecord r WHERE r.account_id=@account AND r.person_id=@person AND r.status='APPROVED' AND (r.expiry_date IS NULL OR r.expiry_date>=CONVERT(date,SYSUTCDATETIME())) AND r.issue_date<=CONVERT(date,SYSUTCDATETIME()) AND r.certification_name COLLATE Latin1_General_100_CI_AS=c.name COLLATE Latin1_General_100_CI_AS AND r.provider COLLATE Latin1_General_100_CI_AS=provider.name COLLATE Latin1_General_100_CI_AS) THEN 1 ELSE 0 END),
 'Current manager-reviewed credential; exact master name and provider match (not issuer validation)'
 FROM OPENJSON(@requirements,'$.certifications') s JOIN dbo.CredentialDefinition c ON c.account_id=@account AND c.id=TRY_CONVERT(uniqueidentifier,s.value) JOIN dbo.CredentialProvider provider ON provider.account_id=c.account_id AND provider.id=c.provider_id
);

GO
CREATE OR ALTER PROCEDURE dbo.BusinessDashboard @account_id uniqueidentifier,@actor_id uniqueidentifier,@payload nvarchar(max),@export bit=0 AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.BusinessHasAccess(@account_id,@actor_id)<>1 OR @export=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=1 THROW 51003,'Business access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>10000 THROW 51000,'Invalid query.',1;
 DECLARE @asof datetime2=SYSUTCDATETIME(),@scopeSnapshot nvarchar(max)=JSON_QUERY(dbo.BusinessProjection(@account_id,@actor_id),'$.scopes');
 DECLARE @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@dataset varchar(20)=JSON_VALUE(@payload,'$.dataset'),@sort varchar(20)=ISNULL(JSON_VALUE(@payload,'$.sort'),'updated_desc'),@search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),
 @status varchar(20)=ISNULL(JSON_VALUE(@payload,'$.status'),''),@validity varchar(10)=ISNULL(JSON_VALUE(@payload,'$.validity'),''),@category nvarchar(80)=ISNULL(JSON_VALUE(@payload,'$.category'),''),@issuer nvarchar(120)=ISNULL(JSON_VALUE(@payload,'$.issuer'),''),
 @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.minRank')),@maxRank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.maxRank')),@page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),@from date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.from'),'')),@to date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.to'),'')),@today date=CONVERT(date,@asof);
 IF @sort NOT IN('employee_asc','employee_desc','name_asc','updated_desc','expiry_asc') THROW 51000,'Invalid sort.',1;
 IF @dataset IS NULL OR @dataset NOT IN('people','skills','certifications','submissions') OR @status NOT IN('','SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED') OR @validity NOT IN('','CURRENT','EXPIRED','14','30','60','90','15_30','31_60','61_90','NO_EXPIRY','LATER') OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 4 OR @maxRank IS NULL OR @maxRank NOT BETWEEN @rank AND 4 OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid filters.',1;
 IF JSON_VALUE(@payload,'$.scopeId') IS NOT NULL AND (@scope IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)) THROW 51003,'Selected scope unavailable.',1;
 SELECT p.person_id,p.display_name,p.employee_code INTO #people FROM dbo.AccessPerson p JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id AND (@search='' OR CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0);
 CREATE UNIQUE CLUSTERED INDEX IX_People ON #people(person_id);
 SELECT c.claim_id AS id,c.person_id,c.skill_id,c.skill_name AS name,c.category,c.claimed_rank AS recorded_rank,CASE WHEN EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') THEN c.claimed_rank ELSE NULL END AS rank,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at INTO #skills FROM dbo.SkillClaimDraft c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@skill IS NULL OR c.skill_id=@skill) AND (@rank=1 AND @maxRank=4 OR (CASE WHEN EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') THEN c.claimed_rank ELSE NULL END) BETWEEN @rank AND @maxRank);
 SELECT c.id,c.person_id,c.certification_name AS name,c.provider AS issuer,c.category,c.issue_date,c.expiry_date,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at INTO #certs FROM dbo.CertificationRecord c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today));
 DECLARE @rows nvarchar(max),@total int,@size int=CASE WHEN @export=1 THEN 50000 ELSE 25 END,@offset int=CASE WHEN @export=1 THEN 0 ELSE (@page-1)*25 END;
 IF @dataset='people' BEGIN
  SELECT @total=COUNT(*) FROM #people p WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id));
  SELECT @rows=(SELECT p.person_id AS id,p.display_name AS employee,p.employee_code AS employeeCode,(SELECT COUNT(*) FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') AS reviewedSkills,(SELECT COUNT(*) FROM #certs c WHERE c.person_id=p.person_id AND c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)) AS currentCertifications FROM #people p WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id)) ORDER BY CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort<>'employee_desc' THEN p.display_name END,p.person_id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH);
 END ELSE IF @dataset='submissions' BEGIN
  SELECT 'skill-'+CONVERT(varchar(36),s.id) AS id,s.person_id,'SKILL' AS type,s.name,s.category,s.status,s.reviewer_id,s.submitted_at,s.reviewed_at,s.updated_at INTO #submissions FROM #skills s WHERE @status='' OR s.status=@status
  UNION ALL SELECT 'certification-'+CONVERT(varchar(36),c.id),c.person_id,'CERTIFICATION',c.name,c.category,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at FROM #certs c WHERE @status='' OR c.status=@status;
  SELECT @total=COUNT(*) FROM #submissions;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.type,s.name,s.category,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt,CASE WHEN s.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=s.reviewer_id AND s.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN s.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #submissions s JOIN #people p ON p.person_id=s.person_id ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE IF @dataset='skills' BEGIN
  SELECT @total=COUNT(*) FROM #skills WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.name,s.category,s.recorded_rank AS recordedRank,s.rank AS chartRank,(SELECT COUNT(*) FROM dbo.SkillCertificationLink l JOIN dbo.CertificationRecord c ON c.account_id=l.account_id AND c.id=l.certification_id WHERE l.account_id=@account_id AND l.claim_id=s.id AND l.published=1 AND c.status='APPROVED') AS reviewedCertificates,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt,CASE WHEN s.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=s.reviewer_id AND s.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN s.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #skills s JOIN #people p ON p.person_id=s.person_id WHERE @status='' OR s.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE BEGIN
  SELECT @total=COUNT(*) FROM #certs WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT c.id,p.display_name AS employee,p.employee_code AS employeeCode,c.name,c.issuer,c.category,(SELECT COUNT(*) FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND l.published=1 AND s.status IN('SUBMITTED','APPROVED')) AS linkedSkills,c.status,CASE WHEN c.expiry_date IS NULL THEN 'NO_EXPIRY' WHEN c.expiry_date<@today THEN 'EXPIRED' ELSE 'CURRENT' END AS validity,c.issue_date AS issued,c.expiry_date AS expiry,c.submitted_at AS submittedAt,c.reviewed_at AS reviewedAt,CASE WHEN c.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=c.reviewer_id AND c.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN c.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #certs c JOIN #people p ON p.person_id=c.person_id WHERE @status='' OR c.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN c.name END,CASE WHEN @sort='expiry_asc' THEN COALESCE(c.expiry_date,'9999-12-31') END,c.updated_at DESC,c.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END;
 IF @export=1 AND @total>50000 THROW 51000,'Export exceeds 50000 rows. Narrow the filters.',1;
 SELECT (SELECT JSON_QUERY((SELECT @revision AS revision,@actor_id AS actorId,@asof AS asOf,CAST(1 AS bit) AS canView,CONVERT(bit,CASE WHEN dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(@scopeSnapshot) AS scopes FROM dbo.AccessWorkspace w WHERE w.account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS context,
 JSON_QUERY((SELECT (SELECT COUNT(*) FROM #people) AS employees,(SELECT COUNT(DISTINCT person_id) FROM #certs WHERE status='APPROVED' AND issue_date<=@today AND (expiry_date IS NULL OR expiry_date>=@today)) AS certified,(SELECT COUNT(DISTINCT person_id) FROM #skills WHERE status='APPROVED') AS skilled,(SELECT COUNT(*) FROM #skills WHERE status='SUBMITTED')+(SELECT COUNT(*) FROM #certs WHERE status='SUBMITTED') AS pending,(SELECT COUNT(*) FROM #certs WHERE expiry_date<@today) AS expired,(SELECT COUNT(*) FROM #certs WHERE expiry_date BETWEEN @today AND DATEADD(day,30,@today)) AS expiring FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS summary,
 JSON_QUERY((SELECT s.skill_id AS id,COALESCE(c.display_name COLLATE DATABASE_DEFAULT,s.name COLLATE DATABASE_DEFAULT) AS label,s.rank,COUNT(DISTINCT s.person_id) AS holders FROM #skills s LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account_id AND c.skill_id=s.skill_id WHERE s.status='APPROVED' AND s.rank IS NOT NULL AND s.skill_id IN(SELECT TOP(10) skill_id FROM #skills WHERE status='APPROVED' AND rank IS NOT NULL GROUP BY skill_id ORDER BY COUNT(DISTINCT person_id) DESC,skill_id) GROUP BY s.skill_id,COALESCE(c.display_name COLLATE DATABASE_DEFAULT,s.name COLLATE DATABASE_DEFAULT),s.rank ORDER BY label,s.rank FOR JSON PATH)) AS coverage,
 JSON_QUERY((SELECT TOP(15) issuer AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY issuer ORDER BY value DESC,issuer FOR JSON PATH)) AS distribution,
 JSON_QUERY((SELECT TOP(15) category AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY category ORDER BY value DESC,category FOR JSON PATH)) AS categories,
 JSON_QUERY((SELECT TOP(30) g.id,g.scope_kind AS kind,COALESCE(project.name,node.display_name,N'Organization') AS label,counts.employees,counts.certified,counts.skilled FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject project ON project.account_id=g.account_id AND project.id=g.scope_id AND g.scope_kind='PROJECT' LEFT JOIN dbo.AccessOrgNode node ON node.account_id=g.account_id AND node.node_id=g.scope_id AND g.scope_kind IN('DELIVERY_UNIT','DEPARTMENT') CROSS APPLY (SELECT COUNT(*) AS employees,ISNULL(SUM(holding.certified),0) AS certified,ISNULL(SUM(holding.skilled),0) AS skilled FROM #people p JOIN dbo.BusinessScopePeople(@account_id,g.scope_kind,g.scope_id) members ON members.person_id=p.person_id CROSS APPLY(SELECT CASE WHEN EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id AND c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)) THEN 1 ELSE 0 END AS certified,CASE WHEN EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') THEN 1 ELSE 0 END AS skilled) holding) counts WHERE g.account_id=@account_id AND g.person_id=@actor_id AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>@asof) AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,g.id)=1 ORDER BY label,g.id FOR JSON PATH)) AS comparisons,
 JSON_QUERY((SELECT CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END AS label,COUNT(*) AS value FROM #certs GROUP BY CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END FOR JSON PATH)) AS expiry,
 JSON_QUERY((SELECT CONVERT(char(7),at,126) AS label,SUM(submission) AS submissions,SUM(decision) AS decisions FROM (SELECT a.occurred_at AS at,CASE WHEN a.action IN('claim.submitted','certification.submitted') THEN 1 ELSE 0 END AS submission,CASE WHEN a.action IN('claim.submitted','certification.submitted') THEN 0 ELSE 1 END AS decision
 FROM dbo.AccessAudit a JOIN #people p ON p.person_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(a.after_json)=1 THEN a.after_json ELSE N'{}' END,'$.person_id'))
 WHERE a.account_id=@account_id AND (
 a.action IN('claim.submitted','claim.approved','claim.changes_requested','claim.rejected') AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft c WHERE c.account_id=@account_id AND c.claim_id=a.target_id AND c.person_id=p.person_id AND (@category='' OR c.category=@category) AND (@skill IS NULL OR c.skill_id=@skill) AND CASE WHEN c.claimed_rank>5 THEN 5 ELSE c.claimed_rank END BETWEEN @rank AND @maxRank)
 OR a.action IN('certification.submitted','certification.approved','certification.changes_requested','certification.rejected') AND EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.id=a.target_id AND c.person_id=p.person_id AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today))))) e WHERE (@from IS NULL OR at>=@from) AND (@to IS NULL OR at<DATEADD(day,1,@to)) GROUP BY CONVERT(char(7),at,126) ORDER BY label FOR JSON PATH)) AS activity,
 JSON_QUERY(@rows) AS rows,@total AS total,@page AS page,@size AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO

-- Existing saved legacy claims stay readable/editable against their own version.
-- New claims or a switch of definition must use the current four-level framework.
CREATE OR ALTER TRIGGER dbo.SkillCurrentFramework ON dbo.SkillClaimDraft AFTER INSERT,UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted n LEFT JOIN deleted d ON d.account_id=n.account_id AND d.claim_id=n.claim_id
 WHERE (d.claim_id IS NULL OR n.definition_revision<>d.definition_revision OR n.skill_id<>d.skill_id)
 AND NOT EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=n.account_id AND v.skill_id=n.skill_id AND v.definition_revision=n.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003'))
 THROW 51000,'Choose a skill aligned to the current four-level framework.',1;
END;
GO
