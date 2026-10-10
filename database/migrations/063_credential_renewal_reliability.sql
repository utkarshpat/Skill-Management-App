-- Renewal continuity is explicit; historical records and exact manager authority stay intact.
CREATE OR ALTER FUNCTION dbo.CertificationRenewalValid(@account uniqueidentifier,@source uniqueidentifier,@owner uniqueidentifier,@name nvarchar(200),@provider nvarchar(120),@issue date,@expiry date) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account AND c.id=@source AND c.person_id=@owner AND c.status='APPROVED' AND c.expiry_date IS NOT NULL
 AND LTRIM(RTRIM(c.certification_name)) COLLATE Latin1_General_100_CI_AS=LTRIM(RTRIM(@name)) COLLATE Latin1_General_100_CI_AS
 AND LTRIM(RTRIM(c.provider)) COLLATE Latin1_General_100_CI_AS=LTRIM(RTRIM(@provider)) COLLATE Latin1_General_100_CI_AS
 AND @issue>=c.issue_date AND @issue<=CONVERT(date,SYSUTCDATETIME()) AND (@expiry IS NULL OR @expiry>c.expiry_date AND @expiry>=CONVERT(date,SYSUTCDATETIME()) AND @expiry>=@issue)) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.LinkCertificationRenewal
 @account_id uniqueidentifier,@actor_id uniqueidentifier,
 @certification_id uniqueidentifier,@renewed_from_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF @certification_id IS NULL OR @renewed_from_id IS NULL OR @certification_id=@renewed_from_id
  THROW 51000,'Invalid credential renewal.',1;
 BEGIN TRY BEGIN TRANSACTION;
  DECLARE @workspace int,@owner uniqueidentifier,@status varchar(20),@existing uniqueidentifier,
   @source_owner uniqueidentifier,@source_status varchar(20),@source_expiry date,@before nvarchar(max);
  SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
   WHERE w.account_id=@account_id;
  IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
     dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR
     dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 THROW 51003,'Credential renewal denied.',1;
  SELECT @owner=person_id,@status=status,@existing=renewed_from_id
   FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
   WHERE account_id=@account_id AND id=@certification_id;
  SELECT @source_owner=person_id,@source_status=status,@source_expiry=expiry_date
   FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
   WHERE account_id=@account_id AND id=@renewed_from_id;
  IF @owner IS NULL OR @source_owner IS NULL THROW 51004,'Credential unavailable.',1;
  IF @owner<>@actor_id OR @source_owner<>@actor_id THROW 51003,'Own credentials required.',1;
  IF @status<>'DRAFT' OR @source_status<>'APPROVED' OR @source_expiry IS NULL
   THROW 51010,'Only a saved renewal draft of an expiring reviewed credential can be linked.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.id=@certification_id AND dbo.CertificationRenewalValid(@account_id,@renewed_from_id,c.person_id,c.certification_name,c.provider,c.issue_date,c.expiry_date)=1) THROW 51013,'Renewal must preserve credential continuity and extend current validity.',1;
  IF @existing IS NOT NULL AND @existing<>@renewed_from_id
   THROW 51009,'This draft is linked to another credential.',1;
  IF EXISTS(SELECT 1 FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
    WHERE account_id=@account_id AND renewed_from_id=@renewed_from_id
    AND status IN('DRAFT','SUBMITTED','APPROVED') AND id<>@certification_id)
   THROW 51010,'A renewal draft is already active for this credential.',1;
  IF @existing IS NULL BEGIN
   SET @before=(SELECT id,renewed_from_id FROM dbo.CertificationRecord
    WHERE account_id=@account_id AND id=@certification_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   UPDATE dbo.CertificationRecord SET renewed_from_id=@renewed_from_id
    WHERE account_id=@account_id AND id=@certification_id;
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
    VALUES(@account_id,@workspace+1,@actor_id,'certification.renewal_started',@certification_id,@before,
     (SELECT id,renewed_from_id FROM dbo.CertificationRecord
      WHERE account_id=@account_id AND id=@certification_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  END;
  COMMIT;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
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
 FROM dbo.CertificationRecord c
 CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
  AND c.expiry_date IS NOT NULL AND DATEDIFF(day,@today,c.expiry_date)=d.days
  AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
   WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
    AND renewal.status IN('SUBMITTED','APPROVED') AND dbo.CertificationRenewalValid(@account_id,c.id,renewal.person_id,renewal.certification_name,renewal.provider,renewal.issue_date,renewal.expiry_date)=1)
 ORDER BY c.expiry_date,c.id,d.days DESC;
END;
GO
GRANT EXECUTE ON dbo.LinkCertificationRenewal TO [skill_management_runtime];
GRANT EXECUTE ON dbo.CertificationExpiryNotifications TO [skill_management_runtime];
GO

-- Require a persisted image for submission; retain existing records and draft staging.
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
  u.occurred_at AS at,CASE WHEN u.action='certification.submitted' THEN N'Certification review requested' ELSE N'Certification review completed' END AS title,
  c.certification_name AS body,CASE WHEN u.action='certification.submitted' THEN '/certifications?tab=queue' ELSE '/certifications?tab=mine' END AS href
  FROM dbo.AccessAudit u JOIN dbo.CertificationRecord c ON c.account_id=u.account_id AND c.id=u.target_id
  WHERE u.account_id=@account_id AND
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
  AND (@search=N'' OR CHARINDEX(@search,c.certification_name)>0 OR CHARINDEX(@search,c.provider)>0 OR CHARINDEX(@search,p.display_name)>0);
  IF @operation='GET' AND NOT EXISTS(SELECT 1 FROM #visible) THROW 51004,'Certification unavailable.',1;
  IF @operation='LIST' SELECT COUNT(*) AS total FROM #visible;
  SELECT c.id,c.revision,c.person_id AS personId,c.reviewer_id AS reviewerId,p.display_name AS name,p.employee_code AS employeeCode,
  CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.CertificationImageRecord i WHERE i.account_id=c.account_id AND i.certification_id=c.id AND i.active=1) THEN 1 ELSE 0 END AS bit) AS hasImage,
  c.certification_name AS certificationName,c.provider,c.category,CONVERT(varchar(10),c.issue_date,23) AS certificationDate,
  CONVERT(varchar(10),c.expiry_date,23) AS expiryDate,c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.notes,c.status,c.feedback,
  r.display_name AS reviewedBy,c.reviewed_at AS reviewedAt,c.submitted_at AS submittedAt
  FROM #visible v JOIN dbo.CertificationRecord c ON c.account_id=@account_id AND c.id=v.id
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
  DECLARE @renewalSource uniqueidentifier=(SELECT renewed_from_id FROM dbo.CertificationRecord WHERE account_id=@account_id AND id=@id);
  IF @renewalSource IS NOT NULL AND dbo.CertificationRenewalValid(@account_id,@renewalSource,@owner,@title,@provider,@issue,@expiry)<>1 THROW 51013,'Renewal must preserve credential continuity and extend current validity.',1;
  IF @owner IS NULL INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status)
   VALUES(@account_id,@id,@actor_id,1,@title,@provider,@category,@issue,@expiry,@credential,@url,@notes,'DRAFT');
  ELSE UPDATE dbo.CertificationRecord SET revision=revision+1,certification_name=@title,provider=@provider,category=@category,issue_date=@issue,expiry_date=@expiry,
   credential_id=@credential,credential_url=@url,notes=@notes,status='DRAFT',updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
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
GRANT EXECUTE ON dbo.CertificationWorkspace TO [skill_management_runtime];
GO
