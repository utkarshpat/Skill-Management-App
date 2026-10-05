-- Bounded actor-owned claims for currently available skill-linked learning plans.
-- Caller supplies no person, workspace, plan or skill selector.
CREATE OR ALTER PROCEDURE dbo.ReadOwnGrowthClaims
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 THROW 51003,'Growth journey denied.',1;
 DECLARE @skills TABLE(skill_id uniqueidentifier PRIMARY KEY);
 INSERT @skills SELECT DISTINCT TRY_CONVERT(uniqueidentifier,JSON_VALUE(payload,'$.skillId')) FROM
 (SELECT TOP(50) payload FROM dbo.LearningPlan WHERE account_id=@account_id AND person_id=@actor_id AND status<>'ARCHIVED' ORDER BY updated_at DESC,plan_id) p
 WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(payload,'$.skillId')) IS NOT NULL;
 SELECT d.*,ROW_NUMBER() OVER(PARTITION BY d.skill_id ORDER BY d.updated_at DESC,d.claim_id) AS latest INTO #claims
 FROM dbo.SkillClaimDraft d JOIN @skills s ON s.skill_id=d.skill_id WHERE d.account_id=@account_id AND d.person_id=@actor_id;
 SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canClaim FROM #claims WHERE latest=1;
 SELECT claim_id AS id,revision,skill_id AS skillId,skill_name AS skillName,category,definition_revision AS definitionRevision,claimed_rank AS rank,level_name AS levelName,level_description AS levelDescription,experience_months AS experienceMonths,CONVERT(char(10),last_used_on,23) AS lastUsedOn,description,status,updated_at AS updatedAt,projects,evidence,feedback,reviewer_id AS reviewerId FROM #claims WHERE latest=1 ORDER BY updated_at DESC,claim_id;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOwnGrowthClaims TO [skill_management_runtime];
