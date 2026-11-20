-- Label audited records in the existing authorized read without exposing draft contents.
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
 p.display_name AS actorName,labels.targetName,
 CASE WHEN @include_details=1 THEN e.before_json ELSE NULL END AS [before],
 CASE WHEN @include_details=1 THEN e.after_json ELSE NULL END AS [after],
 CASE WHEN @include_details=1 AND e.action='capability.decide' THEN (
   SELECT i.kind,i.needsReview,i.status,i.feedback,
    CASE WHEN i.kind='SKILL' THEN JSON_VALUE(s.snapshot_json,'$.skill_name')
         WHEN i.kind='CERTIFICATION' THEN JSON_VALUE(s.snapshot_json,'$.certification_name') END AS name
   FROM OPENJSON(e.after_json,'$.items') WITH (
     kind varchar(20),id uniqueidentifier,needsReview bit,status varchar(20) '$.decision.status',feedback nvarchar(2000) '$.decision.feedback'
   ) i
   LEFT JOIN dbo.CapabilitySubmissionItem s ON s.account_id=e.account_id AND s.submission_id=e.target_id
     AND s.kind=i.kind AND s.record_id=i.id
   WHERE i.kind IN ('SKILL','CERTIFICATION') AND i.needsReview=1
   ORDER BY i.kind,i.id FOR JSON PATH
 ) END AS decisionItems,
 CASE WHEN @include_details=1 THEN (
   SELECT DISTINCT r.kind,r.id,COALESCE(person_ref.display_name,node_ref.display_name,role_ref.display_name,
     skill_ref.display_name COLLATE DATABASE_DEFAULT) AS name
   FROM (VALUES(e.before_json),(e.after_json)) snapshot(payload)
   CROSS APPLY (
      SELECT f.kind,TRY_CONVERT(uniqueidentifier,JSON_VALUE(snapshot.payload,f.path)) AS id
      FROM (VALUES('person','$.managerId'),('person','$.reviewer_id'),('organization','$.departmentId'),
        ('organization','$.teamId'),('skill','$.primaryCapabilityId')) f(kind,path)
      UNION ALL
      SELECT 'template',TRY_CONVERT(uniqueidentifier,CASE WHEN j.type=1 THEN j.value
        ELSE JSON_VALUE(CASE WHEN j.type=5 THEN j.value END,'$.id') END)
      FROM OPENJSON(snapshot.payload,'$.roles') j
      UNION ALL
      SELECT 'template',TRY_CONVERT(uniqueidentifier,j.value) FROM OPENJSON(snapshot.payload,'$.roleIds') j
   ) r
   LEFT JOIN dbo.AccessPerson person_ref ON r.kind='person' AND person_ref.account_id=e.account_id AND person_ref.person_id=r.id
   LEFT JOIN dbo.AccessOrgNode node_ref ON r.kind='organization' AND node_ref.account_id=e.account_id AND node_ref.node_id=r.id
   LEFT JOIN dbo.AccountRole role_ref ON r.kind='template' AND role_ref.account_id=e.account_id AND role_ref.role_id=r.id
   LEFT JOIN dbo.SkillCatalogue skill_ref ON r.kind='skill' AND skill_ref.account_id=e.account_id AND skill_ref.skill_id=r.id
   WHERE COALESCE(person_ref.person_id,node_ref.node_id,role_ref.role_id,skill_ref.skill_id) IS NOT NULL
   FOR JSON PATH
 ) END AS referenceNames
 FROM dbo.AccessAudit e
 OUTER APPLY (SELECT
 CASE WHEN e.action IN ('business.responsibility','business.membership') THEN TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(e.after_json,'$.personId'),JSON_VALUE(e.after_json,'$.person_id'))) END AS after_person,
 CASE WHEN e.action IN ('business.responsibility','business.membership') THEN TRY_CONVERT(uniqueidentifier,COALESCE(JSON_VALUE(e.before_json,'$.personId'),JSON_VALUE(e.before_json,'$.person_id'))) END AS before_person) subjects
 LEFT JOIN dbo.AccessPerson p ON p.account_id=e.account_id AND p.person_id=e.actor_id
 LEFT JOIN dbo.AccessPerson target ON target.account_id=e.account_id AND target.person_id=e.target_id
 LEFT JOIN dbo.AccessPerson subject ON subject.account_id=e.account_id AND subject.person_id=COALESCE(subjects.after_person,subjects.before_person)
 LEFT JOIN dbo.AccountRole r ON r.account_id=e.account_id AND r.role_id=e.target_id
 LEFT JOIN dbo.AccessOrgNode org ON org.account_id=e.account_id AND org.node_id=e.target_id AND e.action LIKE 'organization.node.%'
 LEFT JOIN dbo.SkillCatalogue skill ON skill.account_id=e.account_id AND skill.skill_id=e.target_id AND e.action IN ('skill.created','skill.updated')
 LEFT JOIN dbo.SkillClaimDraft claim ON claim.account_id=e.account_id AND claim.claim_id=e.target_id AND e.action LIKE 'claim.%'
 LEFT JOIN dbo.CertificationRecord cert ON cert.account_id=e.account_id AND cert.id=e.target_id AND e.action LIKE 'certification.%'
 LEFT JOIN dbo.CapabilitySubmission submission ON submission.account_id=e.account_id AND submission.id=e.target_id AND e.action LIKE 'capability.%'
 CROSS APPLY (SELECT CASE
   WHEN e.action LIKE 'capability.%' THEN N'Capability submission'
   WHEN e.action IN ('claim.submitted','claim.approved','claim.rejected','claim.changes_requested') THEN
     COALESCE(JSON_VALUE(e.after_json,'$.skill_name'),JSON_VALUE(e.before_json,'$.skill_name'),N'Skill claim')
   WHEN e.action LIKE 'claim.%' THEN N'Skill claim'
   WHEN e.action IN ('certification.submitted','certification.approved','certification.rejected','certification.changes_requested') THEN
     COALESCE(JSON_VALUE(e.after_json,'$.certification_name'),JSON_VALUE(e.before_json,'$.certification_name'),N'Certificate record')
   WHEN e.action LIKE 'certification.%' THEN N'Certificate record'
 END AS record_name) audited
 LEFT JOIN dbo.AccessPerson record_owner ON record_owner.account_id=e.account_id
   AND record_owner.person_id=COALESCE(claim.person_id,cert.person_id,submission.person_id)
 CROSS APPLY (SELECT CASE WHEN audited.record_name IS NOT NULL
   THEN CONCAT_WS(N' · ',audited.record_name,record_owner.display_name)
   ELSE COALESCE(subject.display_name,target.display_name,r.display_name,org.display_name,skill.display_name COLLATE DATABASE_DEFAULT)
 END AS targetName) labels
 WHERE e.account_id=@account_id AND e.revision<=@revision AND (@before IS NULL OR e.revision<@before)
 AND (@person_id IS NULL OR e.target_id=@person_id OR subjects.after_person=@person_id OR subjects.before_person=@person_id)
 AND (@query=N'' OR CHARINDEX(@query,CONCAT(e.action,N' ',REPLACE(REPLACE(e.action,'.',' '),'_',' '),N' ',p.display_name,N' ',labels.targetName,N' ',CONVERT(nvarchar(36),e.target_id),N' ',CONVERT(nvarchar(36),e.actor_id)))>0)
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
