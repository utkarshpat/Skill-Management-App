-- Add the required framework without rewriting enterprise-v1 or historical snapshots.
DECLARE @constraint sysname;
SELECT @constraint=name FROM sys.check_constraints
WHERE parent_object_id=OBJECT_ID(N'dbo.ProficiencyFramework') AND definition LIKE '%enterprise-v1%';
IF @constraint IS NULL THROW 51000,'Expected the existing common-framework constraint.',1;
DECLARE @drop_constraint nvarchar(max)=N'ALTER TABLE dbo.ProficiencyFramework DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC(@drop_constraint);
ALTER TABLE dbo.ProficiencyFramework ADD CONSTRAINT CK_ProficiencyFramework_Common
 CHECK(account_id IS NOT NULL OR framework_key IN ('enterprise-v1','enterprise-v2'));
INSERT dbo.ProficiencyFramework(framework_id,account_id,framework_key)
 VALUES('00000000-0000-4000-8000-000000000002',NULL,'enterprise-v2');
INSERT dbo.ProficiencyLevel(framework_id,rank,display_name,description) VALUES
 ('00000000-0000-4000-8000-000000000002',1,N'Awareness',N'Understands concepts and terminology; participates in guided work.'),
 ('00000000-0000-4000-8000-000000000002',2,N'Foundation',N'Completes simple tasks independently.'),
 ('00000000-0000-4000-8000-000000000002',3,N'Practitioner',N'Handles standard professional tasks independently.'),
 ('00000000-0000-4000-8000-000000000002',4,N'Advanced',N'Solves complex problems, reviews work and guides others.'),
 ('00000000-0000-4000-8000-000000000002',5,N'Expert',N'Leads architecture, standards, strategy and advanced mentoring.');
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
 IF (SELECT COUNT(*) FROM @levels)<>5 OR EXISTS(SELECT 1 FROM @levels WHERE rank IS NULL OR rank NOT BETWEEN 1 AND 5 OR name IS NULL OR LEN(name)=0 OR DATALENGTH(name)>120 OR description IS NULL OR DATALENGTH(description)>2000 OR (@status='PUBLISHED' AND LEN(description)=0)) THROW 51000,'Define five levels with valid names and criteria; criteria are required before publishing.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.levels') WHERE type<>5 OR TRY_CONVERT(int,JSON_VALUE(value,'$.rank'))<>TRY_CONVERT(int,[key])+1) OR EXISTS(SELECT rank FROM @levels GROUP BY rank HAVING COUNT(*)>1) THROW 51000,'Use sequential proficiency levels.',1;
 DECLARE @framework uniqueidentifier='00000000-0000-4000-8000-000000000002';
 IF EXISTS(SELECT 1 FROM @levels x LEFT JOIN dbo.ProficiencyLevel l ON l.framework_id=@framework AND l.rank=x.rank AND l.display_name COLLATE Latin1_General_100_BIN2=x.name COLLATE Latin1_General_100_BIN2 WHERE l.rank IS NULL)
 THROW 51000,'Use exactly five levels: Awareness, Foundation, Practitioner, Advanced and Expert.',1;
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
