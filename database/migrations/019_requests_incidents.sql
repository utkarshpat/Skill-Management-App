-- Owner and explicitly assigned recipient only. No inferred role authority.
CREATE TABLE dbo.WorkflowRecord(
 account_id uniqueidentifier NOT NULL,record_id uniqueidentifier NOT NULL,kind varchar(8) NOT NULL CHECK(kind IN ('REQUEST','INCIDENT')),
 requester_id uniqueidentifier NOT NULL,recipient_id uniqueidentifier NOT NULL,title nvarchar(160) NOT NULL,description nvarchar(2000) NOT NULL,
 priority varchar(6) NOT NULL CHECK(priority IN ('NORMAL','HIGH')),status varchar(20) NOT NULL CHECK(status IN ('SUBMITTED','CANCELLED')),
 revision int NOT NULL CHECK(revision>0),created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),updated_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,record_id),FOREIGN KEY(account_id,requester_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,recipient_id) REFERENCES dbo.AccessPerson(account_id,person_id),CHECK(requester_id<>recipient_id)
);
CREATE INDEX IX_WorkflowOwner ON dbo.WorkflowRecord(account_id,requester_id,updated_at DESC);
CREATE INDEX IX_WorkflowRecipient ON dbo.WorkflowRecord(account_id,recipient_id,updated_at DESC);
CREATE TABLE dbo.WorkflowEvent(
 account_id uniqueidentifier NOT NULL,record_id uniqueidentifier NOT NULL,event_id uniqueidentifier NOT NULL,
 revision int NOT NULL,actor_id uniqueidentifier NOT NULL,action varchar(20) NOT NULL CHECK(action IN ('CREATE','COMMENT','CANCEL')),
 body nvarchar(1000) NOT NULL,occurred_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,event_id),UNIQUE(account_id,record_id,revision),
 FOREIGN KEY(account_id,record_id) REFERENCES dbo.WorkflowRecord(account_id,record_id),FOREIGN KEY(account_id,actor_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
GO
CREATE OR ALTER FUNCTION dbo.WorkflowCanView(@account uniqueidentifier,@actor uniqueidentifier,@record uniqueidentifier)
RETURNS bit AS BEGIN
 DECLARE @kind varchar(8),@owner uniqueidentifier,@recipient uniqueidentifier,@view varchar(30),@assign varchar(30);
 SELECT @kind=kind,@owner=requester_id,@recipient=recipient_id FROM dbo.WorkflowRecord WHERE account_id=@account AND record_id=@record;
 SET @view=CASE @kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END;
 SET @assign=CASE @kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END;
 IF @owner=@actor AND dbo.AccessCan(@account,@actor,@view,1)=1 RETURN 1;
 IF @recipient=@actor AND dbo.AccessCan(@account,@actor,@view,0)=1 AND dbo.AccessCan(@account,@actor,@assign,0)=1 RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.WorkflowWorkspace
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@mode varchar(20),@record_id uniqueidentifier=NULL,@page int=1,@inbox bit=0,@payload nvarchar(max)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1) THROW 51003,'Workspace denied.',1;
 DECLARE @can_request bit=CASE WHEN dbo.AccessCan(@account_id,@actor_id,'request.create',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'request.view',1)=1 THEN 1 ELSE 0 END,
 @can_incident bit=CASE WHEN dbo.AccessCan(@account_id,@actor_id,'incident.create',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'incident.view',1)=1 THEN 1 ELSE 0 END;
 IF @mode='OPTIONS' BEGIN
  SELECT @can_request AS canRequest,@can_incident AS canIncident;
  SELECT p.person_id AS id,p.display_name AS name,k.kind,CAST(CASE WHEN a.manager_id=p.person_id THEN 1 ELSE 0 END AS bit) AS reportingManager
  FROM dbo.AccessPerson p CROSS JOIN (VALUES('REQUEST','request.view','request.assign'),('INCIDENT','incident.view','incident.assign')) k(kind,v,s)
  LEFT JOIN dbo.AccessOrgAssignment a ON a.account_id=p.account_id AND a.person_id=@actor_id
  WHERE p.account_id=@account_id AND p.active=1 AND p.person_id<>@actor_id AND dbo.AccessCan(@account_id,p.person_id,k.v,0)=1 AND dbo.AccessCan(@account_id,p.person_id,k.s,0)=1
  AND ((k.kind='REQUEST' AND @can_request=1) OR (k.kind='INCIDENT' AND @can_incident=1)) ORDER BY reportingManager DESC,p.display_name;
 END
 ELSE IF @mode IN ('LIST','DETAIL') BEGIN
  IF @page IS NULL OR @page NOT BETWEEN 1 AND 99999 THROW 51000,'Invalid page.',1;
  IF @mode='DETAIL' AND dbo.WorkflowCanView(@account_id,@actor_id,@record_id)<>1 THROW 51004,'Record unavailable.',1;
  IF @mode='LIST' BEGIN
   IF dbo.AccessCan(@account_id,@actor_id,'request.view',1)<>1 AND dbo.AccessCan(@account_id,@actor_id,'incident.view',1)<>1 THROW 51003,'View denied.',1;
   SELECT COUNT(*) AS total FROM dbo.WorkflowRecord WHERE account_id=@account_id AND dbo.WorkflowCanView(@account_id,@actor_id,record_id)=1 AND CASE WHEN @inbox=1 THEN recipient_id ELSE requester_id END=@actor_id;
  END;
  SELECT r.record_id AS id,r.kind,r.title,r.description,r.priority,r.status,r.revision,r.requester_id AS requesterId,o.display_name AS requesterName,r.recipient_id AS recipientId,p.display_name AS recipientName,r.created_at AS createdAt,r.updated_at AS updatedAt,
  CAST(CASE WHEN r.status='SUBMITTED' AND (r.requester_id<>@actor_id OR CASE r.kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END=1) THEN 1 ELSE 0 END AS bit) AS canComment,
  CAST(CASE WHEN r.status='SUBMITTED' AND r.requester_id=@actor_id AND CASE r.kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END=1 THEN 1 ELSE 0 END AS bit) AS canCancel
  FROM dbo.WorkflowRecord r JOIN dbo.AccessPerson o ON o.account_id=r.account_id AND o.person_id=r.requester_id JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.recipient_id
  WHERE r.account_id=@account_id AND dbo.WorkflowCanView(@account_id,@actor_id,r.record_id)=1 AND ((@mode='DETAIL' AND r.record_id=@record_id) OR (@mode='LIST' AND CASE WHEN @inbox=1 THEN r.recipient_id ELSE r.requester_id END=@actor_id))
  ORDER BY r.updated_at DESC,r.record_id OFFSET CASE WHEN @mode='DETAIL' THEN 0 ELSE (@page-1)*10 END ROWS FETCH NEXT 10 ROWS ONLY;
  IF @mode='DETAIL' SELECT e.event_id AS id,e.action,e.body,p.display_name AS actorName,e.occurred_at AS at,e.revision FROM dbo.WorkflowEvent e JOIN dbo.AccessPerson p ON p.account_id=e.account_id AND p.person_id=e.actor_id WHERE e.account_id=@account_id AND e.record_id=@record_id ORDER BY e.revision;
 END
 ELSE IF @mode='NOTIFICATIONS' BEGIN
  -- Durable committed events are the bell feed; no transient or external delivery.
  SELECT TOP 30 CONVERT(varchar(36),e.event_id) AS id,e.occurred_at AS at,CASE e.action WHEN 'CREATE' THEN 'New '+LOWER(r.kind) WHEN 'CANCEL' THEN 'Cancelled '+LOWER(r.kind) ELSE 'New comment' END AS title,r.title AS body,'/requests?record='+CONVERT(varchar(36),r.record_id) AS href
  FROM dbo.WorkflowEvent e JOIN dbo.WorkflowRecord r ON r.account_id=e.account_id AND r.record_id=e.record_id
  WHERE r.account_id=@account_id AND e.actor_id<>@actor_id AND dbo.WorkflowCanView(@account_id,@actor_id,r.record_id)=1 ORDER BY e.occurred_at DESC,e.event_id;
 END
 ELSE IF @mode IN ('CREATE','COMMENT','CANCEL') BEGIN
  IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>16384 OR EXISTS(SELECT [key] FROM OPENJSON(@payload) GROUP BY [key] HAVING COUNT(*)>1) OR ISNULL(JSON_VALUE(@payload,'$.action'),'')<>@mode OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')) IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id'))<>@record_id OR @record_id IS NULL THROW 51000,'Invalid payload.',1;
  DECLARE @kind varchar(8),@title nvarchar(4000),@description nvarchar(4000),@priority varchar(6),@recipient uniqueidentifier,@revision int,@owner uniqueidentifier,@status varchar(20),@body nvarchar(4000),@event uniqueidentifier;
  IF @mode='CREATE' BEGIN
   IF (SELECT COUNT(*) FROM OPENJSON(@payload))<>7 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','kind','title','description','priority','recipientId') OR type<>1) THROW 51000,'Invalid create fields.',1;
   IF JSON_VALUE(@payload,'$.kind') NOT IN ('REQUEST','INCIDENT') OR JSON_VALUE(@payload,'$.priority') NOT IN ('NORMAL','HIGH') THROW 51000,'Invalid type.',1;
   SET @kind=JSON_VALUE(@payload,'$.kind');SET @priority=JSON_VALUE(@payload,'$.priority');SET @title=LTRIM(RTRIM(JSON_VALUE(@payload,'$.title')));SET @description=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));SET @recipient=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.recipientId'));
   IF @title IS NULL OR LEN(@title) NOT BETWEEN 1 AND 160 OR @description IS NULL OR LEN(@description) NOT BETWEEN 1 AND 2000 OR @recipient IS NULL OR @recipient=@actor_id THROW 51000,'Invalid fields.',1;
   IF CASE @kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END<>1 THROW 51003,'Create denied.',1;
   IF dbo.AccessCan(@account_id,@recipient,CASE @kind WHEN 'REQUEST' THEN 'request.view' ELSE 'incident.view' END,0)<>1 OR dbo.AccessCan(@account_id,@recipient,CASE @kind WHEN 'REQUEST' THEN 'request.assign' ELSE 'incident.assign' END,0)<>1 THROW 51011,'Recipient unavailable.',1;
   IF EXISTS(SELECT 1 FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id AND requester_id=@actor_id AND kind=@kind AND title=@title AND description=@description AND priority=@priority AND recipient_id=@recipient) THROW 51009,'Duplicate identifier changed.',1;
    COMMIT;RETURN;
   END;
   IF (SELECT COUNT(*) FROM dbo.WorkflowRecord WHERE account_id=@account_id AND requester_id=@actor_id AND status='SUBMITTED')>=100 THROW 51000,'Open record limit reached.',1;
   INSERT dbo.WorkflowRecord(account_id,record_id,kind,requester_id,recipient_id,title,description,priority,status,revision) VALUES(@account_id,@record_id,@kind,@actor_id,@recipient,@title,@description,@priority,'SUBMITTED',1);
   SET @revision=1;SET @event=@record_id;SET @body=N'Submitted to the selected recipient.';
  END
  ELSE BEGIN
   IF (SELECT COUNT(*) FROM OPENJSON(@payload))<>5 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('action','id','eventId','revision','body') OR ([key]<>'revision' AND type<>1)) THROW 51000,'Invalid change fields.',1;
   SET @event=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.eventId'));SET @body=LTRIM(RTRIM(JSON_VALUE(@payload,'$.body')));
   IF @event IS NULL OR @body IS NULL OR LEN(@body) NOT BETWEEN 1 AND 1000 OR NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='revision' AND type=2 AND value NOT LIKE '%[.eE]%' AND TRY_CONVERT(int,value)>0) THROW 51000,'Invalid comment.',1;
   IF dbo.WorkflowCanView(@account_id,@actor_id,@record_id)<>1 THROW 51004,'Record unavailable.',1;
   SELECT @kind=kind,@owner=requester_id,@revision=revision,@status=status FROM dbo.WorkflowRecord WHERE account_id=@account_id AND record_id=@record_id;
   IF @owner=@actor_id AND CASE @kind WHEN 'REQUEST' THEN @can_request ELSE @can_incident END<>1 THROW 51003,'Change denied.',1;
   IF @mode='CANCEL' AND @owner<>@actor_id THROW 51003,'Owner cancellation only.',1;
   IF EXISTS(SELECT 1 FROM dbo.WorkflowEvent WHERE account_id=@account_id AND event_id=@event) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.WorkflowEvent WHERE account_id=@account_id AND event_id=@event AND record_id=@record_id AND actor_id=@actor_id AND action=@mode AND body=@body) THROW 51009,'Duplicate event changed.',1;
    COMMIT;RETURN;
   END;
   IF @revision<>TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) OR @status<>'SUBMITTED' THROW 51009,'Record changed.',1;
   IF @revision>=101 THROW 51000,'Timeline limit reached. Contact the administrator.',1;
   SET @revision=@revision+1;
   UPDATE dbo.WorkflowRecord SET revision=@revision,updated_at=SYSUTCDATETIME(),status=CASE WHEN @mode='CANCEL' THEN 'CANCELLED' ELSE status END WHERE account_id=@account_id AND record_id=@record_id;
  END;
  INSERT dbo.WorkflowEvent(account_id,record_id,event_id,revision,actor_id,action,body) VALUES(@account_id,@record_id,@event,@revision,@actor_id,@mode,@body);
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'workflow.'+LOWER(@mode),@record_id,(SELECT @record_id AS id,@revision AS revision,@mode AS action FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 END
 ELSE THROW 51000,'Unknown workflow action.',1;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.WorkflowWorkspace TO [skill_management_runtime];
GO
