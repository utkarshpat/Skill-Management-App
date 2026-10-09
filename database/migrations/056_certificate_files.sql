ALTER TABLE dbo.CertificationImageRecord
 ADD mime_type varchar(100) NOT NULL CONSTRAINT DF_CertificationImageRecord_mime_type DEFAULT('image/webp'),
     file_name nvarchar(255) NOT NULL CONSTRAINT DF_CertificationImageRecord_file_name DEFAULT(N'certificate.webp');
GO
DECLARE @bytesConstraint sysname,@dropConstraint nvarchar(500);
SELECT TOP (1) @bytesConstraint=name FROM sys.check_constraints
WHERE parent_object_id=OBJECT_ID(N'dbo.CertificationImageRecord') AND definition LIKE N'%bytes%';
IF @bytesConstraint IS NOT NULL BEGIN
 SET @dropConstraint=N'ALTER TABLE dbo.CertificationImageRecord DROP CONSTRAINT '+QUOTENAME(@bytesConstraint);
 EXEC sys.sp_executesql @dropConstraint;
END;
GO
ALTER TABLE dbo.CertificationImageRecord ALTER COLUMN width int NULL;
ALTER TABLE dbo.CertificationImageRecord ALTER COLUMN height int NULL;
GO
ALTER TABLE dbo.CertificationImageRecord ADD CONSTRAINT CK_CertificationImageRecord_file
 CHECK(bytes BETWEEN 1 AND 5242880 AND
   mime_type IN('image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain') AND
   ((mime_type='image/webp' AND width BETWEEN 1 AND 1920 AND height BETWEEN 1 AND 1920) OR
    (mime_type<>'image/webp' AND width IS NULL AND height IS NULL)));
GO
CREATE OR ALTER PROCEDURE dbo.CertificationImage
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@operation varchar(8)='READ',
 @expected_revision int=NULL,@evidence_id uniqueidentifier=NULL,@blob_name varchar(160)=NULL,@bytes int=NULL,@width int=NULL,@height int=NULL,
 @mime_type varchar(100)=NULL,@file_name nvarchar(255)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @operation IS NULL OR @operation NOT IN('READ','CHECK','ADD','REMOVE') THROW 51000,'Invalid image operation.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@owner uniqueidentifier,@status varchar(20),@revision int,@can_upload bit=0,@before nvarchar(max);
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 SELECT @owner=person_id,@status=status,@revision=revision FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@claim_id;
 IF @owner IS NULL THROW 51004,'Certification unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Certification access denied.',1;
 IF @owner=@actor_id BEGIN
  IF dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 AND @status IN('DRAFT','CHANGES_REQUESTED','REJECTED') SET @can_upload=1;
 END ELSE IF dbo.CertificationCanReview(@account_id,@actor_id,@claim_id)<>1 THROW 51003,'Assigned file unavailable.',1;
 IF @operation IN('CHECK','ADD','REMOVE') BEGIN
  IF @can_upload<>1 THROW 51003,'File changes unavailable.',1;
  IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Certification changed.',1;
 END;
 IF @operation IN('ADD','REMOVE') BEGIN
  SELECT @before=(SELECT evidence_id AS fileId,mime_type AS mimeType,bytes FROM dbo.CertificationImageRecord WHERE account_id=@account_id AND certification_id=@claim_id AND active=1 FOR JSON PATH);
  IF @operation='ADD' AND (@evidence_id IS NULL OR @blob_name IS NULL OR @blob_name<>LOWER(CONVERT(varchar(36),@account_id)+'/certifications/'+CONVERT(varchar(36),@claim_id)+'/'+CONVERT(varchar(36),@evidence_id))
   OR @bytes IS NULL OR @bytes NOT BETWEEN 1 AND 5242880
   OR @mime_type NOT IN('image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')
   OR @file_name IS NULL OR LEN(@file_name)=0 OR LEN(@file_name)>255
   OR @mime_type='image/webp' AND (@width IS NULL OR @width NOT BETWEEN 1 AND 1920 OR @height IS NULL OR @height NOT BETWEEN 1 AND 1920)
   OR @mime_type<>'image/webp' AND (@width IS NOT NULL OR @height IS NOT NULL)) THROW 51000,'Invalid certificate file.',1;
  UPDATE dbo.CertificationImageRecord SET active=0 WHERE account_id=@account_id AND certification_id=@claim_id AND active=1;
  IF @operation='ADD' INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,width,height,mime_type,file_name)
   VALUES(@account_id,@claim_id,@evidence_id,@blob_name,@bytes,@width,@height,@mime_type,@file_name);
  UPDATE dbo.CertificationRecord SET revision=revision+1,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND id=@claim_id;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,CASE @operation WHEN 'ADD' THEN 'certification.file.saved' ELSE 'certification.file.removed' END,@claim_id,@before,(SELECT @evidence_id AS fileId,@mime_type AS mimeType,@bytes AS bytes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  SET @revision=@revision+1;
 END;
 SELECT @revision AS revision,@can_upload AS canUpload;
 SELECT evidence_id AS id,blob_name AS blobName,bytes,width,height,mime_type AS mimeType,file_name AS fileName
 FROM dbo.CertificationImageRecord WHERE account_id=@account_id AND certification_id=@claim_id AND active=1;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.CertificationImage TO [skill_management_runtime];
