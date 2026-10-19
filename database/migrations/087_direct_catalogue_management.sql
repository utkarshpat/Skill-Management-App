-- Optional skill descriptions. Historical snapshots and criteria are unchanged.
DECLARE @skill nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.SaveSkillCatalogue'));
DECLARE @required nvarchar(max)=N' IF @status=''PUBLISHED'' AND LEN(@description)=0 THROW 51000,''Describe the skill before publishing.'',1;';
IF @skill IS NULL THROW 51000,'Catalogue procedure is unavailable. Install migration 086 and check metadata access.',1;
DECLARE @needsSkillChange bit=CASE WHEN CHARINDEX(@required,@skill)>0 THEN 1 ELSE 0 END;
-- A reviewed optional-description procedure may already be installed without ledger 087.
-- Preserve it; reject unrelated definitions rather than replaying migration 086.
IF @needsSkillChange=0 AND (
 CHARINDEX(N'-- Description is optional for drafts and published skills.',@skill)=0
 OR CHARINDEX(N'Describe the skill before publishing.',@skill)>0
 OR CHARINDEX(N'@hasCredentialMapping',@skill)=0
 OR CHARINDEX(N'SET @payload=JSON_MODIFY(@payload,''$.levels''',@skill)=0
 OR CHARINDEX(N'SkillDefinitionVersion',@skill)=0
) THROW 51000,'Catalogue procedure differs from reviewed migration 086/087. Review its definition before migrating.',1;
-- Migration 007 also enforced a nonempty published description at table level.
-- Remove only that exact legacy check; retain name/category, status and rank checks.
DECLARE @descriptionCheck sysname;
SELECT @descriptionCheck=name FROM sys.check_constraints
WHERE parent_object_id=OBJECT_ID(N'dbo.SkillCatalogue')
AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''))=N'status<>''published''orlenltrimrtrimdescription>0';
IF @descriptionCheck IS NOT NULL BEGIN
 DECLARE @dropCheck nvarchar(max)=N'ALTER TABLE dbo.SkillCatalogue DROP CONSTRAINT '+QUOTENAME(@descriptionCheck);
 EXEC sys.sp_executesql @dropCheck;
END;
-- An absent legacy check is already compatible; never remove unrelated constraints.
IF @needsSkillChange=1 BEGIN
 SET @skill=REPLACE(@skill,@required,N' -- Description is optional for drafts and published skills.');
 SET @skill=N'ALTER '+SUBSTRING(@skill,CHARINDEX(N'PROCEDURE',UPPER(@skill)),LEN(@skill));
 EXEC sys.sp_executesql @skill;
END;
GO
-- Direct writes use precisely the existing catalogue approval authority, not role labels.
-- SAVE_MASTER and recovery share identity, DENY, current-access and intent checks.
CREATE OR ALTER PROCEDURE dbo.SaveCatalogueMaster
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(30),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'request.approve')=1 THROW 51003,'Current catalogue approval authority required.',1;
 IF @operation IS NULL OR @operation NOT IN('SAVE_MASTER','RECOVER_MASTER') OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>40000 THROW 51000,'Invalid catalogue change.',1;
 DECLARE @command nvarchar(max)=JSON_MODIFY(@payload,'$.accessRevision',NULL),@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@expected int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@type varchar(20)=JSON_VALUE(@payload,'$.type'),@target uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.targetId')),@new bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.isNew')),@definition nvarchar(max)=JSON_QUERY(@payload,'$.definition');
 IF @id IS NULL OR @expected IS NULL OR @type IS NULL OR @type NOT IN('SKILL','CERTIFICATION','PROVIDER') OR @new IS NULL OR @definition IS NULL THROW 51000,'Invalid catalogue fields.',1;
 DECLARE @saved nvarchar(max);
 SELECT @saved=after_json FROM dbo.AccessAudit WHERE account_id=@account_id AND actor_id=@actor_id AND target_id=@id AND action='catalogue.master.saved';
 IF @saved IS NOT NULL BEGIN
  IF JSON_QUERY(@saved,'$.command') IS NULL OR JSON_QUERY(@saved,'$.command') COLLATE Latin1_General_100_BIN2<>@command COLLATE Latin1_General_100_BIN2 THROW 51009,'This save identifier was already used for a different change.',1;
  SELECT (SELECT @id AS id,JSON_VALUE(@saved,'$.targetId') AS targetId,CAST(1 AS bit) AS saved,CAST(1 AS bit) AS replayed FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END ELSE IF @operation='RECOVER_MASTER' SELECT N'null' AS json;
 ELSE BEGIN
  IF @revision<>@expected OR (JSON_VALUE(@payload,'$.accessRevision') IS NOT NULL AND TRY_CONVERT(int,JSON_VALUE(@payload,'$.accessRevision'))<>@revision) THROW 51009,'Catalogue changed. Preview the current change again.',1;
  IF @new=1 BEGIN
   IF @target IS NOT NULL THROW 51000,'A new entry cannot replace an existing entry.',1;
   SET @target=@id;
  END ELSE IF @target IS NULL THROW 51000,'Choose an existing catalogue entry.',1;
  DECLARE @name nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@definition,'$.name'))),@category nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@definition,'$.category'))),@description nvarchar(4000)=ISNULL(JSON_VALUE(@definition,'$.description'),''),@active bit=TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),@before nvarchar(max),@provider uniqueidentifier,@providerCreated bit=0;
  IF NULLIF(@name,'') IS NULL OR DATALENGTH(@name)>200 OR @active IS NULL OR DATALENGTH(@description)>4000 OR (@type<>'PROVIDER' AND (NULLIF(@category,'') IS NULL OR DATALENGTH(@category)>160)) THROW 51000,'Check catalogue name, category and description.',1;
  IF @type='SKILL' BEGIN
   EXEC dbo.SaveSkillCatalogue @account_id,@actor_id,@revision,@target,@new,@definition;
   -- SaveSkillCatalogue audits its own revision. Reserve the next for this intent receipt.
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
   SELECT @revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
  END ELSE BEGIN
   IF @type='PROVIDER' BEGIN
    SELECT @before=(SELECT id,name,active,revision FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@target FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    IF @new=0 AND NULLIF(@before,'') IS NULL THROW 51004,'Provider unavailable.',1;
    IF @new=1 INSERT dbo.CredentialProvider(account_id,id,name,active,revision) VALUES(@account_id,@target,@name,@active,1);
    ELSE UPDATE dbo.CredentialProvider SET name=@name,active=@active,revision=revision+1 WHERE account_id=@account_id AND id=@target;
   END ELSE BEGIN
    SELECT @before=(SELECT d.id,d.name,d.category,d.description,d.provider_id AS providerId,d.active,d.revision,JSON_QUERY(COALESCE((SELECT '['+STRING_AGG('"'+CONVERT(varchar(36),m.skill_id)+'"',',')+']' FROM dbo.CredentialSkillMapping m WHERE m.account_id=d.account_id AND m.credential_id=d.id),'[]')) AS relatedSkillIds FROM dbo.CredentialDefinition d WHERE d.account_id=@account_id AND d.id=@target FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    IF @new=0 AND NULLIF(@before,'') IS NULL THROW 51004,'Certification unavailable.',1;
    DECLARE @providerName nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@definition,'$.providerName')));
    SET @provider=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@definition,'$.providerId'));
    IF @providerName IS NOT NULL BEGIN
     IF @provider IS NOT NULL OR NULLIF(@providerName,'') IS NULL OR DATALENGTH(@providerName)>200 THROW 51000,'Choose a provider or enter its name.',1;
     SELECT @provider=id FROM dbo.CredentialProvider WHERE account_id=@account_id AND LOWER(LTRIM(RTRIM(name)))=LOWER(@providerName);
     IF @provider IS NULL BEGIN
      SET @provider=NEWID();SET @providerCreated=1;
      INSERT dbo.CredentialProvider(account_id,id,name,active,revision) VALUES(@account_id,@provider,@providerName,1,1);
     END;
    END;
    IF NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@provider AND active=1) THROW 51000,'Choose an active provider from this catalogue.',1;
    DECLARE @hasMappings bit=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(@definition) WHERE [key]='relatedSkillIds') THEN 1 ELSE 0 END;
    IF @hasMappings=1 BEGIN
     IF NOT EXISTS(SELECT 1 FROM OPENJSON(@definition) WHERE [key]='relatedSkillIds' AND type=4) OR (SELECT COUNT(*) FROM OPENJSON(@definition) WHERE [key]='relatedSkillIds')<>1 THROW 51000,'Choose a related-skills array.',1;
     IF (SELECT COUNT(*) FROM OPENJSON(@definition,'$.relatedSkillIds'))>20 OR EXISTS(SELECT 1 FROM OPENJSON(@definition,'$.relatedSkillIds') j LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account_id AND c.skill_id=TRY_CONVERT(uniqueidentifier,j.value) AND c.status='PUBLISHED' WHERE j.type<>1 OR DATALENGTH(j.value)<>72 OR c.skill_id IS NULL) OR (SELECT COUNT(*) FROM OPENJSON(@definition,'$.relatedSkillIds'))<>(SELECT COUNT(DISTINCT TRY_CONVERT(uniqueidentifier,value)) FROM OPENJSON(@definition,'$.relatedSkillIds')) THROW 51000,'Choose unique published skills from this account.',1;
     IF EXISTS(SELECT 1 FROM OPENJSON(@definition,'$.relatedSkillIds') j WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=CONVERT(uniqueidentifier,j.value) AND m.credential_id=@target) AND (SELECT COUNT(*) FROM dbo.CredentialSkillMapping m WHERE m.account_id=@account_id AND m.skill_id=CONVERT(uniqueidentifier,j.value))>=20) THROW 51000,'A skill can suggest up to twenty certifications.',1;
    END;
    IF @new=1 INSERT dbo.CredentialDefinition(account_id,id,name,provider_id,category,description,active,revision) VALUES(@account_id,@target,@name,@provider,@category,@description,@active,1);
    ELSE UPDATE dbo.CredentialDefinition SET name=@name,provider_id=@provider,category=@category,description=@description,active=@active,revision=revision+1 WHERE account_id=@account_id AND id=@target;
    IF @hasMappings=1 BEGIN
     DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND credential_id=@target;
     INSERT dbo.CredentialSkillMapping(account_id,credential_id,skill_id) SELECT @account_id,@target,CONVERT(uniqueidentifier,value) FROM OPENJSON(@definition,'$.relatedSkillIds');
    END;
   END;
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
   SET @revision=@revision+1;
  END;
  DECLARE @after nvarchar(max)=(SELECT JSON_QUERY(@command) AS command,@target AS targetId,@provider AS providerId,@providerCreated AS providerCreated FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@revision,@actor_id,'catalogue.master.saved',@id,NULLIF(@before,''),@after);
  SELECT (SELECT @id AS id,@target AS targetId,CAST(1 AS bit) AS saved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SaveCatalogueMaster TO [skill_management_runtime];
