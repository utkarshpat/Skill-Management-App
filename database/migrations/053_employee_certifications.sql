-- Explicit credential actions; no existing grants are copied or widened.
INSERT dbo.Permission(permission_code,description)
SELECT v.code,v.description FROM (VALUES
 ('certification.view',N'View own certifications'),
 ('certification.manage',N'Manage own certification drafts and submissions'),
 ('certification.verify',N'Review assigned certifications of current direct reports'),
 ('certification.directory',N'View organization certification directory'),
 ('certification.export',N'Export organization certifications')
) v(code,description) WHERE NOT EXISTS(SELECT 1 FROM dbo.Permission p WHERE p.permission_code=v.code);
INSERT dbo.AccessImplementedScope(permission_code,scope_kind)
VALUES('certification.view','OWN'),('certification.manage','OWN'),
 ('certification.verify','ORGANIZATION'),('certification.directory','ORGANIZATION'),('certification.export','ORGANIZATION');
GO
CREATE TABLE dbo.EmployeeCertification(
 account_id uniqueidentifier NOT NULL,
 id uniqueidentifier NOT NULL,
 person_id uniqueidentifier NOT NULL,
 reviewer_id uniqueidentifier NULL,
 certification_name nvarchar(200) NOT NULL,
 provider nvarchar(100) NOT NULL,
 category nvarchar(100) NOT NULL,
 issued_date date NOT NULL,
 expiry_date date NULL,
 credential_id nvarchar(100) NOT NULL,
 credential_url nvarchar(500) NOT NULL,
 status varchar(30) NOT NULL CHECK(status IN('DRAFT','SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED')),
 revision int NOT NULL CHECK(revision>0),
 feedback nvarchar(2000) NOT NULL DEFAULT N'',
 reviewed_by uniqueidentifier NULL,
 reviewed_at datetime2 NULL,
 submitted_at datetime2 NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,reviewer_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,reviewed_by) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK(reviewer_id IS NULL OR reviewer_id<>person_id),
 CHECK(expiry_date IS NULL OR expiry_date>=issued_date)
);
CREATE INDEX IX_Certification_Owner ON dbo.EmployeeCertification(account_id,person_id,updated_at);
CREATE INDEX IX_Certification_Reviewer ON dbo.EmployeeCertification(account_id,reviewer_id,status);
CREATE TABLE dbo.CertificationEvent(
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,revision int NOT NULL,
 actor_id uniqueidentifier NOT NULL,action varchar(30) NOT NULL,at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 snapshot nvarchar(max) NOT NULL CHECK(ISJSON(snapshot)=1),
 PRIMARY KEY(account_id,id,revision),
 FOREIGN KEY(account_id,id) REFERENCES dbo.EmployeeCertification(account_id,id),
 FOREIGN KEY(account_id,actor_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
GO
CREATE OR ALTER FUNCTION dbo.CertificationAccess(@account uniqueidentifier,@actor uniqueidentifier,@action varchar(100))
RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 RETURN 0;
 IF @action='certification.verify' BEGIN
  IF dbo.AccessReportingValid(@account,@actor)<>1 RETURN 0;
  IF EXISTS(
   SELECT 1 FROM dbo.AccountRolePermission p JOIN dbo.AccessPersonRole r ON r.account_id=p.account_id AND r.role_id=p.role_id
   WHERE r.account_id=@account AND r.person_id=@actor AND p.permission_code=@action AND p.scope_kind='ORGANIZATION'
    AND p.effect='DENY' AND (p.valid_until IS NULL OR p.valid_until>SYSUTCDATETIME())
   UNION ALL SELECT 1 FROM dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@actor AND permission_code=@action
    AND scope_kind='ORGANIZATION' AND effect='DENY' AND (valid_until IS NULL OR valid_until>SYSUTCDATETIME())
  ) RETURN 0;
  IF EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.person_id AND p.active=1
   WHERE o.account_id=@account AND o.manager_id=@actor AND o.person_id<>@actor AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 1;
  RETURN 0;
 END;
 IF @action='certification.manage' AND dbo.AccessCan(@account,@actor,'certification.view',1)<>1 RETURN 0;
 IF @action='certification.export' AND dbo.AccessCan(@account,@actor,'certification.directory',0)<>1 RETURN 0;
 RETURN dbo.AccessCan(@account,@actor,@action,CASE WHEN @action IN('certification.view','certification.manage') THEN 1 ELSE 0 END);
END;
GO
CREATE OR ALTER FUNCTION dbo.CertificationReviewer(@account uniqueidentifier,@actor uniqueidentifier,@owner uniqueidentifier,@reviewer uniqueidentifier)
RETURNS bit AS BEGIN
 IF @actor=@owner OR @reviewer IS NULL OR @reviewer<>@actor OR dbo.CertificationAccess(@account,@actor,'certification.verify')<>1 RETURN 0;
 IF dbo.AccessReportingValid(@account,@owner)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@owner AND active=1) RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@owner AND manager_id=@actor) RETURN 0;
 RETURN 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.Certifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id)
  THROW 51003,'Workspace denied.',1;
 IF @payload IS NULL OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>16384 THROW 51000,'Invalid certification input.',1;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),
  @today date=CONVERT(date,SYSUTCDATETIME()),@workspace_revision int;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace_revision IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Workspace unavailable.',1;
 IF @action IN('LIST','EXPORT') BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('view','page','search','category','du','active','id')) THROW 51000,'Invalid filters.',1;
  DECLARE @view varchar(20)=JSON_VALUE(@payload,'$.view'),@page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),
   @search nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.search'),N''),@category nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.category'),N''),
   @du nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.du'),N''),
   @active varchar(10)=JSON_VALUE(@payload,'$.active'),@size int=CASE WHEN @action='EXPORT' THEN 5000 ELSE 20 END;
  IF @view IS NULL OR @view NOT IN('mine','queue','directory') OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000
   OR @active IS NULL OR @active NOT IN('ALL','Y','N') OR DATALENGTH(@search)>200 OR DATALENGTH(@category)>200 OR DATALENGTH(@du)>200
   OR (JSON_VALUE(@payload,'$.id') IS NOT NULL AND @id IS NULL) THROW 51000,'Invalid filters.',1;
  IF @view='mine' AND dbo.CertificationAccess(@account_id,@actor_id,'certification.view')<>1
   OR @view='queue' AND dbo.CertificationAccess(@account_id,@actor_id,'certification.verify')<>1
   OR @view='directory' AND dbo.CertificationAccess(@account_id,@actor_id,'certification.directory')<>1
   OR @action='EXPORT' AND (@view<>'directory' OR dbo.CertificationAccess(@account_id,@actor_id,'certification.export')<>1)
   THROW 51003,'Certification read denied.',1;
  DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY,active bit NOT NULL,expiring bit NOT NULL);
  INSERT @visible
  SELECT c.id,v.active,CONVERT(bit,CASE WHEN v.active=1 AND c.expiry_date BETWEEN @today AND DATEADD(day,90,@today) THEN 1 ELSE 0 END)
  FROM dbo.EmployeeCertification c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
  LEFT JOIN dbo.AccessOrgAssignment o ON o.account_id=c.account_id AND o.person_id=c.person_id
  LEFT JOIN dbo.AccessOrgNode team ON team.account_id=o.account_id AND team.node_id=o.team_id AND team.active=1 AND team.kind='TEAM'
  LEFT JOIN dbo.AccessOrgNode department ON department.account_id=o.account_id AND department.node_id=COALESCE(o.department_id,team.parent_id) AND department.active=1 AND department.kind='DEPARTMENT'
  LEFT JOIN dbo.AccessOrgNode du ON du.account_id=o.account_id AND du.node_id=department.parent_id AND du.active=1 AND du.kind='DELIVERY_UNIT'
  CROSS APPLY(SELECT CONVERT(bit,CASE WHEN c.status='APPROVED' AND p.active=1 AND (c.expiry_date IS NULL OR c.expiry_date>=@today) THEN 1 ELSE 0 END) AS active) v
  WHERE c.account_id=@account_id AND (@id IS NULL OR c.id=@id)
   AND (@view='mine' AND c.person_id=@actor_id
    OR @view='queue' AND c.status='SUBMITTED' AND dbo.CertificationReviewer(@account_id,@actor_id,c.person_id,c.reviewer_id)=1
    OR @view='directory' AND c.status<>'DRAFT')
   AND (@search=N'' OR CHARINDEX(@search,c.certification_name)>0 OR CHARINDEX(@search,c.provider)>0 OR CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0)
   AND (@category=N'' OR c.category=@category)
   AND (@du=N'' OR ISNULL(du.display_name,N'Unassigned')=@du)
   AND (@active='ALL' OR @active='Y' AND v.active=1 OR @active='N' AND v.active=0);
  IF @action='EXPORT' AND (SELECT COUNT(*) FROM @visible)>5000 THROW 51000,'Narrow report filters to at most 5000 credentials.',1;
  SELECT COUNT(*) AS total,ISNULL(SUM(CONVERT(int,active)),0) AS activeCount,
   ISNULL(SUM(CONVERT(int,expiring)),0) AS expiringSoonCount,@workspace_revision AS revision FROM @visible;
  SELECT c.id,c.person_id AS personId,c.reviewer_id AS reviewerId,c.revision,
   p.display_name AS name,p.employee_code AS employeeCode,ISNULL(du.display_name,N'Unassigned') AS du,
   c.certification_name AS certificationName,c.provider,c.category,CONVERT(varchar(10),c.issued_date,23) AS certificationDate,
   CONVERT(varchar(10),c.expiry_date,23) AS expiryDate,
   CASE WHEN c.expiry_date IS NULL THEN 'Yes' ELSE 'No' END AS doesNotExpire,
   CASE WHEN v.active=1 THEN 'Y' ELSE 'N' END AS active,
   c.credential_id AS credentialId,c.credential_url AS credentialUrl,c.status,c.feedback AS feedbackNote,
   CONVERT(bit,CASE WHEN c.status='APPROVED' THEN 1 ELSE 0 END) AS verified,
   reviewer.display_name AS reviewedBy,c.reviewed_at AS reviewedAt,c.submitted_at AS submittedAt,
   CONVERT(bit,CASE WHEN c.person_id=@actor_id AND c.status IN('DRAFT','CHANGES_REQUESTED','REJECTED') AND dbo.CertificationAccess(@account_id,@actor_id,'certification.manage')=1 THEN 1 ELSE 0 END) AS canEdit,
   CONVERT(bit,CASE WHEN c.status='SUBMITTED' AND dbo.CertificationReviewer(@account_id,@actor_id,c.person_id,c.reviewer_id)=1 THEN 1 ELSE 0 END) AS canReview,
   CASE WHEN c.person_id=@actor_id THEN 'SELF_REVIEW'
    WHEN p.active=0 THEN 'INACTIVE_CLAIMANT'
    WHEN dbo.CertificationAccess(@account_id,@actor_id,'certification.verify')<>1 THEN 'REVIEW_ACCESS_DENIED'
    WHEN dbo.AccessReportingValid(@account_id,c.person_id)<>1 THEN 'INVALID_RELATIONSHIP'
    WHEN o.manager_id IS NULL OR o.manager_id<>@actor_id THEN 'NOT_CURRENT_DIRECT_MANAGER'
    WHEN c.reviewer_id IS NULL OR c.reviewer_id<>@actor_id THEN 'NOT_ASSIGNED_REVIEWER'
    WHEN c.status<>'SUBMITTED' THEN 'NOT_AWAITING_REVIEW'
    ELSE 'CURRENT_ASSIGNED_DIRECT_MANAGER' END AS reviewReason,
   CONVERT(bit,CASE WHEN c.person_id=@actor_id AND c.status='SUBMITTED' AND (o.manager_id IS NULL OR c.reviewer_id<>o.manager_id) THEN 1 ELSE 0 END) AS routingMismatch,
   (SELECT TOP(20) e.revision,e.action,e.at,a.display_name AS actorName,
    JSON_VALUE(e.snapshot,'$.feedback') AS feedback
    FROM dbo.CertificationEvent e JOIN dbo.AccessPerson a ON a.account_id=e.account_id AND a.person_id=e.actor_id
    WHERE e.account_id=c.account_id AND e.id=c.id AND e.action<>'SAVE' ORDER BY e.revision DESC FOR JSON PATH) AS history
  FROM @visible v JOIN dbo.EmployeeCertification c ON c.account_id=@account_id AND c.id=v.id
  JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
  LEFT JOIN dbo.AccessPerson reviewer ON reviewer.account_id=c.account_id AND reviewer.person_id=c.reviewed_by
  LEFT JOIN dbo.AccessOrgAssignment o ON o.account_id=c.account_id AND o.person_id=c.person_id
  LEFT JOIN dbo.AccessOrgNode team ON team.account_id=o.account_id AND team.node_id=o.team_id AND team.active=1 AND team.kind='TEAM'
  LEFT JOIN dbo.AccessOrgNode department ON department.account_id=o.account_id AND department.node_id=COALESCE(o.department_id,team.parent_id) AND department.active=1 AND department.kind='DEPARTMENT'
  LEFT JOIN dbo.AccessOrgNode du ON du.account_id=o.account_id AND du.node_id=department.parent_id AND du.active=1 AND du.kind='DELIVERY_UNIT'
  ORDER BY c.updated_at DESC,c.id OFFSET (CASE WHEN @action='EXPORT' THEN 0 ELSE (@page-1)*20 END) ROWS FETCH NEXT @size ROWS ONLY;
  COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;RETURN;
 END;
 IF @action IS NULL OR @action NOT IN('SAVE','SUBMIT','REROUTE','APPROVED','CHANGES_REQUESTED','REJECTED') OR @id IS NULL
  OR JSON_VALUE(@payload,'$.action')<>@action OR JSON_VALUE(@payload,'$.action') IS NULL
  OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('id','revision','action','fields','feedback')) THROW 51000,'Invalid action.',1;
 DECLARE @revision int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@current int,
  @owner uniqueidentifier,@assigned uniqueidentifier,@manager uniqueidentifier,@status varchar(30),@before nvarchar(max),@after nvarchar(max);
 IF @revision IS NULL OR @revision<0 THROW 51000,'Invalid revision.',1;
 SELECT @current=revision,@owner=person_id,@assigned=reviewer_id,@status=status FROM dbo.EmployeeCertification WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id;
 IF @current IS NULL AND @revision<>0 OR @current IS NOT NULL AND @revision<>@current THROW 51009,'Certification changed.',1;
 SET @before=(SELECT * FROM dbo.EmployeeCertification WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @action IN('SAVE','SUBMIT') BEGIN
  IF dbo.CertificationAccess(@account_id,@actor_id,'certification.manage')<>1 OR (@owner IS NOT NULL AND @owner<>@actor_id) THROW 51003,'Own certification required.',1;
  IF @current IS NOT NULL AND @status NOT IN('DRAFT','CHANGES_REQUESTED','REJECTED') THROW 51009,'Certification is locked.',1;
  DECLARE @fields nvarchar(max)=JSON_QUERY(@payload,'$.fields');
  IF @fields IS NULL OR JSON_VALUE(@payload,'$.feedback') IS NOT NULL OR
   EXISTS(SELECT 1 FROM OPENJSON(@fields) WHERE [key] NOT IN('certificationName','provider','category','certificationDate','expiryDate','credentialId','credentialUrl'))
   THROW 51000,'Invalid fields.',1;
  DECLARE @title nvarchar(4000)=JSON_VALUE(@fields,'$.certificationName'),@provider nvarchar(4000)=JSON_VALUE(@fields,'$.provider'),
   @cat nvarchar(4000)=JSON_VALUE(@fields,'$.category'),@issued date=TRY_CONVERT(date,JSON_VALUE(@fields,'$.certificationDate'),23),
   @expiry date=TRY_CONVERT(date,JSON_VALUE(@fields,'$.expiryDate'),23),
   @credential nvarchar(4000)=JSON_VALUE(@fields,'$.credentialId'),@url nvarchar(4000)=JSON_VALUE(@fields,'$.credentialUrl');
  IF NULLIF(LTRIM(RTRIM(@title)),N'') IS NULL OR DATALENGTH(@title)>400
   OR NULLIF(LTRIM(RTRIM(@provider)),N'') IS NULL OR DATALENGTH(@provider)>200
   OR NULLIF(LTRIM(RTRIM(@cat)),N'') IS NULL OR DATALENGTH(@cat)>200
   OR @issued IS NULL OR @issued<'19000101' OR @issued>@today
   OR CONVERT(varchar(10),@issued,23)<>JSON_VALUE(@fields,'$.certificationDate')
   OR (JSON_VALUE(@fields,'$.expiryDate') IS NOT NULL AND (@expiry IS NULL OR CONVERT(varchar(10),@expiry,23)<>JSON_VALUE(@fields,'$.expiryDate')))
   OR @expiry<@issued OR @credential IS NULL OR DATALENGTH(@credential)>200
   OR @url IS NULL OR DATALENGTH(@url)>1000 OR (@url<>N'' AND (LEFT(@url,8)<>N'https://' OR LEN(@url)<10 OR CHARINDEX(N' ',@url)>0
    OR CHARINDEX(N'@',SUBSTRING(@url,9,CHARINDEX(N'/',@url+N'/',9)-9))>0))
   OR (@action='SUBMIT' AND NULLIF(@url,N'') IS NULL) THROW 51000,'Check fields, dates and HTTPS issuer link.',1;
  IF @action='SUBMIT' BEGIN
   SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
   IF @manager IS NULL OR dbo.CertificationReviewer(@account_id,@manager,@actor_id,@manager)<>1 THROW 51003,'An eligible current manager is required.',1;
  END;
  IF @current IS NULL BEGIN
   IF (SELECT COUNT(*) FROM dbo.EmployeeCertification WHERE account_id=@account_id AND person_id=@actor_id)>=1000 THROW 51000,'Credential limit reached.',1;
   INSERT dbo.EmployeeCertification(account_id,id,person_id,certification_name,provider,category,issued_date,expiry_date,credential_id,credential_url,status,revision)
    VALUES(@account_id,@id,@actor_id,@title,@provider,@cat,@issued,@expiry,@credential,@url,'DRAFT',1);
  END ELSE UPDATE dbo.EmployeeCertification SET certification_name=@title,provider=@provider,category=@cat,issued_date=@issued,expiry_date=@expiry,
   credential_id=@credential,credential_url=@url,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  UPDATE dbo.EmployeeCertification SET status=CASE WHEN @action='SUBMIT' THEN 'SUBMITTED' ELSE 'DRAFT' END,
   reviewer_id=CASE WHEN @action='SUBMIT' THEN @manager ELSE reviewer_id END,
   submitted_at=CASE WHEN @action='SUBMIT' THEN SYSUTCDATETIME() ELSE submitted_at END
   WHERE account_id=@account_id AND id=@id;
 END ELSE IF @action='REROUTE' BEGIN
  IF @current IS NULL OR @owner<>@actor_id OR @status<>'SUBMITTED' OR dbo.CertificationAccess(@account_id,@actor_id,'certification.manage')<>1 THROW 51003,'Own submitted certification required.',1;
  IF JSON_QUERY(@payload,'$.fields') IS NOT NULL OR JSON_VALUE(@payload,'$.feedback') IS NOT NULL THROW 51000,'Routing changes cannot edit evidence.',1;
  SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner;
  IF @manager IS NULL OR @manager=@assigned OR dbo.CertificationReviewer(@account_id,@manager,@owner,@manager)<>1 THROW 51009,'No eligible new manager.',1;
  UPDATE dbo.EmployeeCertification SET reviewer_id=@manager,revision=revision+1,submitted_at=SYSUTCDATETIME(),updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END ELSE BEGIN
  IF @current IS NULL OR @status<>'SUBMITTED' OR dbo.CertificationReviewer(@account_id,@actor_id,@owner,@assigned)<>1 THROW 51003,'Current assigned manager and submitted record required.',1;
  IF JSON_QUERY(@payload,'$.fields') IS NOT NULL THROW 51000,'Decisions cannot change evidence.',1;
  DECLARE @feedback nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.feedback'),N'');
  IF DATALENGTH(@feedback)>4000 OR (@action<>'APPROVED' AND NULLIF(LTRIM(RTRIM(@feedback)),N'') IS NULL) THROW 51000,'Decision reason required.',1;
  UPDATE dbo.EmployeeCertification SET status=@action,feedback=@feedback,reviewed_by=@actor_id,reviewed_at=SYSUTCDATETIME(),revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
 END;
 SET @after=(SELECT * FROM dbo.EmployeeCertification WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT dbo.CertificationEvent(account_id,id,revision,actor_id,action,snapshot)
  SELECT account_id,id,revision,@actor_id,@action,@after FROM dbo.EmployeeCertification WHERE account_id=@account_id AND id=@id;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
  VALUES(@account_id,@workspace_revision+1,@actor_id,'certification.'+LOWER(@action),@id,@before,@after);
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.Certifications TO [skill_management_runtime];
GO
