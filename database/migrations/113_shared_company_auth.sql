-- Process-independent, short-lived OIDC state and opaque company sessions.
CREATE TABLE dbo.CompanyAuthState(
 kind varchar(7) NOT NULL CHECK(kind IN('SESSION','OIDC')),
 entry_hash binary(32) NOT NULL,
 expires_at datetime2(3) NOT NULL,
 payload nvarchar(max) NOT NULL CHECK(ISJSON(payload)=1),
 PRIMARY KEY(kind,entry_hash)
);
CREATE INDEX IX_CompanyAuthState_Expiry ON dbo.CompanyAuthState(expires_at);
GO
CREATE OR ALTER PROCEDURE dbo.CompanyAuthStateAccess
 @kind varchar(7), @operation varchar(6), @entry_hash binary(32),
 @expires_at datetime2(3)=NULL, @payload nvarchar(max)=NULL
AS BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 DECLARE @now datetime2(3)=SYSUTCDATETIME();
 IF @kind IS NULL OR @kind NOT IN('SESSION','OIDC') OR @entry_hash IS NULL
  THROW 51000,'Invalid authentication state.',1;
 IF @operation='READ'
  SELECT payload FROM dbo.CompanyAuthState WHERE kind=@kind AND entry_hash=@entry_hash AND expires_at>@now;
 ELSE IF @operation='TAKE'
  DELETE FROM dbo.CompanyAuthState OUTPUT deleted.payload WHERE kind=@kind AND entry_hash=@entry_hash AND expires_at>@now;
 ELSE IF @operation='DELETE'
  DELETE FROM dbo.CompanyAuthState WHERE kind=@kind AND entry_hash=@entry_hash;
 ELSE IF @operation='WRITE' BEGIN
  IF ISNULL(ISJSON(@payload),0)<>1 OR DATALENGTH(@payload)>20000 OR @expires_at IS NULL OR @expires_at<=@now
   OR @expires_at>DATEADD(second,CASE WHEN @kind='OIDC' THEN 300 ELSE 28800 END,@now)
   THROW 51000,'Invalid authentication lifetime.',1;
  BEGIN TRY BEGIN TRANSACTION;
   DECLARE @lock int;
   EXEC @lock=sys.sp_getapplock @Resource=N'company-auth-state-write',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
   IF @lock<0 THROW 51000,'Authentication state unavailable.',1;
   DELETE FROM dbo.CompanyAuthState WHERE expires_at<=@now;
   IF (SELECT COUNT(*) FROM dbo.CompanyAuthState WHERE kind=@kind)>=10000 BEGIN
    COMMIT; SELECT CONVERT(bit,0) AS saved; RETURN;
   END;
   INSERT dbo.CompanyAuthState(kind,entry_hash,expires_at,payload) VALUES(@kind,@entry_hash,@expires_at,@payload);
   COMMIT; SELECT CONVERT(bit,1) AS saved;
  END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
 END ELSE THROW 51000,'Invalid authentication operation.',1;
END;
GO
GRANT EXECUTE ON dbo.CompanyAuthStateAccess TO [skill_management_runtime];
GO
