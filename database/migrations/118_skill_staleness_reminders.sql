CREATE TABLE dbo.SkillStalenessReminder (
 account_id uniqueidentifier NOT NULL,
 claim_id uniqueidentifier NOT NULL,
 claim_revision int NOT NULL,
 created_at datetime2(7) NOT NULL,
 CONSTRAINT PK_SkillStalenessReminder PRIMARY KEY(account_id,claim_id,claim_revision),
 CONSTRAINT FK_SkillStalenessReminder_Claim FOREIGN KEY(account_id,claim_id)
  REFERENCES dbo.SkillClaimDraft(account_id,claim_id) ON DELETE CASCADE
);
GO
CREATE OR ALTER PROCEDURE dbo.GenerateSkillStalenessReminders
 @account_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
  DECLARE @revision int,@now datetime2(7)=SYSUTCDATETIME(),@created int;
  SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
   WHERE w.account_id=@account_id;
  IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
  INSERT dbo.SkillStalenessReminder(account_id,claim_id,claim_revision,created_at)
   SELECT c.account_id,c.claim_id,c.revision,@now
   FROM dbo.SkillClaimDraft c
   JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1
   WHERE c.account_id=@account_id AND c.status='APPROVED' AND DATEADD(month,18,c.updated_at)<=@now
    AND dbo.AccessCan(@account_id,c.person_id,'profile.view',1)=1
    AND dbo.AccessCan(@account_id,c.person_id,'skill.view',1)=1
    AND NOT EXISTS(SELECT 1 FROM dbo.SkillStalenessReminder r
     WHERE r.account_id=c.account_id AND r.claim_id=c.claim_id AND r.claim_revision=c.revision);
  SET @created=@@ROWCOUNT;
  COMMIT;
  SELECT @created AS created;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadSkillStalenessNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
    dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR NOT EXISTS(
     SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id AND a.status='ACTIVE'
     WHERE p.account_id=@account_id AND p.person_id=@actor_id AND p.active=1
    ) THROW 51003,'Skill notification access denied.',1;
 IF @page IS NULL OR @page<1 THROW 51000,'Invalid reminder page.',1;
 SELECT
  'skill-stale-'+LOWER(CONVERT(varchar(36),c.claim_id))+'-'+CONVERT(varchar(11),c.revision) AS id,
  r.created_at AS at,
  N'Review your skill' AS title,
  c.skill_name+N' has not been updated for 18 months. Do you want to update or retire this skill?' AS body,
  '/my-skills?claim='+LOWER(CONVERT(varchar(36),c.claim_id)) AS href
 FROM dbo.SkillClaimDraft c
 JOIN dbo.SkillStalenessReminder r ON r.account_id=c.account_id AND r.claim_id=c.claim_id AND r.claim_revision=c.revision
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
  AND DATEADD(month,18,c.updated_at)<=SYSUTCDATETIME()
 ORDER BY r.created_at DESC,c.claim_id
 OFFSET ((CONVERT(bigint,@page)-1)*30) ROWS FETCH NEXT 31 ROWS ONLY;
END;
GO
GRANT EXECUTE ON dbo.GenerateSkillStalenessReminders TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadSkillStalenessNotifications TO [skill_management_runtime];
GO
