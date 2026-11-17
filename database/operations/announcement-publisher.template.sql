-- Historical operator runbook for migrations 102–103. Superseded by migration 104.
-- Run as a SQL owner against the intended workspace after migration 102.
-- Preview first. Set @apply=1 with the displayed revision to grant or revoke exactly this binding.
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @account uniqueidentifier=NULL,@administrator uniqueidentifier=NULL,
 @responsibility uniqueidentifier=NULL,@enabled bit=1,@apply bit=0,@expected_revision int=NULL;
IF ISNULL(IS_MEMBER('db_owner'),0)<>1 OR @account IS NULL OR @administrator IS NULL OR @responsibility IS NULL
 THROW 51000,'Set the exact workspace, administrator and responsibility IDs and run as SQL owner.',1;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @revision int,@person uniqueidentifier,@kind varchar(20),@scope uniqueidentifier,@old bit=0;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account;
 IF @revision IS NULL OR dbo.BusinessSystemAdmin(@account,@administrator)<>1
  THROW 51003,'The workspace administrator is unavailable.',1;
 SELECT @person=person_id,@kind=scope_kind,@scope=scope_id FROM dbo.BusinessResponsibility
  WHERE account_id=@account AND id=@responsibility;
 IF @person IS NULL OR @enabled=1 AND (dbo.BusinessResponsibilityUsable(@account,@person,@responsibility)<>1
  OR dbo.AccessCan(@account,@person,'profile.view',1)<>1 OR @kind='ORGANIZATION')
  THROW 51003,'Choose an active, effective responsibility.',1;
 IF EXISTS(SELECT 1 FROM dbo.AnnouncementPublisher WHERE account_id=@account AND responsibility_id=@responsibility
  AND (@enabled=0 OR person_id=@person AND scope_kind=@kind AND scope_id=@scope)) SET @old=1;
 IF @apply=1 BEGIN
  IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Access changed. Preview the binding again.',1;
  IF @enabled<>@old BEGIN
   DELETE dbo.AnnouncementPublisher WHERE account_id=@account AND responsibility_id=@responsibility;
   IF @enabled=1 INSERT dbo.AnnouncementPublisher(account_id,responsibility_id,person_id,scope_kind,scope_id)
     VALUES(@account,@responsibility,@person,@kind,@scope);
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,after_json)
    VALUES(@account,@revision+1,@administrator,@person,'announcement.publisher.changed',
      (SELECT @responsibility AS responsibilityId,@enabled AS enabled FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  END;
 END;
 SELECT @account AS accountId,p.employee_code AS employeeCode,p.display_name AS employee,@responsibility AS responsibilityId,
  @kind AS scopeKind,@scope AS scopeId,@old AS currentEnabled,@enabled AS requestedEnabled,@revision AS previewRevision,@apply AS applied
 FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.person_id=@person;
 COMMIT;
END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
