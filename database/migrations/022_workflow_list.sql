CREATE OR ALTER PROCEDURE dbo.ReadWorkflowList
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1,@inbox bit=0,
 @query nvarchar(80)=N'',@kind varchar(8)='',@status varchar(20)='',@priority varchar(6)='',@category varchar(24)=''
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page NOT BETWEEN 1 AND 99999 OR @inbox IS NULL OR @kind IS NULL OR @kind NOT IN ('','REQUEST','INCIDENT') OR @status IS NULL OR @status NOT IN ('','SUBMITTED','CANCELLED') OR @priority IS NULL OR @priority NOT IN ('','NORMAL','HIGH') OR @category IS NULL OR @category NOT IN ('','LEARNING','SKILL','ASSESSMENT','PROJECT','PROFILE_ACCESS','OTHER') THROW 51000,'Invalid filters.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@request bit,@incident bit;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 SET @request=dbo.AccessCan(@account_id,@actor_id,'request.view',1);SET @incident=dbo.AccessCan(@account_id,@actor_id,'incident.view',1);
 IF @workspace IS NULL OR (@request<>1 AND @incident<>1) THROW 51003,'View denied.',1;
 DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY,mine bit,assigned bit,kind varchar(8),status varchar(20),priority varchar(6));
 INSERT @visible SELECT record_id,CASE WHEN requester_id=@actor_id THEN 1 ELSE 0 END,CASE WHEN recipient_id=@actor_id THEN 1 ELSE 0 END,kind,status,priority FROM dbo.WorkflowRecord
 WHERE account_id=@account_id AND (requester_id=@actor_id OR recipient_id=@actor_id) AND ((kind='REQUEST' AND @request=1) OR (kind='INCIDENT' AND @incident=1));
 DECLARE @pattern nvarchar(250)=N'%'+REPLACE(REPLACE(REPLACE(ISNULL(@query,N''),'[','[[]'),'%','[%]'),'_','[_]')+N'%';
 DECLARE @filtered TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @filtered SELECT r.record_id FROM dbo.WorkflowRecord r JOIN @visible v ON v.id=r.record_id
 WHERE r.account_id=@account_id AND CASE WHEN @inbox=1 THEN v.assigned ELSE v.mine END=1
 AND (@kind='' OR r.kind=@kind) AND (@status='' OR r.status=@status) AND (@priority='' OR r.priority=@priority) AND (@category='' OR r.category=@category)
 AND (ISNULL(@query,N'')=N'' OR r.title LIKE @pattern OR r.description LIKE @pattern OR CONCAT(CASE r.kind WHEN 'REQUEST' THEN 'REQ' ELSE 'INC' END,'-',r.record_number) LIKE @pattern);
 DECLARE @total int=(SELECT COUNT(*) FROM @filtered),@pages int;
 SET @pages=CASE WHEN @total=0 THEN 1 ELSE (@total+9)/10 END;IF @page>@pages SET @page=@pages;
 SELECT @total AS total,@page AS page;
 SELECT r.record_id AS id,CONCAT(CASE r.kind WHEN 'REQUEST' THEN 'REQ' ELSE 'INC' END,'-',r.record_number) AS reference,r.category,r.kind,r.title,r.description,r.priority,r.status,r.revision,r.requester_id AS requesterId,o.display_name AS requesterName,r.recipient_id AS recipientId,p.display_name AS recipientName,r.created_at AS createdAt,r.updated_at AS updatedAt,
 CAST(0 AS bit) AS canComment,CAST(0 AS bit) AS canCancel
 FROM @filtered f JOIN dbo.WorkflowRecord r ON r.account_id=@account_id AND r.record_id=f.id JOIN dbo.AccessPerson o ON o.account_id=r.account_id AND o.person_id=r.requester_id JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.recipient_id
 ORDER BY r.updated_at DESC,r.record_id OFFSET (@page-1)*10 ROWS FETCH NEXT 10 ROWS ONLY;
 SELECT COUNT(*) AS total,COUNT(CASE WHEN status='SUBMITTED' THEN 1 END) AS submitted,COUNT(CASE WHEN status='CANCELLED' THEN 1 END) AS cancelled,COUNT(CASE WHEN kind='INCIDENT' THEN 1 END) AS incidents,COUNT(CASE WHEN priority='HIGH' THEN 1 END) AS highPriority,
 (SELECT COUNT(*) FROM @visible WHERE mine=1) AS myTotal,(SELECT COUNT(*) FROM @visible WHERE assigned=1) AS assignedTotal
 FROM @visible WHERE CASE WHEN @inbox=1 THEN assigned ELSE mine END=1;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadWorkflowList TO [skill_management_runtime];
GO
