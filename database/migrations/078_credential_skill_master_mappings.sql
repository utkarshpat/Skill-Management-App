-- Governed credential-to-skill defaults. No grants or employee claims are changed.
CREATE TABLE dbo.CredentialSkillMapping(
 account_id uniqueidentifier NOT NULL,credential_id uniqueidentifier NOT NULL,skill_id uniqueidentifier NOT NULL,
 PRIMARY KEY(account_id,credential_id,skill_id),
 FOREIGN KEY(account_id,credential_id) REFERENCES dbo.CredentialDefinition(account_id,id),
 FOREIGN KEY(account_id,skill_id) REFERENCES dbo.SkillCatalogue(account_id,skill_id));
GO
-- Catalogue request lifecycle; 065 reserved for deferred scheduler branch.
CREATE OR ALTER PROCEDURE dbo.BusinessWorkflow @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(30),@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;IF @operation IN('MASTERS','AMENDMENTS','AMENDMENT','DEMANDS','MATCHES') SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;ELSE SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 IF @operation IS NULL OR @operation NOT IN('MASTERS','AMENDMENTS','AMENDMENT','DEMANDS','PROPOSE','APPROVE_AMENDMENT','REJECT_AMENDMENT','SAVE_DEMAND','MATCHES','SHORTLIST') OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>40000 THROW 51000,'Invalid operation.',1;
 DECLARE @initial_revision int=@revision;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@expected int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@page int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1),@result nvarchar(max),@audit nvarchar(max),@action varchar(50),@manage bit=CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'request.approve')=0 THEN 1 ELSE 0 END);
 IF @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid page.',1;
 IF @operation='MASTERS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 AND @manage<>1 THROW 51003,'Catalogue access denied.',1;
  DECLARE @masterSearch nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),@includeInactive bit=ISNULL(TRY_CONVERT(bit,JSON_VALUE(@payload,'$.includeInactive')),0);
  IF @includeInactive=1 AND dbo.BusinessAmendCan(@account_id,@actor_id)<>1 AND @manage<>1 THROW 51003,'Retired definition access denied.',1;
  SELECT id,name,active INTO #providers FROM dbo.CredentialProvider WHERE account_id=@account_id AND (@includeInactive=1 OR active=1) AND (@masterSearch='' OR CHARINDEX(@masterSearch,name)>0);
  SELECT d.id,d.name,d.provider_id AS providerId,p.name AS provider,d.category,d.description,d.active,JSON_QUERY(COALESCE((SELECT '['+STRING_AGG('"'+CONVERT(varchar(36),m.skill_id)+'"',',')+']' FROM dbo.CredentialSkillMapping m WHERE m.account_id=d.account_id AND m.credential_id=d.id),'[]')) AS relatedSkillIds INTO #definitions FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE d.account_id=@account_id AND (@includeInactive=1 OR d.active=1 AND p.active=1) AND (@masterSearch='' OR CHARINDEX(@masterSearch,d.name)>0 OR CHARINDEX(@masterSearch,p.name)>0);
  SELECT skill_id AS id,display_name AS name,category,description,CONVERT(bit,CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) AS active INTO #catalogue FROM dbo.SkillCatalogue WHERE account_id=@account_id AND (@includeInactive=1 OR status='PUBLISHED') AND (@masterSearch='' OR CHARINDEX(@masterSearch,display_name)>0 OR CHARINDEX(@masterSearch,category)>0);
  SET @result=(SELECT @revision AS revision,@page AS page,25 AS pageSize,(SELECT COUNT(*) FROM #providers) AS providerTotal,(SELECT COUNT(*) FROM #definitions) AS certificationTotal,(SELECT COUNT(*) FROM #catalogue) AS skillTotal,
   JSON_QUERY((SELECT * FROM #providers ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS providers,
   JSON_QUERY((SELECT d.id,d.name,d.providerId,d.provider,d.category,d.description,d.active,JSON_QUERY(d.relatedSkillIds) AS relatedSkillIds FROM #definitions d ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS certifications,
   JSON_QUERY((SELECT c.*,JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=c.id ORDER BY rank FOR JSON PATH)) AS levels FROM #catalogue c ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS skills FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='AMENDMENTS' BEGIN
  IF dbo.BusinessAmendCan(@account_id,@actor_id)<>1 AND @manage<>1 THROW 51003,'Amendment access denied.',1;
  SET @result=(SELECT @revision AS revision,@manage AS canApprove,JSON_QUERY((SELECT m.id,m.person_id AS personId,p.display_name AS employee,m.type,m.target_id AS targetId,m.target_revision AS targetRevision,m.is_new AS isNew,JSON_QUERY(m.definition) AS definition,m.reason,m.status,m.revision,m.decision_note AS decisionNote,m.created_at AS createdAt,m.decided_at AS decidedAt FROM dbo.MasterAmendment m JOIN dbo.AccessPerson p ON p.account_id=m.account_id AND p.person_id=m.person_id WHERE m.account_id=@account_id AND (@manage=1 OR m.person_id=@actor_id) ORDER BY m.created_at DESC,m.id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES)) AS rows,(SELECT COUNT(*) FROM dbo.MasterAmendment WHERE account_id=@account_id AND (@manage=1 OR person_id=@actor_id)) AS total,@page AS page,25 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='AMENDMENT' BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id AND (@manage=1 OR person_id=@actor_id AND dbo.BusinessAmendCan(@account_id,@actor_id)=1)) THROW 51003,'Amendment unavailable.',1;
  DECLARE @detailType varchar(20),@detailTarget uniqueidentifier,@currentDefinition nvarchar(max),@currentTargetRevision int;
  SELECT @detailType=type,@detailTarget=target_id FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id;
  IF @detailType='SKILL' SELECT @currentTargetRevision=definition_revision,@currentDefinition=(SELECT display_name AS name,category,description,CONVERT(bit,CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) AS active,JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=@detailTarget ORDER BY rank FOR JSON PATH)) AS levels FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@detailTarget;
  ELSE IF @detailType='PROVIDER' SELECT @currentTargetRevision=revision,@currentDefinition=(SELECT name,active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@detailTarget;
  ELSE SELECT @currentTargetRevision=d.revision,@currentDefinition=(SELECT d.name,d.category,d.description,d.provider_id AS providerId,p.name AS provider,d.active,JSON_QUERY(COALESCE((SELECT '['+STRING_AGG('"'+CONVERT(varchar(36),m.skill_id)+'"',',')+']' FROM dbo.CredentialSkillMapping m WHERE m.account_id=d.account_id AND m.credential_id=d.id),'[]')) AS relatedSkillIds FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE d.account_id=@account_id AND d.id=@detailTarget;
  SET @result=(SELECT id,type,target_id AS targetId,target_revision AS targetRevision,is_new AS isNew,JSON_QUERY(definition) AS definition,JSON_QUERY(@currentDefinition) AS currentDefinition,@currentTargetRevision AS currentTargetRevision,CONVERT(bit,CASE WHEN is_new=0 AND (@currentTargetRevision IS NULL OR @currentTargetRevision<>target_revision) THEN 1 ELSE 0 END) AS targetChanged,reason,status,revision,decision_note AS decisionNote,created_at AS createdAt,decided_at AS decidedAt FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES);
 END ELSE IF @operation='PROPOSE' BEGIN
  IF dbo.BusinessAmendCan(@account_id,@actor_id)<>1 THROW 51003,'Only current direct managers or authorized Business Operations may propose amendments.',1;
  DECLARE @type varchar(20)=JSON_VALUE(@payload,'$.type'),@target uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.targetId')),@new bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.isNew')),@definition nvarchar(max)=JSON_QUERY(@payload,'$.definition'),@reason nvarchar(1000)=JSON_VALUE(@payload,'$.reason'),@targetRevision int;
  IF @id IS NULL OR @type IS NULL OR @type NOT IN('SKILL','CERTIFICATION','PROVIDER') OR @new IS NULL OR @definition IS NULL OR NULLIF(LTRIM(RTRIM(@reason)),'') IS NULL THROW 51000,'Invalid amendment.',1;
  IF EXISTS(SELECT 1 FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id) BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id AND person_id=@actor_id AND type=@type AND is_new=@new AND definition=@definition AND reason=@reason AND (@new=1 OR target_id=@target)) THROW 51009,'Amendment identifier already used.',1;
  END ELSE BEGIN
   IF @expected IS NULL OR @expected<>@revision THROW 51009,'Configuration changed. Review the current masters.',1;
   IF @new=1 SET @target=NEWID();ELSE IF @target IS NULL OR @type='SKILL' AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target) OR @type='PROVIDER' AND NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@target) OR @type='CERTIFICATION' AND NOT EXISTS(SELECT 1 FROM dbo.CredentialDefinition WHERE account_id=@account_id AND id=@target) THROW 51004,'Master record unavailable.',1;
   IF @new=0 BEGIN
    IF @type='SKILL' SELECT @targetRevision=definition_revision FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target;
    ELSE IF @type='PROVIDER' SELECT @targetRevision=revision FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@target;
    ELSE SELECT @targetRevision=revision FROM dbo.CredentialDefinition WHERE account_id=@account_id AND id=@target;
   END;
   -- Workspace update lock serializes proposals, including different request IDs.
   IF EXISTS(SELECT 1 FROM dbo.MasterAmendment WHERE account_id=@account_id AND type=@type AND status='SUBMITTED' AND ((@new=0 AND is_new=0 AND target_id=@target) OR (@new=1 AND is_new=1 AND LOWER(LTRIM(RTRIM(JSON_VALUE(definition,'$.name'))))=LOWER(LTRIM(RTRIM(JSON_VALUE(@definition,'$.name')))) AND (@type<>'CERTIFICATION' OR JSON_VALUE(definition,'$.providerId')=JSON_VALUE(@definition,'$.providerId'))))) THROW 51010,'A pending request already exists for this entry. Wait for its review before proposing another change.',1;
   INSERT dbo.MasterAmendment VALUES(@account_id,@id,@actor_id,@type,@target,@targetRevision,@new,@definition,@reason,'SUBMITTED',1,NULL,NULL,SYSUTCDATETIME(),NULL);SET @action='business.amendment.proposed';SET @audit=@payload;
  END;
  SET @result=(SELECT @id AS id,CAST(1 AS bit) AS saved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation IN('APPROVE_AMENDMENT','REJECT_AMENDMENT') BEGIN
  IF @manage<>1 THROW 51003,'System administration and catalogue authority required.',1;
  DECLARE @amendRevision int,@amendStatus varchar(20),@decision varchar(20)=CASE WHEN @operation='APPROVE_AMENDMENT' THEN 'APPROVED' ELSE 'REJECTED' END,@note nvarchar(1000)=JSON_VALUE(@payload,'$.note'),@proposer uniqueidentifier,@previousBy uniqueidentifier,@previousNote nvarchar(1000);
  SELECT @amendRevision=revision,@amendStatus=status,@type=type,@target=target_id,@targetRevision=target_revision,@new=is_new,@definition=definition,@proposer=person_id,@previousBy=decision_by,@previousNote=decision_note FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id;
  IF @amendRevision IS NULL THROW 51004,'Amendment unavailable.',1;
  IF @amendStatus=@decision AND @amendRevision=@expected+1 AND @previousBy=@actor_id AND @previousNote=@note SET @result=(SELECT @id AS id,CAST(1 AS bit) AS saved,CAST(1 AS bit) AS replayed FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  ELSE BEGIN
   IF @amendStatus<>'SUBMITTED' OR @expected IS NULL OR @expected<>@amendRevision THROW 51009,'Amendment changed. Review again.',1;
   IF NULLIF(LTRIM(RTRIM(@note)),'') IS NULL THROW 51000,'Add decision feedback.',1;
   IF @decision='APPROVED' BEGIN
    IF @new=0 AND (@targetRevision IS NULL OR @type='SKILL' AND NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@target AND definition_revision=@targetRevision) OR @type='PROVIDER' AND NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@target AND revision=@targetRevision) OR @type='CERTIFICATION' AND NOT EXISTS(SELECT 1 FROM dbo.CredentialDefinition WHERE account_id=@account_id AND id=@target AND revision=@targetRevision)) THROW 51009,'The target definition changed. Submit a fresh amendment.',1;
    IF NULLIF(LTRIM(RTRIM(JSON_VALUE(@definition,'$.name'))),'') IS NULL OR LEN(JSON_VALUE(@definition,'$.name'))>100 OR TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')) IS NULL THROW 51000,'Invalid master definition.',1;
    IF @type<>'PROVIDER' AND (NULLIF(LTRIM(RTRIM(JSON_VALUE(@definition,'$.category'))),'') IS NULL OR LEN(JSON_VALUE(@definition,'$.category'))>80) THROW 51000,'Invalid master category.',1;
    IF @type='SKILL' EXEC dbo.SaveSkillCatalogue @account_id,@actor_id,@revision,@target,@new,@definition;
    ELSE IF @type='PROVIDER' BEGIN
     IF @new=1 INSERT dbo.CredentialProvider VALUES(@account_id,@target,JSON_VALUE(@definition,'$.name'),TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),1);
     ELSE UPDATE dbo.CredentialProvider SET name=JSON_VALUE(@definition,'$.name'),active=TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),revision=revision+1 WHERE account_id=@account_id AND id=@target;
    END ELSE BEGIN
     DECLARE @provider uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@definition,'$.providerId'));
     IF NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider WHERE account_id=@account_id AND id=@provider AND active=1) THROW 51000,'Choose an active provider.',1;
     
     IF JSON_QUERY(@definition,'$.relatedSkillIds') IS NOT NULL BEGIN
      IF LEFT(LTRIM(JSON_QUERY(@definition,'$.relatedSkillIds')),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@definition,'$.relatedSkillIds'))>20 OR EXISTS(SELECT 1 FROM OPENJSON(@definition,'$.relatedSkillIds') j LEFT JOIN dbo.SkillCatalogue s ON s.account_id=@account_id AND s.skill_id=TRY_CONVERT(uniqueidentifier,j.value) AND s.status='PUBLISHED' WHERE j.type<>1 OR s.skill_id IS NULL) OR (SELECT COUNT(*) FROM OPENJSON(@definition,'$.relatedSkillIds'))<>(SELECT COUNT(DISTINCT TRY_CONVERT(uniqueidentifier,value)) FROM OPENJSON(@definition,'$.relatedSkillIds')) THROW 51000,'Choose unique published related skills from this account.',1;
     END;
     IF @new=1 INSERT dbo.CredentialDefinition VALUES(@account_id,@target,JSON_VALUE(@definition,'$.name'),@provider,JSON_VALUE(@definition,'$.category'),ISNULL(JSON_VALUE(@definition,'$.description'),''),TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),1);
     ELSE UPDATE dbo.CredentialDefinition SET name=JSON_VALUE(@definition,'$.name'),provider_id=@provider,category=JSON_VALUE(@definition,'$.category'),description=ISNULL(JSON_VALUE(@definition,'$.description'),''),active=TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),revision=revision+1 WHERE account_id=@account_id AND id=@target;
     IF JSON_QUERY(@definition,'$.relatedSkillIds') IS NOT NULL BEGIN
      DELETE dbo.CredentialSkillMapping WHERE account_id=@account_id AND credential_id=@target;
      INSERT dbo.CredentialSkillMapping(account_id,credential_id,skill_id) SELECT @account_id,@target,CONVERT(uniqueidentifier,value) FROM OPENJSON(@definition,'$.relatedSkillIds');
     END;
    END;
   END;
   UPDATE dbo.MasterAmendment SET status=@decision,revision=revision+1,decision_by=@actor_id,decision_note=@note,decided_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
   SET @action='business.amendment.'+LOWER(@decision);SET @audit=@payload;SET @result=(SELECT @id AS id,CAST(1 AS bit) AS saved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END;
 END ELSE IF @operation='DEMANDS' BEGIN
  IF dbo.BusinessHasAccess(@account_id,@actor_id)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'demand.view')=1 THROW 51003,'Demand access denied.',1;
  SET @result=(SELECT @revision AS revision,JSON_QUERY((SELECT d.id,d.title,d.description,d.scope_kind AS scopeKind,d.scope_id AS scopeId,JSON_QUERY(d.requirements) AS requirements,d.revision,d.created_at AS createdAt FROM dbo.BusinessDemand d WHERE d.account_id=@account_id AND dbo.BusinessDemandCan(@account_id,@actor_id,d.id)=1 ORDER BY d.created_at DESC,d.id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS rows,(SELECT COUNT(*) FROM dbo.BusinessDemand WHERE account_id=@account_id AND dbo.BusinessDemandCan(@account_id,@actor_id,id)=1) AS total,@page AS page,25 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='SAVE_DEMAND' BEGIN
  IF dbo.BusinessHasAccess(@account_id,@actor_id)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'demand.create')=1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'demand.view')=1 THROW 51003,'Demand creation denied.',1;
  DECLARE @grant uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@scopeKind varchar(20),@scope uniqueidentifier,@title nvarchar(150)=JSON_VALUE(@payload,'$.title'),@description nvarchar(2000)=ISNULL(JSON_VALUE(@payload,'$.description'),''),@requirements nvarchar(max)=JSON_QUERY(@payload,'$.requirements');
  SELECT @scopeKind=scope_kind,@scope=scope_id FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@grant AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1;
  IF @scopeKind IS NULL OR @id IS NULL OR NULLIF(LTRIM(RTRIM(@title)),'') IS NULL OR @requirements IS NULL OR (SELECT COUNT(*) FROM OPENJSON(@requirements,'$.skills'))+(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.certifications')) NOT BETWEEN 1 AND 20 THROW 51000,'Choose an allowed scope and valid demand.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@requirements,'$.skills') r LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account_id AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id')) AND c.status='PUBLISHED' WHERE c.skill_id IS NULL OR TRY_CONVERT(int,JSON_VALUE(r.value,'$.minRank')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(r.value,'$.minRank')) NOT BETWEEN 1 AND 5) OR EXISTS(SELECT 1 FROM OPENJSON(@requirements,'$.certifications') r LEFT JOIN dbo.CredentialDefinition d ON d.account_id=@account_id AND d.id=TRY_CONVERT(uniqueidentifier,r.value) AND d.active=1 LEFT JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1 WHERE d.id IS NULL OR p.id IS NULL) THROW 51000,'Choose published skills and active credentials.',1;
  IF EXISTS(SELECT 1 FROM dbo.BusinessDemand WHERE account_id=@account_id AND id=@id) BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.BusinessDemand WHERE account_id=@account_id AND id=@id AND person_id=@actor_id AND title=@title AND description=@description AND requirements=@requirements AND scope_kind=@scopeKind AND (scope_id=@scope OR scope_id IS NULL AND @scope IS NULL)) OR dbo.BusinessDemandCan(@account_id,@actor_id,@id)<>1 THROW 51009,'Demand identifier already used.',1;
  END ELSE BEGIN
   IF @expected IS NULL OR @expected<>@revision THROW 51009,'Access changed. Reload before creating demand.',1;
   INSERT dbo.BusinessDemand VALUES(@account_id,@id,@actor_id,@title,@description,@scopeKind,@scope,@requirements,1,SYSUTCDATETIME());
   IF dbo.BusinessDemandCan(@account_id,@actor_id,@id)<>1 THROW 51003,'Selected demand scope is denied.',1;
   SET @action='business.demand.created';SET @audit=@payload;
  END;
  SET @result=(SELECT @id AS id,CAST(1 AS bit) AS saved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation IN('MATCHES','SHORTLIST') BEGIN
  IF dbo.BusinessDemandCan(@account_id,@actor_id,@id)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.view')=1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.run')=1 THROW 51003,'Matching access denied.',1;
  SELECT @requirements=requirements,@scopeKind=scope_kind,@scope=scope_id,@amendRevision=revision FROM dbo.BusinessDemand WHERE account_id=@account_id AND id=@id;
  IF @operation='SHORTLIST' BEGIN
   DECLARE @person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId'));
   SET @note=JSON_VALUE(@payload,'$.note');
   IF dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.shortlist')=1 OR dbo.BusinessCan(@account_id,@actor_id,@person,NULL)<>1 OR dbo.BusinessScopeMatches(@account_id,@person,@scopeKind,@scope)<>1 THROW 51003,'Candidate unavailable in this scope.',1;
   IF @expected IS NULL OR @expected<>@amendRevision THROW 51009,'Demand changed. Match again.',1;
   IF (SELECT COUNT(*) FROM dbo.BusinessMatchRequirements(@account_id,@person,@requirements) WHERE matched=1)<>(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.skills'))+(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.certifications')) THROW 51009,'Candidate no longer meets every requirement.',1;
   IF EXISTS(SELECT 1 FROM dbo.BusinessShortlist WHERE account_id=@account_id AND demand_id=@id AND person_id=@person) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.BusinessShortlist WHERE account_id=@account_id AND demand_id=@id AND person_id=@person AND actor_id=@actor_id AND note=@note) THROW 51009,'Candidate already shortlisted. Refresh.',1;
   END ELSE BEGIN
    IF NULLIF(LTRIM(RTRIM(@note)),'') IS NULL THROW 51000,'Explain this shortlist.',1;
    INSERT dbo.BusinessShortlist VALUES(@account_id,@id,@person,@actor_id,@note,SYSUTCDATETIME());SET @action='business.candidate.shortlisted';SET @audit=@payload;
   END;
   SET @result=(SELECT @id AS id,CAST(1 AS bit) AS saved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE BEGIN
   SELECT p.person_id,p.display_name,p.employee_code,(SELECT COUNT(*) FROM dbo.BusinessMatchRequirements(@account_id,p.person_id,@requirements) WHERE matched=1) AS matched INTO #candidates FROM dbo.AccessPerson p JOIN dbo.BusinessScopePeople(@account_id,@scopeKind,@scope) membership ON membership.person_id=p.person_id JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,NULL) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id;
   DECLARE @required int=(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.skills'))+(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.certifications'));
   SET @result=(SELECT @id AS id,@amendRevision AS revision,SYSUTCDATETIME() AS asOf,@required AS required,(SELECT COUNT(*) FROM #candidates) AS total,@page AS page,25 AS pageSize,JSON_QUERY((SELECT p.person_id AS id,p.display_name AS employee,p.employee_code AS employeeCode,p.matched,CONVERT(bit,CASE WHEN p.matched=@required THEN 1 ELSE 0 END) AS eligible,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.BusinessShortlist WHERE account_id=@account_id AND demand_id=@id AND person_id=p.person_id) THEN 1 ELSE 0 END) AS shortlisted,JSON_QUERY((SELECT * FROM dbo.BusinessMatchRequirements(@account_id,p.person_id,@requirements) FOR JSON PATH)) AS criteria FROM #candidates p ORDER BY p.matched DESC,p.display_name,p.person_id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END;
 END;
 IF @action IS NOT NULL BEGIN
  IF TRY_CONVERT(int,JSON_VALUE(@payload,'$.accessRevision')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.accessRevision'))<>@initial_revision THROW 51009,'Access changed after preview. Review again.',1;
  SELECT @revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,occurred_at,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,@id,@action,SYSUTCDATETIME(),NULL,@audit);
 END;
 SELECT @result AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.BusinessWorkflow TO [skill_management_runtime];
GO

-- Actor-addressed notification projection; no audit payloads or unrelated people.
CREATE OR ALTER PROCEDURE dbo.BusinessAmendmentNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 DECLARE @manage bit=CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'request.approve')=0 THEN 1 ELSE 0 END);
 SELECT ISNULL((SELECT TOP(30) 'amendment-'+CONVERT(varchar(36),id)+'-'+CONVERT(varchar(12),revision) AS id,COALESCE(decided_at,created_at) AS at,
 CASE status WHEN 'SUBMITTED' THEN 'Catalogue request awaiting review' WHEN 'APPROVED' THEN 'Your catalogue request was approved' ELSE 'Your catalogue request was not approved' END AS title,
 CONCAT(JSON_VALUE(definition,'$.name'),CASE WHEN status='SUBMITTED' THEN ': review this proposed catalogue change.' ELSE ': '+ISNULL(decision_note,'Open the request for details.') END) AS body,
 '/skills?tab=amendments&request='+CONVERT(varchar(36),id) AS href
 FROM dbo.MasterAmendment WHERE account_id=@account_id AND ((status='SUBMITTED' AND @manage=1) OR (status<>'SUBMITTED' AND person_id=@actor_id AND dbo.BusinessAmendCan(@account_id,@actor_id)=1)) ORDER BY COALESCE(decided_at,created_at) DESC,id FOR JSON PATH),N'[]') AS json;
END;
GO
GRANT EXECUTE ON dbo.BusinessAmendmentNotifications TO [skill_management_runtime];
GO

-- Preserve exact saved rubric versions and renewal ancestry in capability reads.
-- Authorization, transactions, revision checks and workflow decisions remain unchanged.
CREATE OR ALTER PROCEDURE dbo.CapabilitySubmissionWorkspace @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(20),@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>500000 OR @operation NOT IN('SAVE','INTAKE','GET','MINE','QUEUE','SUBMIT','REROUTE','DECIDE','LINKS','OPTIONS','PUBLISH_LINKS','DISCARD','RESTORE') THROW 51000,'Invalid submission operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@revision int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@owner uniqueidentifier,@reviewer uniqueidentifier,@status varchar(20),@version int,@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Capability access denied.',1;
 IF @operation IN('MINE','OPTIONS','SAVE','INTAKE','SUBMIT','REROUTE','PUBLISH_LINKS','DISCARD','RESTORE') AND dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Personal skill access denied.',1;
 IF @operation='OPTIONS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Published catalogue claim access required.',1;
  SELECT (SELECT JSON_QUERY((SELECT c.claim_id AS id,c.revision,c.skill_id AS skillId,c.skill_name AS name,c.definition_revision AS definitionRevision,c.status,c.claimed_rank AS rank,c.experience_months AS experienceMonths,c.description,c.projects,c.evidence,c.last_used_on AS lastUsedOn FROM dbo.SkillClaimDraft c WHERE c.account_id=@account_id AND c.person_id=@actor_id FOR JSON PATH)) AS claims,
   JSON_QUERY((SELECT c.id,c.revision,c.certification_name AS certificationName,c.provider,c.category,c.issue_date AS certificationDate,c.expiry_date AS expiryDate,c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.notes,c.status,c.renewed_from_id AS renewedFromId,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord e WHERE e.account_id=c.account_id AND e.certification_id=c.id AND active=1) THEN 1 ELSE 0 END) AS hasImage FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.person_id=@actor_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS certifications,
   JSON_QUERY((SELECT d.id,d.name,p.name AS provider,d.category,d.description,d.revision,JSON_QUERY((SELECT s.skill_id AS id,s.display_name AS name,s.category,s.definition_revision AS definitionRevision,JSON_QUERY((SELECT c.rank,l.display_name AS name,c.description FROM dbo.SkillVersionCriterion c JOIN dbo.ProficiencyLevel l ON l.framework_id=c.framework_id AND l.rank=c.rank WHERE c.account_id=s.account_id AND c.skill_id=s.skill_id AND c.definition_revision=s.definition_revision ORDER BY c.rank FOR JSON PATH)) AS levels FROM dbo.CredentialSkillMapping m JOIN dbo.SkillCatalogue s ON s.account_id=m.account_id AND s.skill_id=m.skill_id AND s.status='PUBLISHED' WHERE m.account_id=d.account_id AND m.credential_id=d.id ORDER BY s.display_name,s.skill_id FOR JSON PATH)) AS relatedSkills FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1 WHERE d.account_id=@account_id AND d.active=1 FOR JSON PATH)) AS definitions FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  COMMIT;RETURN;
 END;
 IF @operation IN('MINE','QUEUE') BEGIN
  IF @operation='QUEUE' AND (dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessReportingValid(@account_id,@actor_id)<>1) THROW 51003,'Review denied.',1;
  SELECT (SELECT JSON_QUERY((SELECT TOP(50) b.id,b.revision,b.status,CONVERT(bit,CASE WHEN @operation='MINE' AND b.status='DRAFT' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canEdit,p.display_name AS name,COALESCE(JSON_VALUE(b.intake_json,'$.certifications[0].fields.certificationName'),JSON_VALUE(b.intake_json,'$.skills[0].choice.name'),(SELECT TOP(1) c.certification_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id),(SELECT TOP(1) s.skill_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N'Capability draft') AS label,b.updated_at AS updatedAt,
   CASE WHEN b.intake_json IS NOT NULL THEN (SELECT COUNT(*) FROM OPENJSON(b.intake_json,'$.skills')) ELSE (SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL') END AS skills,
   CASE WHEN b.intake_json IS NOT NULL THEN (SELECT COUNT(*) FROM OPENJSON(b.intake_json,'$.certifications')) ELSE (SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION') END AS certifications
   FROM dbo.CapabilitySubmission b JOIN dbo.AccessPerson p ON p.account_id=b.account_id AND p.person_id=b.person_id AND p.active=1
   WHERE b.account_id=@account_id AND b.status<>'DISCARDED' AND (@operation='MINE' AND b.person_id=@actor_id OR @operation='QUEUE' AND b.status='SUBMITTED' AND b.reviewer_id=@actor_id AND b.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id))
   AND (@operation='MINE' OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)=1 OR NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION'))
   ORDER BY CASE WHEN b.status IN('DRAFT','SUBMITTED') THEN 0 ELSE 1 END,b.updated_at DESC,b.id FOR JSON PATH)) AS records FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  COMMIT;RETURN;
 END;
 IF @operation='LINKS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Linked credential read denied.',1;
  DECLARE @kind varchar(20)=JSON_VALUE(@payload,'$.kind');
  IF @kind='SKILL' AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@id AND (person_id=@actor_id OR dbo.AccessCanReviewClaim(@account_id,@actor_id,@id,0)=1)) THROW 51003,'Skill links denied.',1;
  IF @kind='CERTIFICATION' AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id AND (person_id=@actor_id OR dbo.CertificationCanReview(@account_id,@actor_id,@id)=1)) THROW 51003,'Credential links denied.',1;
  IF @kind NOT IN('SKILL','CERTIFICATION') THROW 51000,'Invalid link kind.',1;
  SELECT (SELECT JSON_QUERY((SELECT l.claim_id AS claimId,s.skill_id AS skillId,s.skill_name AS skillName,l.certification_id AS certificationId,c.certification_name AS certificationName,c.provider,c.status,c.expiry_date AS expiryDate,l.submission_id AS submissionId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id JOIN dbo.CertificationRecord c ON c.account_id=l.account_id AND c.id=l.certification_id WHERE l.account_id=@account_id AND (@kind='SKILL' AND l.claim_id=@id OR @kind='CERTIFICATION' AND l.certification_id=@id) AND (s.person_id=@actor_id OR l.published=1 AND s.status IN('SUBMITTED','APPROVED') AND c.status IN('SUBMITTED','APPROVED')) FOR JSON PATH)) AS links FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  COMMIT;RETURN;
 END;
 IF @id IS NULL THROW 51000,'Invalid submission ID.',1;
 SELECT @owner=person_id,@reviewer=reviewer_id,@status=status,@version=revision FROM dbo.CapabilitySubmission WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id;
 IF @operation IN('DISCARD','RESTORE') BEGIN
  IF @owner IS NULL THROW 51004,'Draft unavailable.',1;
  IF @owner<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own editable draft required.',1;
  DECLARE @targetStatus varchar(20)=CASE WHEN @operation='DISCARD' THEN 'DISCARDED' ELSE 'DRAFT' END;
  IF @status=@targetStatus AND @revision IN(@version,@version-1) BEGIN
   SELECT (SELECT @id AS id,@version AS revision,@status AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json; COMMIT; RETURN;
  END;
  IF @revision IS NULL OR @revision<>@version THROW 51009,'Draft changed.',1;
  IF @operation='DISCARD' AND @status<>'DRAFT' OR @operation='RESTORE' AND @status<>'DISCARDED' THROW 51003,'Only unsubmitted drafts can be removed or restored.',1;
  IF @operation='RESTORE' AND EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmissionItem j ON j.account_id=i.account_id AND j.kind=i.kind AND j.record_id=i.record_id AND j.submission_id<>i.submission_id JOIN dbo.CapabilitySubmission b ON b.account_id=j.account_id AND b.id=j.submission_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.needs_review=1 AND b.status IN('DRAFT','SUBMITTED')) THROW 51010,'A draft item is now in another submission.',1;
  UPDATE dbo.CapabilitySubmission SET status=@targetStatus,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,@id,'capability.'+LOWER(@operation),(SELECT @status AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),(SELECT @targetStatus AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SELECT (SELECT @id AS id,@version+1 AS revision,@targetStatus AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json; COMMIT; RETURN;
 END;
 IF @status='DISCARDED' THROW 51004,'Draft was removed.',1;
 IF @operation IN('GET','DECIDE') AND (@owner=@actor_id OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='CERTIFICATION')) AND dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Credential or own skill read denied.',1;
 IF @operation IN('GET','DECIDE') AND @owner IS NULL THROW 51004,'Submission unavailable.',1;
 IF @owner IS NOT NULL AND @owner<>@actor_id AND NOT(@operation IN('GET','DECIDE') AND @reviewer=@actor_id AND @owner<>@actor_id AND @status<>'DRAFT' AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,@owner)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@owner AND active=1) AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner AND manager_id=@actor_id)) THROW 51003,'Assigned submission denied.',1;
 IF @operation<>'GET' AND (@revision IS NULL OR @revision<>ISNULL(@version,0)) THROW 51009,'Submission changed.',1;
 IF @operation='INTAKE' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 OR @status IS NOT NULL AND @status<>'DRAFT' THROW 51003,'Own editable intake required.',1;
  IF JSON_QUERY(@payload,'$.skills') IS NULL OR JSON_QUERY(@payload,'$.certifications') IS NULL OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.skills'))>10 OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.certifications'))>10 THROW 51000,'Invalid intake size.',1;
  IF @owner IS NULL INSERT dbo.CapabilitySubmission(account_id,id,person_id,revision,status,intake_json) VALUES(@account_id,@id,@actor_id,1,'DRAFT',@payload);
  ELSE UPDATE dbo.CapabilitySubmission SET revision=revision+1,intake_json=@payload,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END;
 IF @operation='SAVE' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own editing denied.',1;
  IF @status IS NOT NULL AND @status<>'DRAFT' THROW 51010,'Submission is locked.',1;
  IF JSON_QUERY(@payload,'$.skills') IS NULL OR JSON_QUERY(@payload,'$.certifications') IS NULL OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.skills')) NOT BETWEEN 1 AND 10 OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.certifications'))>10 THROW 51000,'Invalid item count.',1;
  IF @owner IS NULL INSERT dbo.CapabilitySubmission(account_id,id,person_id,revision,status) VALUES(@account_id,@id,@actor_id,1,'DRAFT');
  ELSE UPDATE dbo.CapabilitySubmission SET revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) AS id,TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.skillId')) AS skillId,TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) AS revision,JSON_QUERY(value,'$.fields') AS fields INTO #s FROM OPENJSON(@payload,'$.skills');
  SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) AS id,TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) AS revision,JSON_QUERY(value,'$.fields') AS fields,JSON_QUERY(value,'$.skillIds') AS skillIds,TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.renewedFromId')) AS renewedFromId INTO #c FROM OPENJSON(@payload,'$.certifications');
  IF EXISTS(SELECT 1 FROM #s WHERE id IS NULL OR skillId IS NULL OR revision IS NULL OR revision<0) OR EXISTS(SELECT 1 FROM #c WHERE id IS NULL OR revision IS NULL OR revision<0 OR skillIds IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(skillIds))) OR EXISTS(SELECT id FROM #s GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT skillId FROM #s GROUP BY skillId HAVING COUNT(*)>1) OR EXISTS(SELECT id FROM #c GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM #s JOIN #c ON #s.id=#c.id) THROW 51000,'Invalid members.',1;
  IF EXISTS(SELECT 1 FROM #c c CROSS APPLY OPENJSON(c.skillIds) j WHERE NOT EXISTS(SELECT 1 FROM #s s WHERE s.skillId=TRY_CONVERT(uniqueidentifier,j.value))) THROW 51000,'Related skill missing.',1;
  IF EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE b.account_id=@account_id AND b.id<>@id AND b.status IN('DRAFT','SUBMITTED') AND i.needs_review=1 AND (i.kind='SKILL' AND i.record_id IN(SELECT id FROM #s) OR i.kind='CERTIFICATION' AND i.record_id IN(SELECT id FROM #c))) THROW 51010,'An item is already in review.',1;
  DECLARE @record uniqueidentifier,@r int,@fields nvarchar(max),@save nvarchar(max);
  DECLARE skills CURSOR LOCAL FAST_FORWARD FOR SELECT id,revision,fields FROM #s;OPEN skills;FETCH NEXT FROM skills INTO @record,@r,@fields;
  WHILE @@FETCH_STATUS=0 BEGIN
   IF @fields IS NOT NULL EXEC dbo.SaveOwnSkillClaim @account_id,@actor_id,@record,@r,@fields;
   ELSE IF NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@record AND person_id=@actor_id AND revision=@r AND status='APPROVED') THROW 51003,'Only owned reviewed skills can be reused.',1;
   IF NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft s JOIN #s x ON x.id=s.claim_id AND x.skillId=s.skill_id WHERE s.account_id=@account_id AND s.claim_id=@record AND s.person_id=@actor_id) THROW 51003,'Skill ownership mismatch.',1;
   FETCH NEXT FROM skills INTO @record,@r,@fields;
  END;CLOSE skills;DEALLOCATE skills;
  DECLARE certs CURSOR LOCAL FAST_FORWARD FOR SELECT id,revision,fields FROM #c;OPEN certs;FETCH NEXT FROM certs INTO @record,@r,@fields;
  WHILE @@FETCH_STATUS=0 BEGIN
   DECLARE @renewal uniqueidentifier;SELECT @renewal=renewedFromId FROM #c WHERE id=@record;
   IF @fields IS NOT NULL BEGIN SET @save=(SELECT @record AS id,@r AS revision,JSON_QUERY(@fields) AS fields,@renewal AS renewedFromId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER); EXEC dbo.CertificationWorkspace @account_id,@actor_id,'SAVE',@save; END
   ELSE IF NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@record AND person_id=@actor_id AND revision=@r AND status='APPROVED') THROW 51003,'Only owned reviewed credentials can be reused.',1;
   IF @renewal IS NOT NULL EXEC dbo.LinkCertificationRenewal @account_id,@actor_id,@record,@renewal;
   FETCH NEXT FROM certs INTO @record,@r,@fields;
  END;CLOSE certs;DEALLOCATE certs;
  DECLARE @file uniqueidentifier,@blob varchar(160),@bytes int,@width int,@height int,@mime varchar(100),@filename nvarchar(255);
  DECLARE intakeFiles CURSOR LOCAL FAST_FORWARD FOR SELECT f.certification_id,f.evidence_id,f.blob_name,f.bytes,f.width,f.height,f.mime_type,f.file_name FROM dbo.CapabilityIntakeFile f JOIN #c c ON c.id=f.certification_id WHERE f.account_id=@account_id AND f.submission_id=@id AND f.active=1 AND f.transferred=0 AND c.fields IS NOT NULL;
  OPEN intakeFiles;FETCH NEXT FROM intakeFiles INTO @record,@file,@blob,@bytes,@width,@height,@mime,@filename;
  WHILE @@FETCH_STATUS=0 BEGIN
   SELECT @r=revision FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@record AND person_id=@actor_id;
   EXEC dbo.CertificationImage @account_id=@account_id,@actor_id=@actor_id,@claim_id=@record,@operation='ADD',@expected_revision=@r,@evidence_id=@file,@blob_name=@blob,@bytes=@bytes,@width=@width,@height=@height,@mime_type=@mime,@file_name=@filename;
   UPDATE dbo.CapabilityIntakeFile SET transferred=1 WHERE account_id=@account_id AND submission_id=@id AND certification_id=@record AND evidence_id=@file;
   FETCH NEXT FROM intakeFiles INTO @record,@file,@blob,@bytes,@width,@height,@mime,@filename;
  END;CLOSE intakeFiles;DEALLOCATE intakeFiles;
  UPDATE dbo.CapabilitySubmission SET intake_json=NULL WHERE account_id=@account_id AND id=@id;
  DELETE dbo.SkillCertificationLink WHERE account_id=@account_id AND submission_id=@id AND published=0;
  DELETE dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id;
  INSERT dbo.SkillCertificationLink(account_id,claim_id,certification_id,submission_id) SELECT @account_id,s.id,c.id,@id FROM #c c CROSS APPLY OPENJSON(c.skillIds) j JOIN #s s ON s.skillId=TRY_CONVERT(uniqueidentifier,j.value) WHERE NOT EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l WHERE l.account_id=@account_id AND l.claim_id=s.id AND l.certification_id=c.id);
  INSERT dbo.CapabilitySubmissionItem(account_id,submission_id,kind,record_id,needs_review) SELECT @account_id,@id,'SKILL',s.id,CASE WHEN c.status='APPROVED' THEN 0 ELSE 1 END FROM #s s JOIN dbo.SkillClaimDraft c ON c.account_id=@account_id AND c.claim_id=s.id
   UNION ALL SELECT @account_id,@id,'CERTIFICATION',s.id,CASE WHEN c.status='APPROVED' THEN 0 ELSE 1 END FROM #c s JOIN dbo.CertificationRecord c ON c.account_id=@account_id AND c.id=s.id;
 END;
 IF @operation IN('SUBMIT','REROUTE','PUBLISH_LINKS') BEGIN
  IF @owner<>@actor_id OR (@operation='REROUTE' AND @status<>'SUBMITTED' OR @operation<>'REROUTE' AND @status<>'DRAFT') OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own submission required.',1;
  IF @operation<>'PUBLISH_LINKS' AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND needs_review=1) THROW 51000,'There are no new claims to review.',1;
  IF @operation='PUBLISH_LINKS' AND (EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND needs_review=1) OR NOT EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l JOIN dbo.CapabilitySubmissionItem i ON i.account_id=l.account_id AND i.record_id=l.certification_id AND i.kind='CERTIFICATION' AND i.submission_id=@id WHERE l.account_id=@account_id AND l.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL'))) THROW 51000,'Only links between previously reviewed records can be published without another review.',1;
  SELECT 'SKILL' AS kind,TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) AS id,TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) AS revision INTO #expected FROM OPENJSON(@payload,'$.skills') UNION ALL SELECT 'CERTIFICATION',TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) FROM OPENJSON(@payload,'$.certifications');
  IF (SELECT COUNT(*) FROM #expected)<>(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id) OR EXISTS(SELECT kind,id FROM #expected GROUP BY kind,id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i LEFT JOIN #expected e ON e.kind=i.kind AND e.id=i.record_id LEFT JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id AND i.kind='SKILL' LEFT JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id AND i.kind='CERTIFICATION' WHERE i.account_id=@account_id AND i.submission_id=@id AND (e.id IS NULL OR e.revision<>COALESCE(s.revision,c.revision))) THROW 51009,'A submitted item changed.',1;
  DECLARE @oldReviewer uniqueidentifier=@reviewer;
  IF @operation<>'PUBLISH_LINKS' BEGIN
   SELECT @reviewer=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
   IF @reviewer IS NULL OR @reviewer=@actor_id OR dbo.AccessReportingValid(@account_id,@actor_id)<>1 THROW 51011,'Reporting manager unavailable.',1;
   IF @operation='REROUTE' AND @oldReviewer=@reviewer THROW 51010,'This request is already assigned to your current manager.',1;
  END;
  UPDATE dbo.CapabilitySubmission SET status='SUBMITTING' WHERE account_id=@account_id AND id=@id;
  UPDATE l SET published=1 FROM dbo.SkillCertificationLink l WHERE l.account_id=@account_id AND l.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL') AND l.certification_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='CERTIFICATION');
  DECLARE submitItems CURSOR LOCAL FAST_FORWARD FOR SELECT kind,record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND needs_review=1 ORDER BY kind,record_id;
  DECLARE @k varchar(20);OPEN submitItems;FETCH NEXT FROM submitItems INTO @k,@record;
  WHILE @@FETCH_STATUS=0 BEGIN
   IF @k='SKILL' BEGIN SELECT @r=revision FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@record; EXEC dbo.TransitionSkillClaim @account_id,@actor_id,@record,@r,'SUBMIT',N''; END
   ELSE BEGIN SELECT @r=revision FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@record; SET @save=(SELECT @record AS id,@r AS revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER); EXEC dbo.CertificationWorkspace @account_id,@actor_id,'SUBMIT',@save; END;
   FETCH NEXT FROM submitItems INTO @k,@record;
  END;CLOSE submitItems;DEALLOCATE submitItems;
  UPDATE i SET snapshot_json=CASE WHEN kind='SKILL' THEN (SELECT s.* FROM dbo.SkillClaimDraft s WHERE s.account_id=i.account_id AND s.claim_id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) ELSE (SELECT c.* FROM dbo.CertificationRecord c WHERE c.account_id=i.account_id AND c.id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END FROM dbo.CapabilitySubmissionItem i WHERE account_id=@account_id AND submission_id=@id;
  UPDATE i SET snapshot_json=JSON_MODIFY(i.snapshot_json,'$.files',JSON_QUERY(CASE WHEN kind='SKILL' THEN (SELECT e.evidence_id AS id,e.blob_name AS blobName,e.bytes,'image/webp' AS mimeType,'evidence.webp' AS fileName FROM dbo.SkillClaimEvidence e WHERE e.account_id=i.account_id AND e.claim_id=i.record_id FOR JSON PATH) ELSE (SELECT e.evidence_id AS id,e.blob_name AS blobName,e.bytes,e.mime_type AS mimeType,e.file_name AS fileName FROM dbo.CertificationImageRecord e WHERE e.account_id=i.account_id AND e.certification_id=i.record_id AND e.active=1 FOR JSON PATH) END)) FROM dbo.CapabilitySubmissionItem i WHERE account_id=@account_id AND submission_id=@id;
  UPDATE i SET snapshot_json=JSON_MODIFY(i.snapshot_json,'$.relatedSkills',JSON_QUERY((SELECT s.skill_id AS skillId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=i.account_id AND l.certification_id=i.record_id AND l.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL') FOR JSON PATH))) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='CERTIFICATION';
  IF @operation='PUBLISH_LINKS' AND (EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='SKILL' AND s.status<>'APPROVED') OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='CERTIFICATION' AND c.status<>'APPROVED')) THROW 51010,'Reviewed records changed. Refresh before linking.',1;
  IF @operation='PUBLISH_LINKS' UPDATE i SET decision_json=CASE WHEN kind='SKILL' THEN (SELECT s.revision,s.status,s.feedback FROM dbo.SkillClaimDraft s WHERE s.account_id=i.account_id AND s.claim_id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) ELSE (SELECT c.revision,c.status,c.feedback FROM dbo.CertificationRecord c WHERE c.account_id=i.account_id AND c.id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END FROM dbo.CapabilitySubmissionItem i WHERE account_id=@account_id AND submission_id=@id;
  UPDATE dbo.CapabilitySubmission SET reviewer_id=CASE WHEN @operation='PUBLISH_LINKS' THEN NULL ELSE @reviewer END,status=CASE WHEN @operation='PUBLISH_LINKS' THEN 'LINKED' ELSE 'SUBMITTED' END,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END;
 IF @operation='DECIDE' BEGIN
  IF @status<>'SUBMITTED' OR @reviewer<>@actor_id OR @owner=@actor_id THROW 51003,'Assigned review required.',1;
  SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) AS id,JSON_VALUE(value,'$.kind') AS kind,TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) AS revision,JSON_VALUE(value,'$.action') AS action,JSON_VALUE(value,'$.feedback') AS feedback INTO #d FROM OPENJSON(@payload,'$.decisions');
  IF (SELECT COUNT(*) FROM #d)<>(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND needs_review=1) OR EXISTS(SELECT kind,id FROM #d GROUP BY kind,id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM #d d WHERE NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=@account_id AND i.submission_id=@id AND i.needs_review=1 AND i.kind=d.kind AND i.record_id=d.id)) THROW 51000,'Review all pending items exactly once.',1;
  -- Close the bundle inside the same transaction before item transitions. The
  -- grouped-item triggers prevent external endpoints from partially reviewing it.
  UPDATE dbo.CapabilitySubmission SET status='REVIEWED' WHERE account_id=@account_id AND id=@id;
  DECLARE @action varchar(20),@feedback nvarchar(2000);DECLARE decisions CURSOR LOCAL FAST_FORWARD FOR SELECT kind,id,revision,action,feedback FROM #d ORDER BY kind,id;OPEN decisions;FETCH NEXT FROM decisions INTO @k,@record,@r,@action,@feedback;
  WHILE @@FETCH_STATUS=0 BEGIN
   IF @k='SKILL' EXEC dbo.TransitionSkillClaim @account_id,@actor_id,@record,@r,@action,@feedback;
   ELSE BEGIN SET @save=(SELECT @record AS id,@r AS revision,@feedback AS feedback FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);EXEC dbo.CertificationWorkspace @account_id,@actor_id,@action,@save;END;
   FETCH NEXT FROM decisions INTO @k,@record,@r,@action,@feedback;
  END;CLOSE decisions;DEALLOCATE decisions;
  UPDATE i SET decision_json=CASE WHEN kind='SKILL' THEN (SELECT s.revision,s.status,s.feedback FROM dbo.SkillClaimDraft s WHERE s.account_id=i.account_id AND s.claim_id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) ELSE (SELECT c.revision,c.status,c.feedback FROM dbo.CertificationRecord c WHERE c.account_id=i.account_id AND c.id=i.record_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END FROM dbo.CapabilitySubmissionItem i WHERE account_id=@account_id AND submission_id=@id;
  UPDATE dbo.CapabilitySubmission SET status='REVIEWED',revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END;
 IF @operation<>'GET' BEGIN
  SELECT @workspace=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json) VALUES(@account_id,@workspace+1,@actor_id,@id,'capability.'+LOWER(@operation),(SELECT @id AS id,@actor_id AS actorId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 END;
 SELECT (SELECT b.id,b.revision,b.status,CONVERT(bit,CASE WHEN b.person_id=@actor_id AND b.status='SUBMITTED' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson m ON m.account_id=o.account_id AND m.person_id=o.manager_id AND m.active=1 WHERE o.account_id=@account_id AND o.person_id=@actor_id AND o.manager_id<>b.reviewer_id AND o.manager_id<>@actor_id) THEN 1 ELSE 0 END) AS canReroute,b.person_id AS personId,b.reviewer_id AS reviewerId,JSON_QUERY(b.intake_json) AS intake,JSON_QUERY((SELECT certification_id AS certificationId,evidence_id AS id,file_name AS fileName,mime_type AS mimeType,bytes FROM dbo.CapabilityIntakeFile WHERE account_id=@account_id AND submission_id=@id AND active=1 AND transferred=0 FOR JSON PATH)) AS stagedFiles,
 JSON_QUERY((SELECT i.record_id AS id,s.skill_id AS skillId,CASE WHEN b.status='DRAFT' THEN s.skill_name ELSE JSON_VALUE(i.snapshot_json,'$.skill_name') END AS name,CASE WHEN b.status='DRAFT' THEN s.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,s.revision,CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END AS definitionRevision,CASE WHEN b.status='DRAFT' THEN s.claimed_rank ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.claimed_rank')) END AS rank,CASE WHEN b.status='DRAFT' THEN s.experience_months ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.experience_months')) END AS experienceMonths,CASE WHEN b.status='DRAFT' THEN s.description ELSE JSON_VALUE(i.snapshot_json,'$.description') END AS description,CASE WHEN b.status='DRAFT' THEN s.projects ELSE JSON_VALUE(i.snapshot_json,'$.projects') END AS projects,CASE WHEN b.status='DRAFT' THEN s.evidence ELSE JSON_VALUE(i.snapshot_json,'$.evidence') END AS evidence,CASE WHEN b.status='DRAFT' THEN s.last_used_on ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.last_used_on')) END AS lastUsedOn,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE s.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE s.feedback END AS feedback,i.needs_review AS needsReview,JSON_QUERY((SELECT criteria.rank,level.display_name AS name,criteria.description FROM dbo.SkillVersionCriterion criteria JOIN dbo.ProficiencyLevel level ON level.framework_id=criteria.framework_id AND level.rank=criteria.rank WHERE criteria.account_id=s.account_id AND criteria.skill_id=s.skill_id AND criteria.definition_revision=CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END ORDER BY criteria.rank FOR JSON PATH)) AS levels FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='SKILL' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS skills,
 JSON_QUERY((SELECT i.record_id AS id,c.revision,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord e WHERE e.account_id=c.account_id AND e.certification_id=c.id AND e.active=1) THEN 1 ELSE 0 END) AS hasImage,CASE WHEN b.status='DRAFT' THEN c.certification_name ELSE JSON_VALUE(i.snapshot_json,'$.certification_name') END AS certificationName,CASE WHEN b.status='DRAFT' THEN c.provider ELSE JSON_VALUE(i.snapshot_json,'$.provider') END AS provider,CASE WHEN b.status='DRAFT' THEN c.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,CASE WHEN b.status='DRAFT' THEN c.issue_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.issue_date')) END AS certificationDate,CASE WHEN b.status='DRAFT' THEN c.expiry_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.expiry_date')) END AS expiryDate,CASE WHEN b.status='DRAFT' THEN c.credential_id ELSE JSON_VALUE(i.snapshot_json,'$.credential_id') END AS credentialId,CASE WHEN b.status='DRAFT' THEN c.credential_url ELSE JSON_VALUE(i.snapshot_json,'$.credential_url') END AS credentialUrl,CASE WHEN b.status='DRAFT' THEN c.notes ELSE JSON_VALUE(i.snapshot_json,'$.notes') END AS notes,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE c.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE c.feedback END AS feedback,i.needs_review AS needsReview,CASE WHEN b.status='DRAFT' THEN c.renewed_from_id ELSE TRY_CONVERT(uniqueidentifier,JSON_VALUE(i.snapshot_json,'$.renewed_from_id')) END AS renewedFromId,JSON_QUERY(CASE WHEN b.status<>'DRAFT' THEN JSON_QUERY(i.snapshot_json,'$.relatedSkills') ELSE (SELECT s.skill_id AS skillId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND s.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL') FOR JSON PATH) END) AS relatedSkills FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='CERTIFICATION' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS certifications
 FROM dbo.CapabilitySubmission b WHERE b.account_id=@account_id AND b.id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
