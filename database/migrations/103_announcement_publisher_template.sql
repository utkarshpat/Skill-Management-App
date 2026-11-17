-- People & Access assignment for the existing, concrete Announcements Publisher template.
CREATE OR ALTER PROCEDURE dbo.AnnouncementTemplateAccess
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(16),@id uniqueidentifier=NULL,
 @payload nvarchar(max)=N'{}',@email nvarchar(254)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id)
  THROW 51003,'Workspace denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>4096 OR @operation NOT IN('TEMPLATE_OPTIONS','TEMPLATE_PREVIEW','TEMPLATE_APPLY')
  THROW 51000,'Invalid template request.',1;
 DECLARE @person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
  @enabled bit=CASE JSON_VALUE(@payload,'$.enabled') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,
  @expected int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),@revision int,
  @kind varchar(20),@scope uniqueidentifier,@label nvarchar(200),@assigned bit=0,@json nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;
 IF @operation='TEMPLATE_APPLY'
  SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 ELSE
  SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF @revision IS NULL OR dbo.BusinessSystemAdmin(@account_id,@actor_id)<>1
   OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1
   OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'users.manage')=1
   OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'permissions.manage')=1
  THROW 51003,'Announcement template administration is outside your current access.',1;
 IF @person IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person)
  THROW 51004,'Employee unavailable.',1;
 IF @operation='TEMPLATE_OPTIONS' BEGIN
  ;WITH bindings AS (
   SELECT g.id,g.scope_kind AS kind,g.scope_id AS scopeId,
    CONVERT(bit,1) AS eligible,CONVERT(bit,CASE WHEN p.responsibility_id IS NULL THEN 0 ELSE 1 END) AS assigned
   FROM dbo.BusinessResponsibility g
   LEFT JOIN dbo.AnnouncementPublisher p ON p.account_id=g.account_id AND p.responsibility_id=g.id
     AND p.person_id=g.person_id AND p.scope_kind=g.scope_kind AND p.scope_id=g.scope_id
   WHERE g.account_id=@account_id AND g.person_id=@person AND g.scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT')
     AND dbo.BusinessResponsibilityUsable(@account_id,@person,g.id)=1
     AND dbo.AccessCan(@account_id,@person,'profile.view',1)=1
     AND dbo.BusinessLegacyDenied(@account_id,@person,'reports.view')=0
  ), choices AS (
   SELECT id,kind,scopeId,eligible,assigned FROM bindings
   UNION ALL
   SELECT p.responsibility_id,p.scope_kind,p.scope_id,CONVERT(bit,0),CONVERT(bit,1)
   FROM dbo.AnnouncementPublisher p
   WHERE p.account_id=@account_id AND p.person_id=@person AND NOT EXISTS(
    SELECT 1 FROM bindings WHERE id=p.responsibility_id AND assigned=1)
  )
  SELECT @json=(SELECT @revision AS revision,JSON_QUERY(COALESCE((
   SELECT c.id,c.kind,c.scopeId,c.eligible,c.assigned,
    COALESCE(pr.name,node.display_name,CONVERT(nvarchar(36),c.scopeId)) AS label
   FROM choices c LEFT JOIN dbo.BusinessProject pr ON c.kind='PROJECT' AND pr.account_id=@account_id AND pr.id=c.scopeId
   LEFT JOIN dbo.AccessOrgNode node ON node.account_id=@account_id AND node.node_id=c.scopeId AND node.kind=c.kind
   ORDER BY assigned DESC,label,c.id FOR JSON PATH),N'[]')) AS items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE BEGIN
  IF @enabled IS NULL OR @id IS NULL THROW 51000,'Choose a scoped assignment and action.',1;
  IF @operation='TEMPLATE_APPLY' AND (@expected IS NULL OR @expected<>@revision)
   THROW 51009,'Access changed. Review the assignment again.',1;
  IF @enabled=1 BEGIN
   SELECT @kind=g.scope_kind,@scope=g.scope_id FROM dbo.BusinessResponsibility g
   WHERE g.account_id=@account_id AND g.id=@id AND g.person_id=@person AND g.scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT')
    AND dbo.BusinessResponsibilityUsable(@account_id,@person,@id)=1
    AND dbo.AccessCan(@account_id,@person,'profile.view',1)=1
    AND dbo.BusinessLegacyDenied(@account_id,@person,'reports.view')=0;
   IF EXISTS(SELECT 1 FROM dbo.AnnouncementPublisher WHERE account_id=@account_id AND responsibility_id=@id AND person_id=@person AND scope_kind=@kind AND scope_id=@scope)
    THROW 51009,'Announcement publishing is already assigned.',1;
  END ELSE SELECT @kind=scope_kind,@scope=scope_id FROM dbo.AnnouncementPublisher
   WHERE account_id=@account_id AND responsibility_id=@id AND person_id=@person;
  IF @scope IS NULL THROW 51003,'This publishing assignment is outside the selected scope.',1;
  IF @operation='TEMPLATE_APPLY' BEGIN
   DELETE dbo.AnnouncementPublisher WHERE account_id=@account_id AND responsibility_id=@id
    AND (@enabled=1 OR person_id=@person);
   IF @enabled=1 INSERT dbo.AnnouncementPublisher(account_id,responsibility_id,person_id,scope_kind,scope_id)
    VALUES(@account_id,@id,@person,@kind,@scope);
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json)
    VALUES(@account_id,@revision+1,@actor_id,@person,'announcement.publisher.changed',
     (SELECT @id AS responsibilityId,@kind AS scopeKind,@scope AS scopeId,@enabled AS enabled FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  END;
  SELECT @label=COALESCE(
   (SELECT name FROM dbo.BusinessProject WHERE @kind='PROJECT' AND account_id=@account_id AND id=@scope),
   (SELECT display_name FROM dbo.AccessOrgNode WHERE kind=@kind AND account_id=@account_id AND node_id=@scope),
   CONVERT(nvarchar(36),@scope));
  SELECT @json=(SELECT @revision AS revision,@kind AS kind,@scope AS scopeId,@label AS label,@enabled AS enabled FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END;
 COMMIT;
 SELECT @json AS json;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.AnnouncementTemplateAccess TO [skill_management_runtime];
GO
