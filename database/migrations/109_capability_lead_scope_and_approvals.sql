-- Group existing issuer grants into the standard scoped assignment workflow.
CREATE TABLE dbo.CapabilityLeadScope (
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 scope_kind varchar(20) NOT NULL,scope_id uniqueidentifier NOT NULL,effect varchar(5) NOT NULL,
 active bit NOT NULL,all_issuers bit NOT NULL,issuer_ids nvarchar(max) NOT NULL,
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK(scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT')),
 CHECK(effect IN('ALLOW','DENY')),
 CHECK(ISJSON(issuer_ids)=1)
);
CREATE INDEX IX_CapabilityLeadScope_Actor ON dbo.CapabilityLeadScope(account_id,person_id,active,effect);
INSERT dbo.CapabilityLeadScope(account_id,id,person_id,scope_kind,scope_id,effect,active,all_issuers,issuer_ids)
SELECT account_id,NEWID(),person_id,scope_kind,scope_id,effect,active,0,
 CONCAT(N'[',STRING_AGG(CONVERT(nvarchar(max),CONCAT(N'"',LOWER(CONVERT(varchar(36),issuer_id)),N'"')),N','),N']')
FROM dbo.CapabilityLeadGrant
GROUP BY account_id,person_id,scope_kind,scope_id,effect,active;
GO
CREATE OR ALTER FUNCTION dbo.CapabilityLeadMatches(
 @account uniqueidentifier,@actor uniqueidentifier,@owner uniqueidentifier,@issuerId uniqueidentifier
) RETURNS bit AS BEGIN
 IF @actor IS NULL OR @actor=@owner OR dbo.AccessCan(@account,@actor,'profile.view',1)<>1
  OR dbo.AccessCan(@account,@actor,'skill.view',1)<>1
  OR dbo.BusinessLegacyDenied(@account,@actor,'skill.verify')=1
  OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@owner AND active=1)
  RETURN 0;
 DECLARE @matching TABLE(effect varchar(5));
 INSERT @matching
 SELECT g.effect FROM dbo.CapabilityLeadScope g
 WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1
  AND (g.all_issuers=1 OR EXISTS(SELECT 1 FROM OPENJSON(g.issuer_ids) i WHERE TRY_CONVERT(uniqueidentifier,i.value)=@issuerId))
  AND EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account,g.scope_kind,g.scope_id) WHERE person_id=@owner);
 IF EXISTS(SELECT 1 FROM @matching WHERE effect='DENY') RETURN 0;
 IF EXISTS(SELECT 1 FROM @matching WHERE effect='ALLOW') RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.CapabilityLeadCoversIssuer(
 @account uniqueidentifier,@actor uniqueidentifier,@owner uniqueidentifier,@issuer nvarchar(120)
) RETURNS bit AS BEGIN
 DECLARE @issuerId uniqueidentifier;
 IF (SELECT COUNT(*) FROM dbo.CredentialProvider WHERE account_id=@account AND active=1
  AND LOWER(LTRIM(RTRIM(name)))=LOWER(LTRIM(RTRIM(@issuer))))<>1 RETURN 0;
 SELECT @issuerId=id FROM dbo.CredentialProvider WHERE account_id=@account AND active=1
  AND LOWER(LTRIM(RTRIM(name)))=LOWER(LTRIM(RTRIM(@issuer)));
 RETURN dbo.CapabilityLeadMatches(@account,@actor,@owner,@issuerId);
END;
GO
CREATE OR ALTER FUNCTION dbo.CapabilityLeadCanReviewSubmission(
 @account uniqueidentifier,@actor uniqueidentifier,@submission uniqueidentifier
) RETURNS bit AS BEGIN
 DECLARE @owner uniqueidentifier;
 IF NOT EXISTS(SELECT 1 FROM dbo.CapabilityLeadScope
  WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='ALLOW') RETURN 0;
 SELECT @owner=person_id FROM dbo.CapabilitySubmission WHERE account_id=@account AND id=@submission;
 IF @owner IS NULL RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account
  AND submission_id=@submission AND kind='CERTIFICATION')
  RETURN dbo.CapabilityLeadMatches(@account,@actor,@owner,NULL);
 IF EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i
  LEFT JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id AND c.person_id=@owner
  WHERE i.account_id=@account AND i.submission_id=@submission AND i.kind='CERTIFICATION'
   AND (c.id IS NULL OR dbo.CapabilityLeadCoversIssuer(@account,@actor,@owner,c.provider)<>1))
  RETURN 0;
 RETURN 1;
END;
GO
CREATE OR ALTER FUNCTION dbo.CapabilityLeadForSubmission(
 @account uniqueidentifier,@submission uniqueidentifier
) RETURNS uniqueidentifier AS BEGIN
 DECLARE @lead uniqueidentifier;
 SELECT TOP(1) @lead=person_id FROM dbo.CapabilityLeadScope
 WHERE account_id=@account AND active=1 AND effect='ALLOW'
  AND dbo.CapabilityLeadCanReviewSubmission(@account,person_id,@submission)=1 ORDER BY person_id;
 RETURN @lead;
END;
GO
CREATE OR ALTER FUNCTION dbo.CapabilityLeadCanReviewCredential(
 @account uniqueidentifier,@actor uniqueidentifier,@id uniqueidentifier
) RETURNS bit AS BEGIN
 DECLARE @owner uniqueidentifier,@issuer nvarchar(120);
 IF NOT EXISTS(SELECT 1 FROM dbo.CapabilityLeadScope
  WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='ALLOW') RETURN 0;
 SELECT @owner=person_id,@issuer=provider FROM dbo.CertificationRecord
 WHERE account_id=@account AND id=@id AND status='SUBMITTED';
 IF @owner IS NULL OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b
  ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account AND i.kind='CERTIFICATION' AND i.record_id=@id AND i.needs_review=1
   AND b.status IN('SUBMITTING','SUBMITTED')) RETURN 0;
 RETURN dbo.CapabilityLeadCoversIssuer(@account,@actor,@owner,@issuer);
END;
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadHasGrants(@account uniqueidentifier,@actor uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.view',1)<>1
  OR dbo.BusinessLegacyDenied(@account,@actor,'skill.verify')=1 RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.CapabilityLeadScope g
  WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND g.effect='ALLOW'
   AND (g.all_issuers=1 OR EXISTS(SELECT 1 FROM OPENJSON(g.issuer_ids) i
    JOIN dbo.CredentialProvider p ON p.account_id=g.account_id AND p.id=TRY_CONVERT(uniqueidentifier,i.value) AND p.active=1))
   AND dbo.BusinessScopeValid(@account,g.scope_kind,g.scope_id)=1) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CapabilityLeadAdministration
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(10),@payload nvarchar(max)=N'{}'
AS BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @operation IS NULL OR @operation NOT IN('LIST','PREVIEW','SAVE')
  OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>24000 THROW 51000,'Invalid lead assignment.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int,@result nvarchar(max);
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1
   OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1
   OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Lead assignment requires administration access.',1;
  IF @operation='LIST' BEGIN
   DECLARE @selected uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId'));
   SET @result=(SELECT 109 AS schemaVersion,@revision AS revision,
    JSON_QUERY((SELECT id,name FROM dbo.CredentialProvider WHERE account_id=@account_id AND active=1 ORDER BY name,id FOR JSON PATH)) AS issuers,
    JSON_QUERY((SELECT g.id,g.person_id AS personId,p.display_name AS personName,g.all_issuers AS allIssuers,JSON_QUERY(g.issuer_ids) AS issuerIds,
     g.scope_kind AS scopeKind,g.scope_id AS scopeId,COALESCE(n.display_name,b.name) AS scopeName,
     g.effect,g.active FROM dbo.CapabilityLeadScope g
     JOIN dbo.AccessPerson p ON p.account_id=g.account_id AND p.person_id=g.person_id
     LEFT JOIN dbo.AccessOrgNode n ON n.account_id=g.account_id AND n.node_id=g.scope_id AND n.kind=g.scope_kind
     LEFT JOIN dbo.BusinessProject b ON b.account_id=g.account_id AND b.id=g.scope_id AND g.scope_kind='PROJECT'
     WHERE g.account_id=@account_id AND (@selected IS NULL OR g.person_id=@selected) ORDER BY p.display_name,g.scope_kind,g.id FOR JSON PATH)) AS assignments
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE BEGIN
   DECLARE @person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
    @issuers nvarchar(max)=JSON_QUERY(@payload,'$.issuerIds'),
    @all bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.allIssuers')),
    @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),
    @kind varchar(20)=JSON_VALUE(@payload,'$.scopeKind'),@effect varchar(5)=JSON_VALUE(@payload,'$.effect'),
    @active bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.active')),@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),
    @before nvarchar(max),@after nvarchar(max),
    @reason nvarchar(1000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.reason')));
   IF ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<>@revision THROW 51009,'Workspace changed. Refresh and review again.',1;
   IF @person IS NULL OR @id IS NULL OR @all IS NULL OR @issuers IS NULL OR @scope IS NULL OR @active IS NULL OR @kind IS NULL
    OR @kind NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT') OR @effect IS NULL OR @effect NOT IN('ALLOW','DENY')
    OR NULLIF(@reason,N'') IS NULL OR LEN(JSON_VALUE(@payload,'$.reason'))>1000
    THROW 51000,'Choose a person, organization scope, issuer access and effect.',1;
   IF LEFT(@issuers,1)<>N'[' OR (@all=1 AND @issuers<>N'[]') OR (@all=0 AND NOT EXISTS(SELECT 1 FROM OPENJSON(@issuers)))
    OR EXISTS(SELECT 1 FROM OPENJSON(@issuers) WHERE type<>1 OR LEN(value)<>36 OR TRY_CONVERT(uniqueidentifier,value) IS NULL)
    OR EXISTS(SELECT 1 FROM OPENJSON(@issuers) GROUP BY TRY_CONVERT(uniqueidentifier,value) HAVING COUNT(*)>1)
    THROW 51000,'Choose valid issuers or explicitly allow all.',1;
   SELECT @before=(SELECT g.id,g.person_id AS personId,g.scope_kind AS scopeKind,g.scope_id AS scopeId,
     g.effect,g.active,g.all_issuers AS allIssuers,JSON_QUERY(g.issuer_ids) AS issuerIds
     FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM dbo.CapabilityLeadScope g
    WHERE account_id=@account_id AND id=@id AND person_id=@person;
   IF @before IS NULL AND (@active=0 OR EXISTS(SELECT 1 FROM dbo.CapabilityLeadScope WHERE account_id=@account_id AND id=@id))
    THROW 51004,'Lead assignment unavailable.',1;
   IF @active=1 AND (NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND active=1)
    OR EXISTS(SELECT 1 FROM OPENJSON(@issuers) i WHERE NOT EXISTS(SELECT 1 FROM dbo.CredentialProvider
     WHERE account_id=@account_id AND id=TRY_CONVERT(uniqueidentifier,i.value) AND active=1))
    OR dbo.BusinessScopeValid(@account_id,@kind,@scope)<>1) THROW 51000,'Choose active assignment targets.',1;
   SET @after=(SELECT @revision AS revision,@person AS personId,@all AS allIssuers,JSON_QUERY(@issuers) AS issuerIds,@kind AS scopeKind,
    @scope AS scopeId,@effect AS effect,@active AS active,@reason AS reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   IF @operation='SAVE' BEGIN
    IF @before IS NULL
     INSERT dbo.CapabilityLeadScope(account_id,id,person_id,scope_kind,scope_id,effect,active,all_issuers,issuer_ids)
     VALUES(@account_id,@id,@person,@kind,@scope,@effect,@active,@all,@issuers);
    ELSE UPDATE dbo.CapabilityLeadScope SET scope_kind=@kind,scope_id=@scope,effect=@effect,
     active=@active,all_issuers=@all,issuer_ids=@issuers WHERE account_id=@account_id AND id=@id;
    UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
    INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
     VALUES(@account_id,@revision+1,@actor_id,'capability_lead.assignment',@id,@before,@after);
   END;
   SET @result=(SELECT JSON_QUERY(@before) AS [before],JSON_QUERY(@after) AS [after],
    JSON_QUERY(N'{"actions":["Review scoped submissions","View scoped certificate analytics"]}') AS impact,
    JSON_QUERY(N'[]') AS warnings FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END;
 COMMIT;
 SELECT @result AS json;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadCapabilityLeadAnalytics
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.CapabilityLeadHasGrants(@account_id,@actor_id)<>1 THROW 51003,'Capability Lead analytics unavailable.',1;
 DECLARE @today date=CONVERT(date,SYSUTCDATETIME());
 SELECT (SELECT JSON_QUERY((SELECT p.name AS issuer,
  COUNT(DISTINCT c.person_id) AS people,
  COUNT(CASE WHEN c.status='SUBMITTED' THEN 1 END) AS pending,
  COUNT(CASE WHEN c.status='APPROVED' AND (c.expiry_date IS NULL OR c.expiry_date>=@today) THEN 1 END) AS valid,
  COUNT(CASE WHEN c.status='APPROVED' AND c.expiry_date BETWEEN @today AND DATEADD(day,30,@today) THEN 1 END) AS dueSoon,
  COUNT(CASE WHEN c.status='APPROVED' AND c.expiry_date<@today THEN 1 END) AS expired
 FROM dbo.CertificationRecord c JOIN dbo.CredentialProvider p ON p.account_id=c.account_id AND p.active=1
  AND LOWER(LTRIM(RTRIM(p.name)))=LOWER(LTRIM(RTRIM(c.provider)))
 WHERE c.account_id=@account_id AND c.status IN('SUBMITTED','APPROVED')
  AND dbo.CapabilityLeadCoversIssuer(@account_id,@actor_id,c.person_id,c.provider)=1
 GROUP BY p.id,p.name ORDER BY p.name,p.id FOR JSON PATH)) AS issuers FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
END;
GO
GRANT EXECUTE ON dbo.ReadCapabilityLeadAnalytics TO [skill_management_runtime];
GO

CREATE OR ALTER PROCEDURE dbo.TransitionSkillClaim
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@expected_revision int,@action varchar(20),@feedback nvarchar(2000)=N''
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @action IS NULL OR @action NOT IN ('SUBMIT','APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid action.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 DECLARE @owner uniqueidentifier,@reviewer uniqueidentifier,@manager uniqueidentifier,@revision int,@status varchar(20),@skill uniqueidentifier,@definition int,@before nvarchar(max),@after nvarchar(max);
 SELECT @owner=person_id,@reviewer=reviewer_id,@revision=revision,@status=status,@skill=skill_id,@definition=definition_revision FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id;
 IF @owner IS NULL THROW 51004,'Claim unavailable.',1;
 SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner;
 DECLARE @lead uniqueidentifier=(SELECT TOP(1) b.reviewer_id FROM dbo.CapabilitySubmissionItem i
  JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account_id AND i.kind='SKILL' AND i.record_id=@claim_id AND i.needs_review=1
   AND b.person_id=@owner AND b.status='SUBMITTING'
   AND dbo.CapabilityLeadCanReviewSubmission(@account_id,b.reviewer_id,b.id)=1
  ORDER BY b.id),
  @decisionLead uniqueidentifier=(SELECT TOP(1) b.reviewer_id FROM dbo.CapabilitySubmissionItem i
  JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account_id AND i.kind='SKILL' AND i.record_id=@claim_id AND i.needs_review=1
   AND b.person_id=@owner AND b.status='REVIEWED' AND TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.revision'))=@revision
   AND dbo.CapabilityLeadCanReviewSubmission(@account_id,b.reviewer_id,b.id)=1
  ORDER BY b.id);
 IF @action='SUBMIT'
 BEGIN
  IF @owner<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own submission denied.',1;
  IF @lead IS NULL AND (dbo.AccessReportingValid(@account_id,@owner)<>1 OR @manager IS NULL OR @manager=@owner OR dbo.AccessCan(@account_id,@manager,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@manager,'profile.view',1)<>1) THROW 51011,'Reporting reviewer unavailable.',1;
  SET @manager=COALESCE(@lead,@manager);
  IF @status NOT IN ('DRAFT','CHANGES_REQUESTED','REJECTED') AND NOT (@status='SUBMITTED' AND @reviewer<>@manager) THROW 51010,'Submission state invalid.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@skill AND status='PUBLISHED' AND definition_revision=@definition) THROW 51009,'Definition changed.',1;
 END
 ELSE
 BEGIN
  IF @action NOT IN ('APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid decision.',1;
  IF (@decisionLead IS NULL OR @decisionLead<>@actor_id) AND (dbo.AccessCanReviewClaim(@account_id,@actor_id,@claim_id,0)<>1 OR @owner=@actor_id OR @reviewer IS NULL OR @reviewer<>@actor_id OR @manager IS NULL OR @manager<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@owner AND active=1)) THROW 51003,'Assigned review denied.',1;
  IF @status<>'SUBMITTED' THROW 51010,'Claim is not awaiting review.',1;
  IF LEN(LTRIM(RTRIM(ISNULL(@feedback,N''))))=0 THROW 51000,'Feedback required.',1;
 END
 IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Claim changed.',1;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.SkillClaimDraft SET revision=revision+1,status=CASE @action WHEN 'SUBMIT' THEN 'SUBMITTED' WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REQUEST_CHANGES' THEN 'CHANGES_REQUESTED' ELSE 'REJECTED' END,
 reviewer_id=CASE WHEN @action='SUBMIT' THEN @manager ELSE COALESCE(@decisionLead,reviewer_id) END,
 feedback=CASE WHEN @action='SUBMIT' THEN N'' ELSE LTRIM(RTRIM(@feedback)) END,
 submitted_at=CASE WHEN @action='SUBMIT' THEN SYSUTCDATETIME() ELSE submitted_at END,reviewed_at=CASE WHEN @action='SUBMIT' THEN NULL ELSE SYSUTCDATETIME() END,updated_at=SYSUTCDATETIME()
 WHERE account_id=@account_id AND claim_id=@claim_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,CASE @action WHEN 'SUBMIT' THEN 'claim.submitted' WHEN 'APPROVE' THEN 'claim.approved' WHEN 'REQUEST_CHANGES' THEN 'claim.changes_requested' ELSE 'claim.rejected' END,@claim_id,@before,@after);
 INSERT dbo.SkillClaimNotification(account_id,person_id,claim_id,title,body,href) VALUES(@account_id,CASE WHEN @action='SUBMIT' THEN @manager ELSE @owner END,@claim_id,
 CASE @action WHEN 'SUBMIT' THEN 'Skill review requested' WHEN 'APPROVE' THEN 'Skill claim approved' WHEN 'REQUEST_CHANGES' THEN 'Changes requested' ELSE 'Skill claim rejected' END,
 CASE WHEN @action='SUBMIT' THEN 'A direct report submitted a skill claim for your review.' ELSE 'Your skill claim was reviewed. Open My skills for feedback.' END,
 CASE WHEN @action='SUBMIT' THEN '/skill-reviews' ELSE '/my-skills' END);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CertificationWorkspace
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>20000 OR @operation IS NULL OR @operation NOT IN('LIST','GET','NOTIFICATIONS','SAVE','SAVE_SUBMIT','SUBMIT','APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Certification access denied.',1;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),
 @view varchar(10)=ISNULL(JSON_VALUE(@payload,'$.view'),'mine'),@page int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1),
 @search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),N'');
 IF @operation='NOTIFICATIONS' BEGIN
  SELECT TOP(30) 'certification-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(12),u.revision) AS id,
  u.occurred_at AS at,CASE u.action WHEN 'certification.submitted' THEN N'Certificate review requested' WHEN 'certification.approved' THEN N'Certificate approved' WHEN 'certification.changes_requested' THEN N'Certificate needs changes' ELSE N'Certificate not approved' END AS title,
  CONCAT(c.certification_name,CASE WHEN LEN(ISNULL(JSON_VALUE(u.after_json,'$.feedback'),N''))>0 THEN N' · '+LEFT(JSON_VALUE(u.after_json,'$.feedback'),300) ELSE N'' END) AS body,(SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=u.account_id AND p.person_id=u.actor_id) AS actorName,CASE u.action WHEN 'certification.submitted' THEN N'Submitted for review' WHEN 'certification.approved' THEN N'Approved' WHEN 'certification.changes_requested' THEN N'Changes requested' ELSE N'Not approved' END AS actionLabel,CASE WHEN u.action='certification.submitted' THEN '/skill-reviews?certification=' ELSE '/my-skills?record=' END+CONVERT(varchar(36),c.id) AS href
  FROM dbo.AccessAudit u JOIN dbo.CertificationRecord c ON c.account_id=u.account_id AND c.id=u.target_id
  WHERE u.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1) AND
   (u.action='certification.submitted' AND c.reviewer_id=@actor_id AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
    AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.reviewer_id'))=@actor_id
    OR u.action IN('certification.approved','certification.changes_requested','certification.rejected') AND c.person_id=@actor_id)
  ORDER BY u.occurred_at DESC,u.revision DESC;
  COMMIT;RETURN;
 END;
 IF @operation IN('LIST','GET') BEGIN
  IF @view NOT IN('mine','queue') OR @page NOT BETWEEN 1 AND 10000 OR @operation='GET' AND @id IS NULL THROW 51000,'Invalid filters.',1;
  IF @operation='LIST' AND @view='queue' AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 AND dbo.CapabilityLeadHasGrants(@account_id,@actor_id)<>1 THROW 51003,'Review denied.',1;
  SELECT c.id INTO #visible FROM dbo.CertificationRecord c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
  WHERE c.account_id=@account_id AND (@id IS NULL OR c.id=@id)
  AND ((@operation='GET' OR @view='mine') AND c.person_id=@actor_id OR (@operation='GET' OR @view='queue') AND (dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1 OR dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,c.id)=1))
  AND NOT(@operation='LIST' AND @view='queue' AND EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1 AND b.status='SUBMITTED'))
  AND (@search=N'' OR CHARINDEX(@search,c.certification_name)>0 OR CHARINDEX(@search,c.provider)>0 OR CHARINDEX(@search,p.display_name)>0);
  IF @operation='GET' AND NOT EXISTS(SELECT 1 FROM #visible) THROW 51004,'Certification unavailable.',1;
  IF @operation='LIST' SELECT COUNT(*) AS total FROM #visible;
  SELECT c.id,c.revision,CONVERT(bit,CASE WHEN dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,c.id)=1 THEN 1 ELSE 0 END) AS issuerApproval,(SELECT TOP(1) i.submission_id FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1 AND b.status IN('DRAFT','SUBMITTED') ORDER BY b.updated_at DESC,b.id) AS activeSubmissionId,JSON_QUERY((SELECT sc.skill_id AS id,sc.skill_name AS name FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft sc ON sc.account_id=l.account_id AND sc.claim_id=l.claim_id WHERE l.account_id=c.account_id AND l.certification_id=c.id AND (c.person_id=@actor_id OR l.published=1 AND sc.status IN('SUBMITTED','APPROVED')) FOR JSON PATH)) AS relatedSkills,c.person_id AS personId,c.reviewer_id AS reviewerId,p.display_name AS name,p.employee_code AS employeeCode,
  CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord i WHERE i.account_id=c.account_id AND i.certification_id=c.id AND i.active=1) THEN 1 ELSE 0 END AS bit) AS hasImage,
  c.certification_name AS certificationName,c.provider,c.category,CONVERT(varchar(10),c.issue_date,23) AS certificationDate,
  CONVERT(varchar(10),c.expiry_date,23) AS expiryDate,c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.notes,c.status,c.feedback,c.renewed_from_id AS renewedFromId,c.supersededById,c.activeRenewalId,
  r.display_name AS reviewedBy,c.reviewed_at AS reviewedAt,c.submitted_at AS submittedAt
  FROM #visible v JOIN dbo.CertificationPortfolio c ON c.account_id=@account_id AND c.id=v.id
  JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
  LEFT JOIN dbo.AccessPerson r ON r.account_id=c.account_id AND r.person_id=c.reviewer_id AND c.reviewed_at IS NOT NULL
  ORDER BY c.updated_at DESC,c.id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
  COMMIT;RETURN;
 END;
 DECLARE @owner uniqueidentifier,@reviewer uniqueidentifier,@manager uniqueidentifier,@revision int,@status varchar(20),
 @expected int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@before nvarchar(max),@after nvarchar(max),
 @feedback nvarchar(2000)=ISNULL(JSON_VALUE(@payload,'$.feedback'),N'');
 IF @id IS NULL OR @expected IS NULL OR @expected<0 THROW 51000,'Invalid record or revision.',1;
 SELECT @owner=person_id,@reviewer=reviewer_id,@revision=revision,@status=status FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id;
 DECLARE @lead uniqueidentifier=(SELECT TOP(1) b.reviewer_id FROM dbo.CapabilitySubmissionItem i
  JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account_id AND i.kind='CERTIFICATION' AND i.record_id=@id AND i.needs_review=1
   AND b.person_id=@owner AND b.status='SUBMITTING'
   AND dbo.CapabilityLeadCanReviewSubmission(@account_id,b.reviewer_id,b.id)=1
  ORDER BY b.id),
  @decisionLead uniqueidentifier=(SELECT TOP(1) b.reviewer_id FROM dbo.CapabilitySubmissionItem i
  JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account_id AND i.kind='CERTIFICATION' AND i.record_id=@id AND i.needs_review=1
   AND b.person_id=@owner AND b.status='REVIEWED' AND TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.revision'))=@revision
   AND dbo.CapabilityLeadCanReviewSubmission(@account_id,b.reviewer_id,b.id)=1
  ORDER BY b.id);
 SELECT @before=(SELECT * FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @leadNoticeRecipient uniqueidentifier;
 IF @decisionLead IS NULL AND @operation IN('APPROVE','REQUEST_CHANGES','REJECT')
  AND dbo.CertificationCanReview(@account_id,@actor_id,@id)<>1
  AND dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,@id)=1
 BEGIN
  SET @decisionLead=@actor_id;
  SELECT @leadNoticeRecipient=o.manager_id FROM dbo.AccessOrgAssignment o
  JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.manager_id AND p.active=1
  WHERE o.account_id=@account_id AND o.person_id=@owner AND o.manager_id<>@actor_id
   AND dbo.AccessReportingValid(@account_id,@owner)=1;
 END;
 IF @operation IN('SAVE','SAVE_SUBMIT','SUBMIT') BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Personal claim management denied.',1;
  IF @owner IS NOT NULL AND @owner<>@actor_id THROW 51003,'Own record required.',1;
  IF @owner IS NULL AND (@operation='SUBMIT' OR @expected<>0) THROW 51004,'Certification unavailable.',1;
  IF @owner IS NOT NULL AND @revision<>@expected THROW 51009,'Record changed.',1;
  IF @owner IS NOT NULL AND @status NOT IN('DRAFT','CHANGES_REQUESTED','REJECTED') AND @operation<>'SUBMIT' THROW 51010,'Record is locked.',1;
  SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
  IF @operation IN('SAVE_SUBMIT','SUBMIT') BEGIN
   IF @lead IS NULL AND (dbo.AccessReportingValid(@account_id,@actor_id)<>1 OR @manager IS NULL OR @manager=@actor_id OR dbo.AccessReportingValid(@account_id,@manager)<>1 OR dbo.AccessCan(@account_id,@manager,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@manager,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@manager,'skill.verify',0)<>1) THROW 51011,'Current reviewer unavailable.',1;
   SET @manager=COALESCE(@lead,@manager);
   IF @status='APPROVED' OR @status='SUBMITTED' AND @reviewer=@manager THROW 51010,'Record is not editable.',1;
  END;
 END ELSE BEGIN
  IF dbo.CertificationCanReview(@account_id,@actor_id,@id)<>1 AND (@decisionLead IS NULL OR @decisionLead<>@actor_id OR @status<>'SUBMITTED') THROW 51003,'Assigned current review required.',1;
  IF @expected IS NULL OR @expected<>@revision THROW 51009,'Record changed.',1;
  IF LEN(LTRIM(RTRIM(@feedback)))=0 OR LEN(JSON_VALUE(@payload,'$.feedback'))>2000 THROW 51000,'Review feedback required.',1;
 END;
 IF @operation IN('SAVE','SAVE_SUBMIT') BEGIN
  DECLARE @title nvarchar(200)=JSON_VALUE(@payload,'$.fields.certificationName'),@provider nvarchar(120)=JSON_VALUE(@payload,'$.fields.provider'),
   @category nvarchar(80)=JSON_VALUE(@payload,'$.fields.category'),@issue date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.fields.certificationDate'),23),
   @expiry date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.fields.expiryDate'),23),@url nvarchar(1000)=JSON_VALUE(@payload,'$.fields.credentialUrl'),
   @credential nvarchar(200)=JSON_VALUE(@payload,'$.fields.credentialId'),@notes nvarchar(2000)=JSON_VALUE(@payload,'$.fields.notes');
  IF @title IS NULL OR LEN(LTRIM(RTRIM(@title)))=0 OR LEN(JSON_VALUE(@payload,'$.fields.certificationName'))>200
   OR @provider IS NULL OR LEN(LTRIM(RTRIM(@provider)))=0 OR LEN(JSON_VALUE(@payload,'$.fields.provider'))>120
   OR @category IS NULL OR LEN(LTRIM(RTRIM(@category)))=0 OR LEN(JSON_VALUE(@payload,'$.fields.category'))>80
   OR @issue IS NULL OR @issue>CONVERT(date,SYSUTCDATETIME()) OR CONVERT(varchar(10),@issue,23)<>JSON_VALUE(@payload,'$.fields.certificationDate')
   OR JSON_VALUE(@payload,'$.fields.expiryDate') IS NOT NULL AND (@expiry IS NULL OR CONVERT(varchar(10),@expiry,23)<>JSON_VALUE(@payload,'$.fields.expiryDate') OR @expiry<@issue)
   OR @url IS NULL OR LEN(JSON_VALUE(@payload,'$.fields.credentialUrl'))>1000 OR (@url<>N'' AND (@url NOT LIKE N'https://%._%' OR @url LIKE N'% %' OR @url LIKE N'%'+NCHAR(10)+N'%' OR @url LIKE N'%'+NCHAR(13)+N'%'))
   OR @credential IS NULL OR LEN(JSON_VALUE(@payload,'$.fields.credentialId'))>200 OR @notes IS NULL OR LEN(JSON_VALUE(@payload,'$.fields.notes'))>2000 THROW 51000,'Invalid credential fields.',1;
  DECLARE @storedSource uniqueidentifier=(SELECT renewed_from_id FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id),
   @requestedSource uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.renewedFromId'));
  IF JSON_VALUE(@payload,'$.renewedFromId') IS NOT NULL AND @requestedSource IS NULL THROW 51000,'Invalid renewal source.',1;
  IF @storedSource IS NOT NULL AND @requestedSource IS NOT NULL AND @storedSource<>@requestedSource THROW 51013,'Renewal source cannot be changed.',1;
  DECLARE @renewalSource uniqueidentifier=COALESCE(@storedSource,@requestedSource);
  IF @renewalSource IS NOT NULL AND dbo.CertificationRenewalValid(@account_id,@renewalSource,COALESCE(@owner,@actor_id),@title,@provider,@issue,@expiry)<>1 THROW 51013,'Renewal must preserve credential continuity and extend current validity.',1;
  IF @owner IS NULL INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status,renewed_from_id)
   VALUES(@account_id,@id,@actor_id,1,@title,@provider,@category,@issue,@expiry,@credential,@url,@notes,'DRAFT',@renewalSource);
  ELSE UPDATE dbo.CertificationRecord SET revision=revision+1,certification_name=@title,provider=@provider,category=@category,issue_date=@issue,expiry_date=@expiry,
   credential_id=@credential,credential_url=@url,notes=@notes,renewed_from_id=@renewalSource,status='DRAFT',updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END;
 IF @operation IN('SUBMIT','APPROVE') AND EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.id=@id AND c.renewed_from_id IS NOT NULL AND dbo.CertificationRenewalValid(@account_id,c.renewed_from_id,c.person_id,c.certification_name,c.provider,c.issue_date,c.expiry_date)<>1) THROW 51013,'Renewal must preserve credential continuity and extend current validity.',1;
 IF @operation IN('SAVE_SUBMIT','SUBMIT') AND NOT EXISTS(SELECT 1 FROM dbo.CertificationImageRecord WHERE account_id=@account_id AND certification_id=@id AND active=1) THROW 51012,'Certificate image is required before submission.',1;
 IF @operation IN('SAVE_SUBMIT','SUBMIT') UPDATE dbo.CertificationRecord SET status='SUBMITTED',reviewer_id=@manager,submitted_at=SYSUTCDATETIME(),reviewed_at=NULL,feedback=N'',
  revision=revision+CASE WHEN @operation='SUBMIT' THEN 1 ELSE 0 END,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 IF @operation IN('APPROVE','REQUEST_CHANGES','REJECT') UPDATE dbo.CertificationRecord SET status=CASE @operation WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REQUEST_CHANGES' THEN 'CHANGES_REQUESTED' ELSE 'REJECTED' END,
  reviewer_id=COALESCE(@decisionLead,reviewer_id),feedback=LTRIM(RTRIM(@feedback)),reviewed_at=SYSUTCDATETIME(),revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 SELECT @after=(SELECT * FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @leadNoticeRecipient IS NOT NULL SET @after=JSON_MODIFY(@after,'$.leadNoticeRecipient',CONVERT(varchar(36),@leadNoticeRecipient));
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,
  CASE @operation WHEN 'SAVE' THEN 'certification.saved' WHEN 'SAVE_SUBMIT' THEN 'certification.submitted' WHEN 'SUBMIT' THEN 'certification.submitted' WHEN 'APPROVE' THEN 'certification.approved' WHEN 'REQUEST_CHANGES' THEN 'certification.changes_requested' ELSE 'certification.rejected' END,@id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CapabilitySubmissionWorkspace @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(20),@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>500000 OR @operation NOT IN('CATALOGUE','SAVE','INTAKE','GET','MINE','QUEUE','SUBMIT','REROUTE','DECIDE','LINKS','OPTIONS','PUBLISH_LINKS','DISCARD','RESTORE') THROW 51000,'Invalid submission operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@revision int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@owner uniqueidentifier,@reviewer uniqueidentifier,@status varchar(20),@version int,@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Capability access denied.',1;
 IF @operation IN('CATALOGUE','MINE','OPTIONS','SAVE','INTAKE','SUBMIT','REROUTE','PUBLISH_LINKS','DISCARD','RESTORE') AND dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Personal skill access denied.',1;
 IF @operation='CATALOGUE' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Published catalogue claim access required.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('search','page')) THROW 51000,'Invalid catalogue filters.',1;
  DECLARE @catalogueSearch nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),N''),@cataloguePage int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1);
  IF @cataloguePage NOT BETWEEN 1 AND 100 OR LEN(JSON_VALUE(@payload,'$.search'))>100 THROW 51000,'Invalid catalogue filters.',1;
  SELECT d.id INTO #credentialChoices FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1 WHERE d.account_id=@account_id AND d.active=1 AND (@catalogueSearch=N'' OR CHARINDEX(@catalogueSearch,d.name)>0 OR CHARINDEX(@catalogueSearch,p.name)>0 OR CHARINDEX(@catalogueSearch,d.category)>0);
  SELECT (SELECT (SELECT COUNT(*) FROM #credentialChoices) AS total,@cataloguePage AS page,10 AS pageSize,
   JSON_QUERY((SELECT d.id,d.name,p.name AS provider,d.category,LEFT(d.description,500) AS description,JSON_QUERY((SELECT TOP(10) sc.skill_id AS id,sc.display_name AS name,sc.category FROM dbo.CredentialSkillMapping m JOIN dbo.SkillCatalogue sc ON sc.account_id=m.account_id AND sc.skill_id=m.skill_id AND sc.status='PUBLISHED' WHERE m.account_id=d.account_id AND m.credential_id=d.id ORDER BY sc.display_name,sc.skill_id FOR JSON PATH)) AS relatedSkills FROM #credentialChoices v JOIN dbo.CredentialDefinition d ON d.account_id=@account_id AND d.id=v.id JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id ORDER BY d.name,p.name,d.id OFFSET ((@cataloguePage-1)*10) ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH)) AS credentials FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  COMMIT;RETURN;
 END;
 IF @operation='OPTIONS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Published catalogue claim access required.',1;
  SELECT (SELECT JSON_QUERY((SELECT c.claim_id AS id,c.revision,c.skill_id AS skillId,c.skill_name AS name,c.definition_revision AS definitionRevision,c.status,c.claimed_rank AS rank,c.experience_months AS experienceMonths,c.description,c.projects,c.evidence,c.last_used_on AS lastUsedOn FROM dbo.SkillClaimDraft c WHERE c.account_id=@account_id AND c.person_id=@actor_id FOR JSON PATH)) AS claims,
   JSON_QUERY((SELECT c.id,c.revision,c.certification_name AS certificationName,c.provider,c.category,c.issue_date AS certificationDate,c.expiry_date AS expiryDate,c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.notes,c.status,c.renewed_from_id AS renewedFromId,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord e WHERE e.account_id=c.account_id AND e.certification_id=c.id AND active=1) THEN 1 ELSE 0 END) AS hasImage FROM dbo.CurrentCertificationRecord c WHERE c.account_id=@account_id AND c.person_id=@actor_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS certifications,
   JSON_QUERY((SELECT d.id,d.name,p.name AS provider,d.category,d.description,d.revision,JSON_QUERY((SELECT s.skill_id AS id,s.display_name AS name,s.category,s.definition_revision AS definitionRevision,JSON_QUERY((SELECT c.rank,l.display_name AS name,c.description FROM dbo.SkillVersionCriterion c JOIN dbo.ProficiencyLevel l ON l.framework_id=c.framework_id AND l.rank=c.rank WHERE c.account_id=s.account_id AND c.skill_id=s.skill_id AND c.definition_revision=s.definition_revision ORDER BY c.rank FOR JSON PATH)) AS levels FROM dbo.CredentialSkillMapping m JOIN dbo.SkillCatalogue s ON s.account_id=m.account_id AND s.skill_id=m.skill_id AND s.status='PUBLISHED' WHERE m.account_id=d.account_id AND m.credential_id=d.id ORDER BY s.display_name,s.skill_id FOR JSON PATH)) AS relatedSkills FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1 WHERE d.account_id=@account_id AND d.active=1 FOR JSON PATH)) AS definitions FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  COMMIT;RETURN;
 END;
 IF @operation IN('MINE','QUEUE') BEGIN
  IF @operation='QUEUE' AND (dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessReportingValid(@account_id,@actor_id)<>1) AND dbo.CapabilityLeadHasGrants(@account_id,@actor_id)<>1 THROW 51003,'Review denied.',1;
  SELECT (SELECT JSON_QUERY((SELECT TOP(50) COUNT(*) OVER() AS total,b.id,b.person_id AS personId,b.revision,b.status,CONVERT(bit,CASE WHEN @operation='MINE' AND b.status='DRAFT' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canEdit,p.display_name AS name,COALESCE(JSON_VALUE(b.intake_json,'$.certifications[0].fields.certificationName'),JSON_VALUE(b.intake_json,'$.skills[0].choice.name'),(SELECT TOP(1) c.certification_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id),(SELECT TOP(1) s.skill_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N'Capability draft') AS label,b.updated_at AS updatedAt,
   CASE WHEN b.intake_json IS NOT NULL THEN (SELECT COUNT(*) FROM OPENJSON(b.intake_json,'$.skills')) ELSE (SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL') END AS skills,
   CASE WHEN b.intake_json IS NOT NULL THEN (SELECT COUNT(*) FROM OPENJSON(b.intake_json,'$.certifications')) ELSE (SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION') END AS certifications
   FROM dbo.CapabilitySubmission b JOIN dbo.AccessPerson p ON p.account_id=b.account_id AND p.person_id=b.person_id AND p.active=1
   WHERE b.account_id=@account_id AND b.status<>'DISCARDED' AND (@operation='MINE' AND b.person_id=@actor_id OR @operation='QUEUE' AND b.status='SUBMITTED' AND ((b.reviewer_id=@actor_id AND b.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id) AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1) OR dbo.CapabilityLeadCanReviewSubmission(@account_id,@actor_id,b.id)=1))
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
  SELECT (SELECT JSON_QUERY((SELECT l.claim_id AS claimId,s.skill_id AS skillId,s.skill_name AS skillName,l.certification_id AS certificationId,c.certification_name AS certificationName,c.provider,c.status,c.expiry_date AS expiryDate,c.issue_date AS certificationDate,c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.supersededById,l.submission_id AS submissionId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id JOIN dbo.CertificationPortfolio c ON c.account_id=l.account_id AND c.id=l.certification_id WHERE l.account_id=@account_id AND (@kind='SKILL' AND l.claim_id=@id OR @kind='CERTIFICATION' AND l.certification_id=@id) AND (s.person_id=@actor_id OR l.published=1 AND s.status IN('SUBMITTED','APPROVED') AND c.status IN('SUBMITTED','APPROVED')) FOR JSON PATH)) AS links FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
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
 DECLARE @leadNoticeRecipient uniqueidentifier,@leadDecision bit=0;
 IF @operation IN('GET','DECIDE') AND @status='SUBMITTED' AND dbo.CapabilityLeadCanReviewSubmission(@account_id,@actor_id,@id)=1 SET @leadDecision=1;
 IF @owner IS NOT NULL AND @owner<>@actor_id AND @leadDecision=0 AND NOT(@operation IN('GET','DECIDE') AND @reviewer IS NOT NULL AND @reviewer=@actor_id AND @owner<>@actor_id AND @status<>'DRAFT' AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,@owner)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@owner AND active=1) AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner AND manager_id=@actor_id)) THROW 51003,'Assigned submission denied.',1;
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
   DECLARE @leadReviewer uniqueidentifier=dbo.CapabilityLeadForSubmission(@account_id,@id);
   DECLARE @eligibleManager uniqueidentifier=dbo.CapabilityManagerForSubmission(@account_id,@actor_id);
   IF @eligibleManager IS NOT NULL AND dbo.AccessCan(@account_id,@eligibleManager,'skill.view',1)<>1
    AND EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='CERTIFICATION' AND needs_review=1)
    SET @eligibleManager=NULL;
   SET @reviewer=COALESCE(@eligibleManager,@leadReviewer,@reviewer);
   IF @reviewer IS NULL OR @reviewer=@actor_id OR (@leadReviewer IS NULL AND dbo.AccessReportingValid(@account_id,@actor_id)<>1) THROW 51011,'Reporting manager or scoped Capability Lead unavailable.',1;
   IF @operation='REROUTE' AND @oldReviewer=@reviewer THROW 51010,'This request is already assigned to your current manager.',1;
  END;
  UPDATE dbo.CapabilitySubmission SET status='SUBMITTING',reviewer_id=@reviewer WHERE account_id=@account_id AND id=@id;
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
  IF @status<>'SUBMITTED' OR @owner=@actor_id OR (@leadDecision=0 AND (@reviewer IS NULL OR @reviewer<>@actor_id)) THROW 51003,'Assigned review required.',1;
  SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) AS id,JSON_VALUE(value,'$.kind') AS kind,TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) AS revision,JSON_VALUE(value,'$.action') AS action,JSON_VALUE(value,'$.feedback') AS feedback INTO #d FROM OPENJSON(@payload,'$.decisions');
  IF (SELECT COUNT(*) FROM #d)<>(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND needs_review=1) OR EXISTS(SELECT kind,id FROM #d GROUP BY kind,id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM #d d WHERE NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=@account_id AND i.submission_id=@id AND i.needs_review=1 AND i.kind=d.kind AND i.record_id=d.id)) THROW 51000,'Review all pending items exactly once.',1;
  IF @leadDecision=1
   SELECT @leadNoticeRecipient=o.manager_id FROM dbo.AccessOrgAssignment o
   JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.manager_id AND p.active=1
   WHERE o.account_id=@account_id AND o.person_id=@owner AND o.manager_id<>@actor_id
    AND dbo.AccessReportingValid(@account_id,@owner)=1;
  -- Close the bundle inside the same transaction before item transitions. The
  -- grouped-item triggers prevent external endpoints from partially reviewing it.
  UPDATE dbo.CapabilitySubmission SET status='REVIEWED',reviewer_id=@actor_id WHERE account_id=@account_id AND id=@id;
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
  INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json) VALUES(@account_id,@workspace+1,@actor_id,@id,'capability.'+LOWER(@operation),(SELECT @id AS id,@actor_id AS actorId,@leadNoticeRecipient AS leadNoticeRecipient,JSON_QUERY(CASE WHEN @operation='DECIDE' THEN (SELECT kind,record_id AS id,needs_review AS needsReview,JSON_QUERY(decision_json) AS decision FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id FOR JSON PATH) END) AS items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 END;
 SELECT (SELECT b.id,b.revision,b.status,CONVERT(bit,CASE WHEN b.person_id=@actor_id AND b.status='SUBMITTED' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson m ON m.account_id=o.account_id AND m.person_id=o.manager_id AND m.active=1 WHERE o.account_id=@account_id AND o.person_id=@actor_id AND o.manager_id<>b.reviewer_id AND o.manager_id<>@actor_id) THEN 1 ELSE 0 END) AS canReroute,b.person_id AS personId,b.reviewer_id AS reviewerId,JSON_QUERY(b.intake_json) AS intake,JSON_QUERY((SELECT certification_id AS certificationId,evidence_id AS id,file_name AS fileName,mime_type AS mimeType,bytes FROM dbo.CapabilityIntakeFile WHERE account_id=@account_id AND submission_id=@id AND active=1 AND transferred=0 FOR JSON PATH)) AS stagedFiles,
 JSON_QUERY((SELECT i.record_id AS id,s.skill_id AS skillId,CASE WHEN b.status='DRAFT' THEN s.skill_name ELSE JSON_VALUE(i.snapshot_json,'$.skill_name') END AS name,CASE WHEN b.status='DRAFT' THEN s.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,s.revision,CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END AS definitionRevision,CASE WHEN b.status='DRAFT' THEN s.claimed_rank ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.claimed_rank')) END AS rank,CASE WHEN b.status='DRAFT' THEN s.experience_months ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.experience_months')) END AS experienceMonths,CASE WHEN b.status='DRAFT' THEN s.description ELSE JSON_VALUE(i.snapshot_json,'$.description') END AS description,CASE WHEN b.status='DRAFT' THEN s.projects ELSE JSON_VALUE(i.snapshot_json,'$.projects') END AS projects,CASE WHEN b.status='DRAFT' THEN s.evidence ELSE JSON_VALUE(i.snapshot_json,'$.evidence') END AS evidence,CASE WHEN b.status='DRAFT' THEN s.last_used_on ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.last_used_on')) END AS lastUsedOn,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE s.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE s.feedback END AS feedback,i.needs_review AS needsReview,JSON_QUERY((SELECT criteria.rank,level.display_name AS name,criteria.description FROM dbo.SkillVersionCriterion criteria JOIN dbo.ProficiencyLevel level ON level.framework_id=criteria.framework_id AND level.rank=criteria.rank WHERE criteria.account_id=s.account_id AND criteria.skill_id=s.skill_id AND criteria.definition_revision=CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END ORDER BY criteria.rank FOR JSON PATH)) AS levels FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='SKILL' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS skills,
 JSON_QUERY((SELECT i.record_id AS id,c.revision,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord e WHERE e.account_id=c.account_id AND e.certification_id=c.id AND e.active=1) THEN 1 ELSE 0 END) AS hasImage,CASE WHEN b.status='DRAFT' THEN c.certification_name ELSE JSON_VALUE(i.snapshot_json,'$.certification_name') END AS certificationName,CASE WHEN b.status='DRAFT' THEN c.provider ELSE JSON_VALUE(i.snapshot_json,'$.provider') END AS provider,CASE WHEN b.status='DRAFT' THEN c.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,CASE WHEN b.status='DRAFT' THEN c.issue_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.issue_date')) END AS certificationDate,CASE WHEN b.status='DRAFT' THEN c.expiry_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.expiry_date')) END AS expiryDate,CASE WHEN b.status='DRAFT' THEN c.credential_id ELSE JSON_VALUE(i.snapshot_json,'$.credential_id') END AS credentialId,CASE WHEN b.status='DRAFT' THEN c.credential_url ELSE JSON_VALUE(i.snapshot_json,'$.credential_url') END AS credentialUrl,CASE WHEN b.status='DRAFT' THEN c.notes ELSE JSON_VALUE(i.snapshot_json,'$.notes') END AS notes,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE c.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE c.feedback END AS feedback,i.needs_review AS needsReview,CASE WHEN b.status='DRAFT' THEN c.renewed_from_id ELSE TRY_CONVERT(uniqueidentifier,JSON_VALUE(i.snapshot_json,'$.renewed_from_id')) END AS renewedFromId,JSON_QUERY(CASE WHEN b.status<>'DRAFT' THEN JSON_QUERY(i.snapshot_json,'$.relatedSkills') ELSE (SELECT s.skill_id AS skillId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND s.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL') FOR JSON PATH) END) AS relatedSkills FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='CERTIFICATION' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS certifications
 FROM dbo.CapabilitySubmission b WHERE b.account_id=@account_id AND b.id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadCapabilitySubmissionNotifications @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 SELECT TOP(30) 'capability-'+CONVERT(varchar(36),b.id)+'-'+CONVERT(varchar(12),a.revision) AS id,a.occurred_at AS at,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN N'Capability Lead recorded a decision' WHEN a.action='capability.decide' THEN N'Capability review completed' ELSE N'Capability review requested' END AS title,CONCAT((SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.skill_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N' · ',(SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.certification_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id)) AS subject,
 CONCAT((SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL'),N' skill(s), ',(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION'),N' certificate(s)',CASE WHEN a.action='capability.decide' AND JSON_QUERY(a.after_json,'$.items') IS NOT NULL THEN CONCAT(N' · ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='APPROVED'),N' approved; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='CHANGES_REQUESTED'),N' changes requested; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='REJECTED'),N' not approved') ELSE N'' END,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN COALESCE((
 SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(N' · ',d.kind,N' ',JSON_VALUE(d.decision,'$.status'),N': ',JSON_VALUE(d.decision,'$.feedback'))),N'')
 FROM OPENJSON(a.after_json,'$.items') WITH(kind varchar(20),needsReview bit,decision nvarchar(max) AS JSON) d
 WHERE d.needsReview=1),N'') ELSE N'' END) AS body,(SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=a.account_id AND p.person_id=a.actor_id) AS actorName,CASE WHEN a.action='capability.decide' THEN N'Review completed' ELSE N'Submitted for review' END AS actionLabel,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN '' ELSE CASE WHEN a.action='capability.decide' THEN '/my-skills?submission=' ELSE '/skill-reviews?submission=' END+CONVERT(varchar(36),b.id) END AS href
 FROM dbo.AccessAudit a JOIN dbo.CapabilitySubmission b ON b.account_id=a.account_id AND b.id=a.target_id
 WHERE a.account_id=@account_id AND (a.action='capability.decide' AND (b.person_id=@actor_id OR (TRY_CONVERT(uniqueidentifier,JSON_VALUE(a.after_json,'$.leadNoticeRecipient'))=@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id))) OR a.action IN('capability.submit','capability.reroute') AND a.revision=(SELECT MAX(x.revision) FROM dbo.AccessAudit x WHERE x.account_id=b.account_id AND x.target_id=b.id AND x.action IN('capability.submit','capability.reroute')) AND b.status='SUBMITTED' AND ((b.reviewer_id=@actor_id AND b.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id) AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1) OR dbo.CapabilityLeadCanReviewSubmission(@account_id,@actor_id,b.id)=1)) ORDER BY a.occurred_at DESC,a.revision DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CertificationImage
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@operation varchar(8)='READ',
 @expected_revision int=NULL,@evidence_id uniqueidentifier=NULL,@blob_name varchar(160)=NULL,@bytes int=NULL,@width int=NULL,@height int=NULL,
 @mime_type varchar(100)=NULL,@file_name nvarchar(255)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @operation IS NULL OR @operation NOT IN('READ','CHECK','ADD','REMOVE') THROW 51000,'Invalid image operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@owner uniqueidentifier,@status varchar(20),@revision int,@can_upload bit=0,@before nvarchar(max);
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 SELECT @owner=person_id,@status=status,@revision=revision FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@claim_id;
 IF @owner IS NULL THROW 51004,'Certification unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Certification access denied.',1;
 IF @owner=@actor_id BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND @status IN('DRAFT','CHANGES_REQUESTED','REJECTED') SET @can_upload=1;
 END ELSE IF dbo.CertificationCanReview(@account_id,@actor_id,@claim_id)<>1 AND (@operation<>'READ' OR dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,@claim_id)<>1) THROW 51003,'Assigned file unavailable.',1;
 IF @operation IN('CHECK','ADD','REMOVE') BEGIN
  IF @can_upload<>1 THROW 51003,'File changes unavailable.',1;
  IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Certification changed.',1;
 END;
 IF @operation IN('ADD','REMOVE') BEGIN
  SELECT @before=(SELECT evidence_id AS fileId,mime_type AS mimeType,bytes FROM dbo.CertificationImageRecord WHERE account_id=@account_id AND certification_id=@claim_id AND active=1 FOR JSON PATH);
  IF @operation='ADD' AND (@evidence_id IS NULL OR @blob_name IS NULL OR @blob_name<>LOWER(CONVERT(varchar(36),@account_id)+'/certifications/'+CONVERT(varchar(36),@claim_id)+'/'+CONVERT(varchar(36),@evidence_id))
   OR @bytes IS NULL OR @bytes NOT BETWEEN 1 AND 5242880
   OR @mime_type NOT IN('image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')
   OR @file_name IS NULL OR LEN(@file_name)=0 OR LEN(@file_name)>255
   OR @mime_type='image/webp' AND (@width IS NULL OR @width NOT BETWEEN 1 AND 1920 OR @height IS NULL OR @height NOT BETWEEN 1 AND 1920)
   OR @mime_type<>'image/webp' AND (@width IS NOT NULL OR @height IS NOT NULL)) THROW 51000,'Invalid certificate file.',1;
  UPDATE dbo.CertificationImageRecord SET active=0 WHERE account_id=@account_id AND certification_id=@claim_id AND active=1;
  IF @operation='ADD' INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height,mime_type,file_name)
   VALUES(@account_id,@claim_id,@evidence_id,@blob_name,@bytes,@width,@height,@mime_type,@file_name);
  UPDATE dbo.CertificationRecord SET revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@claim_id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,CASE @operation WHEN 'ADD' THEN 'certification.file.saved' ELSE 'certification.file.removed' END,@claim_id,@before,(SELECT @evidence_id AS fileId,@mime_type AS mimeType,@bytes AS bytes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SET @revision=@revision+1;
 END;
 SELECT @revision AS revision,@can_upload AS canUpload;
 SELECT evidence_id AS id,blob_name AS blobName,bytes,width,height,mime_type AS mimeType,file_name AS fileName
 FROM dbo.CertificationImageRecord WHERE account_id=@account_id AND certification_id=@claim_id AND active=1;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadCertificationNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account_id AND status='ACTIVE')
  OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1
  OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1
  THROW 51003,'Certification access denied.',1;

 SELECT TOP(30) 'certification-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(12),u.revision) AS id,
  u.occurred_at AS at,
  CASE WHEN c.person_id<>@actor_id AND u.action<>'certification.submitted' THEN N'Capability Lead · '+REPLACE(REPLACE(u.action,'certification.',''),'_',' ') ELSE CASE u.action WHEN 'certification.submitted' THEN N'Certificate review requested'
   WHEN 'certification.approved' THEN N'Certificate approved'
   WHEN 'certification.changes_requested' THEN N'Certificate needs changes'
   ELSE N'Certificate not approved' END END AS title,
  CONCAT(c.certification_name,CASE WHEN LEN(ISNULL(JSON_VALUE(u.after_json,'$.feedback'),N''))>0
   THEN N' · '+JSON_VALUE(u.after_json,'$.feedback') ELSE N'' END) AS body,
  (SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=u.account_id AND p.person_id=u.actor_id) AS actorName,
  CASE u.action WHEN 'certification.submitted' THEN N'Submitted for review'
   WHEN 'certification.approved' THEN N'Approved'
   WHEN 'certification.changes_requested' THEN N'Changes requested'
   ELSE N'Not approved' END AS actionLabel,
  CASE WHEN u.action='certification.submitted' THEN '/skill-reviews?certification='+CONVERT(varchar(36),c.id) WHEN c.person_id=@actor_id THEN '/my-skills?record='+CONVERT(varchar(36),c.id) ELSE '' END AS href
 FROM dbo.AccessAudit u
 JOIN dbo.CertificationRecord c ON c.account_id=u.account_id AND c.id=u.target_id
 WHERE u.account_id=@account_id
  AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i
   WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1)
  AND (
   u.action='certification.submitted' AND (
    (c.reviewer_id=@actor_id AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
     AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.reviewer_id'))=@actor_id)
    OR (dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,c.id)=1 AND u.revision=(
     SELECT MAX(revision) FROM dbo.AccessAudit WHERE account_id=@account_id AND target_id=c.id AND action='certification.submitted'
    ))
   )
   OR u.action IN('certification.approved','certification.changes_requested','certification.rejected')
    AND (c.person_id=@actor_id OR (
     TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.leadNoticeRecipient'))=@actor_id
     AND dbo.AccessReportingValid(@account_id,c.person_id)=1
     AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=c.account_id AND o.person_id=c.person_id AND o.manager_id=@actor_id)
    ))
  )
 ORDER BY u.occurred_at DESC,u.revision DESC;
END;
GO
