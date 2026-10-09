-- Date-driven in-app reminders are emitted only at the selected UTC-day offsets.
-- Renewal records remain separate from the approved credential they replace.
ALTER TABLE dbo.CertificationRecord
 ADD renewed_from_id uniqueidentifier NULL;
GO
ALTER TABLE dbo.CertificationRecord ADD CONSTRAINT FK_CertificationRecord_RenewedFrom
 FOREIGN KEY(account_id,renewed_from_id) REFERENCES dbo.CertificationRecord(account_id,id);
ALTER TABLE dbo.CertificationRecord ADD CONSTRAINT CK_CertificationRecord_NotSelfRenewal
 CHECK(renewed_from_id IS NULL OR renewed_from_id<>id);
CREATE INDEX IX_CertificationRecord_RenewalSource
 ON dbo.CertificationRecord(account_id,renewed_from_id,status) WHERE renewed_from_id IS NOT NULL;
CREATE UNIQUE INDEX UX_CertificationRecord_ActiveRenewal
 ON dbo.CertificationRecord(account_id,renewed_from_id)
 WHERE renewed_from_id IS NOT NULL AND status<>'CHANGES_REQUESTED' AND status<>'REJECTED';
GO
CREATE OR ALTER PROCEDURE dbo.LinkCertificationRenewal
 @account_id uniqueidentifier,@actor_id uniqueidentifier,
 @certification_id uniqueidentifier,@renewed_from_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF @certification_id IS NULL OR @renewed_from_id IS NULL OR @certification_id=@renewed_from_id
  THROW 51000,'Invalid credential renewal.',1;
 BEGIN TRY BEGIN TRANSACTION;
  DECLARE @workspace int,@owner uniqueidentifier,@status varchar(20),@existing uniqueidentifier,
   @source_owner uniqueidentifier,@source_status varchar(20),@source_expiry date,@before nvarchar(max);
  SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
   WHERE w.account_id=@account_id;
  IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
  IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
     dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR
     dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 THROW 51003,'Credential renewal denied.',1;
  SELECT @owner=person_id,@status=status,@existing=renewed_from_id
   FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
   WHERE account_id=@account_id AND id=@certification_id;
  SELECT @source_owner=person_id,@source_status=status,@source_expiry=expiry_date
   FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
   WHERE account_id=@account_id AND id=@renewed_from_id;
  IF @owner IS NULL OR @source_owner IS NULL THROW 51004,'Credential unavailable.',1;
  IF @owner<>@actor_id OR @source_owner<>@actor_id THROW 51003,'Own credentials required.',1;
  IF @status<>'DRAFT' OR @source_status<>'APPROVED' OR @source_expiry IS NULL
   THROW 51010,'Only a saved renewal draft of an expiring reviewed credential can be linked.',1;
  IF @existing IS NOT NULL AND @existing<>@renewed_from_id
   THROW 51009,'This draft is linked to another credential.',1;
  IF EXISTS(SELECT 1 FROM dbo.CertificationRecord WITH(UPDLOCK,HOLDLOCK)
    WHERE account_id=@account_id AND renewed_from_id=@renewed_from_id
    AND status IN('DRAFT','SUBMITTED','APPROVED') AND id<>@certification_id)
   THROW 51010,'A renewal draft is already active for this credential.',1;
  IF @existing IS NULL BEGIN
   SET @before=(SELECT id,renewed_from_id FROM dbo.CertificationRecord
    WHERE account_id=@account_id AND id=@certification_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   UPDATE dbo.CertificationRecord SET renewed_from_id=@renewed_from_id
    WHERE account_id=@account_id AND id=@certification_id;
   UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
    VALUES(@account_id,@workspace+1,@actor_id,'certification.renewal_started',@certification_id,@before,
     (SELECT id,renewed_from_id FROM dbo.CertificationRecord
      WHERE account_id=@account_id AND id=@certification_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  END;
  COMMIT;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.CertificationExpiryNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
    dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR
    NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  THROW 51003,'Credential notification access denied.',1;
 DECLARE @today date=CONVERT(date,SYSUTCDATETIME());
 SELECT TOP(30) 'cert-expiry-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(2),d.days) AS id,
  CONVERT(datetime2,DATEADD(day,-d.days,c.expiry_date)) AS at,
  CASE WHEN d.days=0 THEN N'Credential expires today'
   ELSE N'Credential expires in '+CONVERT(nvarchar(2),d.days)+N' days' END AS title,
  c.certification_name+N' expires on '+CONVERT(nvarchar(10),c.expiry_date,23)+
   N'. Record your renewal to update your credential.' AS body,
  '/certifications?renew='+CONVERT(varchar(36),c.id) AS href
 FROM dbo.CertificationRecord c
 CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
  AND c.expiry_date IS NOT NULL AND DATEDIFF(day,@today,c.expiry_date)=d.days
  AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
   WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
    AND renewal.status IN('SUBMITTED','APPROVED'))
 ORDER BY c.expiry_date,c.id,d.days DESC;
END;
GO
GRANT EXECUTE ON dbo.LinkCertificationRenewal TO [skill_management_runtime];
GRANT EXECUTE ON dbo.CertificationExpiryNotifications TO [skill_management_runtime];
GO
