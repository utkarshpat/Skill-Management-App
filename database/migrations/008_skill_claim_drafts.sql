-- Own skill drafts are self-assessments, never verified skills or manager submissions.
CREATE TABLE dbo.SkillClaimDraft (
 account_id uniqueidentifier NOT NULL, claim_id uniqueidentifier NOT NULL,
 person_id uniqueidentifier NOT NULL, skill_id uniqueidentifier NOT NULL,
 revision int NOT NULL CHECK(revision>0), definition_revision int NOT NULL CHECK(definition_revision>0),
 skill_name nvarchar(100) NOT NULL, category nvarchar(80) NOT NULL,
 claimed_rank tinyint NOT NULL CHECK(claimed_rank BETWEEN 1 AND 8),
 level_name nvarchar(60) NOT NULL, level_description nvarchar(1000) NOT NULL,
 experience_months smallint NOT NULL CHECK(experience_months BETWEEN 0 AND 600),
 description nvarchar(2000) NOT NULL CHECK(LEN(LTRIM(RTRIM(description)))>0),
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
 updated_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,claim_id), UNIQUE(account_id,person_id,skill_id),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 FOREIGN KEY(account_id,skill_id) REFERENCES dbo.SkillCatalogue(account_id,skill_id)
);
CREATE INDEX IX_SkillClaimDraft_Person ON dbo.SkillClaimDraft(account_id,person_id,updated_at);
GO
CREATE OR ALTER PROCEDURE dbo.ReadOwnSkillClaims
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Own profile access denied.',1;
 SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canClaim FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT claim_id AS id,revision,skill_id AS skillId,skill_name AS skillName,category,definition_revision AS definitionRevision,claimed_rank AS rank,level_name AS levelName,level_description AS levelDescription,experience_months AS experienceMonths,description,status,updated_at AS updatedAt
 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id ORDER BY updated_at DESC,claim_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadClaimSkills
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own skill claim access denied.',1;
 DECLARE @visible TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @visible SELECT skill_id FROM dbo.SkillCatalogue WHERE account_id=@account_id AND status='PUBLISHED' AND (CHARINDEX(ISNULL(@query,N''),display_name)>0 OR CHARINDEX(ISNULL(@query,N''),category)>0);
 SELECT COUNT(*) AS total FROM @visible;
 DECLARE @paged TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @paged SELECT s.skill_id FROM dbo.SkillCatalogue s JOIN @visible v ON v.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 SELECT s.skill_id AS id,s.display_name AS name,s.category,s.definition_revision AS definitionRevision FROM dbo.SkillCatalogue s JOIN @paged p ON p.id=s.skill_id WHERE s.account_id=@account_id ORDER BY s.display_name,s.skill_id;
 SELECT l.skill_id AS skillId,l.rank,l.display_name AS name,l.description FROM dbo.SkillProficiencyLevel l JOIN @paged p ON p.id=l.skill_id WHERE l.account_id=@account_id ORDER BY l.skill_id,l.rank;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.SaveOwnSkillClaim
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@expected_revision int,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own skill claim access denied.',1;
 IF @claim_id IS NULL OR @expected_revision IS NULL OR @expected_revision<0 OR ISJSON(@payload)<>1 THROW 51000,'Invalid draft.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','revision','skillId','definitionRevision','rank','experienceMonths','description')) THROW 51000,'Only editable draft fields accepted.',1;
 DECLARE @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),
 @definition int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.definitionRevision')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank')),
 @months int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.experienceMonths')),@description nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));
 IF @skill IS NULL OR @definition IS NULL OR @definition<1 OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 8 OR @months IS NULL OR @months NOT BETWEEN 0 AND 600 OR @description IS NULL OR LEN(@description)=0 OR DATALENGTH(@description)>4000 THROW 51000,'Invalid draft fields.',1;
 DECLARE @current_definition int,@name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@criteria nvarchar(1000);
 SELECT @current_definition=s.definition_revision,@name=s.display_name,@category=s.category,@level=l.display_name,@criteria=l.description FROM dbo.SkillCatalogue s JOIN dbo.SkillProficiencyLevel l ON l.account_id=s.account_id AND l.skill_id=s.skill_id AND l.rank=@rank WHERE s.account_id=@account_id AND s.skill_id=@skill AND s.status='PUBLISHED';
 IF @current_definition IS NULL THROW 51004,'Published skill and level unavailable.',1;
 IF @definition<>@current_definition THROW 51009,'Definition changed.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id) THROW 51004,'Own draft unavailable.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id AND revision=@expected_revision AND status='DRAFT') THROW 51009,'Draft changed.',1;
 IF @expected_revision>0 AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND skill_id<>@skill) THROW 51000,'A draft cannot change its skill.',1;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @expected_revision=0
 BEGIN
 IF (SELECT COUNT(*) FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id)>=1000 THROW 51000,'Own draft limit reached.',1;
 INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description)
 VALUES(@account_id,@claim_id,@actor_id,@skill,1,@definition,@name,@category,@rank,@level,@criteria,@months,@description);
 END
 ELSE UPDATE dbo.SkillClaimDraft SET revision=revision+1,definition_revision=@definition,skill_name=@name,category=@category,claimed_rank=@rank,level_name=@level,level_description=@criteria,experience_months=@months,description=@description,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,CASE @expected_revision WHEN 0 THEN 'claim.draft.created' ELSE 'claim.draft.updated' END,@claim_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadOwnSkillClaims TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadClaimSkills TO [skill_management_runtime];
GRANT EXECUTE ON dbo.SaveOwnSkillClaim TO [skill_management_runtime];
