-- Approved renewals replace current portfolio visibility, never historical records.
-- Views are internal read projections. Runtime authority is retained in the calling procedures.
GO
CREATE OR ALTER PROCEDURE dbo.CertificationReviewAnalytics @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessReportingValid(@account_id,@actor_id)<>1 THROW 51003,'Review denied.',1;
 SELECT c.person_id,c.status,c.issue_date,c.expiry_date,c.category INTO #assigned FROM dbo.CertificationRecord c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1
 WHERE c.account_id=@account_id AND c.person_id<>@actor_id AND c.reviewer_id=@actor_id AND c.status IN('SUBMITTED','APPROVED')
 AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal WHERE renewal.account_id=c.account_id AND renewal.person_id=c.person_id AND renewal.renewed_from_id=c.id AND renewal.status='APPROVED')
 AND dbo.AccessReportingValid(@account_id,c.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=c.account_id AND o.person_id=c.person_id AND o.manager_id=@actor_id);
 SELECT ISNULL(SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END),0) AS pending,
 ISNULL(SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END),0) AS reviewed,
 COUNT(DISTINCT CASE WHEN status='APPROVED' AND issue_date<=CONVERT(date,SYSUTCDATETIME()) AND (expiry_date IS NULL OR expiry_date>=CONVERT(date,SYSUTCDATETIME())) THEN person_id END) AS certifiedPeople,
 ISNULL(SUM(CASE WHEN status='APPROVED' AND expiry_date<CONVERT(date,SYSUTCDATETIME()) THEN 1 ELSE 0 END),0) AS expired,
 ISNULL(SUM(CASE WHEN status='APPROVED' AND expiry_date BETWEEN CONVERT(date,SYSUTCDATETIME()) AND DATEADD(day,90,CONVERT(date,SYSUTCDATETIME())) THEN 1 ELSE 0 END),0) AS expiresSoon,
 ISNULL(SUM(CASE WHEN status='APPROVED' AND expiry_date IS NULL THEN 1 ELSE 0 END),0) AS noExpiry,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 THEN 1 ELSE 0 END) AS canRecommend FROM #assigned;
 SELECT category,COUNT(*) AS count FROM #assigned GROUP BY category ORDER BY COUNT(*) DESC,category;
END;
GO
CREATE OR ALTER VIEW dbo.CertificationPortfolio AS
SELECT c.*,
 (SELECT TOP(1) r.id FROM dbo.CertificationRecord r WHERE r.account_id=c.account_id AND r.person_id=c.person_id AND r.renewed_from_id=c.id AND r.status='APPROVED' ORDER BY r.reviewed_at DESC,r.id) AS supersededById,
 (SELECT TOP(1) r.id FROM dbo.CertificationRecord r WHERE r.account_id=c.account_id AND r.person_id=c.person_id AND r.renewed_from_id=c.id AND r.status IN('DRAFT','SUBMITTED','CHANGES_REQUESTED') ORDER BY CASE WHEN r.status IN('DRAFT','SUBMITTED') THEN 0 ELSE 1 END,r.updated_at DESC,r.id) AS activeRenewalId
FROM dbo.CertificationRecord c;
GO
CREATE OR ALTER VIEW dbo.CurrentCertificationRecord AS
SELECT * FROM dbo.CertificationPortfolio WHERE supersededById IS NULL;
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
  IF @operation='LIST' AND @view='queue' AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 THROW 51003,'Review denied.',1;
  SELECT c.id INTO #visible FROM dbo.CertificationRecord c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
  WHERE c.account_id=@account_id AND (@id IS NULL OR c.id=@id)
  AND ((@operation='GET' OR @view='mine') AND c.person_id=@actor_id OR (@operation='GET' OR @view='queue') AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1)
  AND NOT(@operation='LIST' AND @view='queue' AND EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1 AND b.status='SUBMITTED'))
  AND (@search=N'' OR CHARINDEX(@search,c.certification_name)>0 OR CHARINDEX(@search,c.provider)>0 OR CHARINDEX(@search,p.display_name)>0);
  IF @operation='GET' AND NOT EXISTS(SELECT 1 FROM #visible) THROW 51004,'Certification unavailable.',1;
  IF @operation='LIST' SELECT COUNT(*) AS total FROM #visible;
  SELECT c.id,c.revision,(SELECT TOP(1) i.submission_id FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b ON b.account_id=i.account_id AND b.id=i.submission_id WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1 AND b.status IN('DRAFT','SUBMITTED') ORDER BY b.updated_at DESC,b.id) AS activeSubmissionId,JSON_QUERY((SELECT sc.skill_id AS id,sc.skill_name AS name FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft sc ON sc.account_id=l.account_id AND sc.claim_id=l.claim_id WHERE l.account_id=c.account_id AND l.certification_id=c.id AND (c.person_id=@actor_id OR l.published=1 AND sc.status IN('SUBMITTED','APPROVED')) FOR JSON PATH)) AS relatedSkills,c.person_id AS personId,c.reviewer_id AS reviewerId,p.display_name AS name,p.employee_code AS employeeCode,
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
 SELECT @before=(SELECT * FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @operation IN('SAVE','SAVE_SUBMIT','SUBMIT') BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Personal claim management denied.',1;
  IF @owner IS NOT NULL AND @owner<>@actor_id THROW 51003,'Own record required.',1;
  IF @owner IS NULL AND (@operation='SUBMIT' OR @expected<>0) THROW 51004,'Certification unavailable.',1;
  IF @owner IS NOT NULL AND @revision<>@expected THROW 51009,'Record changed.',1;
  IF @owner IS NOT NULL AND @status NOT IN('DRAFT','CHANGES_REQUESTED','REJECTED') AND @operation<>'SUBMIT' THROW 51010,'Record is locked.',1;
  SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
  IF @operation IN('SAVE_SUBMIT','SUBMIT') BEGIN
   IF dbo.AccessReportingValid(@account_id,@actor_id)<>1 OR @manager IS NULL OR @manager=@actor_id OR dbo.AccessReportingValid(@account_id,@manager)<>1 OR dbo.AccessCan(@account_id,@manager,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@manager,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@manager,'skill.verify',0)<>1 THROW 51011,'Current reviewer unavailable.',1;
   IF @status='APPROVED' OR @status='SUBMITTED' AND @reviewer=@manager THROW 51010,'Record is not editable.',1;
  END;
 END ELSE BEGIN
  IF dbo.CertificationCanReview(@account_id,@actor_id,@id)<>1 THROW 51003,'Assigned current review required.',1;
  IF @expected<>@revision THROW 51009,'Record changed.',1;
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
  feedback=LTRIM(RTRIM(@feedback)),reviewed_at=SYSUTCDATETIME(),revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 SELECT @after=(SELECT * FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
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
  IF @operation='QUEUE' AND (dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessReportingValid(@account_id,@actor_id)<>1) THROW 51003,'Review denied.',1;
  SELECT (SELECT JSON_QUERY((SELECT TOP(50) COUNT(*) OVER() AS total,b.id,b.person_id AS personId,b.revision,b.status,CONVERT(bit,CASE WHEN @operation='MINE' AND b.status='DRAFT' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canEdit,p.display_name AS name,COALESCE(JSON_VALUE(b.intake_json,'$.certifications[0].fields.certificationName'),JSON_VALUE(b.intake_json,'$.skills[0].choice.name'),(SELECT TOP(1) c.certification_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id),(SELECT TOP(1) s.skill_name FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N'Capability draft') AS label,b.updated_at AS updatedAt,
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
  INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json) VALUES(@account_id,@workspace+1,@actor_id,@id,'capability.'+LOWER(@operation),(SELECT @id AS id,@actor_id AS actorId,JSON_QUERY(CASE WHEN @operation='DECIDE' THEN (SELECT kind,record_id AS id,needs_review AS needsReview,JSON_QUERY(decision_json) AS decision FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id FOR JSON PATH) END) AS items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 END;
 SELECT (SELECT b.id,b.revision,b.status,CONVERT(bit,CASE WHEN b.person_id=@actor_id AND b.status='SUBMITTED' AND dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson m ON m.account_id=o.account_id AND m.person_id=o.manager_id AND m.active=1 WHERE o.account_id=@account_id AND o.person_id=@actor_id AND o.manager_id<>b.reviewer_id AND o.manager_id<>@actor_id) THEN 1 ELSE 0 END) AS canReroute,b.person_id AS personId,b.reviewer_id AS reviewerId,JSON_QUERY(b.intake_json) AS intake,JSON_QUERY((SELECT certification_id AS certificationId,evidence_id AS id,file_name AS fileName,mime_type AS mimeType,bytes FROM dbo.CapabilityIntakeFile WHERE account_id=@account_id AND submission_id=@id AND active=1 AND transferred=0 FOR JSON PATH)) AS stagedFiles,
 JSON_QUERY((SELECT i.record_id AS id,s.skill_id AS skillId,CASE WHEN b.status='DRAFT' THEN s.skill_name ELSE JSON_VALUE(i.snapshot_json,'$.skill_name') END AS name,CASE WHEN b.status='DRAFT' THEN s.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,s.revision,CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END AS definitionRevision,CASE WHEN b.status='DRAFT' THEN s.claimed_rank ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.claimed_rank')) END AS rank,CASE WHEN b.status='DRAFT' THEN s.experience_months ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.experience_months')) END AS experienceMonths,CASE WHEN b.status='DRAFT' THEN s.description ELSE JSON_VALUE(i.snapshot_json,'$.description') END AS description,CASE WHEN b.status='DRAFT' THEN s.projects ELSE JSON_VALUE(i.snapshot_json,'$.projects') END AS projects,CASE WHEN b.status='DRAFT' THEN s.evidence ELSE JSON_VALUE(i.snapshot_json,'$.evidence') END AS evidence,CASE WHEN b.status='DRAFT' THEN s.last_used_on ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.last_used_on')) END AS lastUsedOn,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE s.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE s.feedback END AS feedback,i.needs_review AS needsReview,JSON_QUERY((SELECT criteria.rank,level.display_name AS name,criteria.description FROM dbo.SkillVersionCriterion criteria JOIN dbo.ProficiencyLevel level ON level.framework_id=criteria.framework_id AND level.rank=criteria.rank WHERE criteria.account_id=s.account_id AND criteria.skill_id=s.skill_id AND criteria.definition_revision=CASE WHEN b.status='DRAFT' THEN s.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(i.snapshot_json,'$.definition_revision')) END ORDER BY criteria.rank FOR JSON PATH)) AS levels FROM dbo.CapabilitySubmissionItem i JOIN dbo.SkillClaimDraft s ON s.account_id=i.account_id AND s.claim_id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='SKILL' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS skills,
 JSON_QUERY((SELECT i.record_id AS id,c.revision,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord e WHERE e.account_id=c.account_id AND e.certification_id=c.id AND e.active=1) THEN 1 ELSE 0 END) AS hasImage,CASE WHEN b.status='DRAFT' THEN c.certification_name ELSE JSON_VALUE(i.snapshot_json,'$.certification_name') END AS certificationName,CASE WHEN b.status='DRAFT' THEN c.provider ELSE JSON_VALUE(i.snapshot_json,'$.provider') END AS provider,CASE WHEN b.status='DRAFT' THEN c.category ELSE JSON_VALUE(i.snapshot_json,'$.category') END AS category,CASE WHEN b.status='DRAFT' THEN c.issue_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.issue_date')) END AS certificationDate,CASE WHEN b.status='DRAFT' THEN c.expiry_date ELSE TRY_CONVERT(date,JSON_VALUE(i.snapshot_json,'$.expiry_date')) END AS expiryDate,CASE WHEN b.status='DRAFT' THEN c.credential_id ELSE JSON_VALUE(i.snapshot_json,'$.credential_id') END AS credentialId,CASE WHEN b.status='DRAFT' THEN c.credential_url ELSE JSON_VALUE(i.snapshot_json,'$.credential_url') END AS credentialUrl,CASE WHEN b.status='DRAFT' THEN c.notes ELSE JSON_VALUE(i.snapshot_json,'$.notes') END AS notes,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.status') ELSE c.status END AS status,CASE WHEN b.status IN('REVIEWED','LINKED') THEN JSON_VALUE(i.decision_json,'$.feedback') ELSE c.feedback END AS feedback,i.needs_review AS needsReview,CASE WHEN b.status='DRAFT' THEN c.renewed_from_id ELSE TRY_CONVERT(uniqueidentifier,JSON_VALUE(i.snapshot_json,'$.renewed_from_id')) END AS renewedFromId,JSON_QUERY(CASE WHEN b.status<>'DRAFT' THEN JSON_QUERY(i.snapshot_json,'$.relatedSkills') ELSE (SELECT s.skill_id AS skillId FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND s.claim_id IN(SELECT record_id FROM dbo.CapabilitySubmissionItem WHERE account_id=@account_id AND submission_id=@id AND kind='SKILL') FOR JSON PATH) END) AS relatedSkills FROM dbo.CapabilitySubmissionItem i JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id WHERE i.account_id=@account_id AND i.submission_id=@id AND i.kind='CERTIFICATION' FOR JSON PATH,INCLUDE_NULL_VALUES)) AS certifications
 FROM dbo.CapabilitySubmission b WHERE b.account_id=@account_id AND b.id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
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
 SELECT c.id,c.person_id,c.certification_name AS name,c.provider AS issuer,c.category,c.issue_date,c.expiry_date,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at INTO #certs FROM dbo.CurrentCertificationRecord c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today));
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
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.name,s.category,s.recorded_rank AS recordedRank,s.rank AS chartRank,(SELECT COUNT(*) FROM dbo.SkillCertificationLink l JOIN dbo.CurrentCertificationRecord c ON c.account_id=l.account_id AND c.id=l.certification_id WHERE l.account_id=@account_id AND l.claim_id=s.id AND l.published=1 AND c.status='APPROVED') AS reviewedCertificates,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt,CASE WHEN s.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=s.reviewer_id AND s.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN s.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #skills s JOIN #people p ON p.person_id=s.person_id WHERE @status='' OR s.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
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
CREATE OR ALTER FUNCTION dbo.BusinessMatchRequirements(@account uniqueidentifier,@person uniqueidentifier,@requirements nvarchar(max)) RETURNS TABLE AS RETURN (
 SELECT 'SKILL' AS type,CONVERT(varchar(36),TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))) AS id,c.display_name COLLATE DATABASE_DEFAULT AS name,
 CONVERT(bit,CASE WHEN c.status='PUBLISHED' AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft d JOIN dbo.SkillDefinitionVersion v ON v.account_id=d.account_id AND v.skill_id=d.skill_id AND v.definition_revision=d.definition_revision JOIN dbo.SkillDefinitionVersion currentVersion ON currentVersion.account_id=c.account_id AND currentVersion.skill_id=c.skill_id AND currentVersion.definition_revision=c.definition_revision WHERE d.account_id=@account AND d.person_id=@person AND d.skill_id=c.skill_id AND d.status='APPROVED' AND v.framework_id='00000000-0000-4000-8000-000000000003' AND currentVersion.framework_id=v.framework_id AND d.claimed_rank BETWEEN 1 AND 4 AND TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) BETWEEN 1 AND 4 AND d.claimed_rank>=TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank'))) THEN 1 ELSE 0 END) AS matched,
 'Four-level framework manager-reviewed proficiency L'+ISNULL(JSON_VALUE(s.value,'$.minRank'),'')+' or above' AS criterion
 FROM OPENJSON(@requirements,'$.skills') s JOIN dbo.SkillCatalogue c ON c.account_id=@account AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id'))
 UNION ALL SELECT 'CERTIFICATION',CONVERT(varchar(36),c.id),c.name COLLATE DATABASE_DEFAULT,
 CONVERT(bit,CASE WHEN c.active=1 AND provider.active=1 AND EXISTS(SELECT 1 FROM dbo.CurrentCertificationRecord r WHERE r.account_id=@account AND r.person_id=@person AND r.status='APPROVED' AND (r.expiry_date IS NULL OR r.expiry_date>=CONVERT(date,SYSUTCDATETIME())) AND r.issue_date<=CONVERT(date,SYSUTCDATETIME()) AND r.certification_name COLLATE Latin1_General_100_CI_AS=c.name COLLATE Latin1_General_100_CI_AS AND r.provider COLLATE Latin1_General_100_CI_AS=provider.name COLLATE Latin1_General_100_CI_AS) THEN 1 ELSE 0 END),
 'Current manager-reviewed credential; exact master name and provider match (not issuer validation)'
 FROM OPENJSON(@requirements,'$.certifications') s JOIN dbo.CredentialDefinition c ON c.account_id=@account AND c.id=TRY_CONVERT(uniqueidentifier,s.value) JOIN dbo.CredentialProvider provider ON provider.account_id=c.account_id AND provider.id=c.provider_id
);
GO
CREATE OR ALTER PROCEDURE dbo.ReadCapabilitySubmissionNotifications @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 SELECT TOP(30) 'capability-'+CONVERT(varchar(36),b.id)+'-'+CONVERT(varchar(12),a.revision) AS id,a.occurred_at AS at,CASE WHEN a.action='capability.decide' THEN N'Capability review completed' ELSE N'Capability review requested' END AS title,CONCAT((SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.skill_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N' · ',(SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.certification_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id)) AS subject,
 CONCAT((SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL'),N' skill(s), ',(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION'),N' certificate(s)',CASE WHEN a.action='capability.decide' AND JSON_QUERY(a.after_json,'$.items') IS NOT NULL THEN CONCAT(N' · ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='APPROVED'),N' approved; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='CHANGES_REQUESTED'),N' changes requested; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='REJECTED'),N' not approved') ELSE N'' END) AS body,(SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=a.account_id AND p.person_id=a.actor_id) AS actorName,CASE WHEN a.action='capability.decide' THEN N'Review completed' ELSE N'Submitted for review' END AS actionLabel,CASE WHEN a.action='capability.decide' THEN '/my-skills?submission=' ELSE '/skill-reviews?submission=' END+CONVERT(varchar(36),b.id) AS href
 FROM dbo.AccessAudit a JOIN dbo.CapabilitySubmission b ON b.account_id=a.account_id AND b.id=a.target_id
 WHERE a.account_id=@account_id AND (a.action='capability.decide' AND b.person_id=@actor_id OR a.action IN('capability.submit','capability.reroute') AND a.revision=(SELECT MAX(x.revision) FROM dbo.AccessAudit x WHERE x.account_id=b.account_id AND x.target_id=b.id AND x.action IN('capability.submit','capability.reroute')) AND b.status='SUBMITTED' AND b.reviewer_id=@actor_id AND b.person_id<>@actor_id AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id)) ORDER BY a.occurred_at DESC,a.revision DESC;
END;
GO
CREATE OR ALTER FUNCTION dbo.CertificationRenewalValid(@account uniqueidentifier,@source uniqueidentifier,@owner uniqueidentifier,@name nvarchar(200),@provider nvarchar(120),@issue date,@expiry date) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.CertificationPortfolio c WHERE c.account_id=@account AND c.id=@source AND c.person_id=@owner AND c.status='APPROVED' AND c.supersededById IS NULL AND c.expiry_date IS NOT NULL
 AND LTRIM(RTRIM(c.certification_name)) COLLATE Latin1_General_100_CI_AS=LTRIM(RTRIM(@name)) COLLATE Latin1_General_100_CI_AS
 AND LTRIM(RTRIM(c.provider)) COLLATE Latin1_General_100_CI_AS=LTRIM(RTRIM(@provider)) COLLATE Latin1_General_100_CI_AS
 AND @issue>=c.issue_date AND @issue<=CONVERT(date,SYSUTCDATETIME()) AND (@expiry IS NULL OR @expiry>c.expiry_date AND @expiry>=CONVERT(date,SYSUTCDATETIME()) AND @expiry>=@issue)) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CertificationExpiryNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
    dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR
    NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  THROW 51003,'Credential notification access denied.',1;
 DECLARE @today date=CONVERT(date,SYSUTCDATETIME());
 SELECT TOP(30) 'cert-expiry-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(2),d.days) AS id,
  CONVERT(datetime2,DATEADD(day,-d.days,c.expiry_date)) AS at,
  CASE WHEN d.days=0 THEN N'Credential expires today'
   ELSE N'Credential expires in '+CONVERT(nvarchar(2),d.days)+N' days' END AS title,
  c.certification_name+N' expires on '+CONVERT(nvarchar(10),c.expiry_date,23)+
   N'. Record your renewal to update your credential.' AS body,
  '/certifications?renew='+LOWER(CONVERT(varchar(36),c.id)) AS href
 FROM dbo.CurrentCertificationRecord c
 CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
  AND c.expiry_date IS NOT NULL AND DATEDIFF(day,@today,c.expiry_date)=d.days
  AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
   WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
    AND renewal.status IN('SUBMITTED','APPROVED') AND dbo.CertificationRenewalValid(@account_id,c.id,renewal.person_id,renewal.certification_name,renewal.provider,renewal.issue_date,renewal.expiry_date)=1)
 ORDER BY c.expiry_date,c.id,d.days DESC;
END;
GO
