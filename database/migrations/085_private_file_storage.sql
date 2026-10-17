-- Provider-neutral private-file registry. Binary columns are never joined into list projections.
CREATE TABLE dbo.PrivateFileCounter(
 account_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,kind varchar(12) NOT NULL,
 last_number bigint NOT NULL CHECK(last_number>0),PRIMARY KEY(account_id,person_id,kind),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),CHECK(kind IN('cert','evidence')));
CREATE TABLE dbo.PrivateFileObject(
 account_id uniqueidentifier NOT NULL,file_id uniqueidentifier NOT NULL,object_key varchar(160) NOT NULL,
 person_id uniqueidentifier NOT NULL,provider varchar(12) NOT NULL CHECK(provider IN('sql','azure-blob')),
 bytes int NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),sha256 binary(32) NOT NULL,
 file_name nvarchar(255) NOT NULL,original_name nvarchar(255) NOT NULL,mime_type varchar(100) NOT NULL,
 content varbinary(max) NULL,created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,file_id),UNIQUE(account_id,object_key),
 FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK(provider='sql' AND content IS NOT NULL AND DATALENGTH(content)=bytes OR provider='azure-blob' AND content IS NULL));
CREATE TABLE dbo.PrivateUploadPart(
 account_id uniqueidentifier NOT NULL,actor_id uniqueidentifier NOT NULL,binding binary(32) NOT NULL,
 part_index int NOT NULL CHECK(part_index BETWEEN 0 AND 3),part_count int NOT NULL CHECK(part_count BETWEEN 1 AND 4),
 total_bytes int NOT NULL CHECK(total_bytes BETWEEN 1 AND 10485760),content varbinary(max) NOT NULL,
 sha256 binary(32) NOT NULL,created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,actor_id,binding,part_index),FOREIGN KEY(account_id,actor_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CHECK(DATALENGTH(content) BETWEEN 1 AND 3145728));
GO
CREATE OR ALTER FUNCTION dbo.PrivateFileNameToken(@value nvarchar(200)) RETURNS nvarchar(100) AS BEGIN
 DECLARE @out nvarchar(100)=N'',@i int=1,@c nchar(1);
 WHILE @i<=LEN(@value) AND LEN(@out)<100 BEGIN
  SET @c=SUBSTRING(@value,@i,1);
  IF @c COLLATE Latin1_General_100_BIN2 LIKE N'[A-Za-z0-9_-]' SET @out=@out+@c;
  ELSE IF RIGHT(@out,1)<>N'_' SET @out=@out+N'_';
  SET @i=@i+1;
 END;
 RETURN CASE WHEN LEN(@out)=0 THEN N'employee' ELSE @out END;
END;
GO
-- Add an optional output of the SAME authorized metadata; existing result sets and policies remain intact.
DECLARE @name sysname,@definition nvarchar(max),@pos int,@start int,@finish int,@query nvarchar(max),@needle nvarchar(200);
DECLARE files CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES('SkillEvidence'),('CertificationImage'),('CapabilityIntakeFiles'),('CapabilitySubmissionFiles'),('BusinessRecordFiles')) names(name);
OPEN files;FETCH NEXT FROM files INTO @name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID(N'dbo.'+@name));
 IF @definition IS NULL OR @definition LIKE N'%@private_manifest%' THROW 51000,'Unexpected private-file metadata procedure version.',1;
 -- SQL stores CREATE headers with varying whitespace after earlier ALTERs.
 SET @start=CHARINDEX(N'PROCEDURE',@definition);
 IF @start=0 THROW 51000,'Private-file procedure declaration missing.',1;
 SET @definition=N'ALTER '+SUBSTRING(@definition,@start,LEN(@definition));
 SET @pos=CHARINDEX(N'AS BEGIN',@definition);
 IF @pos=0 SET @pos=CHARINDEX(N'AS'+CHAR(13)+CHAR(10)+N'BEGIN',@definition);
 IF @pos=0 SET @pos=CHARINDEX(N'AS'+CHAR(10)+N'BEGIN',@definition);
 IF @pos=0 THROW 51000,'Private-file metadata header missing.',1;
 SET @definition=STUFF(@definition,@pos,0,N',@private_manifest nvarchar(max)=NULL OUTPUT '+CHAR(10));
 IF @name IN('SkillEvidence','CertificationImage') BEGIN
  SET @needle=CASE WHEN @name='SkillEvidence' THEN N'SELECT e.evidence_id AS id,e.blob_name AS blobName' ELSE N'SELECT evidence_id AS id,blob_name AS blobName' END;
  SET @start=CHARINDEX(@needle,@definition);
  SET @finish=CHARINDEX(N';',@definition,@start);
  IF @start=0 OR @finish=0 THROW 51000,'Private-file authorized projection missing.',1;
  SET @query=SUBSTRING(@definition,@start,@finish-@start);
  SET @definition=STUFF(@definition,@finish+1,0,CHAR(10)+N'IF @private_manifest IS NOT NULL SET @private_manifest=(SELECT JSON_QUERY(('+@query+N' FOR JSON PATH)) AS items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);'+CHAR(10));
 END ELSE BEGIN
  IF CHARINDEX(N'SELECT (SELECT',@definition)=0 OR CHARINDEX(N') AS json;',@definition)=0 THROW 51000,'Private-file JSON projection missing.',1;
  SET @definition=REPLACE(@definition,N'SELECT (SELECT',N'SET @private_manifest=(SELECT');
  SET @definition=REPLACE(@definition,N') AS json;',N'); SELECT @private_manifest AS json;');
 END;
 EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM files INTO @name;
END;
CLOSE files;DEALLOCATE files;
GO
CREATE OR ALTER PROCEDURE dbo.SavePrivateFile
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@context varchar(20),@record_id uniqueidentifier,
 @submission_id uniqueidentifier=NULL,@expected_revision int,@file_id uniqueidentifier,@provider varchar(12),
 @bytes int,@sha256 binary(32),@mime_type varchar(100),@original_name nvarchar(255),
 @content varbinary(max)=NULL,@width int=NULL,@height int=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @context IS NULL OR @context NOT IN('skill','certification','intake') OR @provider IS NULL OR @provider NOT IN('sql','azure-blob') OR @bytes IS NULL OR @bytes<1 OR @bytes>CASE WHEN @context='skill' THEN 10485760 ELSE 5242880 END
  OR @sha256 IS NULL OR @original_name IS NULL OR @file_id IS NULL OR @expected_revision IS NULL
  OR @provider='sql' AND (@content IS NULL OR DATALENGTH(@content)<>@bytes OR HASHBYTES('SHA2_256',@content)<>@sha256)
  OR @provider='azure-blob' AND @content IS NOT NULL THROW 51000,'Invalid private file.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int,@employee nvarchar(40),@person nvarchar(100),@number bigint,@kind varchar(12)=CASE WHEN @context='skill' THEN 'evidence' ELSE 'cert' END;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 SELECT @employee=employee_code,@person=display_name FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1;
 IF @workspace IS NULL OR @person IS NULL OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'File upload denied.',1;
 -- The existing ADD procedure performs the exact owner/editable/revision checks atomically below.
 IF EXISTS(SELECT 1 FROM dbo.PrivateFileObject WHERE account_id=@account_id AND file_id=@file_id) THROW 51009,'Immutable file ID already exists.',1;
 SELECT @number=last_number+1 FROM dbo.PrivateFileCounter WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND person_id=@actor_id AND kind=@kind;
 IF @number IS NULL BEGIN SET @number=1;INSERT dbo.PrivateFileCounter VALUES(@account_id,@actor_id,@kind,@number);END
 ELSE UPDATE dbo.PrivateFileCounter SET last_number=@number WHERE account_id=@account_id AND person_id=@actor_id AND kind=@kind;
 DECLARE @extension varchar(5)=CASE @mime_type WHEN 'image/webp' THEN 'webp' WHEN 'application/pdf' THEN 'pdf' WHEN 'text/plain' THEN 'txt' WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx' END;
 IF @extension IS NULL THROW 51000,'Unsupported private file type.',1;
 DECLARE @name nvarchar(255)=dbo.PrivateFileNameToken(@employee)+N'_'+dbo.PrivateFileNameToken(@person)+N'_'+@kind+CONVERT(nvarchar(20),@number)+N'.'+@extension;
 DECLARE @key varchar(160)=LOWER(CONVERT(varchar(36),@account_id)+'/'+CASE WHEN @context='skill' THEN '' ELSE 'certifications/' END+CONVERT(varchar(36),@record_id)+'/'+CONVERT(varchar(36),@file_id)+CASE WHEN @context='skill' THEN '.'+@extension ELSE '' END);
 INSERT dbo.PrivateFileObject(account_id,file_id,object_key,person_id,provider,bytes,sha256,file_name,original_name,mime_type,content)
 VALUES(@account_id,@file_id,@key,@actor_id,@provider,@bytes,@sha256,@name,@original_name,@mime_type,@content);
 IF @context='skill' EXEC dbo.SkillEvidence @account_id=@account_id,@actor_id=@actor_id,@claim_id=@record_id,@operation='ADD',@expected_revision=@expected_revision,@evidence_id=@file_id,@blob_name=@key,@bytes=@bytes,@width=@width,@height=@height,@mime_type=@mime_type,@file_name=@name;
 ELSE IF @context='certification' EXEC dbo.CertificationImage @account_id=@account_id,@actor_id=@actor_id,@claim_id=@record_id,@operation='ADD',@expected_revision=@expected_revision,@evidence_id=@file_id,@blob_name=@key,@bytes=@bytes,@width=@width,@height=@height,@mime_type=@mime_type,@file_name=@name;
 ELSE BEGIN
  DECLARE @payload nvarchar(max)=(SELECT @file_id AS id,@key AS blobName,@expected_revision AS revision,@bytes AS bytes,@mime_type AS mimeType,@name AS fileName,@width AS width,@height AS height FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  EXEC dbo.CapabilityIntakeFiles @account_id=@account_id,@actor_id=@actor_id,@id=@submission_id,@certification_id=@record_id,@operation='ADD',@payload=@payload;
 END;
 COMMIT TRANSACTION;
 SELECT @file_id AS id,@key AS blobName,@name AS fileName;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadPrivateFile
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@context varchar(20),@record_id uniqueidentifier,
 @file_id uniqueidentifier,@submission_id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int,@manifest nvarchar(max)=N'{}';
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF @context='skill' EXEC dbo.SkillEvidence @account_id=@account_id,@actor_id=@actor_id,@claim_id=@record_id,@private_manifest=@manifest OUTPUT;
 ELSE IF @context='certification' EXEC dbo.CertificationImage @account_id=@account_id,@actor_id=@actor_id,@claim_id=@record_id,@private_manifest=@manifest OUTPUT;
 ELSE IF @context='intake' EXEC dbo.CapabilityIntakeFiles @account_id=@account_id,@actor_id=@actor_id,@id=@submission_id,@certification_id=@record_id,@private_manifest=@manifest OUTPUT;
 ELSE IF @context='submission' EXEC dbo.CapabilitySubmissionFiles @account_id=@account_id,@actor_id=@actor_id,@id=@submission_id,@record_id=@record_id,@private_manifest=@manifest OUTPUT;
 ELSE IF @context IN('business-skill','business-cert') BEGIN
  DECLARE @kind varchar(20)=CASE WHEN @context='business-skill' THEN 'skills' ELSE 'certifications' END;
  EXEC dbo.BusinessRecordFiles @account_id=@account_id,@actor_id=@actor_id,@kind=@kind,@id=@record_id,@private_manifest=@manifest OUTPUT;
 END ELSE THROW 51000,'Invalid private-file context.',1;
 DECLARE @key varchar(160),@bytes int;
 SELECT @key=blobName,@bytes=bytes FROM OPENJSON(@manifest,'$.items') WITH(id uniqueidentifier,blobName varchar(160),bytes int) WHERE id=@file_id;
 IF @key IS NULL THROW 51004,'File unavailable in this context.',1;
 SELECT COALESCE(f.provider,'azure-blob') AS provider,@key AS objectKey,@bytes AS bytes,f.sha256,f.content,f.file_name AS fileName
 FROM (VALUES(1)) seed(n) LEFT JOIN dbo.PrivateFileObject f ON f.account_id=@account_id AND f.file_id=@file_id AND f.object_key=@key
 WHERE f.file_id IS NULL OR f.bytes=@bytes;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.StagePrivateUpload
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@binding binary(32),@part_index int,@part_count int,@total_bytes int,@content varbinary(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Upload denied.',1;
 IF @binding IS NULL OR @content IS NULL OR @total_bytes IS NULL OR @part_count IS NULL OR @part_index IS NULL OR @total_bytes NOT BETWEEN 1 AND 10485760 OR @part_count<>(@total_bytes+3145727)/3145728 OR @part_index<0 OR @part_index>=@part_count
  OR DATALENGTH(@content)<>CASE WHEN @part_index=@part_count-1 THEN @total_bytes-3145728*@part_index ELSE 3145728 END THROW 51000,'Invalid upload part.',1;
 BEGIN TRY BEGIN TRANSACTION;
 IF EXISTS(SELECT 1 FROM dbo.PrivateUploadPart WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND actor_id=@actor_id AND binding=@binding AND (part_count<>@part_count OR total_bytes<>@total_bytes OR created_at<DATEADD(hour,-24,SYSUTCDATETIME()))) THROW 51009,'Upload expired or changed; restart with a new upload ID.',1;
 IF EXISTS(SELECT 1 FROM dbo.PrivateUploadPart WHERE account_id=@account_id AND actor_id=@actor_id AND binding=@binding AND part_index=@part_index AND sha256<>HASHBYTES('SHA2_256',@content)) THROW 51009,'Upload part changed.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.PrivateUploadPart WHERE account_id=@account_id AND actor_id=@actor_id AND binding=@binding AND part_index=@part_index)
  INSERT dbo.PrivateUploadPart(account_id,actor_id,binding,part_index,part_count,total_bytes,content,sha256) VALUES(@account_id,@actor_id,@binding,@part_index,@part_count,@total_bytes,@content,HASHBYTES('SHA2_256',@content));
 IF @part_index=@part_count-1 BEGIN
  IF (SELECT COUNT(*) FROM dbo.PrivateUploadPart WHERE account_id=@account_id AND actor_id=@actor_id AND binding=@binding)<>@part_count THROW 51009,'Upload incomplete; retry missing parts.',1;
  SELECT content,sha256 FROM dbo.PrivateUploadPart WHERE account_id=@account_id AND actor_id=@actor_id AND binding=@binding ORDER BY part_index;
 END;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.SavePrivateFile TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadPrivateFile TO [skill_management_runtime];
GRANT EXECUTE ON dbo.StagePrivateUpload TO [skill_management_runtime];
