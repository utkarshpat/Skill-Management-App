CREATE TABLE dbo.LearningPlan(
 account_id uniqueidentifier NOT NULL,plan_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 revision int NOT NULL CHECK(revision>0),status varchar(10) NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')),
 payload nvarchar(max) NOT NULL CHECK(ISJSON(payload)=1 AND DATALENGTH(payload)<=65536),updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,plan_id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
CREATE INDEX IX_LearningPlan_Person ON dbo.LearningPlan(account_id,person_id,updated_at);
GO
CREATE OR ALTER PROCEDURE dbo.ReadOwnLearningPlans @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 THROW 51003,'Learning denied.',1;
 SELECT CONVERT(bit,dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)) AS canManage;
 SELECT plan_id AS id,revision,status,payload FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id ORDER BY updated_at DESC,plan_id;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ChangeOwnLearningPlan
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@expected_revision int,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@current int,@status varchar(10),@document nvarchar(max),@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Learning denied.',1;
 IF @plan_id IS NULL OR @expected_revision IS NULL OR @expected_revision<0 OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 OR @action IS NULL OR JSON_VALUE(@payload,'$.action') IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) IS NULL OR JSON_VALUE(@payload,'$.action')<>@action OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'))<>@plan_id OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision'))<>@expected_revision THROW 51000,'Invalid change.',1;
 SELECT @current=revision,@status=status,@document=payload FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @action='CREATE' BEGIN
  IF @expected_revision<>0 OR @current IS NOT NULL THROW 51009,'Plan exists.',1;
  IF EXISTS(SELECT 1 FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id) THROW 51004,'Plan unavailable.',1;
  IF (SELECT COUNT(*) FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id)>=50 THROW 51000,'Plan limit reached.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','revision','title','goal','timezone','dailyMinutes','targetDate','tasks')) THROW 51000,'Invalid fields.',1;
  IF NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.title'))),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.title'))>320 OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.goal'))),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.goal'))>4000 OR NULLIF(JSON_VALUE(@payload,'$.timezone'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.timezone'))>160 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes')),0) NOT BETWEEN 5 AND 480 OR TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23) IS NULL OR JSON_QUERY(@payload,'$.tasks') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.tasks')),1)<>'[' THROW 51000,'Invalid plan.',1;
  DECLARE @tasks TABLE(id uniqueidentifier,title nvarchar(4000),day date,minutes int,raw nvarchar(max));
  INSERT @tasks SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),JSON_VALUE(value,'$.title'),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes')),value FROM OPENJSON(@payload,'$.tasks');
  IF (SELECT COUNT(*) FROM @tasks) NOT BETWEEN 1 AND 60 OR EXISTS(SELECT 1 FROM @tasks WHERE id IS NULL OR NULLIF(LTRIM(RTRIM(title)),'') IS NULL OR DATALENGTH(title)>320 OR day IS NULL OR day>TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23) OR minutes IS NULL OR minutes NOT BETWEEN 1 AND 480) OR EXISTS(SELECT id FROM @tasks GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT day FROM @tasks GROUP BY day HAVING SUM(minutes)>TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes'))) OR EXISTS(SELECT 1 FROM @tasks t CROSS APPLY OPENJSON(t.raw) j WHERE j.[key] NOT IN ('id','title','plannedDate','estimatedMinutes')) THROW 51000,'Invalid tasks.',1;
  INSERT dbo.LearningPlan(account_id,plan_id,person_id,revision,status,payload) VALUES(@account_id,@plan_id,@actor_id,1,'ACTIVE',@payload);
 END ELSE BEGIN
  IF @current IS NULL THROW 51004,'Own plan unavailable.',1;
  IF @current<>@expected_revision THROW 51009,'Plan changed.',1;
  IF @status='ARCHIVED' THROW 51010,'Plan archived.',1;
  SET @before=(SELECT plan_id AS id,revision,status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @action IN ('LOG','RESCHEDULE') BEGIN
   IF @status<>'ACTIVE' THROW 51010,'Resume the plan first.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','revision','taskId','plannedDate','actualMinutes','notes')) THROW 51000,'Invalid fields.',1;
   DECLARE @task_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.taskId')),@index int,@task nvarchar(max);
   SELECT @index=TRY_CONVERT(int,[key]),@task=value FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))=@task_id;
   IF @index IS NULL THROW 51004,'Task unavailable.',1;
   IF JSON_VALUE(@task,'$.completedAt') IS NOT NULL THROW 51010,'Task already completed.',1;
   DECLARE @path nvarchar(100)=N'$.tasks['+CONVERT(nvarchar(10),@index)+N']';
   IF @action='LOG' BEGIN
    DECLARE @minutes int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.actualMinutes')),@notes nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.notes'),N'');
    IF @minutes IS NULL OR @minutes NOT BETWEEN 1 AND 480 OR DATALENGTH(@notes)>4000 THROW 51000,'Invalid activity.',1;
    SET @document=JSON_MODIFY(@document,@path+'.actualMinutes',@minutes);
    SET @document=JSON_MODIFY(@document,@path+'.notes',@notes);
    SET @document=JSON_MODIFY(@document,@path+'.completedAt',CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z');
   END ELSE BEGIN
    DECLARE @day date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.plannedDate'),23),@capacity int=TRY_CONVERT(int,JSON_VALUE(@document,'$.dailyMinutes'));
    IF @day IS NULL OR @day>TRY_CONVERT(date,JSON_VALUE(@document,'$.targetDate'),23) THROW 51000,'Invalid date.',1;
    IF (SELECT ISNULL(SUM(TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes'))),0) FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23)=@day AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))<>@task_id AND JSON_VALUE(value,'$.completedAt') IS NULL)+TRY_CONVERT(int,JSON_VALUE(@task,'$.estimatedMinutes'))>@capacity THROW 51000,'Daily capacity exceeded.',1;
    SET @document=JSON_MODIFY(@document,@path+'.plannedDate',CONVERT(varchar(10),@day,23));
   END;
  END ELSE IF @action='PAUSE' AND @status='ACTIVE' SET @status='PAUSED';
  ELSE IF @action='RESUME' AND @status='PAUSED' SET @status='ACTIVE';
  ELSE IF @action='ARCHIVE' SET @status='ARCHIVED';
  ELSE THROW 51010,'Invalid transition.',1;
  UPDATE dbo.LearningPlan SET payload=@document,status=@status,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 END;
 SET @after=(SELECT plan_id AS id,revision,status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.'+LOWER(@action),@plan_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOwnLearningPlans TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ChangeOwnLearningPlan TO [skill_management_runtime];
