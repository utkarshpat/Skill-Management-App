-- Atomic owner-only recovery; only dates, daily budget and target are editable.
CREATE OR ALTER PROCEDURE dbo.RecoverOwnLearningPlan
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@expected_revision int,@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@revision int,@status varchar(10),@document nvarchar(max),@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1 THROW 51003,'Learning denied.',1;
 SELECT @revision=revision,@status=status,@document=payload FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @revision IS NULL THROW 51004,'Own plan unavailable.',1;
 IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Plan changed.',1;
 IF @status<>'ACTIVE' THROW 51010,'Resume the plan first.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>65536 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('dailyMinutes','targetDate','startDate','tasks')) OR (SELECT COUNT(*) FROM OPENJSON(@payload))<>4 OR EXISTS(SELECT [key] FROM OPENJSON(@payload) GROUP BY [key] HAVING COUNT(*)>1) THROW 51000,'Invalid recovery.',1;
 DECLARE @daily int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.dailyMinutes')),@target date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.targetDate'),23),@start date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.startDate'),23);
 IF @daily IS NULL OR @daily NOT BETWEEN 5 AND 480 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='dailyMinutes' AND type=2 AND value NOT LIKE '%[.eE]%') OR @target IS NULL OR @start IS NULL OR JSON_VALUE(@payload,'$.targetDate')<>CONVERT(varchar(10),@target,23) OR JSON_VALUE(@payload,'$.startDate')<>CONVERT(varchar(10),@start,23) OR CONVERT(varchar(10),@start,23) NOT LIKE '20%' OR CONVERT(varchar(10),@target,23) NOT LIKE '20%' OR @target<@start OR @start<DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())) OR JSON_QUERY(@payload,'$.tasks') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.tasks')),1)<>'[' THROW 51000,'Invalid recovery dates.',1;
 DECLARE @changes TABLE(id uniqueidentifier,day date,raw nvarchar(max));
 INSERT @changes SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),value FROM OPENJSON(@payload,'$.tasks');
 IF (SELECT COUNT(*) FROM @changes) NOT BETWEEN 1 AND 60 OR EXISTS(SELECT 1 FROM @changes WHERE id IS NULL OR day IS NULL OR day<@start OR day>@target OR JSON_VALUE(raw,'$.plannedDate')<>CONVERT(varchar(10),day,23)) OR EXISTS(SELECT id FROM @changes GROUP BY id HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM @changes c CROSS APPLY OPENJSON(c.raw) j WHERE j.[key] NOT IN ('id','plannedDate')) OR EXISTS(SELECT 1 FROM @changes WHERE (SELECT COUNT(*) FROM OPENJSON(raw))<>2) THROW 51000,'Invalid recovery tasks.',1;
 DECLARE @tasks TABLE(idx int,id uniqueidentifier,day date,minutes int,completed bit);
 INSERT @tasks SELECT TRY_CONVERT(int,[key]),TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')),TRY_CONVERT(date,JSON_VALUE(value,'$.plannedDate'),23),TRY_CONVERT(int,JSON_VALUE(value,'$.estimatedMinutes')),CASE WHEN JSON_VALUE(value,'$.completedAt') IS NULL THEN 0 ELSE 1 END FROM OPENJSON(@document,'$.tasks');
 IF EXISTS(SELECT 1 FROM @changes c LEFT JOIN @tasks t ON t.id=c.id WHERE t.id IS NULL OR t.completed=1) OR EXISTS(SELECT 1 FROM @tasks t LEFT JOIN @changes c ON c.id=t.id WHERE t.completed=0 AND c.id IS NULL) THROW 51000,'Every pending task must be included exactly once.',1;
 IF EXISTS(SELECT c.day FROM @changes c JOIN @tasks t ON t.id=c.id GROUP BY c.day HAVING SUM(t.minutes)>@daily) OR EXISTS(SELECT 1 FROM @tasks WHERE completed=1 AND day>@target) OR @target<>(SELECT MAX(day) FROM (SELECT day FROM @changes UNION ALL SELECT day FROM @tasks WHERE completed=1) d) THROW 51000,'Capacity or target exceeded.',1;
 SET @before=(SELECT @plan_id AS id,@revision AS revision,JSON_VALUE(@document,'$.dailyMinutes') AS dailyMinutes,JSON_VALUE(@document,'$.targetDate') AS targetDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @idx int,@newday date,@path nvarchar(100);
 WHILE EXISTS(SELECT 1 FROM @tasks WHERE completed=0) BEGIN
  SELECT TOP 1 @idx=t.idx,@newday=c.day FROM @tasks t JOIN @changes c ON c.id=t.id WHERE t.completed=0 ORDER BY t.idx;
  SET @path=N'$.tasks['+CONVERT(nvarchar(10),@idx)+N'].plannedDate';
  SET @document=JSON_MODIFY(@document,@path,CONVERT(varchar(10),@newday,23));
  DELETE FROM @tasks WHERE idx=@idx;
 END;
 SET @document=JSON_MODIFY(@document,'$.dailyMinutes',@daily);
 SET @document=JSON_MODIFY(@document,'$.targetDate',CONVERT(varchar(10),@target,23));
 UPDATE dbo.LearningPlan SET payload=@document,revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 SET @after=(SELECT @plan_id AS id,@revision+1 AS revision,@daily AS dailyMinutes,CONVERT(varchar(10),@target,23) AS targetDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.recover',@plan_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.RecoverOwnLearningPlan TO [skill_management_runtime];
GO
