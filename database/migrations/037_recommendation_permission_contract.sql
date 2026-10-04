-- Register the recommendation action for documented allow/deny exceptions. No person or template grants are created.
IF NOT EXISTS(SELECT 1 FROM dbo.Permission WHERE permission_code='learning.recommend') INSERT dbo.Permission(permission_code,description) VALUES('learning.recommend',N'Recommend published learning to current active direct reports');
GO
CREATE OR ALTER FUNCTION dbo.RecommendationCan(@account uniqueidentifier,@sender uniqueidentifier,@person uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@sender,'skill.view',0)<>1 AND dbo.AccessCan(@account,@sender,'skill.catalogue.manage',0)<>1 RETURN 0;
 IF @sender=@person OR dbo.AccessCan(@account,@sender,'profile.view',1)<>1 OR dbo.AccessCan(@account,@sender,'learning.view',1)<>1 OR dbo.AccessCan(@account,@sender,'learning.recommend',0)<>1 RETURN 0;
 IF dbo.AccessReportingValid(@account,@person)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@person AND manager_id=@sender) RETURN 0;
 IF dbo.AccessCan(@account,@person,'learning.view',1)<>1 RETURN 0;
 RETURN 1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.LearningRecommendations @account_id uniqueidentifier,@actor_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 THROW 51000,'Invalid input.',1;
 DECLARE @view varchar(10)=ISNULL(JSON_VALUE(@payload,'$.view'),'received'),@search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),@page int=ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1),@id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'));
 IF @action='OPTIONS' BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 THROW 51003,'Recommendation denied.',1;
  SELECT TOP(25) p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND dbo.RecommendationCan(@account_id,@actor_id,p.person_id)=1 AND (CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0) ORDER BY p.display_name,p.person_id;RETURN;
 END;
 IF @action='NOTIFICATIONS' BEGIN
  SELECT TOP(30) 'recommendation-'+CONVERT(varchar(36),e.id)+'-'+CONVERT(varchar(10),e.revision) AS id,e.created_at AS at,
  CASE WHEN e.action='SEND' THEN sender.display_name+' recommended '+r.skill_name+' for your development' ELSE recipient.display_name+' responded to your '+r.skill_name+' recommendation' END AS title,
  CASE WHEN e.action='SEND' THEN LEFT(r.reason,240) ELSE CASE e.action WHEN 'ACCEPT' THEN 'Accepted and a personal learning plan was created.' WHEN 'DECLINE' THEN 'Declined. '+LEFT(e.message,200) ELSE 'Discussion requested: '+LEFT(e.message,200) END END AS body,
  CASE WHEN e.action='SEND' THEN '/learning?tab=recommendations&recommendation=' ELSE '/learning?tab=recommendations&direction=sent&recommendation=' END+CONVERT(varchar(36),r.id) AS href
  FROM dbo.LearningRecommendationEvent e JOIN dbo.LearningRecommendation r ON r.account_id=e.account_id AND r.id=e.id
  JOIN dbo.AccessPerson sender ON sender.account_id=r.account_id AND sender.person_id=r.sender_id JOIN dbo.AccessPerson recipient ON recipient.account_id=r.account_id AND recipient.person_id=r.person_id
  WHERE e.account_id=@account_id AND e.person_id=@actor_id AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1
  AND (r.person_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 OR r.sender_id=@actor_id AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1)
  ORDER BY e.created_at DESC,e.id,e.revision DESC;RETURN;
 END;
 IF @action='LIST' BEGIN
  IF @view NOT IN('received','sent') OR @page NOT BETWEEN 1 AND 1000 THROW 51000,'Invalid filters.',1;
  IF @view='received' AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR @view='sent' AND dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)<>1 THROW 51003,'Recommendation denied.',1;
  DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
  INSERT @visible SELECT r.id FROM dbo.LearningRecommendation r WHERE r.account_id=@account_id AND (@id IS NULL OR r.id=@id) AND
  (@view='received' AND r.person_id=@actor_id OR @view='sent' AND r.sender_id=@actor_id AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1);
  SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'learning.recommend',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.view',1)=1 AND (dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 OR dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)=1) THEN 1 ELSE 0 END) AS canSend FROM @visible;
  SELECT r.id,r.person_id AS personId,r.sender_id AS senderId,s.display_name AS senderName,p.display_name AS personName,p.employee_code AS employeeCode,
  r.skill_id AS skillId,r.skill_name AS skillName,r.category,r.rank,r.level_name AS levelName,r.reason,r.resource,CONVERT(varchar(10),r.target_date,23) AS targetDate,
  r.status,r.revision,r.response,r.plan_id AS planId,r.created_at AS createdAt,r.updated_at AS updatedAt,
  CONVERT(bit,CASE WHEN r.person_id=@actor_id AND r.status IN('PENDING','DISCUSSION') AND dbo.RecommendationCan(@account_id,r.sender_id,r.person_id)=1 AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)=1 THEN 1 ELSE 0 END) AS canRespond
  FROM @visible v JOIN dbo.LearningRecommendation r ON r.account_id=@account_id AND r.id=v.id JOIN dbo.AccessPerson s ON s.account_id=r.account_id AND s.person_id=r.sender_id JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.person_id
  ORDER BY r.updated_at DESC,r.id OFFSET (@page-1)*20 ROWS FETCH NEXT 20 ROWS ONLY;RETURN;
 END;
 IF @action NOT IN('SEND','ACCEPT','DECLINE','DISCUSS') THROW 51000,'Invalid action.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@person uniqueidentifier,@sender uniqueidentifier,@skill uniqueidentifier,@rank int,@skill_name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@current int,@status varchar(20),@before nvarchar(max),@after nvarchar(max),@plan uniqueidentifier;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF @id IS NULL THROW 51000,'Invalid record.',1;
 IF @action='SEND' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('id','personId','skillId','rank','reason','resource','targetDate')) THROW 51000,'Invalid fields.',1;
  SET @person=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId'));SET @skill=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId'));SET @rank=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank'));SET @sender=@actor_id;
  IF @person IS NULL OR dbo.RecommendationCan(@account_id,@sender,@person)<>1 THROW 51003,'Current direct report required.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 THROW 51003,'Catalogue denied.',1;
  SELECT @skill_name=c.display_name,@category=c.category,@level=l.display_name FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision JOIN dbo.ProficiencyLevel l ON l.framework_id=v.framework_id AND l.rank=@rank WHERE c.account_id=@account_id AND c.skill_id=@skill AND c.status='PUBLISHED';
  IF @skill_name IS NULL THROW 51004,'Published skill or level unavailable.',1;
  DECLARE @reason nvarchar(4000)=JSON_VALUE(@payload,'$.reason'),@resource nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.resource'),''),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23);
  IF NULLIF(LTRIM(RTRIM(@reason)),'') IS NULL OR DATALENGTH(@reason)>4000 OR DATALENGTH(@resource)>2000 OR (@resource<>'' AND LEFT(@resource,8)<>'https://') OR (JSON_VALUE(@payload,'$.targetDate') IS NOT NULL AND @target IS NULL) THROW 51000,'Invalid recommendation.',1;
  IF (SELECT COUNT(*) FROM dbo.LearningRecommendation WHERE account_id=@account_id AND sender_id=@sender AND person_id=@person AND status IN('PENDING','DISCUSSION'))>=50 THROW 51000,'Pending recommendation limit reached.',1;
  INSERT dbo.LearningRecommendation(account_id,id,sender_id,person_id,skill_id,skill_name,category,rank,level_name,reason,resource,target_date,status,revision) VALUES(@account_id,@id,@sender,@person,@skill,@skill_name,@category,@rank,@level,@reason,@resource,@target,'PENDING',1);
  INSERT dbo.LearningRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message) VALUES(@account_id,@id,1,@actor_id,@person,'SEND',@reason);
 END ELSE BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN('id','revision','action','message','plan')) OR JSON_VALUE(@payload,'$.action')<>@action THROW 51000,'Invalid fields.',1;
  SELECT @current=revision,@status=status,@person=person_id,@sender=sender_id,@skill=skill_id FROM dbo.LearningRecommendation WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id AND person_id=@actor_id;
  IF @current IS NULL THROW 51004,'Own recommendation unavailable.',1;
  IF @current<>TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) IS NULL THROW 51009,'Recommendation changed.',1;
  IF @status NOT IN('PENDING','DISCUSSION') THROW 51010,'Recommendation already decided.',1;
  IF dbo.RecommendationCan(@account_id,@sender,@person)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Current relationship and personal learning required.',1;
  DECLARE @message nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.message'),'');
  IF DATALENGTH(@message)>4000 OR (@action='DISCUSS' AND NULLIF(LTRIM(RTRIM(@message)),'') IS NULL) THROW 51000,'Explain the discussion request.',1;
  SET @before=(SELECT status,revision FROM dbo.LearningRecommendation WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @action='ACCEPT' BEGIN
   DECLARE @plan_payload nvarchar(max)=JSON_QUERY(@payload,'$.plan');SET @plan=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@plan_payload,'$.id'));
   IF @plan IS NULL OR JSON_VALUE(@plan_payload,'$.action')<>'CREATE' OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@plan_payload,'$.skillId'))<>@skill OR JSON_VALUE(@plan_payload,'$.skillId') IS NULL THROW 51000,'Review a new plan for the recommended skill.',1;
   EXEC dbo.ChangeOwnLearningPlan @account_id,@actor_id,@plan,0,'CREATE',@plan_payload;
   SELECT @workspace_revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
  END ELSE IF JSON_QUERY(@payload,'$.plan') IS NOT NULL THROW 51000,'Only acceptance creates a plan.',1;
  UPDATE dbo.LearningRecommendation SET status=CASE @action WHEN 'ACCEPT' THEN 'ACCEPTED' WHEN 'DECLINE' THEN 'DECLINED' ELSE 'DISCUSSION' END,response=@message,plan_id=@plan,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@id;
  INSERT dbo.LearningRecommendationEvent(account_id,id,revision,actor_id,person_id,action,message) VALUES(@account_id,@id,@current+1,@actor_id,@sender,@action,@message);
 END;
 SET @after=(SELECT status,revision,plan_id AS planId FROM dbo.LearningRecommendation WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'recommendation.'+LOWER(@action),@id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.LearningRecommendations TO [skill_management_runtime];
GO
