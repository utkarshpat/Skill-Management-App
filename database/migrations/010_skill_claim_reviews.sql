-- Extend existing self-assessments with immutable submissions and assigned reviews.
DECLARE @constraint sysname;
SELECT @constraint=name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.SkillClaimDraft') AND definition LIKE '%status%';
IF @constraint IS NULL THROW 51000,'Existing claim status constraint missing.',1;
DECLARE @drop nvarchar(500)=N'ALTER TABLE dbo.SkillClaimDraft DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC(@drop);
ALTER TABLE dbo.SkillClaimDraft ADD projects nvarchar(2000) NOT NULL DEFAULT N'',evidence nvarchar(2000) NOT NULL DEFAULT N'',feedback nvarchar(2000) NOT NULL DEFAULT N'',reviewer_id uniqueidentifier NULL,submitted_at datetime2(7) NULL,reviewed_at datetime2(7) NULL;
ALTER TABLE dbo.SkillClaimDraft ADD CONSTRAINT CK_SkillClaim_Status CHECK(status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED','REJECTED'));
ALTER TABLE dbo.SkillClaimDraft ADD FOREIGN KEY(account_id,reviewer_id) REFERENCES dbo.AccessPerson(account_id,person_id);
CREATE INDEX IX_SkillClaim_Review ON dbo.SkillClaimDraft(account_id,reviewer_id,status,submitted_at);
CREATE TABLE dbo.SkillClaimNotification(
 notification_id uniqueidentifier NOT NULL DEFAULT NEWID(),account_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,claim_id uniqueidentifier NOT NULL,
 title nvarchar(100) NOT NULL,body nvarchar(300) NOT NULL,href varchar(30) NOT NULL,created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,notification_id),FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),FOREIGN KEY(account_id,claim_id) REFERENCES dbo.SkillClaimDraft(account_id,claim_id));
CREATE INDEX IX_SkillClaimNotification_Person ON dbo.SkillClaimNotification(account_id,person_id,created_at);
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
 SELECT claim_id AS id,revision,skill_id AS skillId,skill_name AS skillName,category,definition_revision AS definitionRevision,claimed_rank AS rank,level_name AS levelName,level_description AS levelDescription,experience_months AS experienceMonths,description,status,updated_at AS updatedAt,projects,evidence,feedback,reviewer_id AS reviewerId
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','revision','skillId','definitionRevision','rank','experienceMonths','description','projects','evidence')) THROW 51000,'Only editable draft fields accepted.',1;
 DECLARE @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),
 @definition int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.definitionRevision')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank')),
 @months int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.experienceMonths')),@description nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));
 IF @skill IS NULL OR @definition IS NULL OR @definition<1 OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 8 OR @months IS NULL OR @months NOT BETWEEN 0 AND 600 OR @description IS NULL OR LEN(@description)=0 OR DATALENGTH(@description)>4000 THROW 51000,'Invalid draft fields.',1;
 DECLARE @projects nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.projects'),N''),@evidence nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.evidence'),N'');
 IF DATALENGTH(@projects)>4000 OR DATALENGTH(@evidence)>4000 THROW 51000,'Evidence or projects too long.',1;
 DECLARE @current_definition int,@name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@criteria nvarchar(1000);
 SELECT @current_definition=s.definition_revision,@name=s.display_name,@category=s.category,@level=l.display_name,@criteria=l.description FROM dbo.SkillCatalogue s JOIN dbo.SkillProficiencyLevel l ON l.account_id=s.account_id AND l.skill_id=s.skill_id AND l.rank=@rank WHERE s.account_id=@account_id AND s.skill_id=@skill AND s.status='PUBLISHED';
 IF @current_definition IS NULL THROW 51004,'Published skill and level unavailable.',1;
 IF @definition<>@current_definition THROW 51009,'Definition changed.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id) THROW 51004,'Own draft unavailable.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id AND revision=@expected_revision AND status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')) THROW 51009,'Draft changed.',1;
 IF @expected_revision>0 AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND skill_id<>@skill) THROW 51000,'A draft cannot change its skill.',1;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @expected_revision=0
 BEGIN
 IF (SELECT COUNT(*) FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id)>=1000 THROW 51000,'Own draft limit reached.',1;
 INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description,projects,evidence)
 VALUES(@account_id,@claim_id,@actor_id,@skill,1,@definition,@name,@category,@rank,@level,@criteria,@months,@description,@projects,@evidence);
 END
 ELSE UPDATE dbo.SkillClaimDraft SET revision=revision+1,definition_revision=@definition,skill_name=@name,category=@category,claimed_rank=@rank,level_name=@level,level_description=@criteria,experience_months=@months,description=@description,projects=@projects,evidence=@evidence,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
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
GO

CREATE OR ALTER PROCEDURE dbo.TransitionSkillClaim
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@expected_revision int,@action varchar(20),@feedback nvarchar(2000)=N''
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @action IS NULL OR @action NOT IN ('SUBMIT','APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid action.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 DECLARE @owner uniqueidentifier,@reviewer uniqueidentifier,@manager uniqueidentifier,@revision int,@status varchar(20),@skill uniqueidentifier,@definition int,@before nvarchar(max),@after nvarchar(max);
 SELECT @owner=person_id,@reviewer=reviewer_id,@revision=revision,@status=status,@skill=skill_id,@definition=definition_revision FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id;
 IF @owner IS NULL THROW 51004,'Claim unavailable.',1;
 SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner;
 IF @action='SUBMIT'
 BEGIN
  IF @owner<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own submission denied.',1;
  IF @manager IS NULL OR @manager=@owner OR dbo.AccessCan(@account_id,@manager,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@manager,'profile.view',1)<>1 THROW 51011,'Reporting reviewer unavailable.',1;
  IF @status NOT IN ('DRAFT','CHANGES_REQUESTED','REJECTED') AND NOT (@status='SUBMITTED' AND @reviewer<>@manager) THROW 51010,'Submission state invalid.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@skill AND status='PUBLISHED' AND definition_revision=@definition) THROW 51009,'Definition changed.',1;
 END
 ELSE
 BEGIN
  IF @action NOT IN ('APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid decision.',1;
  IF @owner=@actor_id OR @reviewer IS NULL OR @reviewer<>@actor_id OR @manager IS NULL OR @manager<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@owner AND active=1) THROW 51003,'Assigned review denied.',1;
  IF @status<>'SUBMITTED' THROW 51010,'Claim is not awaiting review.',1;
  IF LEN(LTRIM(RTRIM(ISNULL(@feedback,N''))))=0 THROW 51000,'Feedback required.',1;
 END
 IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Claim changed.',1;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.SkillClaimDraft SET revision=revision+1,status=CASE @action WHEN 'SUBMIT' THEN 'SUBMITTED' WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REQUEST_CHANGES' THEN 'CHANGES_REQUESTED' ELSE 'REJECTED' END,
 reviewer_id=CASE WHEN @action='SUBMIT' THEN @manager ELSE reviewer_id END,
 feedback=CASE WHEN @action='SUBMIT' THEN N'' ELSE LTRIM(RTRIM(@feedback)) END,
 submitted_at=CASE WHEN @action='SUBMIT' THEN SYSUTCDATETIME() ELSE submitted_at END,reviewed_at=CASE WHEN @action='SUBMIT' THEN NULL ELSE SYSUTCDATETIME() END,updated_at=SYSUTCDATETIME()
 WHERE account_id=@account_id AND claim_id=@claim_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,CASE @action WHEN 'SUBMIT' THEN 'claim.submitted' WHEN 'APPROVE' THEN 'claim.approved' WHEN 'REQUEST_CHANGES' THEN 'claim.changes_requested' ELSE 'claim.rejected' END,@claim_id,@before,@after);
 INSERT dbo.SkillClaimNotification(account_id,person_id,claim_id,title,body,href) VALUES(@account_id,CASE WHEN @action='SUBMIT' THEN @manager ELSE @owner END,@claim_id,
 CASE @action WHEN 'SUBMIT' THEN 'Skill review requested' WHEN 'APPROVE' THEN 'Skill claim approved' WHEN 'REQUEST_CHANGES' THEN 'Changes requested' ELSE 'Skill claim rejected' END,
 CASE WHEN @action='SUBMIT' THEN 'A direct report submitted a skill claim for your review.' ELSE 'Your reporting manager reviewed your skill claim. Open My skills for feedback.' END,
 CASE WHEN @action='SUBMIT' THEN '/skill-reviews' ELSE '/my-skills' END);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadAssignedSkillReviews
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Review access denied.',1;
 SELECT c.claim_id INTO #visible FROM dbo.SkillClaimDraft c JOIN dbo.AccessOrgAssignment o ON o.account_id=c.account_id AND o.person_id=c.person_id JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1
 WHERE c.account_id=@account_id AND c.reviewer_id=@actor_id AND o.manager_id=@actor_id AND c.person_id<>@actor_id AND c.status='SUBMITTED';
 SELECT COUNT(*) AS total,CONVERT(bit,0) AS canClaim FROM #visible;
 SELECT c.claim_id AS id,c.revision,c.skill_id AS skillId,c.skill_name AS skillName,c.category,c.definition_revision AS definitionRevision,c.claimed_rank AS rank,c.level_name AS levelName,c.level_description AS levelDescription,c.experience_months AS experienceMonths,c.description,c.status,c.updated_at AS updatedAt,c.projects,c.evidence,c.feedback,c.reviewer_id AS reviewerId,p.display_name AS personName
 FROM dbo.SkillClaimDraft c JOIN #visible v ON v.claim_id=c.claim_id JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id WHERE c.account_id=@account_id ORDER BY c.submitted_at,c.claim_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadSkillClaimNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 SELECT TOP(30) CONVERT(varchar(36),n.notification_id) AS id,n.created_at AS at,n.title,n.body,n.href FROM dbo.SkillClaimNotification n JOIN dbo.SkillClaimDraft c ON c.account_id=n.account_id AND c.claim_id=n.claim_id
 WHERE n.account_id=@account_id AND n.person_id=@actor_id AND (n.href='/my-skills' OR (dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o WHERE o.account_id=n.account_id AND o.person_id=c.person_id AND o.manager_id=@actor_id))) ORDER BY n.created_at DESC,n.notification_id;
END;
GO
GRANT EXECUTE ON dbo.TransitionSkillClaim TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadAssignedSkillReviews TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadSkillClaimNotifications TO [skill_management_runtime];
