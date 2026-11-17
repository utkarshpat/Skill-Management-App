-- Notification reads do not mutate access, records or audits.  Keep the same
-- runtime, active-person and per-record authorization checks without taking
-- the AccessWorkspace write lock used by command and preview procedures.
CREATE OR ALTER PROCEDURE dbo.ReadCertificationNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account_id AND status='ACTIVE')
  OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1
  OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1
  THROW 51003,'Certification access denied.',1;

 SELECT TOP(30) 'certification-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(12),u.revision) AS id,
  u.occurred_at AS at,
  CASE u.action WHEN 'certification.submitted' THEN N'Certificate review requested'
   WHEN 'certification.approved' THEN N'Certificate approved'
   WHEN 'certification.changes_requested' THEN N'Certificate needs changes'
   ELSE N'Certificate not approved' END AS title,
  CONCAT(c.certification_name,CASE WHEN LEN(ISNULL(JSON_VALUE(u.after_json,'$.feedback'),N''))>0
   THEN N' · '+LEFT(JSON_VALUE(u.after_json,'$.feedback'),300) ELSE N'' END) AS body,
  (SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=u.account_id AND p.person_id=u.actor_id) AS actorName,
  CASE u.action WHEN 'certification.submitted' THEN N'Submitted for review'
   WHEN 'certification.approved' THEN N'Approved'
   WHEN 'certification.changes_requested' THEN N'Changes requested'
   ELSE N'Not approved' END AS actionLabel,
  CASE WHEN u.action='certification.submitted' THEN '/skill-reviews?certification=' ELSE '/my-skills?record=' END+CONVERT(varchar(36),c.id) AS href
 FROM dbo.AccessAudit u
 JOIN dbo.CertificationRecord c ON c.account_id=u.account_id AND c.id=u.target_id
 WHERE u.account_id=@account_id
  AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i
   WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1)
  AND (
   u.action='certification.submitted' AND c.reviewer_id=@actor_id
    AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
    AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.reviewer_id'))=@actor_id
   OR u.action IN('certification.approved','certification.changes_requested','certification.rejected')
    AND c.person_id=@actor_id
  )
 ORDER BY u.occurred_at DESC,u.revision DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadWorkflowNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account_id AND status='ACTIVE')
  OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  THROW 51003,'Workspace denied.',1;

 SELECT TOP 30 CONVERT(varchar(36),e.event_id) AS id,e.occurred_at AS at,
  CASE e.action WHEN 'CREATE' THEN 'New '+LOWER(r.kind) WHEN 'CANCEL' THEN 'Cancelled '+LOWER(r.kind)
   WHEN 'START' THEN 'Work started' WHEN 'RESOLVE' THEN 'Resolved '+LOWER(r.kind)
   WHEN 'REASSIGN' THEN 'Reassigned '+LOWER(r.kind) ELSE 'New comment' END AS title,
  actor.display_name AS actorName,r.title AS subject,LEFT(e.body,500) AS body,
  'View '+LOWER(r.kind) AS actionLabel,'/requests?record='+CONVERT(varchar(36),r.record_id) AS href
 FROM dbo.WorkflowEvent e
 JOIN dbo.WorkflowRecord r ON r.account_id=e.account_id AND r.record_id=e.record_id
 LEFT JOIN dbo.AccessPerson actor ON actor.account_id=e.account_id AND actor.person_id=e.actor_id
 WHERE r.account_id=@account_id AND e.actor_id<>@actor_id
  AND dbo.WorkflowCanView(@account_id,@actor_id,r.record_id)=1
 ORDER BY e.occurred_at DESC,e.event_id;
END;
GO
GRANT EXECUTE ON dbo.ReadCertificationNotifications TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadWorkflowNotifications TO [skill_management_runtime];
GO
