-- Shared fixed criteria on future catalogue saves; optional reciprocal suggestions.
-- Existing claims, definition versions and review policies are retained.
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
 -- Criteria are server-owned; per-version rows remain immutable historical snapshots.
 SET @payload=JSON_MODIFY(@payload,'$.levels',JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.ProficiencyLevel WHERE framework_id='00000000-0000-4000-8000-000000000003' ORDER BY rank FOR JSON PATH)));
 DECLARE @hasCredentialMapping bit=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='relatedCertificationIds') THEN 1 ELSE 0 END;
 DECLARE @credentials TABLE(id uniqueidentifier PRIMARY KEY);
 IF @hasCredentialMapping=1 BEGIN
  IF NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='relatedCertificationIds' AND type=4) OR (SELECT COUNT(*) FROM OPENJSON(@payload) WHERE [key]='relatedCertificationIds')<>1 THROW 51000,'Choose a certification array.',1;
  IF (SELECT COUNT(*) FROM OPENJSON(@payload,'$.relatedCertificationIds'))>20 OR EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.relatedCertificationIds') WHERE type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL) OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.relatedCertificationIds'))<>(SELECT COUNT(DISTINCT TRY_CONVERT(uniqueidentifier,value)) FROM OPENJSON(@payload,'$.relatedCertificationIds')) THROW 51000,'Choose up to twenty distinct certifications.',1;
  INSERT @credentials SELECT CONVERT(uniqueidentifier,value) FROM OPENJSON(@payload,'$.relatedCertificationIds');
  IF EXISTS(SELECT 1 FROM @credentials c LEFT JOIN dbo.CredentialDefinition d ON d.account_id=@account_id AND d.id=c.id LEFT JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE d.id IS NULL OR ((d.active<>1 OR p.active<>1) AND NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id AND m.credential_id=c.id))) THROW 51000,'Choose active certifications from this account.',1;
  IF EXISTS(SELECT 1 FROM @credentials c WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id AND m.credential_id=c.id) AND (SELECT COUNT(*) FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.credential_id=c.id)>=20) THROW 51000,'A certification can suggest up to twenty skills.',1;
 END;
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
 SELECT @before=(SELECT skill_id AS id,display_name AS name,category,description,status,business_code AS businessCode,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels,JSON_QUERY(COALESCE((SELECT '['+STRING_AGG('"'+CONVERT(varchar(36),m.credential_id)+'"',',')+']' FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id),'[]')) AS relatedCertificationIds FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @code varchar(20)=JSON_VALUE(@payload,'$.businessCode');
 IF @code IS NOT NULL AND (LEN(@code)<>7 OR @code COLLATE Latin1_General_100_BIN2 NOT LIKE 'SKL-[0-9][0-9][0-9]') THROW 51000,'Invalid business code.',1;
 IF @is_new=0 AND @code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id AND business_code=@code) THROW 51000,'Business codes are immutable.',1;
 IF @is_new=1 INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision,business_code) VALUES(@account_id,@target_id,@name,@category,@description,@status,@revision+1,@code);
 ELSE UPDATE dbo.SkillCatalogue SET display_name=@name,category=@category,description=@description,status=@status,definition_revision=@revision+1 WHERE account_id=@account_id AND skill_id=@target_id;
 INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status)
 VALUES(@account_id,@target_id,@revision+1,@framework,@name,@category,@description,@status);
 INSERT dbo.SkillVersionCriterion SELECT @account_id,@target_id,@revision+1,@framework,rank,description FROM @levels;
 IF @hasCredentialMapping=1 BEGIN
  DECLARE @changedCredentials TABLE(id uniqueidentifier PRIMARY KEY);
  INSERT @changedCredentials SELECT credential_id FROM dbo.CredentialSkillMapping WHERE account_id=@account_id AND skill_id=@target_id AND credential_id NOT IN(SELECT id FROM @credentials)
   UNION SELECT id FROM @credentials c WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id AND m.credential_id=c.id);
  DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND skill_id=@target_id AND credential_id NOT IN(SELECT id FROM @credentials);
  INSERT dbo.CredentialSkillMapping(account_id,credential_id,skill_id) SELECT @account_id,c.id,@target_id FROM @credentials c WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id AND m.credential_id=c.id);
  UPDATE d SET revision=revision+1 FROM dbo.CredentialDefinition d JOIN @changedCredentials c ON c.id=d.id WHERE d.account_id=@account_id;
 END;
 SELECT @after=(SELECT skill_id AS id,display_name AS name,category,description,status,business_code AS businessCode,definition_revision AS definitionRevision,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@target_id ORDER BY rank FOR JSON PATH)) AS levels,JSON_QUERY(COALESCE((SELECT '['+STRING_AGG('"'+CONVERT(varchar(36),m.credential_id)+'"',',')+']' FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=@target_id),'[]')) AS relatedCertificationIds FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,CASE @is_new WHEN 1 THEN 'skill.created' ELSE 'skill.updated' END,@target_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
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
 AND (ISNULL(@query,N'')=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,category)>0);
 SELECT @total=COUNT(*) FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 SELECT @revision AS revision,@manage AS canManage,@total AS total;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.description,s.status,s.business_code AS businessCode,s.definition_revision AS definitionRevision FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 SELECT m.skill_id AS skillId,d.id,d.name,p.name AS provider,CONVERT(bit,CASE WHEN d.active=1 AND p.active=1 THEN 1 ELSE 0 END) AS active
 FROM dbo.CredentialSkillMapping m JOIN @paged v ON v.id=m.skill_id JOIN dbo.CredentialDefinition d ON d.account_id=m.account_id AND d.id=m.credential_id JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id
 WHERE m.account_id=@account_id AND (@manage=1 OR d.active=1 AND p.active=1) ORDER BY d.name,d.id;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
 END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadCatalogueCertifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid catalogue page.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 THROW 51003,'Catalogue access denied.',1;
 SELECT d.id,d.name,p.name AS provider,d.active INTO #choices FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE d.account_id=@account_id AND d.active=1 AND p.active=1 AND (ISNULL(@query,'')='' OR CHARINDEX(@query,d.name)>0 OR CHARINDEX(@query,p.name)>0);
 SELECT @revision AS revision,COUNT(*) AS total FROM #choices;
 SELECT id,name,provider,active FROM #choices ORDER BY name,id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; THROW; END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadCatalogueCertifications TO [skill_management_runtime];

GO
-- Retain installed workflow permission, review and recovery checks.
DECLARE @workflow nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.BusinessWorkflow'));
IF @workflow IS NULL THROW 51000,'Business workflow must already be installed.',1;
IF CHARINDEX(N'JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=c.id ORDER BY rank FOR JSON PATH)) AS levels FROM #catalogue c',@workflow)=0 THROW 51000,'Catalogue workflow patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=c.id ORDER BY rank FOR JSON PATH)) AS levels FROM #catalogue c',N'JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=c.id ORDER BY rank FOR JSON PATH)) AS levels,JSON_QUERY((SELECT d.id,d.name,p.name AS provider,CONVERT(bit,CASE WHEN d.active=1 AND p.active=1 THEN 1 ELSE 0 END) AS active FROM dbo.CredentialSkillMapping m JOIN dbo.CredentialDefinition d ON d.account_id=m.account_id AND d.id=m.credential_id JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE m.account_id=@account_id AND m.skill_id=c.id ORDER BY d.name,d.id FOR JSON PATH)) AS relatedCertifications FROM #catalogue c');
IF CHARINDEX(N'  IF @id IS NULL OR @type IS NULL OR @type NOT IN(''SKILL'',''CERTIFICATION'',''PROVIDER'')',@workflow)=0 THROW 51000,'Catalogue workflow patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'  IF @id IS NULL OR @type IS NULL OR @type NOT IN(''SKILL'',''CERTIFICATION'',''PROVIDER'')',N'  IF @type=''SKILL'' BEGIN
   SET @definition=JSON_MODIFY(@definition,''$.levels'',JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.ProficiencyLevel WHERE framework_id=''00000000-0000-4000-8000-000000000003'' ORDER BY rank FOR JSON PATH)));
   IF JSON_QUERY(@definition,''$.relatedCertificationIds'') IS NOT NULL SET @definition=JSON_MODIFY(@definition,''$._originalCertificationIds'',JSON_QUERY(COALESCE((SELECT ''[''+STRING_AGG(''"''+CONVERT(varchar(36),credential_id)+''"'','','') WITHIN GROUP(ORDER BY credential_id)+'']'' FROM dbo.CredentialSkillMapping WHERE account_id=@account_id AND skill_id=@target),''[]'')));
  END;
  IF @id IS NULL OR @type IS NULL OR @type NOT IN(''SKILL'',''CERTIFICATION'',''PROVIDER'')');
IF CHARINDEX(N'    IF @type=''SKILL'' EXEC dbo.SaveSkillCatalogue',@workflow)=0 THROW 51000,'Catalogue workflow patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'    IF @type=''SKILL'' EXEC dbo.SaveSkillCatalogue',N'    IF @type=''SKILL'' AND JSON_QUERY(@definition,''$._originalCertificationIds'') IS NOT NULL AND JSON_QUERY(@definition,''$._originalCertificationIds'')<>COALESCE((SELECT ''[''+STRING_AGG(''"''+CONVERT(varchar(36),credential_id)+''"'','','') WITHIN GROUP(ORDER BY credential_id)+'']'' FROM dbo.CredentialSkillMapping WHERE account_id=@account_id AND skill_id=@target),''[]'') THROW 51009,''Certification associations changed. Submit a fresh amendment.'',1;
    IF @type=''SKILL'' EXEC dbo.SaveSkillCatalogue');
IF CHARINDEX(N'JSON_QUERY(definition) AS definition,JSON_QUERY(@currentDefinition)',@workflow)=0 THROW 51000,'Catalogue detail patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'JSON_QUERY(definition) AS definition,JSON_QUERY(@currentDefinition)',N'JSON_QUERY(JSON_MODIFY(JSON_MODIFY(definition,''$.relatedCertificationDetails'',JSON_QUERY((SELECT d.id,d.name,p.name AS provider FROM OPENJSON(definition,''$.relatedCertificationIds'') j JOIN dbo.CredentialDefinition d ON d.account_id=@account_id AND d.id=TRY_CONVERT(uniqueidentifier,j.value) JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id ORDER BY d.name,d.id FOR JSON PATH))),''$.relatedSkillDetails'',JSON_QUERY((SELECT c.skill_id AS id,c.display_name AS name FROM OPENJSON(definition,''$.relatedSkillIds'') j JOIN dbo.SkillCatalogue c ON c.account_id=@account_id AND c.skill_id=TRY_CONVERT(uniqueidentifier,j.value) ORDER BY c.display_name,c.skill_id FOR JSON PATH)))) AS definition,JSON_QUERY(@currentDefinition)');
IF CHARINDEX(N'ORDER BY rank FOR JSON PATH)) AS levels FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@detailTarget;',@workflow)=0 THROW 51000,'Catalogue detail patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'ORDER BY rank FOR JSON PATH)) AS levels FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@detailTarget;',N'ORDER BY rank FOR JSON PATH)) AS levels,JSON_QUERY(COALESCE((SELECT ''[''+STRING_AGG(''"''+CONVERT(varchar(36),credential_id)+''"'','','') WITHIN GROUP(ORDER BY credential_id)+'']'' FROM dbo.CredentialSkillMapping WHERE account_id=@account_id AND skill_id=@detailTarget),''[]'')) AS relatedCertificationIds,JSON_QUERY((SELECT d.id,d.name,p.name AS provider FROM dbo.CredentialSkillMapping m JOIN dbo.CredentialDefinition d ON d.account_id=m.account_id AND d.id=m.credential_id JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE m.account_id=@account_id AND m.skill_id=@detailTarget ORDER BY d.name,d.id FOR JSON PATH)) AS relatedCertificationDetails FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@detailTarget;');
IF CHARINDEX(N'@currentTargetRevision<>target_revision) THEN 1 ELSE 0 END) AS targetChanged',@workflow)=0 THROW 51000,'Catalogue detail patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'@currentTargetRevision<>target_revision) THEN 1 ELSE 0 END) AS targetChanged',N'@currentTargetRevision<>target_revision OR (type=''SKILL'' AND JSON_QUERY(definition,''$._originalCertificationIds'') IS NOT NULL AND JSON_QUERY(definition,''$._originalCertificationIds'')<>JSON_QUERY(@currentDefinition,''$.relatedCertificationIds''))) THEN 1 ELSE 0 END) AS targetChanged');
IF CHARINDEX(N'      DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND credential_id=@target;',@workflow)=0 THROW 51000,'Catalogue mapping limit patch anchor missing.',1;
SET @workflow=REPLACE(@workflow,N'      DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND credential_id=@target;',N'      IF EXISTS(SELECT 1 FROM OPENJSON(@definition,''$.relatedSkillIds'') j WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=TRY_CONVERT(uniqueidentifier,j.value) AND m.credential_id=@target) AND (SELECT COUNT(*) FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=TRY_CONVERT(uniqueidentifier,j.value))>=20) THROW 51000,''A skill can suggest up to twenty certifications.'',1;
      DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND credential_id=@target;');
SET @workflow=N'ALTER '+SUBSTRING(@workflow,CHARINDEX(N'PROCEDURE',UPPER(@workflow)),LEN(@workflow));
EXEC sys.sp_executesql @workflow;
