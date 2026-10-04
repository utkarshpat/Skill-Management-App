-- Requester or current recipient may hand off their own record; outsiders remain denied.
CREATE OR ALTER PROCEDURE dbo.WorkflowWorkspace
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@mode varchar(20),@record_id uniqueidentifier=NULL,@page int=1,@inbox bit=0,@payload nvarchar(max)=NULL,@query nvarchar(100)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1) THROW 51003,'Workspace denied.',1;
 DECLARE @can_request bit=CASE WHEN dbo.AccessCan(@account_id,@actor_id,'request.create',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'request.view',1)=1 THEN 1 ELSE 0 END,
 @can_incident bit=CASE WHEN dbo.AccessCan(@account_id,@actor_id,'incident.create',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'incident.view',1)=1 THEN 1 ELSE 0 END;
 IF @mode='REASSIGN_OPTIONS' BEGIN
  IF dbo.WorkflowCanView(@account_id,@actor_id,@record_id)<>1 THROW 51004,'Record unavailable.',1;
  DECLARE @search_kind varchar(8),@search_owner uniqueidentifier,@search_recipient uniqueidentifier,@search_status varchar(20);
  SELECT @search_kind=kind,@search_owner=requester_id,@search_recipient=recipient_id,@search_status=status FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id;
  IF (@search_recipient<>@actor_id AND @search_owner<>@actor_id) OR dbo.AccessCan(@account_id,@actor_id,CASE @search_kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END,1)<>1 THROW 51003,'Reassignment denied.',1;
  IF @search_status NOT IN ('SUBMITTED','IN_PROGRESS') THROW 51009,'Record changed.',1;
  SELECT TOP 20 p.person_id AS id,p.display_name AS name,@search_kind AS kind,CAST(0 AS bit) AS reportingManager
  FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND p.active=1 AND p.person_id NOT IN (@search_owner,@search_recipient)
  AND dbo.AccessCan(@account_id,p.person_id,CASE @search_kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END,1)=1
  AND (@query IS NULL OR p.display_name LIKE N'%'+REPLACE(REPLACE(REPLACE(@query,'[','[[]'),'%','[%]'),'_','[_]')+N'%') ORDER BY p.display_name,p.person_id;
 END
 ELSE IF @mode='OPTIONS' BEGIN
  SELECT @can_request AS canRequest,@can_incident AS canIncident;
  SELECT TOP 20 p.person_id AS id,p.display_name AS name,k.kind,CAST(CASE WHEN a.manager_id=p.person_id THEN 1 ELSE 0 END AS bit) AS reportingManager
  FROM dbo.AccessPerson p CROSS JOIN (VALUES('REQUEST','request.view','request.assign'),('INCIDENT','incident.view','incident.assign')) k(kind,v,s)
  LEFT JOIN dbo.AccessOrgAssignment a ON a.account_id=p.account_id AND a.person_id=@actor_id
  WHERE p.account_id=@account_id AND p.active=1 AND p.person_id<>@actor_id AND dbo.AccessCan(@account_id,p.person_id,k.v,1)=1 AND (@query IS NULL OR p.display_name LIKE N'%'+REPLACE(REPLACE(REPLACE(@query,'[','[[]'),'%','[%]'),'_','[_]')+N'%')
  AND ((k.kind='REQUEST' AND @can_request=1) OR (k.kind='INCIDENT' AND @can_incident=1)) ORDER BY reportingManager DESC,p.display_name;
 END
 ELSE IF @mode IN ('LIST','DETAIL') BEGIN
  IF @page IS NULL OR @page NOT BETWEEN 1 AND 99999 THROW 51000,'Invalid page.',1;
  IF @mode='DETAIL' AND dbo.WorkflowCanView(@account_id,@actor_id,@record_id)<>1 THROW 51004,'Record unavailable.',1;
  IF @mode='LIST' BEGIN
   IF dbo.AccessCan(@account_id,@actor_id,'request.view',1)<>1 AND dbo.AccessCan(@account_id,@actor_id,'incident.view',1)<>1 THROW 51003,'View denied.',1;
   SELECT COUNT(*) AS total FROM dbo.WorkflowRecord WHERE account_id=@account_id AND dbo.WorkflowCanView(@account_id,@actor_id,record_id)=1 AND CASE WHEN @inbox=1 THEN recipient_id ELSE requester_id END=@actor_id;
  END;
  SELECT r.record_id AS id,CONCAT(CASE r.kind WHEN 'REQUEST' THEN 'REQ' ELSE 'INC' END,'-',r.record_number) AS reference,r.category,r.kind,r.title,r.description,r.priority,r.status,r.revision,r.requester_id AS requesterId,o.display_name AS requesterName,r.recipient_id AS recipientId,p.display_name AS recipientName,r.created_at AS createdAt,r.updated_at AS updatedAt,
  CAST(CASE WHEN r.status IN ('SUBMITTED','IN_PROGRESS') AND CASE r.kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END=1 THEN 1 ELSE 0 END AS bit) AS canComment,
  CAST(CASE WHEN r.status IN ('SUBMITTED','IN_PROGRESS') AND r.requester_id=@actor_id AND CASE r.kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END=1 THEN 1 ELSE 0 END AS bit) AS canCancel,
  CAST(CASE WHEN r.recipient_id=@actor_id AND r.status='SUBMITTED' AND dbo.AccessCan(@account_id,@actor_id,CASE r.kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END,1)=1 THEN 1 ELSE 0 END AS bit) AS canStart,
  CAST(CASE WHEN r.recipient_id=@actor_id AND r.status='IN_PROGRESS' AND dbo.AccessCan(@account_id,@actor_id,CASE r.kind WHEN 'REQUEST' THEN 'request.resolve' ELSE 'incident.resolve' END,1)=1 THEN 1 ELSE 0 END AS bit) AS canResolve,
  CAST(CASE WHEN (r.recipient_id=@actor_id OR r.requester_id=@actor_id) AND r.status IN ('SUBMITTED','IN_PROGRESS') AND dbo.AccessCan(@account_id,@actor_id,CASE r.kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END,1)=1 THEN 1 ELSE 0 END AS bit) AS canReassign
  FROM dbo.WorkflowRecord r JOIN dbo.AccessPerson o ON o.account_id=r.account_id AND o.person_id=r.requester_id JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.recipient_id
  WHERE r.account_id=@account_id AND dbo.WorkflowCanView(@account_id,@actor_id,r.record_id)=1 AND ((@mode='DETAIL' AND r.record_id=@record_id) OR (@mode='LIST' AND CASE WHEN @inbox=1 THEN r.recipient_id ELSE r.requester_id END=@actor_id))
  ORDER BY r.updated_at DESC,r.record_id OFFSET CASE WHEN @mode='DETAIL' THEN 0 ELSE (@page-1)*10 END ROWS FETCH NEXT 10 ROWS ONLY;
  IF @mode='DETAIL' SELECT e.event_id AS id,e.action,CASE WHEN e.action='REASSIGN' THEN CONCAT(e.body,N' — Assigned to ',target.display_name) ELSE e.body END AS body,p.display_name AS actorName,e.occurred_at AS at,e.revision FROM dbo.WorkflowEvent e JOIN dbo.AccessPerson p ON p.account_id=e.account_id AND p.person_id=e.actor_id LEFT JOIN dbo.AccessPerson target ON target.account_id=e.account_id AND target.person_id=e.target_recipient_id WHERE e.account_id=@account_id AND e.record_id=@record_id ORDER BY e.revision;
 END
 ELSE IF @mode='NOTIFICATIONS' BEGIN
  -- Durable committed events are the bell feed; no transient or external delivery.
  SELECT TOP 30 CONVERT(varchar(36),e.event_id) AS id,e.occurred_at AS at,CASE e.action WHEN 'CREATE' THEN 'New '+LOWER(r.kind) WHEN 'CANCEL' THEN 'Cancelled '+LOWER(r.kind) WHEN 'START' THEN 'Work started' WHEN 'RESOLVE' THEN 'Resolved '+LOWER(r.kind) WHEN 'REASSIGN' THEN 'Reassigned '+LOWER(r.kind) ELSE 'New comment' END AS title,r.title AS body,'/requests?record='+CONVERT(varchar(36),r.record_id) AS href
  FROM dbo.WorkflowEvent e JOIN dbo.WorkflowRecord r ON r.account_id=e.account_id AND r.record_id=e.record_id
  WHERE r.account_id=@account_id AND e.actor_id<>@actor_id AND dbo.WorkflowCanView(@account_id,@actor_id,r.record_id)=1 ORDER BY e.occurred_at DESC,e.event_id;
 END
 ELSE IF @mode IN ('CREATE','COMMENT','CANCEL','START','RESOLVE','REASSIGN') BEGIN
  IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>16384 OR EXISTS(SELECT [key] FROM OPENJSON(@payload) GROUP BY [key] HAVING COUNT(*)>1) OR ISNULL(JSON_VALUE(@payload,'$.action'),'')<>@mode OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')) IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'))<>@record_id OR @record_id IS NULL THROW 51000,'Invalid payload.',1;
  DECLARE @category varchar(24)=ISNULL(JSON_VALUE(@payload,'$.category'),'OTHER');
  DECLARE @kind varchar(8),@title nvarchar(4000),@description nvarchar(4000),@priority varchar(6),@recipient uniqueidentifier,@revision int,@owner uniqueidentifier,@status varchar(20),@body nvarchar(4000),@event uniqueidentifier,@new_recipient uniqueidentifier,@base_revision int;
  IF @mode='CREATE' BEGIN
   IF @category NOT IN ('LEARNING','SKILL','ASSESSMENT','PROJECT','PROFILE_ACCESS','OTHER') THROW 51000,'Invalid category.',1;
   IF (SELECT COUNT(*) FROM OPENJSON(@payload)) NOT IN (7,8) OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','kind','title','description','priority','recipientId','category') OR type<>1) THROW 51000,'Invalid create fields.',1;
   IF JSON_VALUE(@payload,'$.kind') NOT IN ('REQUEST','INCIDENT') OR JSON_VALUE(@payload,'$.priority') NOT IN ('NORMAL','HIGH') THROW 51000,'Invalid type.',1;
   SET @kind=JSON_VALUE(@payload,'$.kind');SET @priority=JSON_VALUE(@payload,'$.priority');SET @title=LTRIM(RTRIM(JSON_VALUE(@payload,'$.title')));SET @description=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));SET @recipient=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.recipientId'));
   IF @title IS NULL OR LEN(@title) NOT BETWEEN 1 AND 160 OR @description IS NULL OR LEN(@description) NOT BETWEEN 1 AND 2000 OR @recipient IS NULL OR @recipient=@actor_id THROW 51000,'Invalid fields.',1;
   IF CASE @kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END<>1 THROW 51003,'Create denied.',1;
   IF dbo.AccessCan(@account_id,@recipient,CASE @kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END,1)<>1 THROW 51011,'Recipient unavailable.',1;
   IF EXISTS(SELECT 1 FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id AND requester_id=@actor_id AND kind=@kind AND title=@title AND description=@description AND priority=@priority AND recipient_id=@recipient AND category=@category) THROW 51009,'Duplicate identifier changed.',1;
    COMMIT;RETURN;
   END;
   IF (SELECT COUNT(*) FROM dbo.WorkflowRecord WHERE account_id=@account_id AND requester_id=@actor_id AND status IN ('SUBMITTED','IN_PROGRESS'))>=100 THROW 51000,'Open record limit reached.',1;
   INSERT dbo.WorkflowRecord(account_id,record_id,kind,requester_id,recipient_id,title,description,priority,status,revision,category) VALUES(@account_id,@record_id,@kind,@actor_id,@recipient,@title,@description,@priority,'SUBMITTED',1,@category);
   SET @revision=1;SET @event=@record_id;SET @body=N'Submitted to the selected recipient.';
  END
  ELSE BEGIN
   IF (SELECT COUNT(*) FROM OPENJSON(@payload))<>CASE WHEN @mode='REASSIGN' THEN 6 ELSE 5 END OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE ([key] NOT IN ('action','id','eventId','revision','body') AND NOT(@mode='REASSIGN' AND [key]='recipientId')) OR ([key]<>'revision' AND type<>1)) THROW 51000,'Invalid change fields.',1;
   SET @event=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.eventId'));SET @body=LTRIM(RTRIM(JSON_VALUE(@payload,'$.body')));
   IF @event IS NULL OR @body IS NULL OR LEN(@body) NOT BETWEEN 1 AND 1000 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='revision' AND type=2 AND value NOT LIKE '%[.eE]%' AND TRY_CONVERT(int,value)>0) THROW 51000,'Invalid comment.',1;
   IF dbo.WorkflowCanView(@account_id,@actor_id,@record_id)<>1 THROW 51004,'Record unavailable.',1;
   SELECT @kind=kind,@owner=requester_id,@recipient=recipient_id,@revision=revision,@status=status FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id;
   SET @base_revision=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision'));
   SET @new_recipient=CASE WHEN @mode='REASSIGN' THEN TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.recipientId')) ELSE NULL END;
   IF @mode IN ('COMMENT','CANCEL') AND CASE @kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END<>1 THROW 51003,'Change denied.',1;
   IF @mode IN ('START','REASSIGN','RESOLVE') AND ((@recipient<>@actor_id AND NOT(@mode='REASSIGN' AND @owner=@actor_id)) OR dbo.AccessCan(@account_id,@actor_id,CASE WHEN @mode='RESOLVE' THEN CASE @kind WHEN 'REQUEST' THEN 'request.resolve' ELSE 'incident.resolve' END ELSE CASE @kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END END,1)<>1) THROW 51003,'Recipient action denied.',1;
   IF @mode='REASSIGN' AND (@new_recipient IS NULL OR @new_recipient IN (@owner,@recipient)) THROW 51000,'Choose a different recipient.',1;
   IF @mode='REASSIGN' AND dbo.AccessCan(@account_id,@new_recipient,CASE @kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END,1)<>1 THROW 51011,'Recipient unavailable.',1;
   IF @mode='CANCEL' AND @owner<>@actor_id THROW 51003,'Owner cancellation only.',1;
   IF EXISTS(SELECT 1 FROM dbo.WorkflowEvent WHERE account_id=@account_id AND event_id=@event) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.WorkflowEvent WHERE account_id=@account_id AND event_id=@event AND record_id=@record_id AND actor_id=@actor_id AND action=@mode AND body=@body AND (base_revision IS NULL OR base_revision=@base_revision) AND ((target_recipient_id IS NULL AND @new_recipient IS NULL) OR target_recipient_id=@new_recipient)) THROW 51009,'Duplicate event changed.',1;
    COMMIT;RETURN;
   END;
   IF @revision<>@base_revision OR @status NOT IN ('SUBMITTED','IN_PROGRESS') OR (@mode='START' AND @status<>'SUBMITTED') OR (@mode='RESOLVE' AND @status<>'IN_PROGRESS') THROW 51009,'Record changed.',1;
   IF @revision>=100 THROW 51000,'Timeline limit reached. Contact the administrator.',1;
   SET @revision=@revision+1;
   UPDATE dbo.WorkflowRecord SET revision=@revision,updated_at=SYSUTCDATETIME(),status=CASE @mode WHEN 'CANCEL' THEN 'CANCELLED' WHEN 'START' THEN 'IN_PROGRESS' WHEN 'RESOLVE' THEN 'RESOLVED' WHEN 'REASSIGN' THEN 'SUBMITTED' ELSE status END,recipient_id=CASE WHEN @mode='REASSIGN' THEN @new_recipient ELSE recipient_id END WHERE account_id=@account_id AND record_id=@record_id;
  END;
  INSERT dbo.WorkflowEvent(account_id,record_id,event_id,revision,actor_id,action,body,base_revision,target_recipient_id) VALUES(@account_id,@record_id,@event,@revision,@actor_id,@mode,@body,@base_revision,@new_recipient);
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'workflow.'+LOWER(@mode),@record_id,(SELECT @record_id AS id,@revision AS revision,@mode AS action,@new_recipient AS recipientId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 END
 ELSE THROW 51000,'Unknown workflow action.',1;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.WorkflowWorkspace TO [skill_management_runtime];
GO



