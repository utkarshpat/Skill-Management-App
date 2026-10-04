-- Notifications point to a specific authorized claim. Source rows and scope checks are unchanged.
CREATE OR ALTER PROCEDURE dbo.ReadSkillClaimNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 SELECT TOP(30) CONVERT(varchar(36),n.notification_id) AS id,n.created_at AS at,n.title,n.body,CASE WHEN n.href IN('/my-skills','/skill-reviews') THEN n.href+'?claim='+CONVERT(varchar(36),c.claim_id) ELSE n.href END AS href FROM dbo.SkillClaimNotification n JOIN dbo.SkillClaimDraft c ON c.account_id=n.account_id AND c.claim_id=n.claim_id
 WHERE n.account_id=@account_id AND n.person_id=@actor_id AND (n.href='/my-skills' OR (dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=n.account_id AND o.person_id=c.person_id AND o.manager_id=@actor_id))) ORDER BY n.created_at DESC,n.notification_id;
END;
GO
GRANT EXECUTE ON dbo.ReadSkillClaimNotifications TO [skill_management_runtime];
GO
