-- Reviewed master amendments and scoped demand matching. No legacy grants are promoted.
CREATE TABLE dbo.CredentialProvider(account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,name nvarchar(100) NOT NULL,active bit NOT NULL,revision int NOT NULL,
 PRIMARY KEY(account_id,id),UNIQUE(account_id,name),FOREIGN KEY(account_id) REFERENCES dbo.AccessWorkspace(account_id));
CREATE TABLE dbo.CredentialDefinition(account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,name nvarchar(100) NOT NULL,provider_id uniqueidentifier NOT NULL,category nvarchar(80) NOT NULL,description nvarchar(2000) NOT NULL,active bit NOT NULL,revision int NOT NULL,
 PRIMARY KEY(account_id,id),UNIQUE(account_id,name,provider_id),FOREIGN KEY(account_id,provider_id) REFERENCES dbo.CredentialProvider(account_id,id));
CREATE TABLE dbo.MasterAmendment(account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,type varchar(20) NOT NULL CHECK(type IN('SKILL','CERTIFICATION','PROVIDER')),target_id uniqueidentifier NOT NULL,target_revision int NULL,is_new bit NOT NULL,definition nvarchar(max) NOT NULL CHECK(ISJSON(definition)=1),reason nvarchar(1000) NOT NULL,status varchar(20) NOT NULL CHECK(status IN('SUBMITTED','APPROVED','REJECTED')),revision int NOT NULL,decision_by uniqueidentifier NULL,decision_note nvarchar(1000) NULL,created_at datetime2 NOT NULL,decided_at datetime2 NULL,
 PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),FOREIGN KEY(account_id,decision_by) REFERENCES dbo.AccessPerson(account_id,person_id));
CREATE INDEX IX_MasterAmendment_Queue ON dbo.MasterAmendment(account_id,status,created_at);
CREATE TABLE dbo.BusinessDemand(account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,title nvarchar(150) NOT NULL,description nvarchar(2000) NOT NULL,scope_kind varchar(20) NOT NULL,scope_id uniqueidentifier NULL,requirements nvarchar(max) NOT NULL CHECK(ISJSON(requirements)=1),revision int NOT NULL,created_at datetime2 NOT NULL,
 PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),CHECK(scope_kind IN('ORGANIZATION','DELIVERY_UNIT','DEPARTMENT','PROJECT')),CHECK((scope_kind='ORGANIZATION' AND scope_id IS NULL) OR (scope_kind<>'ORGANIZATION' AND scope_id IS NOT NULL)));
CREATE TABLE dbo.BusinessShortlist(account_id uniqueidentifier NOT NULL,demand_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,actor_id uniqueidentifier NOT NULL,note nvarchar(1000) NOT NULL,created_at datetime2 NOT NULL,
 PRIMARY KEY(account_id,demand_id,person_id),FOREIGN KEY(account_id,demand_id) REFERENCES dbo.BusinessDemand(account_id,id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),FOREIGN KEY(account_id,actor_id) REFERENCES dbo.AccessPerson(account_id,person_id));
GO
CREATE OR ALTER FUNCTION dbo.BusinessAmendCan(@account uniqueidentifier,@actor uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.view',0)<>1 OR dbo.BusinessLegacyDenied(@account,@actor,'skill.catalogue.propose')=1 RETURN 0;
 IF dbo.BusinessHasResponsibility(@account,@actor)=1 RETURN 1;
 IF dbo.AccessReportingValid(@account,@actor)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson p ON p.account_id=a.account_id AND p.person_id=a.person_id AND p.active=1 WHERE a.account_id=@account AND a.manager_id=@actor AND a.person_id<>@actor AND dbo.AccessReportingValid(@account,a.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeCovers(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier,@targetKind varchar(20),@target uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.BusinessScopeValid(@account,@kind,@scope)<>1 OR dbo.BusinessScopeValid(@account,@targetKind,@target)<>1 RETURN 0;
 IF @kind='ORGANIZATION' RETURN 1;
 IF @kind=@targetKind AND @scope=@target RETURN 1;
 IF @kind='DELIVERY_UNIT' AND @targetKind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account AND node_id=@target AND parent_id=@scope AND active=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessDemandCan(@account uniqueidentifier,@actor uniqueidentifier,@id uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.BusinessHasAccess(@account,@actor)<>1 OR dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=1 RETURN 0;
 DECLARE @kind varchar(20),@scope uniqueidentifier;SELECT @kind=scope_kind,@scope=scope_id FROM dbo.BusinessDemand WHERE account_id=@account AND id=@id;
 IF @kind IS NULL RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='DENY' AND (valid_until IS NULL OR valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeCovers(@account,scope_kind,scope_id,@kind,@scope)=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='ALLOW' AND dbo.BusinessResponsibilityUsable(@account,@actor,id)=1 AND dbo.BusinessScopeCovers(@account,scope_kind,scope_id,@kind,@scope)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessMatchRequirements(@account uniqueidentifier,@person uniqueidentifier,@requirements nvarchar(max)) RETURNS TABLE AS RETURN (
 SELECT 'SKILL' AS type,CONVERT(varchar(36),TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))) AS id,c.display_name COLLATE DATABASE_DEFAULT AS name,
 CONVERT(bit,CASE WHEN c.status='PUBLISHED' AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft d WHERE d.account_id=@account AND d.person_id=@person AND d.skill_id=c.skill_id AND d.status='APPROVED' AND d.claimed_rank>=TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank'))) THEN 1 ELSE 0 END) AS matched,
 'Manager-reviewed proficiency L'+ISNULL(JSON_VALUE(s.value,'$.minRank'),'')+' or above' AS criterion
 FROM OPENJSON(@requirements,'$.skills') s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))
 UNION ALL SELECT 'CERTIFICATION',CONVERT(varchar(36),c.id),c.name COLLATE DATABASE_DEFAULT,
 CONVERT(bit,CASE WHEN c.active=1 AND provider.active=1 AND EXISTS(SELECT 1 FROM dbo.CertificationRecord r WHERE r.account_id=@account AND r.person_id=@person AND r.status='APPROVED' AND (r.expiry_date IS NULL OR r.expiry_date>=CONVERT(date,SYSUTCDATETIME())) AND r.issue_date<=CONVERT(date,SYSUTCDATETIME()) AND r.certification_name COLLATE Latin1_General_100_CI_AS=c.name COLLATE Latin1_General_100_CI_AS AND r.provider COLLATE Latin1_General_100_CI_AS=provider.name COLLATE Latin1_General_100_CI_AS) THEN 1 ELSE 0 END),
 'Current manager-reviewed credential; exact master name and provider match (not issuer validation)'
 FROM OPENJSON(@requirements,'$.certifications') s JOIN dbo.CredentialDefinition c ON c.account_id=@account AND c.id=TRY_CONVERT(uniqueidentifier,s.value) JOIN dbo.CredentialProvider provider ON provider.account_id=c.account_id AND provider.id=c.provider_id
);
GO
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
  SELECT d.id,d.name,d.provider_id AS providerId,p.name AS provider,d.category,d.description,d.active INTO #definitions FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id WHERE d.account_id=@account_id AND (@includeInactive=1 OR d.active=1 AND p.active=1) AND (@masterSearch='' OR CHARINDEX(@masterSearch,d.name)>0 OR CHARINDEX(@masterSearch,p.name)>0);
  SELECT skill_id AS id,display_name AS name,category,description,CONVERT(bit,CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) AS active INTO #catalogue FROM dbo.SkillCatalogue WHERE account_id=@account_id AND (@includeInactive=1 OR status='PUBLISHED') AND (@masterSearch='' OR CHARINDEX(@masterSearch,display_name)>0 OR CHARINDEX(@masterSearch,category)>0);
  SET @result=(SELECT @revision AS revision,@page AS page,25 AS pageSize,(SELECT COUNT(*) FROM #providers) AS providerTotal,(SELECT COUNT(*) FROM #definitions) AS certificationTotal,(SELECT COUNT(*) FROM #catalogue) AS skillTotal,
   JSON_QUERY((SELECT * FROM #providers ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS providers,
   JSON_QUERY((SELECT * FROM #definitions ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS certifications,
   JSON_QUERY((SELECT c.*,JSON_QUERY((SELECT rank,description FROM dbo.SkillProficiencyLevel WHERE account_id=@account_id AND skill_id=c.id ORDER BY rank FOR JSON PATH)) AS levels FROM #catalogue c ORDER BY name,id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH)) AS skills FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='AMENDMENTS' BEGIN
  IF dbo.BusinessAmendCan(@account_id,@actor_id)<>1 AND @manage<>1 THROW 51003,'Amendment access denied.',1;
  SET @result=(SELECT @revision AS revision,@manage AS canApprove,JSON_QUERY((SELECT m.id,m.person_id AS personId,p.display_name AS employee,m.type,m.target_id AS targetId,m.target_revision AS targetRevision,m.is_new AS isNew,JSON_QUERY(m.definition) AS definition,m.reason,m.status,m.revision,m.decision_note AS decisionNote,m.created_at AS createdAt FROM dbo.MasterAmendment m JOIN dbo.AccessPerson p ON p.account_id=m.account_id AND p.person_id=m.person_id WHERE m.account_id=@account_id AND (@manage=1 OR m.person_id=@actor_id) ORDER BY m.created_at DESC,m.id OFFSET (@page-1)*25 ROWS FETCH NEXT 25 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES)) AS rows,(SELECT COUNT(*) FROM dbo.MasterAmendment WHERE account_id=@account_id AND (@manage=1 OR person_id=@actor_id)) AS total,@page AS page,25 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='AMENDMENT' BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id AND (@manage=1 OR person_id=@actor_id AND dbo.BusinessAmendCan(@account_id,@actor_id)=1)) THROW 51003,'Amendment unavailable.',1;
  SET @result=(SELECT id,type,target_id AS targetId,target_revision AS targetRevision,is_new AS isNew,JSON_QUERY(definition) AS definition,reason,status,revision,decision_note AS decisionNote FROM dbo.MasterAmendment WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
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
     IF @new=1 INSERT dbo.CredentialDefinition VALUES(@account_id,@target,JSON_VALUE(@definition,'$.name'),@provider,JSON_VALUE(@definition,'$.category'),ISNULL(JSON_VALUE(@definition,'$.description'),''),TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),1);
     ELSE UPDATE dbo.CredentialDefinition SET name=JSON_VALUE(@definition,'$.name'),provider_id=@provider,category=JSON_VALUE(@definition,'$.category'),description=ISNULL(JSON_VALUE(@definition,'$.description'),''),active=TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),revision=revision+1 WHERE account_id=@account_id AND id=@target;
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
