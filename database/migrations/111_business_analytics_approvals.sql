-- Use existing Business Analytics assignments as all-issuer approval grants.
-- Keep original assignment IDs, expiry, active state, scope and audit history.
CREATE OR ALTER VIEW dbo.BusinessApprovalAssignment AS
 SELECT account_id,id,person_id,scope_kind,scope_id,effect,active,all_issuers,issuer_ids
 FROM dbo.CapabilityLeadScope
 UNION ALL
 SELECT account_id,id,person_id,scope_kind,scope_id,effect,active,CONVERT(bit,1),CONVERT(nvarchar(max),N'[]')
 FROM dbo.BusinessResponsibility
 WHERE bundle='BUSINESS_OPERATIONS' AND (valid_until IS NULL OR valid_until>SYSUTCDATETIME());
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadMatches(
 @account uniqueidentifier,@actor uniqueidentifier,@owner uniqueidentifier,@issuerId uniqueidentifier
) RETURNS bit AS BEGIN
 IF @actor IS NULL OR @actor=@owner OR dbo.AccessCan(@account,@actor,'profile.view',1)<>1
  OR dbo.AccessCan(@account,@actor,'skill.view',1)<>1
  OR dbo.BusinessLegacyDenied(@account,@actor,'skill.verify')=1
  OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@owner AND active=1)
  RETURN 0;
 DECLARE @matching TABLE(effect varchar(5));
 INSERT @matching
 SELECT g.effect FROM dbo.BusinessApprovalAssignment g
 WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1
  AND (g.all_issuers=1 OR EXISTS(SELECT 1 FROM OPENJSON(g.issuer_ids) i WHERE TRY_CONVERT(uniqueidentifier,i.value)=@issuerId))
  AND EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account,g.scope_kind,g.scope_id) WHERE person_id=@owner);
 IF EXISTS(SELECT 1 FROM @matching WHERE effect='DENY') RETURN 0;
 IF EXISTS(SELECT 1 FROM @matching WHERE effect='ALLOW') RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadCanReviewSubmission(
 @account uniqueidentifier,@actor uniqueidentifier,@submission uniqueidentifier
) RETURNS bit AS BEGIN
 DECLARE @owner uniqueidentifier;
 IF NOT EXISTS(SELECT 1 FROM dbo.BusinessApprovalAssignment
  WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='ALLOW') RETURN 0;
 SELECT @owner=person_id FROM dbo.CapabilitySubmission WHERE account_id=@account AND id=@submission;
 IF @owner IS NULL RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem WHERE account_id=@account
  AND submission_id=@submission AND kind='CERTIFICATION')
  RETURN dbo.CapabilityLeadMatches(@account,@actor,@owner,NULL);
 IF EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i
  LEFT JOIN dbo.CertificationRecord c ON c.account_id=i.account_id AND c.id=i.record_id AND c.person_id=@owner
  WHERE i.account_id=@account AND i.submission_id=@submission AND i.kind='CERTIFICATION'
   AND (c.id IS NULL OR dbo.CapabilityLeadCoversIssuer(@account,@actor,@owner,c.provider)<>1))
  RETURN 0;
 RETURN 1;
END;
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadForSubmission(
 @account uniqueidentifier,@submission uniqueidentifier
) RETURNS uniqueidentifier AS BEGIN
 DECLARE @lead uniqueidentifier;
 SELECT TOP(1) @lead=person_id FROM dbo.BusinessApprovalAssignment
 WHERE account_id=@account AND active=1 AND effect='ALLOW'
  AND dbo.CapabilityLeadCanReviewSubmission(@account,person_id,@submission)=1 ORDER BY person_id;
 RETURN @lead;
END;
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadCanReviewCredential(
 @account uniqueidentifier,@actor uniqueidentifier,@id uniqueidentifier
) RETURNS bit AS BEGIN
 DECLARE @owner uniqueidentifier,@issuer nvarchar(120);
 IF NOT EXISTS(SELECT 1 FROM dbo.BusinessApprovalAssignment
  WHERE account_id=@account AND person_id=@actor AND active=1 AND effect='ALLOW') RETURN 0;
 SELECT @owner=person_id,@issuer=provider FROM dbo.CertificationRecord
 WHERE account_id=@account AND id=@id AND status='SUBMITTED';
 IF @owner IS NULL OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i JOIN dbo.CapabilitySubmission b
  ON b.account_id=i.account_id AND b.id=i.submission_id
  WHERE i.account_id=@account AND i.kind='CERTIFICATION' AND i.record_id=@id AND i.needs_review=1
   AND b.status IN('SUBMITTING','SUBMITTED')) RETURN 0;
 RETURN dbo.CapabilityLeadCoversIssuer(@account,@actor,@owner,@issuer);
END;
GO

CREATE OR ALTER FUNCTION dbo.CapabilityLeadHasGrants(@account uniqueidentifier,@actor uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.view',1)<>1
  OR dbo.BusinessLegacyDenied(@account,@actor,'skill.verify')=1 RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.BusinessApprovalAssignment g
  WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND g.effect='ALLOW'
   AND (g.all_issuers=1 OR EXISTS(SELECT 1 FROM OPENJSON(g.issuer_ids) i
    JOIN dbo.CredentialProvider p ON p.account_id=g.account_id AND p.id=TRY_CONVERT(uniqueidentifier,i.value) AND p.active=1))
   AND NOT EXISTS(SELECT 1 FROM dbo.BusinessApprovalAssignment d
    WHERE d.account_id=g.account_id AND d.person_id=g.person_id AND d.active=1 AND d.effect='DENY'
     AND d.all_issuers=1 AND dbo.BusinessScopeCovers(g.account_id,d.scope_kind,d.scope_id,g.scope_kind,g.scope_id)=1)
   AND dbo.BusinessScopeValid(@account,g.scope_kind,g.scope_id)=1) RETURN 1;
 RETURN 0;
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReadCapabilitySubmissionNotifications @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 SELECT TOP(30) 'capability-'+CONVERT(varchar(36),b.id)+'-'+CONVERT(varchar(12),a.revision) AS id,a.occurred_at AS at,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN N'Business Analytics recorded a decision' WHEN a.action='capability.decide' THEN N'Capability review completed' ELSE N'Capability review requested' END AS title,CONCAT((SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.skill_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL' ORDER BY i.record_id),N' · ',(SELECT TOP(1) JSON_VALUE(i.snapshot_json,'$.certification_name') FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION' ORDER BY i.record_id)) AS subject,
 CONCAT((SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='SKILL'),N' skill(s), ',(SELECT COUNT(*) FROM dbo.CapabilitySubmissionItem i WHERE i.account_id=b.account_id AND i.submission_id=b.id AND i.kind='CERTIFICATION'),N' certificate(s)',CASE WHEN a.action='capability.decide' AND JSON_QUERY(a.after_json,'$.items') IS NOT NULL THEN CONCAT(N' · ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='APPROVED'),N' approved; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='CHANGES_REQUESTED'),N' changes requested; ',(SELECT COUNT(*) FROM OPENJSON(a.after_json,'$.items') WITH(decision_json nvarchar(max) '$.decision' AS JSON,needsReview bit '$.needsReview') i WHERE i.needsReview=1 AND JSON_VALUE(i.decision_json,'$.status')='REJECTED'),N' not approved') ELSE N'' END,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN COALESCE((
 SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(N' · ',d.kind,N' ',JSON_VALUE(d.decision,'$.status'),N': ',JSON_VALUE(d.decision,'$.feedback'))),N'')
 FROM OPENJSON(a.after_json,'$.items') WITH(kind varchar(20),needsReview bit,decision nvarchar(max) AS JSON) d
 WHERE d.needsReview=1),N'') ELSE N'' END) AS body,(SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=a.account_id AND p.person_id=a.actor_id) AS actorName,CASE WHEN a.action='capability.decide' THEN N'Review completed' ELSE N'Submitted for review' END AS actionLabel,CASE WHEN a.action='capability.decide' AND b.person_id<>@actor_id THEN '' ELSE CASE WHEN a.action='capability.decide' THEN '/my-skills?submission=' ELSE '/skill-reviews?submission=' END+CONVERT(varchar(36),b.id) END AS href
 FROM dbo.AccessAudit a JOIN dbo.CapabilitySubmission b ON b.account_id=a.account_id AND b.id=a.target_id
 WHERE a.account_id=@account_id AND (a.action='capability.decide' AND (b.person_id=@actor_id OR (TRY_CONVERT(uniqueidentifier,JSON_VALUE(a.after_json,'$.leadNoticeRecipient'))=@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id))) OR a.action IN('capability.submit','capability.reroute') AND a.revision=(SELECT MAX(x.revision) FROM dbo.AccessAudit x WHERE x.account_id=b.account_id AND x.target_id=b.id AND x.action IN('capability.submit','capability.reroute')) AND b.status='SUBMITTED' AND ((b.reviewer_id=@actor_id AND b.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,b.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=b.account_id AND o.person_id=b.person_id AND o.manager_id=@actor_id) AND dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(@account_id,@actor_id)=1) OR dbo.CapabilityLeadCanReviewSubmission(@account_id,@actor_id,b.id)=1)) ORDER BY a.occurred_at DESC,a.revision DESC;
END;
GO

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
  CASE WHEN c.person_id<>@actor_id AND u.action<>'certification.submitted' THEN N'Business Analytics · '+REPLACE(REPLACE(u.action,'certification.',''),'_',' ') ELSE CASE u.action WHEN 'certification.submitted' THEN N'Certificate review requested'
   WHEN 'certification.approved' THEN N'Certificate approved'
   WHEN 'certification.changes_requested' THEN N'Certificate needs changes'
   ELSE N'Certificate not approved' END END AS title,
  CONCAT(c.certification_name,CASE WHEN LEN(ISNULL(JSON_VALUE(u.after_json,'$.feedback'),N''))>0
   THEN N' · '+JSON_VALUE(u.after_json,'$.feedback') ELSE N'' END) AS body,
  (SELECT p.display_name FROM dbo.AccessPerson p WHERE p.account_id=u.account_id AND p.person_id=u.actor_id) AS actorName,
  CASE u.action WHEN 'certification.submitted' THEN N'Submitted for review'
   WHEN 'certification.approved' THEN N'Approved'
   WHEN 'certification.changes_requested' THEN N'Changes requested'
   ELSE N'Not approved' END AS actionLabel,
  CASE WHEN u.action='certification.submitted' THEN '/skill-reviews?certification='+CONVERT(varchar(36),c.id) WHEN c.person_id=@actor_id THEN '/my-skills?record='+CONVERT(varchar(36),c.id) ELSE '' END AS href
 FROM dbo.AccessAudit u
 JOIN dbo.CertificationRecord c ON c.account_id=u.account_id AND c.id=u.target_id
 WHERE u.account_id=@account_id
  AND NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem i
   WHERE i.account_id=c.account_id AND i.kind='CERTIFICATION' AND i.record_id=c.id AND i.needs_review=1)
  AND (
   u.action='certification.submitted' AND (
    (c.reviewer_id=@actor_id AND dbo.CertificationCanReview(@account_id,@actor_id,c.id)=1
     AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.reviewer_id'))=@actor_id)
    OR (dbo.CapabilityLeadCanReviewCredential(@account_id,@actor_id,c.id)=1 AND u.revision=(
     SELECT MAX(revision) FROM dbo.AccessAudit WHERE account_id=@account_id AND target_id=c.id AND action='certification.submitted'
    ))
   )
   OR u.action IN('certification.approved','certification.changes_requested','certification.rejected')
    AND (c.person_id=@actor_id OR (
     TRY_CONVERT(uniqueidentifier,JSON_VALUE(u.after_json,'$.leadNoticeRecipient'))=@actor_id
     AND dbo.AccessReportingValid(@account_id,c.person_id)=1
     AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=c.account_id AND o.person_id=c.person_id AND o.manager_id=@actor_id)
    ))
  )
 ORDER BY u.occurred_at DESC,u.revision DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BusinessAdministration @account_id uniqueidentifier,@actor_id uniqueidentifier,@person_id uniqueidentifier=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person_id) THROW 51004,'Person unavailable.',1;
 SELECT (SELECT @revision AS revision,w.personal_baseline_enabled AS personalBaseline,
 (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1) AS baselineAffectedPeople,
 JSON_QUERY((SELECT id,name,department_id AS departmentId,active FROM dbo.BusinessProject WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS projects,
 JSON_QUERY((SELECT project_id AS projectId,person_id AS personId,active FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND (@person_id IS NULL OR person_id=@person_id) FOR JSON PATH)) AS memberships,
 JSON_QUERY((SELECT id,person_id AS personId,bundle,scope_kind AS kind,scope_id AS scopeId,effect,active,valid_until AS validUntil,reason FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND (@person_id IS NULL OR person_id=@person_id) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
 JSON_QUERY((SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,p.active,
 dbo.AccessCan(p.account_id,p.person_id,'profile.view',1) AS employeeAccess,
 CONVERT(bit,CASE WHEN dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS managerAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.BusinessHasAccess(p.account_id,p.person_id)=1 THEN 1 ELSE 0 END) AS analyticsAccess,
 dbo.CapabilityLeadHasGrants(p.account_id,p.person_id) AS issuerAnalyticsAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'permissions.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'users.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS adminAccess
 FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND (@person_id IS NULL OR p.person_id=@person_id) ORDER BY p.employee_code FOR JSON PATH)) AS people,
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active,dbo.BusinessScopeValid(@account_id,kind,node_id) AS scopeValid FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
 JSON_QUERY((SELECT r.role_id AS roleId,r.permission_code AS permission,r.scope_kind AS scope,r.effect FROM dbo.AccountRolePermission r WHERE r.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope s WHERE s.permission_code=r.permission_code AND s.scope_kind=r.scope_kind) FOR JSON PATH)) AS historicalGrantsForReview
 FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
