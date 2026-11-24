-- Reserve estimated tokens before each model call and settle against provider usage.
IF OBJECT_ID(N'dbo.AiDailyTokenBudget', N'U') IS NULL
 CREATE TABLE dbo.AiDailyTokenBudget (
  account_id uniqueidentifier NOT NULL,
  budget_day date NOT NULL,
  actor_id uniqueidentifier NOT NULL,
  tokens bigint NOT NULL CHECK (tokens >= 0),
  PRIMARY KEY(account_id, budget_day, actor_id)
 );
IF OBJECT_ID(N'dbo.AiTokenReservation', N'U') IS NULL
 CREATE TABLE dbo.AiTokenReservation (
  account_id uniqueidentifier NOT NULL,
  reservation_id uniqueidentifier NOT NULL,
  actor_id uniqueidentifier NOT NULL,
  budget_day date NOT NULL,
  tokens bigint NOT NULL CHECK (tokens > 0),
  PRIMARY KEY(account_id, reservation_id)
 );
GO
CREATE OR ALTER PROCEDURE dbo.AiTokenBudget
 @account_id uniqueidentifier, @actor_id uniqueidentifier, @reservation_id uniqueidentifier,
 @operation varchar(8), @tokens bigint, @actor_limit int, @account_limit int
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace access denied.',1;
 IF @operation IS NULL OR @operation NOT IN ('reserve','settle') OR @tokens IS NULL OR @tokens<0
  THROW 51000,'Invalid AI token budget operation.',1;
 DECLARE @day date=CONVERT(date,SYSUTCDATETIME()), @reserved bigint, @locked int,
  @resource nvarchar(255)=N'ai-tokens:'+CONVERT(nvarchar(36),@account_id);
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC @locked=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
  IF @locked<0 THROW 51029,'AI token budget busy.',1;
  SELECT @reserved=tokens,@day=budget_day FROM dbo.AiTokenReservation
   WHERE account_id=@account_id AND reservation_id=@reservation_id AND actor_id=@actor_id;
  IF @operation='settle'
  BEGIN
   -- Settlement remains possible after revocation and applies to the original UTC day.
   IF @reserved IS NOT NULL
   BEGIN
    UPDATE dbo.AiDailyTokenBudget SET tokens=tokens-@reserved+@tokens
     WHERE account_id=@account_id AND budget_day=@day AND actor_id=@actor_id;
    DELETE FROM dbo.AiTokenReservation
     WHERE account_id=@account_id AND reservation_id=@reservation_id AND actor_id=@actor_id;
   END;
  END
  ELSE IF @reserved IS NULL
  BEGIN
   IF ISNULL(dbo.AccessCan(@account_id,@actor_id,'profile.view',1),0)<>1
    THROW 51003,'Assistant access denied.',1;
   IF @tokens=0 OR ISNULL(@actor_limit,0)<1 OR ISNULL(@account_limit,0)<1
    THROW 51000,'Invalid AI token limits.',1;
   IF @tokens+ISNULL((SELECT tokens FROM dbo.AiDailyTokenBudget
       WHERE account_id=@account_id AND budget_day=@day AND actor_id=@actor_id),0)>@actor_limit
    OR @tokens+ISNULL((SELECT SUM(tokens) FROM dbo.AiDailyTokenBudget
       WHERE account_id=@account_id AND budget_day=@day),0)>@account_limit
    THROW 51029,'AI token budget exhausted.',1;
   UPDATE dbo.AiDailyTokenBudget SET tokens=tokens+@tokens
    WHERE account_id=@account_id AND budget_day=@day AND actor_id=@actor_id;
   IF @@ROWCOUNT=0 INSERT dbo.AiDailyTokenBudget VALUES(@account_id,@day,@actor_id,@tokens);
   INSERT dbo.AiTokenReservation VALUES(@account_id,@reservation_id,@actor_id,@day,@tokens);
   DELETE TOP(100) FROM dbo.AiTokenReservation WHERE account_id=@account_id AND budget_day<DATEADD(day,-7,@day);
   DELETE TOP(100) FROM dbo.AiDailyTokenBudget WHERE account_id=@account_id AND budget_day<DATEADD(day,-7,@day);
  END;
  COMMIT;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  THROW;
 END CATCH
END;
GO
GRANT EXECUTE ON dbo.AiTokenBudget TO [skill_management_runtime];
GO
