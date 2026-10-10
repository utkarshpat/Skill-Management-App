-- Durable exact-payload SEND replay and event-specific notification text.
-- No response/review replay or new permissions. Migration 058 remains immutable.
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
   CASE WHEN e.action='SEND' THEN sender.display_name+N' recommended a certification'
    ELSE recipient.display_name+CASE e.action WHEN 'ACCEPT' THEN N' accepted a certification recommendation'
     WHEN 'DECLINE' THEN N' declined a certification recommendation' ELSE N' requested a discussion about a certification recommendation' END END AS title,
   r.certification_name+CASE WHEN e.action='SEND' THEN N' · '+LEFT(r.reason,180)
    WHEN LEN(LTRIM(RTRIM(e.message)))>0 THEN N' · '+LEFT(e.message,180) ELSE N'' END AS body,
   CASE WHEN e.action='SEND' THEN '/certifications?tab=recommendations&recommendation='+CONVERT(varchar(36),r.id)
    ELSE '/skill-reviews?type=certifications&tab=recommendations&direction=sent&recommendation='+CONVERT(varchar(36),r.id) END AS href
  FROM dbo.CertificationRecommendationEvent e JOIN dbo.CertificationRecommendation r ON r.account_id=e.account_id AND r.id=e.id
   JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id
   JOIN dbo.AccessPerson recipient ON recipient.account_id=r.account_id AND recipient.person_id=r.person_id
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
   CONVERT(bit,CASE WHEN @view='received' AND r.status IN('PENDING','DISCUSSION') AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)=1 THEN 1 ELSE 0 END) AS canRespond
  FROM #visible v JOIN dbo.CertificationRecommendation r ON r.account_id=@account_id AND r.id=v.id
   JOIN dbo.AccessPerson recipient ON recipient.account_id=r.account_id AND recipient.person_id=r.person_id
   JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id
  ORDER BY r.updated_at DESC,r.id OFFSET ((@page-1)*20) ROWS FETCH NEXT 20 ROWS ONLY;RETURN;
 END;
 BEGIN TRANSACTION;
 IF @action='SEND' BEGIN
  -- Access/reporting mutations also lock this row: bind the decision to this transaction.
  DECLARE @workspace int;
  SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
  IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
  DECLARE @name nvarchar(200)=JSON_VALUE(@payload,'$.certificationName'),@provider nvarchar(120)=JSON_VALUE(@payload,'$.provider'),
   @category nvarchar(80)=JSON_VALUE(@payload,'$.category'),@reason nvarchar(2000)=JSON_VALUE(@payload,'$.reason'),
   @url nvarchar(1000)=ISNULL(JSON_VALUE(@payload,'$.credentialUrl'),N''),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23);
  IF @id IS NULL OR @person IS NULL OR dbo.CertificationRecommendationCan(@account_id,@actor_id,@person)<>1 THROW 51003,'Direct manager recommendation unavailable.',1;
  IF @name IS NULL OR LEN(LTRIM(RTRIM(@name)))=0 OR LEN(@name)>200 OR @provider IS NULL OR LEN(@provider)>120 OR @category IS NULL OR LEN(@category)>80
   OR @reason IS NULL OR LEN(LTRIM(RTRIM(@reason)))=0 OR LEN(@reason)>2000 OR LEN(@url)>1000 OR JSON_VALUE(@payload,'$.targetDate') IS NOT NULL AND @target IS NULL
   OR @url<>N'' AND (@url NOT LIKE N'https://%._%' OR @url LIKE N'% %') THROW 51000,'Check the certification recommendation.',1;
  -- Recheck current authorization above before replaying a committed SEND.
  -- The primary key range lock serializes concurrent retries across API instances.
  IF EXISTS(SELECT 1 FROM dbo.CertificationRecommendation WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id) BEGIN
   IF NOT EXISTS(SELECT 1 FROM dbo.CertificationRecommendation WHERE account_id=@account_id AND id=@id
    AND sender_id=@actor_id AND person_id=@person
    AND certification_name COLLATE Latin1_General_100_BIN2=@name COLLATE Latin1_General_100_BIN2 AND DATALENGTH(certification_name)=DATALENGTH(@name)
    AND provider COLLATE Latin1_General_100_BIN2=@provider COLLATE Latin1_General_100_BIN2 AND DATALENGTH(provider)=DATALENGTH(@provider)
    AND category COLLATE Latin1_General_100_BIN2=@category COLLATE Latin1_General_100_BIN2 AND DATALENGTH(category)=DATALENGTH(@category)
    AND reason COLLATE Latin1_General_100_BIN2=@reason COLLATE Latin1_General_100_BIN2 AND DATALENGTH(reason)=DATALENGTH(@reason)
    AND credential_url COLLATE Latin1_General_100_BIN2=@url COLLATE Latin1_General_100_BIN2 AND DATALENGTH(credential_url)=DATALENGTH(@url)
    AND (target_date=@target OR target_date IS NULL AND @target IS NULL))
    THROW 51009,'Operation ID already belongs to a different recommendation.',1;
   COMMIT;SELECT CONVERT(bit,1) AS saved,@id AS id;RETURN;
  END;
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
