-- Experience descriptions are optional; keep all owner, revision and workflow checks.
DECLARE @constraint sysname;
SELECT @constraint=name FROM sys.check_constraints
WHERE parent_object_id=OBJECT_ID(N'dbo.SkillClaimDraft')
AND definition LIKE N'%description%' AND definition LIKE N'%LTRIM%' AND definition LIKE N'%LEN%';
IF @constraint IS NOT NULL
BEGIN
 DECLARE @ddl nvarchar(max)=N'ALTER TABLE dbo.SkillClaimDraft DROP CONSTRAINT '+QUOTENAME(@constraint);
 EXEC sys.sp_executesql @ddl;
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
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','revision','skillId','definitionRevision','rank','experienceMonths','lastUsedOn','description','projects','evidence')) THROW 51000,'Only editable draft fields accepted.',1;
 DECLARE @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),
 @definition int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.definitionRevision')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank')),
 @months int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.experienceMonths')),@description nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));
 IF @skill IS NULL OR @definition IS NULL OR @definition<1 OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 8 OR @months IS NULL OR @months NOT BETWEEN 0 AND 600 OR @description IS NULL OR DATALENGTH(@description)>4000 THROW 51000,'Invalid draft fields.',1;
 DECLARE @projects nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.projects'),N''),@evidence nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.evidence'),N'');
 IF DATALENGTH(@projects)>4000 OR DATALENGTH(@evidence)>4000 THROW 51000,'Evidence or projects too long.',1;
 DECLARE @last_used_text nvarchar(max),@last_used date;
 IF (SELECT COUNT(*) FROM OPENJSON(@payload) WHERE [key]='lastUsedOn')>1 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='lastUsedOn' AND [type] NOT IN (0,1)) THROW 51000,'Invalid last-used date.',1;
 SELECT @last_used_text=[value] FROM OPENJSON(@payload) WHERE [key]='lastUsedOn' AND [type]=1;
 IF @last_used_text IS NOT NULL
 BEGIN
  SET @last_used=TRY_CONVERT(date,@last_used_text,23);
  IF @last_used IS NULL OR DATALENGTH(@last_used_text)<>20 OR CONVERT(nvarchar(10),@last_used,23)<>@last_used_text OR @last_used>CONVERT(date,SYSUTCDATETIME()) THROW 51000,'Last used must be a real date on or before today (UTC).',1;
 END;
 DECLARE @current_definition int,@name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@criteria nvarchar(1000);
 SELECT @current_definition=s.definition_revision,@name=s.display_name,@category=s.category,@level=l.display_name,@criteria=l.description FROM dbo.SkillCatalogue s JOIN dbo.SkillProficiencyLevel l ON l.account_id=s.account_id AND l.skill_id=s.skill_id AND l.rank=@rank WHERE s.account_id=@account_id AND s.skill_id=@skill AND s.status='PUBLISHED';
 IF @current_definition IS NULL THROW 51004,'Published skill and level unavailable.',1;
 IF @definition<>@current_definition THROW 51009,'Definition changed.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id) THROW 51004,'Own draft unavailable.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id AND revision=@expected_revision AND status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')) THROW 51009,'Draft changed.',1;
 IF @expected_revision>0 AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND skill_id<>@skill) THROW 51000,'A draft cannot change its skill.',1;
 -- Older clients omit this field; omission preserves it, explicit null clears it.
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='lastUsedOn')
  SELECT @last_used=last_used_on FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @expected_revision=0
 BEGIN
 IF (SELECT COUNT(*) FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id)>=1000 THROW 51000,'Own draft limit reached.',1;
 INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,last_used_on,description,projects,evidence)
 VALUES(@account_id,@claim_id,@actor_id,@skill,1,@definition,@name,@category,@rank,@level,@criteria,@months,@last_used,@description,@projects,@evidence);
 END
 ELSE UPDATE dbo.SkillClaimDraft SET revision=revision+1,definition_revision=@definition,skill_name=@name,category=@category,claimed_rank=@rank,level_name=@level,level_description=@criteria,experience_months=@months,last_used_on=@last_used,description=@description,projects=@projects,evidence=@evidence,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,CASE @expected_revision WHEN 0 THEN 'claim.draft.created' ELSE 'claim.draft.updated' END,@claim_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
