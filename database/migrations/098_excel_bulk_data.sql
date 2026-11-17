CREATE OR ALTER PROCEDURE dbo.ExcelBulkData
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@kind varchar(20),
 @operation varchar(12),@payload nvarchar(max)=N'{}',@revision int=NULL
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 DECLARE @current int,@admin bit,@catalogueAdmin bit;
 IF @operation IN('IMPORT','PREVIEW')
  SELECT @current=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 ELSE
  SELECT @current=w.revision FROM dbo.AccessWorkspace w WITH(HOLDLOCK)
  JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @current IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1
  THROW 51003,'Workspace denied.',1;
 SET @admin=CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1
  AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1
  AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END;
 SET @catalogueAdmin=CASE WHEN @admin=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)=1
  AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'request.approve')=0 THEN 1 ELSE 0 END;
 IF @kind IS NULL OR @kind NOT IN('catalogue','certifications') OR
  @operation IS NULL OR @operation NOT IN('ACCESS','EXPORT','PREVIEW','IMPORT')
  OR @payload IS NULL OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>4000000 THROW 51000,'Invalid workbook request.',1;
 DECLARE @import bit=CASE WHEN @kind='catalogue' THEN @catalogueAdmin ELSE @admin END;
 DECLARE @scopedExport bit=CASE WHEN dbo.BusinessHasAccess(@account_id,@actor_id)=1
  AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END;
 IF @operation='ACCESS' BEGIN
  SELECT (SELECT @import AS canImport,@scopedExport AS canExportScope FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END
 ELSE IF @operation='EXPORT' BEGIN
  DECLARE @search nvarchar(100)=COALESCE(JSON_VALUE(@payload,'$.search'),N''),
   @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scope')),
   @hierarchy uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.hierarchy')),
   @hierarchyKind varchar(20),@skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),
   @status varchar(20)=COALESCE(JSON_VALUE(@payload,'$.status'),''),
   @categoryFilter nvarchar(80)=COALESCE(JSON_VALUE(@payload,'$.category'),''),
   @issuerFilter nvarchar(120)=COALESCE(JSON_VALUE(@payload,'$.issuer'),''),
   @validity varchar(10)=COALESCE(JSON_VALUE(@payload,'$.validity'),''),
   @from date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.from'),23),
   @to date=TRY_CONVERT(date,JSON_VALUE(@payload,'$.to'),23),
   @today date=CONVERT(date,SYSUTCDATETIME()),
   @portfolio bit=CASE WHEN JSON_VALUE(@payload,'$.view')='scope' THEN 1 ELSE 0 END;
  IF @kind='catalogue' BEGIN
   IF @catalogueAdmin=0 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Catalogue access denied.',1;
   SELECT (SELECT
    JSON_QUERY((SELECT s.skill_id AS [ID],s.display_name AS [Name],s.category AS [Category],s.description AS [Description],s.status AS [Status],
     MAX(CASE WHEN l.rank=1 THEN l.description END) AS [Foundation],MAX(CASE WHEN l.rank=2 THEN l.description END) AS [Autonomous],
     MAX(CASE WHEN l.rank=3 THEN l.description END) AS [Experienced],MAX(CASE WHEN l.rank=4 THEN l.description END) AS [Expert]
     FROM dbo.SkillCatalogue s LEFT JOIN dbo.SkillProficiencyLevel l ON l.account_id=s.account_id AND l.skill_id=s.skill_id
     WHERE s.account_id=@account_id AND (@catalogueAdmin=1 OR s.status='PUBLISHED')
      AND (@status='' OR s.status=@status)
      AND (@search='' OR CHARINDEX(@search,s.display_name)>0 OR CHARINDEX(@search,s.category)>0)
     GROUP BY s.skill_id,s.display_name,s.category,s.description,s.status ORDER BY s.display_name,s.skill_id FOR JSON PATH)) AS [Skills],
    JSON_QUERY((SELECT d.id AS [ID],d.name AS [Name],d.category AS [Category],d.description AS [Description],p.name AS [Issuer],d.active AS [Active],
     (SELECT STRING_AGG(CONVERT(varchar(max),m.skill_id),',') WITHIN GROUP(ORDER BY m.skill_id)
      FROM dbo.CredentialSkillMapping m JOIN dbo.SkillCatalogue s ON s.account_id=m.account_id AND s.skill_id=m.skill_id
      WHERE m.account_id=d.account_id AND m.credential_id=d.id AND (@catalogueAdmin=1 OR s.status='PUBLISHED')) AS [Related Skill IDs]
     FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id
     WHERE d.account_id=@account_id AND (@catalogueAdmin=1 OR (d.active=1 AND p.active=1))
      AND (@search='' OR CHARINDEX(@search,d.name)>0 OR CHARINDEX(@search,d.category)>0)
     ORDER BY d.name,d.id FOR JSON PATH)) AS [Certifications],
    JSON_QUERY((SELECT p.id AS [ID],p.name AS [Name],p.active AS [Active] FROM dbo.CredentialProvider p
     WHERE p.account_id=@account_id AND (@catalogueAdmin=1 OR p.active=1) ORDER BY p.name,p.id FOR JSON PATH)) AS [Issuers]
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  END ELSE BEGIN
   IF @portfolio=1 AND (@scopedExport<>1 OR (JSON_VALUE(@payload,'$.scope') IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope
      AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)))
    THROW 51003,'Certification export scope denied.',1;
   IF @portfolio=1 AND JSON_VALUE(@payload,'$.hierarchy') IS NOT NULL BEGIN
    SELECT @hierarchyKind=kind FROM dbo.BusinessHierarchy(@account_id,@actor_id) WHERE id=@hierarchy;
    IF @hierarchyKind IS NULL THROW 51003,'Certification export hierarchy denied.',1;
   END;
   IF @portfolio=0 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 THROW 51003,'Certification access denied.',1;
   SELECT (SELECT JSON_QUERY((SELECT TOP(10001) p.employee_code AS [Employee Code],
    c.certification_name AS [Certification],c.provider AS [Issuer],c.category AS [Category],
    CONVERT(char(10),c.issue_date,23) AS [Issue Date],CONVERT(char(10),c.expiry_date,23) AS [Expiry Date],
    CONVERT(bit,CASE WHEN c.expiry_date IS NULL THEN 1 ELSE 0 END) AS [Does Not Expire],
    CASE WHEN @portfolio=0 OR @admin=1 THEN c.credential_id END AS [Credential ID],c.status AS [Status],
    CASE WHEN @portfolio=0 OR @admin=1 THEN COALESCE(JSON_VALUE(imported.after_json,'$.source'),N'Skill Management') END AS [Source],
    CASE WHEN @portfolio=0 OR @admin=1 THEN COALESCE(JSON_VALUE(imported.after_json,'$.sourceId'),CONVERT(nvarchar(36),c.id)) END AS [Source ID]
    FROM dbo.CertificationRecord c JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
    LEFT JOIN dbo.AccessAudit imported ON imported.account_id=c.account_id AND imported.target_id=c.id AND imported.action='certification.imported'
    WHERE c.account_id=@account_id AND ((@portfolio=0 AND c.person_id=@actor_id) OR
     (@portfolio=1 AND c.status='APPROVED' AND EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) x WHERE x.person_id=c.person_id)))
     AND (@hierarchy IS NULL OR @portfolio=0 OR EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account_id,@hierarchyKind,@hierarchy) h WHERE h.person_id=c.person_id))
     AND (@search='' OR CHARINDEX(@search,c.certification_name)>0 OR CHARINDEX(@search,c.provider)>0 OR CHARINDEX(@search,p.employee_code)>0 OR CHARINDEX(@search,p.display_name)>0)
     AND (@categoryFilter='' OR c.category=@categoryFilter) AND (@issuerFilter='' OR c.provider=@issuerFilter)
     AND (@status='' OR c.status=@status) AND (@from IS NULL OR c.issue_date>=@from) AND (@to IS NULL OR c.issue_date<=@to)
     AND (@skill IS NULL OR EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s
      ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=c.account_id AND l.certification_id=c.id AND l.published=1 AND s.skill_id=@skill))
     AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today
      OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)
      OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today)
      OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today)
      OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today)
      OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today)
      OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today))
    ORDER BY p.employee_code,c.issue_date DESC,c.id FOR JSON PATH)) AS [Employee Certifications]
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  END;
 END
 ELSE BEGIN
  IF @import<>1 THROW 51003,'Bulk import requires current administration access.',1;
  IF @operation='IMPORT' AND (@revision IS NULL OR @current<>@revision) THROW 51009,'Workspace changed. Preview the workbook again.',1;
  DECLARE @initial int=@current,@count int=0,@skipped int=0,@row nvarchar(max),@rowNo int,@section varchar(24),@rowError nvarchar(2048);
  IF JSON_QUERY(@payload,'$.rows') IS NULL OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.rows')) NOT BETWEEN 1 AND 1000
   THROW 51000,'Upload between 1 and 1000 rows per batch.',1;
  DECLARE workbook_rows CURSOR LOCAL FAST_FORWARD FOR
   SELECT value FROM OPENJSON(@payload,'$.rows') ORDER BY TRY_CONVERT(int,[key]);
  OPEN workbook_rows;
  FETCH NEXT FROM workbook_rows INTO @row;
  WHILE @@FETCH_STATUS=0 BEGIN
   SET @rowNo=TRY_CONVERT(int,JSON_VALUE(@row,'$.row'));
   SET @section=JSON_VALUE(@row,'$.section');
   IF @kind='catalogue' BEGIN
    IF @section IS NULL OR @section NOT IN('SKILL','PROVIDER','CERTIFICATION') THROW 51000,'Invalid catalogue worksheet.',1;
    DECLARE @target uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@row,'$.targetId')),
     @definition nvarchar(max)=JSON_QUERY(@row,'$.definition'),@command nvarchar(max),@commandId uniqueidentifier=NEWID();
    IF @section='CERTIFICATION' BEGIN
     DECLARE @providerId uniqueidentifier=NULL;
     SELECT @providerId=id FROM dbo.CredentialProvider WHERE account_id=@account_id AND active=1
      AND LOWER(LTRIM(RTRIM(name)))=LOWER(JSON_VALUE(@definition,'$.providerName'));
     IF @providerId IS NULL THROW 51000,'Use an active issuer from the Issuers worksheet or current catalogue.',1;
     SET @definition=JSON_MODIFY(JSON_MODIFY(@definition,'$.providerName',NULL),'$.providerId',CONVERT(varchar(36),@providerId));
    END;
    SET @command=(SELECT @commandId AS id,@current AS revision,@section AS [type],@target AS targetId,
     CONVERT(bit,CASE WHEN @target IS NULL THEN 1 ELSE 0 END) AS isNew,JSON_QUERY(@definition) AS definition
     FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    EXEC dbo.SaveCatalogueMaster @account_id,@actor_id,'SAVE_MASTER',@command;
    SELECT @current=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
    SET @count+=1;
   END ELSE BEGIN
    DECLARE @person uniqueidentifier=NULL,@matches int,@employee nvarchar(100)=JSON_VALUE(@row,'$.employee'),
     @name nvarchar(200)=JSON_VALUE(@row,'$.name'),@issuer nvarchar(120)=JSON_VALUE(@row,'$.issuer'),
     @category nvarchar(80)=JSON_VALUE(@row,'$.category'),@issued date=TRY_CONVERT(date,JSON_VALUE(@row,'$.issued'),23),
     @expiry date=TRY_CONVERT(date,JSON_VALUE(@row,'$.expiry'),23),@credential nvarchar(200)=COALESCE(JSON_VALUE(@row,'$.credential'),N''),
     @source nvarchar(120)=JSON_VALUE(@row,'$.source'),@sourceId nvarchar(200)=JSON_VALUE(@row,'$.sourceId'),
     @id uniqueidentifier=NEWID();
    SELECT @matches=COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1 AND employee_code=@employee;
    IF @matches<>1 THROW 51000,'Employee code must match one active employee.',1;
    SELECT @person=person_id FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1 AND employee_code=@employee;
    IF @issued IS NULL OR @issued>CONVERT(date,SYSUTCDATETIME()) OR
     (JSON_VALUE(@row,'$.expiry') IS NOT NULL AND @expiry IS NULL) OR @expiry<@issued OR
     NULLIF(@name,'') IS NULL OR NULLIF(@issuer,'') IS NULL OR NULLIF(@category,'') IS NULL OR
     NULLIF(@source,'') IS NULL OR NULLIF(@sourceId,'') IS NULL OR ISNULL(JSON_VALUE(@row,'$.status'),'')<>'APPROVED'
     THROW 51000,'Check approved status, certificate fields, dates and source reference.',1;
    IF EXISTS(SELECT 1 FROM dbo.AccessAudit audit JOIN dbo.CertificationRecord c ON c.account_id=audit.account_id AND c.id=audit.target_id
     WHERE audit.account_id=@account_id AND audit.action='certification.imported'
     AND JSON_VALUE(audit.after_json,'$.source')=@source AND JSON_VALUE(audit.after_json,'$.sourceId')=@sourceId
     AND (c.person_id<>@person OR c.certification_name<>@name OR c.provider<>@issuer OR c.issue_date<>@issued
       OR c.category<>@category OR c.credential_id<>@credential OR ISNULL(c.expiry_date,'00010101')<>ISNULL(@expiry,'00010101')))
      THROW 51000,'Source reference already belongs to a different certificate.',1;
    IF EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.person_id=@person
      AND dbo.CertificationIdentityText(c.certification_name) COLLATE Latin1_General_100_CI_AS=dbo.CertificationIdentityText(@name) COLLATE Latin1_General_100_CI_AS
      AND dbo.CertificationIdentityText(c.provider) COLLATE Latin1_General_100_CI_AS=dbo.CertificationIdentityText(@issuer) COLLATE Latin1_General_100_CI_AS
      AND c.issue_date=@issued AND c.status='APPROVED')
     SET @skipped+=1;
    ELSE BEGIN
     -- Imported approval is legacy history and has no fabricated local skill claim or reviewer.
     INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,
      issue_date,expiry_date,credential_id,credential_url,notes,status,requires_skill_link)
     VALUES(@account_id,@id,@person,1,@name,@issuer,@category,@issued,@expiry,@credential,N'',N'','APPROVED',0);
     SET @current+=1;
     UPDATE dbo.AccessWorkspace SET revision=@current WHERE account_id=@account_id;
     INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json)
     VALUES(@account_id,@current,@actor_id,'certification.imported',@id,
      (SELECT @source AS source,@sourceId AS sourceId,@person AS personId,@name AS certification,
       @issuer AS issuer,@issued AS issueDate,@expiry AS expiryDate,'APPROVED' AS status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
     SET @count+=1;
    END;
   END;
   FETCH NEXT FROM workbook_rows INTO @row;
  END;
  CLOSE workbook_rows;
  DEALLOCATE workbook_rows;
  IF @operation='PREVIEW' ROLLBACK TRANSACTION; ELSE COMMIT TRANSACTION;
  SELECT (SELECT @initial AS revision,@count AS changed,@skipped AS duplicates FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
  RETURN;
 END;
 COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  IF @rowNo IS NOT NULL AND ERROR_NUMBER() IN(51000,51004,51012,51014,2601,2627,547) BEGIN
   SET @rowError=CONCAT(@section,N', row ',@rowNo,N': ',CASE WHEN ERROR_NUMBER() IN(2601,2627) THEN N'Duplicate entry.' WHEN ERROR_NUMBER()=547 THEN N'Invalid or in-use catalogue reference.' ELSE ERROR_MESSAGE() END);
   THROW 51000,@rowError,1;
  END;
  THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ExcelBulkData TO [skill_management_runtime];
GO
