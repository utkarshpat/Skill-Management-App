-- Certification review analytics and manager-to-direct-report credential recommendations.
-- Recommendation visibility and writes remain bounded to the employee and current manager.
CREATE TABLE dbo.CertificationRecommendation(
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,sender_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 certification_name nvarchar(200) NOT NULL,provider nvarchar(120) NOT NULL,category nvarchar(80) NOT NULL,
 reason nvarchar(2000) NOT NULL,credential_url nvarchar(1000) NOT NULL,target_date date NULL,
 status varchar(20) NOT NULL CHECK(status IN('PENDING','DISCUSSION','ACCEPTED','DECLINED')),
 revision int NOT NULL CHECK(revision>0),response nvarchar(2000) NOT NULL DEFAULT N'',
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,sender_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),CHECK(sender_id<>person_id)
);
CREATE INDEX IX_CertificationRecommendation_Person ON dbo.CertificationRecommendation(account_id,person_id,updated_at);
CREATE INDEX IX_CertificationRecommendation_Sender ON dbo.CertificationRecommendation(account_id,sender_id,updated_at);
CREATE TABLE dbo.CertificationRecommendationEvent(
 account_id uniqueidentifier NOT NULL,id uniqueidentifier NOT NULL,revision int NOT NULL,actor_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 action varchar(20) NOT NULL,message nvarchar(2000) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,id,revision),FOREIGN KEY(account_id,id) REFERENCES dbo.CertificationRecommendation(account_id,id)
);
GO
CREATE OR ALTER FUNCTION dbo.CertificationRecommendationCan(@account uniqueidentifier,@sender uniqueidentifier,@person uniqueidentifier)
RETURNS bit AS BEGIN
 IF @sender=@person OR dbo.AccessCan(@account,@sender,'profile.view',1)<>1 OR dbo.AccessCan(@account,@sender,'skill.view',1)<>1
  OR dbo.AccessCan(@account,@sender,'learning.view',1)<>1 OR dbo.AccessCan(@account,@sender,'learning.recommend',0)<>1 RETURN 0;
 IF dbo.AccessCan(@account,@person,'profile.view',1)<>1 OR dbo.AccessCan(@account,@person,'learning.view',1)<>1 RETURN 0;
 IF dbo.AccessReportingValid(@account,@sender)<>1 OR dbo.AccessReportingValid(@account,@person)<>1 RETURN 0;
 IF (SELECT COUNT(*) FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@person)<>1 RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@person AND manager_id=@sender) RETURN 0;
 RETURN 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.CertificationReviewAnalytics @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 THROW 51003,'Review denied.',1;
 ;WITH assigned AS(
  SELECT c.expiry_date,c.category FROM dbo.CertificationRecord c
  WHERE c.account_id=@account_id AND c.status='SUBMITTED' AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
 )
 SELECT COUNT(*) AS pending,
  ISNULL(SUM(CASE WHEN expiry_date<CONVERT(date,SYSUTCDATETIME()) THEN 1 ELSE 0 END),0) AS expired,
  ISNULL(SUM(CASE WHEN expiry_date>=CONVERT(date,SYSUTCDATETIME()) AND expiry_date<=DATEADD(day,90,CONVERT(date,SYSUTCDATETIME())) THEN 1 ELSE 0 END),0) AS expiresSoon,
  ISNULL(SUM(CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END),0) AS noExpiry,
  CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 THEN 1 ELSE 0 END) AS canRecommend
 FROM assigned;
 SELECT category,COUNT(*) AS count FROM dbo.CertificationRecord c
 WHERE c.account_id=@account_id AND c.status='SUBMITTED' AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
 GROUP BY category ORDER BY COUNT(*) DESC,category;
END;
GO
CREATE OR ALTER PROCEDURE dbo.CertificationRecommendations @account_id uniqueidentifier,@actor_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>20000 OR @action NOT IN('OPTIONS','LIST','SEND','ACCEPT','DECLINE','DISCUSS','NOTIFICATIONS') THROW 51000,'Invalid recommendation.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),
  @person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
  @revision int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),
  @view varchar(10)=ISNULL(JSON_VALUE(@payload,'$.view'),'received'),
  @page int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1),
  @search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),N''),
  @message nvarchar(2000)=ISNULL(JSON_VALUE(@payload,'$.message'),N'');
 IF @action='OPTIONS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 THROW 51003,'Recommendation denied.',1;
  SELECT TOP(25) p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode FROM dbo.AccessPerson p
  WHERE p.account_id=@account_id AND dbo.CertificationRecommendationCan(@account_id,@actor_id,p.person_id)=1
   AND (CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0)
  ORDER BY p.display_name,p.person_id;RETURN;
 END;
 IF @action='NOTIFICATIONS' BEGIN
  SELECT TOP(30) 'cert-recommendation-'+CONVERT(varchar(36),e.id)+'-'+CONVERT(varchar(10),e.revision) AS id,
   e.created_at AS at,
   CASE WHEN e.action='SEND' THEN sender.display_name+N' recommended a certification' ELSE N'Certification recommendation response' END AS title,
   CASE WHEN e.action='SEND' THEN r.certification_name+N' · '+LEFT(r.reason,180) ELSE r.certification_name+N' · '+LEFT(e.message,180) END AS body,
   CASE WHEN e.action='SEND' THEN '/certifications?tab=recommendations&recommendation='+CONVERT(varchar(36),r.id)
    ELSE '/skill-reviews?type=certifications&tab=recommendations&direction=sent&recommendation='+CONVERT(varchar(36),r.id) END AS href
  FROM dbo.CertificationRecommendationEvent e JOIN dbo.CertificationRecommendation r ON r.account_id=e.account_id AND r.id=e.id
   JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id
  WHERE e.account_id=@account_id AND ((e.action='SEND' AND r.person_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1)
   OR (e.action<>'SEND' AND r.sender_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1
    AND dbo.CertificationRecommendationCan(@account_id,@actor_id,r.person_id)=1))
  ORDER BY e.created_at DESC,e.revision DESC;RETURN;
 END;
 IF @action='LIST' BEGIN
  IF @view NOT IN('received','sent') OR @page NOT BETWEEN 1 AND 1000 THROW 51000,'Invalid filters.',1;
  IF @view='sent' AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 OR @view='received' AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 THROW 51003,'Recommendations unavailable.',1;
  SELECT r.id INTO #visible FROM dbo.CertificationRecommendation r JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=CASE WHEN @view='sent' THEN r.person_id ELSE r.sender_id END
  WHERE r.account_id=@account_id AND ((@view='sent' AND r.sender_id=@actor_id AND dbo.CertificationRecommendationCan(@account_id,@actor_id,r.person_id)=1)
   OR (@view='received' AND r.person_id=@actor_id AND dbo.AccessCan(@account_id,r.sender_id,'profile.view',1)=1))
   AND (@id IS NULL OR r.id=@id) AND (@search=N'' OR CHARINDEX(@search,r.certification_name)>0 OR CHARINDEX(@search,p.display_name)>0);
  SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1 THEN 1 ELSE 0 END) AS canSend FROM #visible;
  SELECT r.id,r.revision,r.person_id AS personId,recipient.display_name AS personName,recipient.employee_code AS employeeCode,
   r.sender_id AS senderId,sender.display_name AS senderName,r.certification_name AS certificationName,r.provider,r.category,r.reason,r.credential_url AS credentialUrl,
   CONVERT(varchar(10),r.target_date,23) AS targetDate,r.status,r.response,r.updated_at AS updatedAt,
   CONVERT(bit,CASE WHEN @view='received' AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)=1 THEN 1 ELSE 0 END) AS canRespond
  FROM #visible v JOIN dbo.CertificationRecommendation r ON r.account_id=@account_id AND r.id=v.id
   JOIN dbo.AccessPerson recipient ON recipient.account_id=r.account_id AND recipient.person_id=r.person_id
   JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id
  ORDER BY r.updated_at DESC,r.id OFFSET ((@page-1)*20) ROWS FETCH NEXT 20 ROWS ONLY;RETURN;
 END;
 BEGIN TRANSACTION;
 IF @action='SEND' BEGIN
  DECLARE @name nvarchar(200)=JSON_VALUE(@payload,'$.certificationName'),@provider nvarchar(120)=JSON_VALUE(@payload,'$.provider'),
   @category nvarchar(80)=JSON_VALUE(@payload,'$.category'),@reason nvarchar(2000)=JSON_VALUE(@payload,'$.reason'),
   @url nvarchar(1000)=ISNULL(JSON_VALUE(@payload,'$.credentialUrl'),N''),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23);
  IF @id IS NULL OR @person IS NULL OR dbo.CertificationRecommendationCan(@account_id,@actor_id,@person)<>1 THROW 51003,'Direct manager recommendation unavailable.',1;
  IF @name IS NULL OR LEN(LTRIM(RTRIM(@name)))=0 OR LEN(@name)>200 OR @provider IS NULL OR LEN(@provider)>120 OR @category IS NULL OR LEN(@category)>80
   OR @reason IS NULL OR LEN(LTRIM(RTRIM(@reason)))=0 OR LEN(@reason)>2000 OR LEN(@url)>1000 OR JSON_VALUE(@payload,'$.targetDate') IS NOT NULL AND @target IS NULL
   OR @url<>N'' AND (@url NOT LIKE N'https://%._%' OR @url LIKE N'% %') THROW 51000,'Check the certification recommendation.',1;
  INSERT dbo.CertificationRecommendation(account_id,id,sender_id,person_id,certification_name,provider,category,reason,credential_url,target_date,status,revision)
   VALUES(@account_id,@id,@actor_id,@person,@name,@provider,@category,@reason,@url,@target,'PENDING',1);
  INSERT dbo.CertificationRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message) VALUES(@account_id,@id,1,@actor_id,@person,'SEND',@reason);
  COMMIT;SELECT CONVERT(bit,1) AS saved,@id AS id;RETURN;
 END;
 IF @action IN('ACCEPT','DECLINE','DISCUSS') BEGIN
  IF @id IS NULL OR @revision IS NULL OR @revision<1 OR dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Personal recommendation response unavailable.',1;
  DECLARE @status varchar(20);
  SELECT @status=status,@person=person_id FROM dbo.CertificationRecommendation WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id;
  IF @person<>@actor_id OR @status IS NULL THROW 51004,'Recommendation unavailable.',1;
  IF @revision<>(SELECT revision FROM dbo.CertificationRecommendation WHERE account_id=@account_id AND id=@id) OR @status NOT IN('PENDING','DISCUSSION') THROW 51009,'Recommendation changed.',1;
  IF LEN(@message)>2000 OR @action='DISCUSS' AND LEN(LTRIM(RTRIM(@message)))=0 THROW 51000,'Add a response message.',1;
  UPDATE dbo.CertificationRecommendation SET status=CASE @action WHEN 'ACCEPT' THEN 'ACCEPTED' WHEN 'DECLINE' THEN 'DECLINED' ELSE 'DISCUSSION' END,
   response=@message,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  INSERT dbo.CertificationRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message)
   VALUES(@account_id,@id,@revision+1,@actor_id,@person,@action,@message);
  COMMIT;SELECT CONVERT(bit,1) AS saved;RETURN;
 END;
 ROLLBACK;THROW 51000,'Invalid recommendation action.',1;
END;
GO
GRANT EXECUTE ON dbo.CertificationReviewAnalytics TO skill_management_runtime;
GRANT EXECUTE ON dbo.CertificationRecommendations TO skill_management_runtime;
