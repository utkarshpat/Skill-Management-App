-- Published-only category discovery; existing unfiltered callers remain compatible.
CREATE OR ALTER PROCEDURE dbo.ReadClaimSkills
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1,@category nvarchar(80)=N'',@page_size int=25
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page_size IS NULL OR @page_size<1 OR @page_size>25 OR @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own skill claim access denied.',1;
 DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @visible SELECT skill_id FROM dbo.SkillCatalogue WHERE account_id=@account_id AND status='PUBLISHED' AND (ISNULL(@category,N'')=N'' OR category=@category) AND (ISNULL(@query,N'')=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,category)>0);
 SELECT COUNT(*) AS total FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*@page_size) ROWS FETCH NEXT @page_size ROWS ONLY;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.description,s.business_code AS businessCode,s.definition_revision AS definitionRevision FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 SELECT TOP(100) category AS name,COUNT(*) AS count FROM dbo.SkillCatalogue WHERE account_id=@account_id AND status='PUBLISHED' GROUP BY category ORDER BY category;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadClaimSkills TO [skill_management_runtime];
