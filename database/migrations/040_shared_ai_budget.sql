-- Atomic account/actor request budgets shared by every API instance.
CREATE TABLE dbo.AiAccountBudget (
 account_id uniqueidentifier NOT NULL PRIMARY KEY,
 budget_day date NOT NULL,
 request_count int NOT NULL
);
CREATE TABLE dbo.AiActorBudget (
 account_id uniqueidentifier NOT NULL,
 actor_id uniqueidentifier NOT NULL,
 budget_minute datetime2(0) NOT NULL,
 request_count int NOT NULL,
 lease_id uniqueidentifier NULL,
 lease_expires datetime2(3) NOT NULL,
 PRIMARY KEY(account_id,actor_id)
);
GO
CREATE OR ALTER PROCEDURE dbo.AiRequestBudget
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@lease_id uniqueidentifier,@operation varchar(8)
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF @operation NOT IN ('acquire','release') THROW 51000,'Invalid budget operation.',1;
 -- Release must remain possible after permission revocation.
 IF @operation='release' BEGIN
  UPDATE dbo.AiActorBudget SET lease_id=NULL WHERE account_id=@account_id AND actor_id=@actor_id AND lease_id=@lease_id;
  RETURN;
 END;
 IF ISNULL(dbo.AccessCan(@account_id,@actor_id,'profile.view',1),0)<>1 THROW 51003,'Assistant access denied.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@day date=CONVERT(date,SYSUTCDATETIME()),@minute datetime2(0)=DATEADD(minute,DATEDIFF(minute,CONVERT(datetime2,'2020-01-01'),SYSUTCDATETIME()),CONVERT(datetime2,'2020-01-01'));
 DECLARE @resource nvarchar(255)=N'ai-budget:'+CONVERT(nvarchar(36),@account_id),@locked int;
 BEGIN TRY
 BEGIN TRANSACTION;
 EXEC @locked=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @locked<0 THROW 51029,'AI budget busy.',1;
 IF EXISTS(SELECT 1 FROM dbo.AiActorBudget WHERE account_id=@account_id AND actor_id=@actor_id AND lease_id IS NOT NULL AND lease_expires>@now) THROW 51029,'Reply already running.',1;
 IF EXISTS(SELECT 1 FROM dbo.AiActorBudget WHERE account_id=@account_id AND actor_id=@actor_id AND budget_minute=@minute AND request_count>=10) OR EXISTS(SELECT 1 FROM dbo.AiAccountBudget WHERE account_id=@account_id AND budget_day=@day AND request_count>=500) THROW 51029,'AI request budget exhausted.',1;
 UPDATE dbo.AiAccountBudget SET request_count=CASE WHEN budget_day=@day THEN request_count+1 ELSE 1 END,budget_day=@day WHERE account_id=@account_id;
 IF @@ROWCOUNT=0 INSERT dbo.AiAccountBudget VALUES(@account_id,@day,1);
 UPDATE dbo.AiActorBudget SET request_count=CASE WHEN budget_minute=@minute THEN request_count+1 ELSE 1 END,budget_minute=@minute,lease_id=@lease_id,lease_expires=DATEADD(second,120,@now) WHERE account_id=@account_id AND actor_id=@actor_id;
 IF @@ROWCOUNT=0 INSERT dbo.AiActorBudget VALUES(@account_id,@actor_id,@minute,1,@lease_id,DATEADD(second,120,@now));
 DELETE TOP(100) FROM dbo.AiActorBudget WHERE account_id=@account_id AND budget_minute<DATEADD(day,-1,@minute) AND lease_expires<@now;
 COMMIT;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.AiRequestBudget TO [skill_management_runtime];
GO
