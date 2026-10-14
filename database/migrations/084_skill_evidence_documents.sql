-- PDF and image skill evidence; account/reviewer/submission checks remain unchanged.
IF COL_LENGTH('dbo.SkillClaimEvidence','mime_type') IS NULL BEGIN
 ALTER TABLE dbo.SkillClaimEvidence ADD mime_type varchar(100) NOT NULL CONSTRAINT DF_SkillEvidenceMime084 DEFAULT 'image/webp',file_name nvarchar(255) NOT NULL CONSTRAINT DF_SkillEvidenceName084 DEFAULT N'evidence.webp';
 ALTER TABLE dbo.SkillClaimEvidence ALTER COLUMN width int NULL;
 ALTER TABLE dbo.SkillClaimEvidence ALTER COLUMN height int NULL;
 DECLARE @oldBytes sysname;
 SELECT @oldBytes=name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.SkillClaimEvidence') AND definition LIKE '%bytes%';
 IF @oldBytes IS NULL THROW 51000,'Expected evidence size constraint missing.',1;
 DECLARE @dropSql nvarchar(max)=N'ALTER TABLE dbo.SkillClaimEvidence DROP CONSTRAINT '+QUOTENAME(@oldBytes);
 EXEC sys.sp_executesql @dropSql;
 EXEC(N'ALTER TABLE dbo.SkillClaimEvidence ADD CONSTRAINT CK_SkillEvidenceContent084 CHECK(
  mime_type=''image/webp'' AND bytes BETWEEN 1 AND 1048576 AND width IS NOT NULL AND height IS NOT NULL
  OR mime_type=''application/pdf'' AND bytes BETWEEN 1 AND 10485760 AND width IS NULL AND height IS NULL);');
END;
GO
-- Workspace audit revisions, not timestamps, bind images to the latest submission.
CREATE OR ALTER PROCEDURE dbo.SkillEvidence
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@operation varchar(8)='READ',
 @expected_revision int=NULL,@evidence_id uniqueidentifier=NULL,@blob_name varchar(160)=NULL,@bytes int=NULL,@width int=NULL,@height int=NULL,@mime_type varchar(100)='image/webp',@file_name nvarchar(255)=N'evidence.webp'
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @operation IS NULL OR @operation NOT IN ('READ','CHECK','ADD') THROW 51000,'Invalid evidence operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@owner uniqueidentifier,@state varchar(20),@revision int,@can_upload bit=0,@submission int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 SELECT @owner=person_id,@state=status,@revision=revision FROM dbo.SkillClaimDraft WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND claim_id=@claim_id;
 IF @owner IS NULL THROW 51004,'Claim unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 IF @owner=@actor_id BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Own skill access denied.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND @state IN ('DRAFT','CHANGES_REQUESTED','REJECTED') SET @can_upload=1;
 END ELSE BEGIN
  IF dbo.AccessCanReviewClaim(@account_id,@actor_id,@claim_id,0)<>1 THROW 51003,'Assigned evidence unavailable.',1;
  SELECT @submission=MAX(revision) FROM dbo.AccessAudit WHERE account_id=@account_id AND target_id=@claim_id AND action='claim.submitted';
  IF @submission IS NULL THROW 51004,'Submitted evidence history unavailable.',1;
 END;
 IF @operation IN ('CHECK','ADD') BEGIN
  IF @can_upload<>1 THROW 51003,'Evidence upload unavailable.',1;
  IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Claim changed. Refresh before uploading.',1;
  IF (SELECT COUNT(*) FROM dbo.SkillClaimEvidence WHERE account_id=@account_id AND claim_id=@claim_id)>=6 THROW 51000,'Maximum six files per claim.',1;
 END;
 IF @operation='ADD' BEGIN
  DECLARE @extension varchar(4)=CASE @mime_type WHEN 'image/webp' THEN 'webp' WHEN 'application/pdf' THEN 'pdf' END;
  IF @extension IS NULL OR NULLIF(LTRIM(RTRIM(@file_name)),N'') IS NULL THROW 51000,'Invalid evidence file metadata.',1;
  IF @evidence_id IS NULL OR @blob_name IS NULL OR @blob_name<>LOWER(CONVERT(varchar(36),@account_id)+'/'+CONVERT(varchar(36),@claim_id)+'/'+CONVERT(varchar(36),@evidence_id)+'.'+@extension) THROW 51000,'Invalid evidence reference.',1;
  INSERT dbo.SkillClaimEvidence(account_id,claim_id,evidence_id,blob_name,bytes,width,height,mime_type,file_name) VALUES(@account_id,@claim_id,@evidence_id,@blob_name,@bytes,@width,@height,@mime_type,@file_name);
  UPDATE dbo.SkillClaimDraft SET revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace+1,@actor_id,'claim.evidence.added',@claim_id,(SELECT @evidence_id AS evidenceId,@bytes AS bytes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SET @revision=@revision+1;
 END;
 SELECT @revision AS revision,@can_upload AS canUpload;
 SELECT e.evidence_id AS id,e.blob_name AS blobName,e.bytes,e.width,e.height,e.mime_type AS mimeType,e.file_name AS fileName
 FROM dbo.SkillClaimEvidence e WHERE e.account_id=@account_id AND e.claim_id=@claim_id
 AND (@owner=@actor_id OR EXISTS(
  SELECT 1 FROM dbo.AccessAudit a WHERE a.account_id=e.account_id AND a.target_id=e.claim_id
  AND a.action='claim.evidence.added' AND a.revision<@submission
  AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(a.after_json,'$.evidenceId'))=e.evidence_id
 ))
 ORDER BY e.created_at,e.evidence_id;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SkillEvidence TO [skill_management_runtime];

DECLARE @definition nvarchar(max),@old nvarchar(500)=N'''image/webp'' AS mimeType,''evidence.webp'' AS fileName',@new nvarchar(500)=N'e.mime_type AS mimeType,e.file_name AS fileName';
DECLARE evidenceConsumers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES('CapabilitySubmissionWorkspace'),('BusinessRecordFiles')) objects(name);
DECLARE @name sysname;OPEN evidenceConsumers;FETCH NEXT FROM evidenceConsumers INTO @name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@name));
 IF @definition IS NULL OR (CHARINDEX(@old,@definition)=0 AND CHARINDEX(@new,@definition)=0) THROW 51000,'Expected evidence snapshot definition missing.',1;
 SET @definition=REPLACE(@definition,@old,@new);
 DECLARE @procedureStart int=CHARINDEX('PROCEDURE',UPPER(@definition));
 IF @procedureStart=0 THROW 51000,'Expected procedure declaration missing.',1;
 SET @definition=STUFF(@definition,1,@procedureStart-1,N'CREATE OR ALTER ');
 EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM evidenceConsumers INTO @name;
END;CLOSE evidenceConsumers;DEALLOCATE evidenceConsumers;
GO




