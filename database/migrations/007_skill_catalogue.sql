-- Workspace-scoped technical skill definitions, independent of claims/evaluations.
CREATE TABLE dbo.SkillCatalogue (
 account_id uniqueidentifier NOT NULL REFERENCES dbo.AccessWorkspace(account_id),
 skill_id uniqueidentifier NOT NULL,
 display_name nvarchar(100) COLLATE Latin1_General_100_CI_AS NOT NULL,
 category nvarchar(80) NOT NULL,description nvarchar(2000) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
 definition_revision int NOT NULL CHECK(definition_revision>0),
 PRIMARY KEY(account_id,skill_id),UNIQUE(account_id,display_name),
 CHECK(LEN(LTRIM(RTRIM(display_name)))>0 AND LEN(LTRIM(RTRIM(category)))>0),
 CHECK(status<>'PUBLISHED' OR LEN(LTRIM(RTRIM(description)))>0)
);
CREATE INDEX IX_SkillCatalogue_Status ON dbo.SkillCatalogue(account_id,status,display_name);
CREATE TABLE dbo.SkillProficiencyLevel (
 account_id uniqueidentifier NOT NULL,skill_id uniqueidentifier NOT NULL,
 rank tinyint NOT NULL CHECK(rank BETWEEN 1 AND 8),
 display_name nvarchar(60) COLLATE Latin1_General_100_CI_AS NOT NULL,
 description nvarchar(1000) NOT NULL,
 PRIMARY KEY(account_id,skill_id,rank),UNIQUE(account_id,skill_id,display_name),
 FOREIGN KEY(account_id,skill_id) REFERENCES dbo.SkillCatalogue(account_id,skill_id),
 CHECK(LEN(LTRIM(RTRIM(display_name)))>0)
);
GO
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
 AND (CHARINDEX(ISNULL(@query,N''),display_name)>0 OR CHARINDEX(ISNULL(@query,N''),category)>0);
 SELECT @total=COUNT(*) FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 SELECT @revision AS revision,@manage AS canManage,@total AS total;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.description,s.status FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
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
 SELECT @before=(SELECT skill_id AS id,display_name AS name,category,description,status,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @is_new=1 INSERT dbo.SkillCatalogue VALUES(@account_id,@target_id,@name,@category,@description,@status,@revision+1);
 ELSE UPDATE dbo.SkillCatalogue SET display_name=@name,category=@category,description=@description,status=@status,definition_revision=@revision+1 WHERE account_id=@account_id AND skill_id=@target_id;
 DELETE dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id;
 INSERT dbo.SkillProficiencyLevel SELECT @account_id,@target_id,rank,name,description FROM @levels;
 SELECT @after=(SELECT skill_id AS id,display_name AS name,category,description,status,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,CASE @is_new WHEN 1 THEN 'skill.created' ELSE 'skill.updated' END,@target_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadSkillCatalogue TO [skill_management_runtime];
GRANT EXECUTE ON dbo.SaveSkillCatalogue TO [skill_management_runtime];
