-- Delegated publishing is opt-in per existing scoped Business responsibility.
CREATE TABLE dbo.AnnouncementPublisher (
 account_id uniqueidentifier NOT NULL,
 responsibility_id uniqueidentifier NOT NULL,
 person_id uniqueidentifier NOT NULL,
 scope_kind varchar(20) NOT NULL CHECK(scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT')),
 scope_id uniqueidentifier NOT NULL,
 CONSTRAINT PK_AnnouncementPublisher PRIMARY KEY(account_id,responsibility_id)
);
CREATE TABLE dbo.Announcement (
 account_id uniqueidentifier NOT NULL,
 id uniqueidentifier NOT NULL,
 owner_id uniqueidentifier NOT NULL,
 responsibility_id uniqueidentifier NOT NULL,
 revision int NOT NULL,
 definition nvarchar(max) NOT NULL CHECK(ISJSON(definition)=1),
 state varchar(10) NOT NULL CHECK(state IN('DRAFT','PUBLISHED','CLOSED')),
 starts_at datetime2 NOT NULL,
 ends_at datetime2 NOT NULL,
 CONSTRAINT PK_Announcement PRIMARY KEY(account_id,id),
 CONSTRAINT FK_Announcement_Owner FOREIGN KEY(account_id,owner_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CONSTRAINT CK_Announcement_Dates CHECK(starts_at<ends_at)
);
CREATE INDEX IX_Announcement_Window ON dbo.Announcement(account_id,state,ends_at,starts_at);
CREATE TABLE dbo.AnnouncementResponse (
 account_id uniqueidentifier NOT NULL,
 announcement_id uniqueidentifier NOT NULL,
 person_id uniqueidentifier NOT NULL,
 email nvarchar(254) NULL,
 answers nvarchar(max) NOT NULL CHECK(ISJSON(answers)=1),
 submitted_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_AnnouncementResponse PRIMARY KEY(account_id,announcement_id,person_id),
 CONSTRAINT FK_AnnouncementResponse_Announcement FOREIGN KEY(account_id,announcement_id) REFERENCES dbo.Announcement(account_id,id),
 CONSTRAINT FK_AnnouncementResponse_Person FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id)
);
GO
CREATE OR ALTER FUNCTION dbo.AnnouncementGrantUsable(@account uniqueidentifier,@actor uniqueidentifier,@grant uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.AccessCan(@account,@actor,'profile.view',1)<>1 RETURN 0;
 IF EXISTS(SELECT 1 FROM dbo.AnnouncementPublisher p
  JOIN dbo.BusinessResponsibility g ON g.account_id=p.account_id AND g.id=p.responsibility_id
  WHERE p.account_id=@account AND g.id=@grant AND g.person_id=@actor
   AND p.person_id=g.person_id AND p.scope_kind=g.scope_kind AND p.scope_id=g.scope_id
   AND dbo.BusinessResponsibilityUsable(@account,@actor,@grant)=1
   AND dbo.BusinessLegacyDenied(@account,@actor,'reports.view')=0) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.AnnouncementScopeCovers(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier,@targetKind varchar(20),@target uniqueidentifier)
RETURNS bit AS BEGIN
 IF dbo.BusinessScopeCovers(@account,@kind,@scope,@targetKind,@target)=1 RETURN 1;
 IF @targetKind='PROJECT' AND EXISTS(SELECT 1 FROM dbo.BusinessProject p
  WHERE p.account_id=@account AND p.id=@target AND p.active=1
   AND dbo.BusinessScopeCovers(@account,@kind,@scope,'DEPARTMENT',p.department_id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.AnnouncementAudience(@account uniqueidentifier,@owner uniqueidentifier,@grant uniqueidentifier,@definition nvarchar(max))
RETURNS TABLE AS RETURN (
 SELECT DISTINCT members.person_id
 FROM dbo.BusinessResponsibility g
 CROSS APPLY OPENJSON(@definition,'$.audience') WITH(kind varchar(20) '$.kind',id uniqueidentifier '$.id') chosen
 CROSS APPLY dbo.BusinessScopePeople(@account,chosen.kind,chosen.id) members
 JOIN dbo.BusinessVisiblePeople(@account,@owner,@grant) visible ON visible.person_id=members.person_id
 WHERE g.account_id=@account AND g.id=@grant
  AND dbo.AnnouncementGrantUsable(@account,@owner,@grant)=1
  AND dbo.AccessCan(@account,members.person_id,'profile.view',1)=1
  AND chosen.kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT')
  AND dbo.AnnouncementScopeCovers(@account,g.scope_kind,g.scope_id,chosen.kind,chosen.id)=1
);
GO
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
 IF @operation='FEED' BEGIN
  SELECT @json=(SELECT JSON_QUERY(COALESCE((SELECT TOP(20) a.id,a.revision,
   JSON_QUERY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(a.definition,'$.versions',NULL),'$.audience',NULL),'$.exports',NULL),'$.image',NULL)) AS definition,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(a.definition) WHERE [key]='image') THEN 1 ELSE 0 END) AS hasImage,
   CONVERT(varchar(30),a.starts_at,126)+'Z' AS startsAt,CONVERT(varchar(30),a.ends_at,126)+'Z' AS endsAt,
   CONVERT(bit,CASE WHEN r.person_id IS NULL THEN 0 ELSE 1 END) AS answered
   FROM dbo.Announcement a LEFT JOIN dbo.AnnouncementResponse r
   ON r.account_id=a.account_id AND r.announcement_id=a.id AND r.person_id=@actor_id
   WHERE a.account_id=@account_id AND a.state='PUBLISHED' AND a.starts_at<=@now AND a.ends_at>@now
    AND EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(a.account_id,a.owner_id,a.responsibility_id,a.definition) WHERE person_id=@actor_id)
   ORDER BY a.starts_at DESC,a.id FOR JSON PATH),N'[]')) AS items,
   JSON_QUERY((SELECT p.display_name AS name,p.employee_code AS employeeId,@email AS email
    FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND p.person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS person,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.AnnouncementPublisher g WHERE g.account_id=@account_id
    AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.responsibility_id)=1) THEN 1 ELSE 0 END) AS canPublish
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SELECT @json AS json;RETURN;
 END;
 IF @operation='MANAGE' BEGIN
  SELECT @json=(SELECT CONVERT(bit,CASE WHEN dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
  JSON_QUERY(COALESCE((SELECT g.id,g.scope_kind AS kind,g.scope_id AS scopeId
   FROM dbo.BusinessResponsibility g WHERE g.account_id=@account_id
    AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.id)=1 FOR JSON PATH),N'[]')) AS grants,
   JSON_QUERY(COALESCE((SELECT target.id,target.kind,target.label,g.id AS grantId
    FROM dbo.BusinessResponsibility g CROSS JOIN (
      SELECT node_id AS id,kind,display_name AS label FROM dbo.AccessOrgNode WHERE account_id=@account_id AND kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT')
      UNION ALL SELECT id,'PROJECT',name FROM dbo.BusinessProject WHERE account_id=@account_id AND active=1
    ) target
    WHERE g.account_id=@account_id AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,g.id)=1
     AND dbo.AnnouncementScopeCovers(@account_id,g.scope_kind,g.scope_id,target.kind,target.id)=1
    ORDER BY target.label,target.id FOR JSON PATH),N'[]')) AS scopes,
   JSON_QUERY(COALESCE((SELECT TOP(50) a.id,a.revision,a.state,a.responsibility_id AS grantId,
    JSON_VALUE(a.definition,'$.title') AS title,
    CONVERT(varchar(30),a.starts_at,126)+'Z' AS startsAt,CONVERT(varchar(30),a.ends_at,126)+'Z' AS endsAt
    FROM dbo.Announcement a WHERE a.account_id=@account_id AND a.owner_id=@actor_id
     AND dbo.AnnouncementGrantUsable(@account_id,@actor_id,a.responsibility_id)=1
    ORDER BY a.starts_at DESC,a.id FOR JSON PATH),N'[]')) AS items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
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
   IF JSON_VALUE(@payload,'$.revision') IS NULL OR TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision'))<>@revision
    THROW 51009,'Announcement changed.',1;
   IF JSON_VALUE(@definition,'$.kind')='FORM' AND @email IS NULL THROW 51000,'Sign in again to confirm your work email.',1;
   IF EXISTS(SELECT 1 FROM dbo.AnnouncementResponse WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id AND announcement_id=@id AND person_id=@actor_id)
    THROW 51009,'You already responded.',1;
   INSERT dbo.AnnouncementResponse(account_id,announcement_id,person_id,email,answers)
    VALUES(@account_id,@id,@actor_id,@email,JSON_QUERY(@payload,'$.answers'));
   SET @json=N'{"saved":true}';
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
    JSON_QUERY(COALESCE((SELECT TOP(CASE WHEN @operation='EXPORT' THEN 10001 ELSE 100 END) p.display_name AS name,p.employee_code AS employeeId,r.email,
    p.grade,path.unit_name AS du,path.portfolio_name AS portfolio,path.department_name AS account,
    c.display_name AS capability,c.display_name AS primarySkill,JSON_QUERY(r.answers) AS answers
    FROM dbo.AnnouncementResponse r
    JOIN dbo.AccessPerson p ON p.account_id=r.account_id AND p.person_id=r.person_id
    JOIN dbo.AnnouncementAudience(@account_id,@actor_id,@grant,@definition) allowed ON allowed.person_id=p.person_id
    LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id
    LEFT JOIN dbo.AccessOrgAssignment oa ON oa.account_id=p.account_id AND oa.person_id=p.person_id
    LEFT JOIN dbo.AccessOrgNode team ON team.account_id=oa.account_id AND team.node_id=oa.team_id AND team.active=1
    LEFT JOIN dbo.OrganizationClientPath(@account_id) path ON path.department_id=COALESCE(oa.department_id,team.parent_id)
    WHERE r.account_id=@account_id AND r.announcement_id=@id ORDER BY r.submitted_at DESC,r.person_id FOR JSON PATH),N'[]')) AS responses
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
GRANT EXECUTE ON dbo.AnnouncementWorkspace TO [skill_management_runtime];
GO
