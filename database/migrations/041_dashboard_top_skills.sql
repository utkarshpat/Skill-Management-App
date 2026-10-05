-- Top skills come from all own reviewed claims, not the recent/paginated preview.
CREATE OR ALTER PROCEDURE dbo.ReadOwnSkillSummary
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Own skill access denied.',1;
 SELECT COUNT(*) AS total,COUNT(CASE WHEN status='APPROVED' THEN 1 END) AS verified,
 COUNT(CASE WHEN status='SUBMITTED' THEN 1 END) AS pending,
 COUNT(CASE WHEN status='DRAFT' THEN 1 END) AS draft,
 COUNT(CASE WHEN status='CHANGES_REQUESTED' THEN 1 END) AS changesRequested,
 COUNT(CASE WHEN status='REJECTED' THEN 1 END) AS rejected
 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT TOP(6) c.claim_id AS id,c.skill_name AS skillName,c.category,c.claimed_rank AS rank,c.level_name AS levelName,
 (SELECT MAX(v.rank) FROM dbo.SkillVersionCriterion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision) AS maxRank
 FROM dbo.SkillClaimDraft c
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
 ORDER BY c.claimed_rank DESC,c.skill_name,c.claim_id;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOwnSkillSummary TO [skill_management_runtime];
GO
