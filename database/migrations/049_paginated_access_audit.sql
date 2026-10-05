-- Cursor reads use the existing (account_id, revision) PK. No new business grants.
CREATE OR ALTER PROCEDURE dbo.ReadAccessAuditPage
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@before int=NULL,@person_id uniqueidentifier=NULL,
 @query nvarchar(100)=N'',@page_size int=25,@include_details bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF @page_size NOT BETWEEN 1 AND 50 OR (@before IS NOT NULL AND @before<1) THROW 51000,'Invalid activity page.',1;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=0 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=0 THROW 51003,'Activity access denied.',1;
 SELECT @revision AS revision;
 SELECT TOP(@page_size+1) e.actor_id AS actorId,e.action,e.target_id AS targetId,e.occurred_at AS at,e.revision,
 p.display_name AS actorName,COALESCE(target.display_name,r.display_name) AS targetName,
 CASE WHEN @include_details=1 THEN e.before_json ELSE NULL END AS [before],CASE WHEN @include_details=1 THEN e.after_json ELSE NULL END AS [after]
 FROM dbo.AccessAudit e
 LEFT JOIN dbo.AccessPerson p ON p.account_id=e.account_id AND p.person_id=e.actor_id
 LEFT JOIN dbo.AccessPerson target ON target.account_id=e.account_id AND target.person_id=e.target_id
 LEFT JOIN dbo.AccountRole r ON r.account_id=e.account_id AND r.role_id=e.target_id
 WHERE e.account_id=@account_id AND e.revision<=@revision AND (@before IS NULL OR e.revision<@before) AND (@person_id IS NULL OR e.target_id=@person_id)
 AND (@query=N'' OR CHARINDEX(@query,CONCAT(e.action,N' ',p.display_name,N' ',target.display_name,N' ',r.display_name,N' ',CONVERT(nvarchar(36),e.target_id),N' ',CONVERT(nvarchar(36),e.actor_id)))>0)
 ORDER BY e.revision DESC;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadAccessAuditPage TO [skill_management_runtime];
GO
