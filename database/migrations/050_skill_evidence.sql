CREATE TABLE dbo.SkillClaimEvidence(
 account_id uniqueidentifier NOT NULL,claim_id uniqueidentifier NOT NULL,evidence_id uniqueidentifier NOT NULL,
 blob_name varchar(160) NOT NULL,bytes int NOT NULL,width int NOT NULL,height int NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,claim_id,evidence_id),FOREIGN KEY(account_id,claim_id) REFERENCES dbo.SkillClaimDraft(account_id,claim_id),
 CHECK(bytes BETWEEN 1 AND 1048576),CHECK(width BETWEEN 1 AND 1920),CHECK(height BETWEEN 1 AND 1920));
GO
CREATE OR ALTER PROCEDURE dbo.SkillEvidence
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@operation varchar(8)='READ',
 @expected_revision int=NULL,@evidence_id uniqueidentifier=NULL,@blob_name varchar(160)=NULL,@bytes int=NULL,@width int=NULL,@height int=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @operation IS NULL OR @operation NOT IN ('READ','CHECK','ADD') THROW 51000,'Invalid evidence operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@owner uniqueidentifier,@state varchar(20),@revision int,@can_upload bit=0;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 SELECT @owner=person_id,@state=status,@revision=revision FROM dbo.SkillClaimDraft WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND claim_id=@claim_id;
 IF @owner IS NULL THROW 51004,'Claim unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 IF @owner=@actor_id BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Own skill access denied.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND @state IN ('DRAFT','CHANGES_REQUESTED','REJECTED') SET @can_upload=1;
 END ELSE IF dbo.AccessCanReviewClaim(@account_id,@actor_id,@claim_id,0)<>1 THROW 51003,'Assigned evidence unavailable.',1;
 IF @operation IN ('CHECK','ADD') BEGIN
  IF @can_upload<>1 THROW 51003,'Evidence upload unavailable.',1;
  IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Claim changed. Refresh before uploading.',1;
  IF (SELECT COUNT(*) FROM dbo.SkillClaimEvidence WHERE account_id=@account_id AND claim_id=@claim_id)>=6 THROW 51000,'Maximum six images per claim.',1;
 END;
 IF @operation='ADD' BEGIN
  IF @evidence_id IS NULL OR @blob_name IS NULL OR @blob_name<>LOWER(CONVERT(varchar(36),@account_id)+'/'+CONVERT(varchar(36),@claim_id)+'/'+CONVERT(varchar(36),@evidence_id)+'.webp') THROW 51000,'Invalid evidence reference.',1;
  INSERT dbo.SkillClaimEvidence(account_id,claim_id,evidence_id,blob_name,bytes,width,height) VALUES(@account_id,@claim_id,@evidence_id,@blob_name,@bytes,@width,@height);
  UPDATE dbo.SkillClaimDraft SET revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace+1,@actor_id,'claim.evidence.added',@claim_id,(SELECT @evidence_id AS evidenceId,@bytes AS bytes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SET @revision=@revision+1;
 END;
 SELECT @revision AS revision,@can_upload AS canUpload;
 SELECT evidence_id AS id,blob_name AS blobName,bytes,width,height FROM dbo.SkillClaimEvidence WHERE account_id=@account_id AND claim_id=@claim_id ORDER BY created_at,evidence_id;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SkillEvidence TO [skill_management_runtime];
