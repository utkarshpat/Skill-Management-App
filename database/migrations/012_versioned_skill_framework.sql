-- Preserve UUIDs and claim snapshots; normalize labels and retain every future definition version.
CREATE TABLE dbo.ProficiencyFramework (
 framework_id uniqueidentifier NOT NULL PRIMARY KEY,
 account_id uniqueidentifier NULL REFERENCES dbo.AccessWorkspace(account_id),
 framework_key varchar(60) NULL,
 CHECK(account_id IS NOT NULL OR framework_key='enterprise-v1')
);
CREATE UNIQUE INDEX UX_ProficiencyFramework_Common ON dbo.ProficiencyFramework(framework_key) WHERE account_id IS NULL;
CREATE TABLE dbo.ProficiencyLevel (
 framework_id uniqueidentifier NOT NULL REFERENCES dbo.ProficiencyFramework(framework_id),
 rank tinyint NOT NULL CHECK(rank BETWEEN 1 AND 8),
 display_name nvarchar(60) COLLATE Latin1_General_100_CI_AS NOT NULL,
 description nvarchar(1000) NOT NULL,
 PRIMARY KEY(framework_id,rank),UNIQUE(framework_id,display_name)
);
INSERT dbo.ProficiencyFramework VALUES('00000000-0000-4000-8000-000000000001',NULL,'enterprise-v1');
INSERT dbo.ProficiencyLevel VALUES
 ('00000000-0000-4000-8000-000000000001',1,N'Awareness',N'Understands concepts and terminology; participates in guided work.'),
 ('00000000-0000-4000-8000-000000000001',2,N'Beginner',N'Completes simple tasks independently.'),
 ('00000000-0000-4000-8000-000000000001',3,N'Intermediate',N'Handles standard professional tasks independently.'),
 ('00000000-0000-4000-8000-000000000001',4,N'Advanced',N'Solves complex problems, reviews work and guides others.'),
 ('00000000-0000-4000-8000-000000000001',5,N'Expert',N'Leads architecture, standards, strategy and advanced mentoring.');
ALTER TABLE dbo.SkillCatalogue ADD business_code varchar(20) NULL;
GO
CREATE UNIQUE INDEX UX_SkillCatalogue_Code ON dbo.SkillCatalogue(account_id,business_code) WHERE business_code IS NOT NULL;
CREATE TABLE dbo.SkillDefinitionVersion (
 account_id uniqueidentifier NOT NULL,skill_id uniqueidentifier NOT NULL,definition_revision int NOT NULL,
 framework_id uniqueidentifier NOT NULL REFERENCES dbo.ProficiencyFramework(framework_id),
 display_name nvarchar(100) NOT NULL,category nvarchar(80) NOT NULL,description nvarchar(2000) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,skill_id,definition_revision),UNIQUE(account_id,skill_id,definition_revision,framework_id),
 FOREIGN KEY(account_id,skill_id) REFERENCES dbo.SkillCatalogue(account_id,skill_id)
);
CREATE TABLE dbo.SkillVersionCriterion (
 account_id uniqueidentifier NOT NULL,skill_id uniqueidentifier NOT NULL,definition_revision int NOT NULL,
 framework_id uniqueidentifier NOT NULL,rank tinyint NOT NULL,description nvarchar(1000) NOT NULL,
 PRIMARY KEY(account_id,skill_id,definition_revision,rank),
 FOREIGN KEY(account_id,skill_id,definition_revision,framework_id) REFERENCES dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id),
 FOREIGN KEY(framework_id,rank) REFERENCES dbo.ProficiencyLevel(framework_id,rank)
);
-- Existing arbitrary 1..8-level catalogues retain their labels in a private framework.
DECLARE @legacy TABLE(account_id uniqueidentifier,skill_id uniqueidentifier,framework_id uniqueidentifier);
INSERT @legacy SELECT account_id,skill_id,NEWID() FROM dbo.SkillCatalogue;
INSERT dbo.ProficiencyFramework(framework_id,account_id) SELECT framework_id,account_id FROM @legacy;
INSERT dbo.ProficiencyLevel SELECT x.framework_id,l.rank,l.display_name,N'Custom framework level.' FROM dbo.SkillProficiencyLevel l JOIN @legacy x ON x.account_id=l.account_id AND x.skill_id=l.skill_id;
INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status)
 SELECT s.account_id,s.skill_id,s.definition_revision,x.framework_id,s.display_name,s.category,s.description,s.status FROM dbo.SkillCatalogue s JOIN @legacy x ON x.account_id=s.account_id AND x.skill_id=s.skill_id;
INSERT dbo.SkillVersionCriterion SELECT l.account_id,l.skill_id,s.definition_revision,x.framework_id,l.rank,l.description FROM dbo.SkillProficiencyLevel l JOIN dbo.SkillCatalogue s ON s.account_id=l.account_id AND s.skill_id=l.skill_id JOIN @legacy x ON x.account_id=l.account_id AND x.skill_id=l.skill_id;
-- Claim snapshots from older revisions remain readable; missing historical definitions cannot be reconstructed.
DROP TABLE dbo.SkillProficiencyLevel;
GO
CREATE VIEW dbo.SkillProficiencyLevel AS
 SELECT c.account_id,c.skill_id,c.rank,l.display_name,c.description
 FROM dbo.SkillVersionCriterion c JOIN dbo.SkillCatalogue s ON s.account_id=c.account_id AND s.skill_id=c.skill_id AND s.definition_revision=c.definition_revision
 JOIN dbo.ProficiencyLevel l ON l.framework_id=c.framework_id AND l.rank=c.rank;
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
 IF (SELECT COUNT(*) FROM @levels) NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM @levels WHERE rank IS NULL OR rank NOT BETWEEN 1 AND 8 OR name IS NULL OR LEN(name)=0 OR DATALENGTH(name)>120 OR description IS NULL OR DATALENGTH(description)>2000 OR (@status='PUBLISHED' AND LEN(description)=0)) THROW 51000,'Check proficiency names, descriptions and level count.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.levels') WHERE type<>5 OR TRY_CONVERT(int,JSON_VALUE(value,'$.rank'))<>TRY_CONVERT(int,[key])+1) OR EXISTS(SELECT rank FROM @levels GROUP BY rank HAVING COUNT(*)>1) OR EXISTS(SELECT name COLLATE Latin1_General_100_CI_AS FROM @levels GROUP BY name COLLATE Latin1_General_100_CI_AS HAVING COUNT(*)>1) THROW 51000,'Use sequential levels with unique names.',1;
 IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id) THROW 51004,'Skill unavailable.',1;
 IF @is_new=1 AND (SELECT COUNT(*) FROM dbo.SkillCatalogue WHERE account_id=@account_id)>=10000 THROW 51000,'Catalogue limit reached.',1;
 SELECT @before=(SELECT skill_id AS id,display_name AS name,category,description,status,business_code AS businessCode,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @code varchar(20)=JSON_VALUE(@payload,'$.businessCode');
 IF @code IS NOT NULL AND (LEN(@code)<>7 OR @code COLLATE Latin1_General_100_BIN2 NOT LIKE 'SKL-[0-9][0-9][0-9]') THROW 51000,'Invalid business code.',1;
 IF @is_new=0 AND @code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id AND business_code=@code) THROW 51000,'Business codes are immutable.',1;
 IF @is_new=1 INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision,business_code) VALUES(@account_id,@target_id,@name,@category,@description,@status,@revision+1,@code);
 ELSE UPDATE dbo.SkillCatalogue SET display_name=@name,category=@category,description=@description,status=@status,definition_revision=@revision+1 WHERE account_id=@account_id AND skill_id=@target_id;
 -- Reuse the five shared labels when they match; criteria are always specific to this version.
 DECLARE @framework uniqueidentifier;
 IF (SELECT COUNT(*) FROM @levels)=5 AND NOT EXISTS(SELECT 1 FROM @levels x LEFT JOIN dbo.ProficiencyLevel l ON l.framework_id='00000000-0000-4000-8000-000000000001' AND l.rank=x.rank AND l.display_name=x.name COLLATE Latin1_General_100_CI_AS WHERE l.rank IS NULL)
 SET @framework='00000000-0000-4000-8000-000000000001';
 ELSE
 BEGIN
 SELECT TOP 1 @framework=v.framework_id FROM dbo.SkillDefinitionVersion v
 WHERE v.account_id=@account_id AND v.skill_id=@target_id
 AND (SELECT COUNT(*) FROM dbo.ProficiencyLevel WHERE framework_id=v.framework_id)=(SELECT COUNT(*) FROM @levels)
 AND NOT EXISTS(SELECT 1 FROM @levels x LEFT JOIN dbo.ProficiencyLevel l ON l.framework_id=v.framework_id AND l.rank=x.rank AND l.display_name=x.name COLLATE Latin1_General_100_CI_AS WHERE l.rank IS NULL)
 ORDER BY v.definition_revision DESC;
 IF @framework IS NULL
 BEGIN
 SET @framework=NEWID();
 INSERT dbo.ProficiencyFramework(framework_id,account_id) VALUES(@framework,@account_id);
 INSERT dbo.ProficiencyLevel SELECT @framework,rank,name,N'Custom framework level.' FROM @levels;
 END;
 END;
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
-- Empty searches mean all eligible skills; CHARINDEX of an empty string must not hide every row.
CREATE OR ALTER PROCEDURE dbo.ReadSkillCatalogue
 @account_id uniqueidentifier,@actor_id uniqueidentifier,
 @query nvarchar(100)=N'',@status varchar(20)='',@page int=1
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 OR @status IS NULL OR @status NOT IN ('','DRAFT','PUBLISHED','ARCHIVED') THROW 51000,'Invalid catalogue filter.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int,@manage bit,@total int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 SET @manage=dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0);
 IF @manage<>1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Skill catalogue permission is not assigned.',1;
 -- A viewer can only see published definitions, including in search/counts.
 DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @visible SELECT skill_id FROM dbo.SkillCatalogue WHERE account_id=@account_id
 AND (@manage=1 OR status='PUBLISHED') AND (@status='' OR status=@status)
 AND (ISNULL(@query,N'')=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,category)>0);
 SELECT @total=COUNT(*) FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 SELECT @revision AS revision,@manage AS canManage,@total AS total;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.description,s.status,s.business_code AS businessCode,s.definition_revision AS definitionRevision FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadSkillCatalogue TO [skill_management_runtime];
GRANT EXECUTE ON dbo.SaveSkillCatalogue TO [skill_management_runtime];
