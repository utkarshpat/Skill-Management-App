-- Keep announcement edits versioned per employee response.
ALTER TABLE dbo.AnnouncementResponse ADD response_revision int NOT NULL
 CONSTRAINT DF_AnnouncementResponse_Revision DEFAULT (1)
 CONSTRAINT CK_AnnouncementResponse_Revision CHECK (response_revision>=1);
GO
-- Allow opt-in edits to a person's own response while the announcement is active.
CREATE OR ALTER PROCEDURE dbo.AnnouncementWorkspace
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(16),@id uniqueidentifier=NULL,
 @payload nvarchar(max)=N'{}',@email nvarchar(254)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id)
  THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>2200000 THROW 51000,'Invalid announcement payload.',1;
 DECLARE @now datetime2=SYSUTCDATETIME(), @json nvarchar(max), @grant uniqueidentifier,
  @owner uniqueidentifier,@definition nvarchar(max),@revision int,@state varchar(10),@start datetime2,@end datetime2;
 DECLARE @page int=COALESCE(TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),1);
 IF @page<1 OR @page>1000000 OR (JSON_VALUE(@payload,'$.page') IS NOT NULL AND TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')) IS NULL)
  THROW 51000,'Invalid announcement page.',1;
 DECLARE @page_size int=CASE @operation WHEN 'FEED' THEN 20 WHEN 'MANAGE' THEN 50 ELSE 100 END;
 DECLARE @offset int=(@page-1)*@page_size;
 IF @operation='FEED' BEGIN
  DECLARE @feed_ids TABLE(id uniqueidentifier PRIMARY KEY);
  INSERT @feed_ids SELECT a.id FROM dbo.Announcement a
   WHERE a.account_id=@account_id AND a.state='PUBLISHED' AND a.starts_at<=@now AND a.ends_at>@now
    AND (@id IS NULL OR a.id=@id)
    AND (@id IS NOT NULL OR COALESCE(JSON_VALUE(@payload,'$.pending'),'false')<>'true'
      OR NOT EXISTS(SELECT 1 FROM dbo.AnnouncementResponse r
        WHERE r.account_id=a.account_id AND r.announcement_id=a.id AND r.person_id=@actor_id))
    AND EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(a.account_id,a.owner_id,a.responsibility_id,a.definition) WHERE person_id=@actor_id);
  SELECT @json=(SELECT JSON_QUERY(COALESCE((SELECT a.id,a.revision,
   JSON_QUERY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(a.definition,'$.versions',NULL),'$.audience',NULL),'$.exports',NULL),'$.image',NULL)) AS definition,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(a.definition) WHERE [key]='image') THEN 1 ELSE 0 END) AS hasImage,
   CONVERT(varchar(30),a.starts_at,126)+'Z' AS startsAt,CONVERT(varchar(30),a.ends_at,126)+'Z' AS endsAt,
   CONVERT(bit,CASE WHEN r.person_id IS NULL THEN 0 ELSE 1 END) AS answered,
   COALESCE(r.response_revision,0) AS responseRevision,
   JSON_QUERY(CASE WHEN @id IS NOT NULL THEN r.answers END) AS savedAnswers
   FROM dbo.Announcement a LEFT JOIN dbo.AnnouncementResponse r
   ON r.account_id=a.account_id AND r.announcement_id=a.id AND r.person_id=@actor_id
   WHERE a.account_id=@account_id AND EXISTS(SELECT 1 FROM @feed_ids f WHERE f.id=a.id)
   ORDER BY a.starts_at DESC,a.id OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY FOR JSON PATH),N'[]')) AS items,
   JSON_QUERY((SELECT p.display_name AS name,p.employee_code AS employeeId,@email AS email
    FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND p.person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS person,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.BusinessResponsibility g WHERE g.account_id=@account_id AND g.person_id=@actor_id
    AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.id)=1) THEN 1 ELSE 0 END) AS canPublish
   ,@page AS page,(SELECT COUNT(*) FROM @feed_ids) AS total,
   CONVERT(bit,CASE WHEN (SELECT COUNT(*) FROM @feed_ids)>@offset+@page_size THEN 1 ELSE 0 END) AS hasMore
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SELECT @json AS json;RETURN;
 END;
 IF @operation='MANAGE' BEGIN
  DECLARE @manage_ids TABLE(id uniqueidentifier PRIMARY KEY);
  INSERT @manage_ids SELECT a.id FROM dbo.Announcement a WHERE a.account_id=@account_id AND a.owner_id=@actor_id
   AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,a.responsibility_id)=1;
  SELECT @json=(SELECT LOWER(CONVERT(varchar(36),@actor_id)) AS actorId,CONVERT(bit,CASE WHEN dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
  JSON_QUERY(COALESCE((SELECT g.id,g.scope_kind AS kind,g.scope_id AS scopeId
   FROM dbo.BusinessResponsibility g WHERE g.account_id=@account_id AND g.person_id=@actor_id
    AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.id)=1 FOR JSON PATH),N'[]')) AS grants,
   JSON_QUERY(COALESCE((SELECT target.id,target.kind,target.label,target.parentId,target.parentKind,g.id AS grantId
    FROM dbo.BusinessResponsibility g CROSS JOIN (
      SELECT node.node_id AS id,node.kind,node.display_name AS label,node.parent_id AS parentId,parent.kind AS parentKind
      FROM dbo.AccessOrgNode node LEFT JOIN dbo.AccessOrgNode parent ON parent.account_id=node.account_id AND parent.node_id=node.parent_id
      WHERE node.account_id=@account_id AND node.active=1 AND node.kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT')
      UNION ALL SELECT id,'PROJECT',name,department_id,'DEPARTMENT' FROM dbo.BusinessProject WHERE account_id=@account_id AND active=1
    ) target
    WHERE g.account_id=@account_id AND g.person_id=@actor_id AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.id)=1
     AND dbo.AnnouncementScopeCovers(@account_id,g.scope_kind,g.scope_id,target.kind,target.id)=1
    ORDER BY target.label,target.id FOR JSON PATH),N'[]')) AS scopes,
   JSON_QUERY(COALESCE((SELECT a.id,a.revision,a.state,a.responsibility_id AS grantId,
    JSON_VALUE(a.definition,'$.title') AS title,
    CONVERT(varchar(30),a.starts_at,126)+'Z' AS startsAt,CONVERT(varchar(30),a.ends_at,126)+'Z' AS endsAt
    FROM dbo.Announcement a WHERE a.account_id=@account_id AND EXISTS(SELECT 1 FROM @manage_ids m WHERE m.id=a.id)
    ORDER BY a.starts_at DESC,a.id OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY FOR JSON PATH),N'[]')) AS items,
    @page AS page,(SELECT COUNT(*) FROM @manage_ids) AS total,
    CONVERT(bit,CASE WHEN (SELECT COUNT(*) FROM @manage_ids)>@offset+@page_size THEN 1 ELSE 0 END) AS hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SELECT @json AS json;RETURN;
 END;
 BEGIN TRY
 BEGIN TRANSACTION;
 -- Serialize audience-sensitive writes against authorized access changes.
 DECLARE @workspace_revision int;
 IF @operation IN('DRAFT','CLOSE')
  SELECT @workspace_revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 ELSE
  SELECT @workspace_revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF @operation IN('DRAFT','CLOSE')
 SELECT @owner=owner_id,@grant=responsibility_id,@definition=definition,@revision=revision,@state=state,@start=starts_at,@end=ends_at
 FROM dbo.Announcement WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND id=@id;
 ELSE
 SELECT @owner=owner_id,@grant=responsibility_id,@definition=definition,@revision=revision,@state=state,@start=starts_at,@end=ends_at
 FROM dbo.Announcement WITH(HOLDLOCK) WHERE account_id=@account_id AND id=@id;
 SET @now=SYSUTCDATETIME();
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile denied.',1;
 IF @operation='IMAGE' BEGIN
  IF @state IS NULL OR NOT (
    @owner=@actor_id AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,@grant)=1
    OR @state='PUBLISHED' AND @start<=@now AND @end>@now
     AND EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(@account_id,@owner,@grant,@definition) WHERE person_id=@actor_id)
  ) THROW 51004,'Image unavailable.',1;
  SET @json=(SELECT image FROM OPENJSON(@definition) WITH(image nvarchar(max) '$.image') FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation='DETAIL' OR @operation='ANSWER' BEGIN
  IF @state IS NULL OR @state<>'PUBLISHED' OR @start>@now OR @end<=@now
   OR NOT EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(@account_id,@owner,@grant,@definition) WHERE person_id=@actor_id)
   THROW 51004,'Announcement unavailable.',1;
  IF @operation='ANSWER' BEGIN
   IF COALESCE(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<>@revision
    THROW 51009,'Announcement changed.',1;
   IF JSON_VALUE(@definition,'$.kind')='FORM' AND @email IS NULL THROW 51000,'Sign in again to confirm your work email.',1;
   DECLARE @response_revision int=0,@expected_response_revision int=TRY_CONVERT(int,COALESCE(JSON_VALUE(@payload,'$.responseRevision'),'0'));
   SELECT @response_revision=response_revision FROM dbo.AnnouncementResponse WITH(UPDLOCK,HOLDLOCK)
    WHERE account_id=@account_id AND announcement_id=@id AND person_id=@actor_id;
   IF @expected_response_revision IS NULL OR @expected_response_revision<>@response_revision
    THROW 51009,'Your response changed. Reopen the latest response before editing.',1;
   IF @response_revision<>0 BEGIN
    IF COALESCE(JSON_VALUE(@definition,'$.allowResponseUpdates'),'false')<>'true'
     THROW 51009,'You already responded.',1;
    UPDATE dbo.AnnouncementResponse SET answers=JSON_QUERY(@payload,'$.answers'),response_revision=response_revision+1
     WHERE account_id=@account_id AND announcement_id=@id AND person_id=@actor_id;
   END ELSE
    INSERT dbo.AnnouncementResponse(account_id,announcement_id,person_id,email,answers)
     VALUES(@account_id,@id,@actor_id,@email,JSON_QUERY(@payload,'$.answers'));
   SET @json=(SELECT CONVERT(bit,1) AS saved,@response_revision+1 AS responseRevision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE SET @json=(SELECT @revision AS revision,JSON_QUERY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@definition,'$.image',NULL),'$.versions',NULL),'$.audience',NULL),'$.exports',NULL)) AS definition FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @operation IN('DESIGN','DRAFT','PREVIEW','EXPORT','RESPONSES','CLOSE','OWNER') BEGIN
  IF @operation IN('DESIGN','DRAFT','PREVIEW') AND @revision IS NULL BEGIN
   SET @grant=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.grantId'));
  END ELSE IF @owner IS NULL OR @owner<>@actor_id THROW 51004,'Announcement unavailable.',1;
  IF dbo.AnnouncementGrantUsable(@account_id,@actor_id,@grant)<>1 THROW 51003,'Publishing is outside your current scope.',1;
  IF @operation='OWNER' SET @json=(SELECT @id AS id,@revision AS revision,@state AS state,@grant AS grantId,JSON_QUERY(@definition) AS definition,
    CONVERT(varchar(30),@start,126)+'Z' AS startsAt,CONVERT(varchar(30),@end,126)+'Z' AS endsAt FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @operation='DESIGN' BEGIN
   IF @state IS NOT NULL AND @state<>'DRAFT' THROW 51009,'Open a draft to iterate on the design.',1;
   SET @json=N'{"allowed":true}';
  END;
  IF @operation IN('DRAFT','PREVIEW') BEGIN
   IF @state IS NOT NULL AND @state<>'DRAFT' THROW 51009,'Published announcements are locked.',1;
   IF ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<>ISNULL(@revision,0)
    THROW 51009,'Draft changed. Reload it before saving.',1;
   IF @grant<>TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.grantId')) THROW 51003,'Draft publishing permission cannot be switched.',1;
   SET @definition=JSON_QUERY(@payload,'$.definition');
   SET @start=CONVERT(datetime2,TRY_CONVERT(datetimeoffset,JSON_VALUE(@payload,'$.startsAt')));
   SET @end=CONVERT(datetime2,TRY_CONVERT(datetimeoffset,JSON_VALUE(@payload,'$.endsAt')));
   SET @state=CASE WHEN JSON_VALUE(@payload,'$.publish')='true' THEN 'PUBLISHED' ELSE 'DRAFT' END;
   IF @start IS NULL OR @end IS NULL OR @start>=@end OR @state='PUBLISHED' AND @end<=@now
    THROW 51000,'Check the announcement schedule.',1;
   IF NOT EXISTS(SELECT 1 FROM OPENJSON(@definition,'$.audience')) OR EXISTS(
    SELECT 1 FROM OPENJSON(@definition,'$.audience') WITH(kind varchar(20) '$.kind',id uniqueidentifier '$.id') chosen
    JOIN dbo.BusinessResponsibility g ON g.account_id=@account_id AND g.id=@grant
    WHERE chosen.kind IS NULL OR chosen.kind NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT') OR chosen.id IS NULL
     OR dbo.AnnouncementScopeCovers(@account_id,g.scope_kind,g.scope_id,chosen.kind,chosen.id)<>1
   ) THROW 51003,'Choose an audience within your publishing scope.',1;
   IF @state='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(@account_id,@actor_id,@grant,@definition))
    THROW 51003,'The selected audience has no eligible employees.',1;
   IF @operation='PREVIEW'
    SET @json=(SELECT COUNT(*) AS audienceCount FROM dbo.AnnouncementAudience(@account_id,@actor_id,@grant,@definition) FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   ELSE BEGIN
   IF @revision IS NULL
    INSERT dbo.Announcement(account_id,id,owner_id,responsibility_id,revision,definition,state,starts_at,ends_at)
    VALUES(@account_id,@id,@actor_id,@grant,1,@definition,@state,@start,@end);
   ELSE UPDATE dbo.Announcement SET revision=@revision+1,definition=@definition,state=@state,starts_at=@start,ends_at=@end
    WHERE account_id=@account_id AND id=@id;
   SET @json=(SELECT @id AS id,ISNULL(@revision,0)+1 AS revision,@state AS state FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   END;
  END;
  IF @operation='CLOSE' BEGIN
   IF @state<>'PUBLISHED' OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<>@revision
    THROW 51009,'Announcement changed. Reload it before closing.',1;
   UPDATE dbo.Announcement SET state='CLOSED',revision=@revision+1 WHERE account_id=@account_id AND id=@id;
   SET @state='CLOSED';SET @json=N'{"closed":true}';
  END;
  IF @operation IN('EXPORT','RESPONSES') BEGIN
   IF @state='DRAFT' OR @operation='EXPORT' AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=1
    THROW 51003,'Response export is outside your current access.',1;
   SET @json=(SELECT JSON_QUERY(JSON_MODIFY(JSON_MODIFY(@definition,'$.image',NULL),'$.versions',NULL)) AS definition,
    JSON_QUERY(COALESCE((SELECT p.display_name AS name,p.employee_code AS employeeId,r.email,
    p.grade,path.unit_name AS du,path.portfolio_name AS portfolio,path.department_name AS account,
    c.display_name AS capability,c.display_name AS primarySkill,JSON_QUERY(r.answers) AS answers
    FROM dbo.AnnouncementResponse r
    JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.person_id
    JOIN dbo.AnnouncementAudience(@account_id,@actor_id,@grant,@definition) allowed ON allowed.person_id=p.person_id
    LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id
    LEFT JOIN dbo.AccessOrgAssignment oa ON oa.account_id=p.account_id AND oa.person_id=p.person_id
    LEFT JOIN dbo.AccessOrgNode team ON team.account_id=oa.account_id AND team.node_id=oa.team_id AND team.active=1
    LEFT JOIN dbo.OrganizationClientPath(@account_id) path ON path.department_id=COALESCE(oa.department_id,team.parent_id)
    WHERE r.account_id=@account_id AND r.announcement_id=@id ORDER BY r.submitted_at DESC,r.person_id
     OFFSET (CASE WHEN @operation='EXPORT' THEN 0 ELSE @offset END) ROWS
     FETCH NEXT (CASE WHEN @operation='EXPORT' THEN 10001 ELSE @page_size END) ROWS ONLY FOR JSON PATH),N'[]')) AS responses,
    @page AS page,CONVERT(bit,CASE WHEN @operation='RESPONSES' AND (SELECT COUNT(*) FROM dbo.AnnouncementResponse r
     JOIN dbo.AnnouncementAudience(@account_id,@actor_id,@grant,@definition) allowed ON allowed.person_id=r.person_id
     WHERE r.account_id=@account_id AND r.announcement_id=@id)>@offset+@page_size THEN 1 ELSE 0 END) AS hasMore
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END;
  IF @operation='CLOSE' OR @operation='DRAFT' AND @state='PUBLISHED' BEGIN
   DECLARE @audit_revision int;
   UPDATE dbo.AccessWorkspace SET revision=revision+1,@audit_revision=revision+1 WHERE account_id=@account_id;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json)
    VALUES(@account_id,@audit_revision,@actor_id,CASE WHEN @operation='CLOSE' THEN 'announcement.closed' ELSE 'announcement.published' END,@id,
    (SELECT @state AS state,JSON_QUERY(@definition,'$.audience') AS audience FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  END;
 END ELSE THROW 51000,'Invalid announcement operation.',1;
 COMMIT;
 SELECT @json AS json;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
 END CATCH;
END;
GO

-- Extend the installed Excel procedure without replaying older catalogue changes.
DECLARE @excel nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.ExcelBulkData',N'P'));
DECLARE @export nvarchar(600)=N'(@portfolio=1 AND c.status=''APPROVED'' AND EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) x WHERE x.person_id=c.person_id))';
DECLARE @duplicate nvarchar(160)=N'AND c.issue_date=@issued AND c.status=''APPROVED'')';
DECLARE @header int=CHARINDEX(N'PROCEDURE dbo.ExcelBulkData',@excel);
IF @excel IS NULL OR ISNULL(@header,0)=0 OR CHARINDEX(@export,@excel)=0 OR CHARINDEX(@duplicate,@excel)=0
 THROW 51000,'Excel scope and import patch requires the installed migration 100 procedure.',1;
SET @excel=REPLACE(@excel,@export,REPLACE(@export,N'AND EXISTS',N'AND dbo.BusinessIssuerDenied(@account_id,@actor_id,c.person_id,c.provider)=0 AND EXISTS'));
DECLARE @natural nvarchar(max);
-- Build on the exact installed clause, including line ending variations.
DECLARE @start int=CHARINDEX(N'FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.person_id=@person',@excel),
 @end int=CHARINDEX(@duplicate,@excel);
IF @start=0 OR @end<=@start THROW 51000,'Excel certificate identity clause is missing.',1;
SET @natural=SUBSTRING(@excel,@start,@end+LEN(@duplicate)-@start);
SET @excel=REPLACE(@excel,N'IF EXISTS(SELECT 1 '+@natural,
 N'IF EXISTS(SELECT 1 '+LEFT(@natural,LEN(@natural)-1)+N'
      AND (c.category<>@category OR ISNULL(c.credential_id,N'''')<>@credential OR ISNULL(c.expiry_date,''00010101'')<>ISNULL(@expiry,''00010101'')))
      THROW 51000,''Existing approved certificate has different category, expiry or credential ID. Verify the workbook row and the approved record.'',1;
    IF EXISTS(SELECT 1 '+@natural);
SET @excel=N'ALTER '+SUBSTRING(@excel,@header,LEN(@excel));
EXEC sys.sp_executesql @excel;
GO

-- Page the authorized combined approvals, and filter the full queue before paging.
DECLARE @queue nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.CapabilitySubmissionWorkspace',N'P'));
DECLARE @header int=CHARINDEX(N'PROCEDURE dbo.CapabilitySubmissionWorkspace',@queue);
DECLARE @start int=CHARINDEX(N'IF @operation IN(''MINE'',''QUEUE'') BEGIN',@queue),
 @end int=CHARINDEX(N'IF @operation=''LINKS'' BEGIN',@queue);
IF @queue IS NULL OR ISNULL(@header,0)=0 OR ISNULL(@start,0)=0 OR @end<=@start
 THROW 51000,'The installed combined approval queue could not be updated.',1;
DECLARE @section nvarchar(max)=SUBSTRING(@queue,@start,@end-@start),@before nvarchar(max);
SET @before=@section;
SET @section=REPLACE(@section,N'IF @operation IN(''MINE'',''QUEUE'') BEGIN',N'IF @operation IN(''MINE'',''QUEUE'') BEGIN
  DECLARE @listPage int=CASE WHEN @operation=''QUEUE'' THEN COALESCE(TRY_CONVERT(int,JSON_VALUE(@payload,''$.page'')),1) ELSE 1 END;
  DECLARE @listSearch nvarchar(100)=CASE WHEN @operation=''QUEUE'' THEN COALESCE(JSON_VALUE(@payload,''$.search''),N'''') ELSE N'''' END;
  DECLARE @listPerson uniqueidentifier=CASE WHEN @operation=''QUEUE'' THEN TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,''$.person'')) END;
  IF @listPage NOT BETWEEN 1 AND 100000 OR LEN(JSON_VALUE(@payload,''$.search''))>100
   OR (JSON_VALUE(@payload,''$.person'') IS NOT NULL AND @listPerson IS NULL)
   THROW 51000,''Invalid combined approval filters.'',1;');
SET @section=REPLACE(@section,N'TOP(50) COUNT(*) OVER()',N'COUNT(*) OVER()');
DECLARE @order nvarchar(200)=N'ORDER BY CASE WHEN b.status IN(''DRAFT'',''SUBMITTED'') THEN 0 ELSE 1 END,b.updated_at DESC,b.id FOR JSON PATH';
IF CHARINDEX(@order,@section)=0 OR CHARINDEX(N'TOP(50)',@before)=0
 THROW 51000,'Combined approval paging anchors are missing.',1;
SET @section=REPLACE(@section,@order,N'AND (@listPerson IS NULL OR b.person_id=@listPerson)
   AND (@listSearch=N'''' OR CHARINDEX(@listSearch,p.display_name)>0 OR CHARINDEX(@listSearch,p.employee_code)>0
    OR EXISTS(SELECT 1 FROM dbo.CapabilitySubmissionItem item WHERE item.account_id=b.account_id AND item.submission_id=b.id
     AND (CHARINDEX(@listSearch,JSON_VALUE(item.snapshot_json,''$.skill_name''))>0
      OR CHARINDEX(@listSearch,JSON_VALUE(item.snapshot_json,''$.certification_name''))>0)))
   ORDER BY CASE WHEN b.status IN(''DRAFT'',''SUBMITTED'') THEN 0 ELSE 1 END,b.updated_at DESC,b.id
   OFFSET (@listPage-1)*50 ROWS FETCH NEXT 50 ROWS ONLY FOR JSON PATH');
SET @queue=STUFF(@queue,@start,@end-@start,@section);
SET @queue=N'ALTER '+SUBSTRING(@queue,@header,LEN(@queue));
EXEC sys.sp_executesql @queue;
GO
