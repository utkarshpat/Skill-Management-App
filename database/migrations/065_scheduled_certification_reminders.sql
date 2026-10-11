-- Durable owner-addressed reminders, independently of browser activity.
CREATE TABLE dbo.CertificationReminderSchedule (
 account_id uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.Account(account_id),
 enabled_date date NOT NULL DEFAULT CONVERT(date,SYSUTCDATETIME()),
 last_completed_at datetime2 NULL
);
INSERT dbo.CertificationReminderSchedule(account_id)
 SELECT account_id FROM dbo.Account WHERE status='ACTIVE';
CREATE TABLE dbo.CertificationExpiryReminder (
 account_id uniqueidentifier NOT NULL,
 certification_id uniqueidentifier NOT NULL,
 expiry_date date NOT NULL,
 days_before tinyint NOT NULL CHECK(days_before IN(14,10,7,5,3,0)),
 due_date date NOT NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_CertificationExpiryReminder PRIMARY KEY(account_id,certification_id,expiry_date,days_before),
 CONSTRAINT FK_CertificationExpiryReminder_Record FOREIGN KEY(account_id,certification_id)
 REFERENCES dbo.CertificationRecord(account_id,id)
);
CREATE INDEX IX_CertificationExpiryReminder_Due ON dbo.CertificationExpiryReminder(account_id,due_date DESC)
 INCLUDE(certification_id,expiry_date,days_before);
GO
CREATE OR ALTER PROCEDURE dbo.GenerateCertificationExpiryReminders
 @account_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
  DECLARE @revision int,@today date=CONVERT(date,SYSUTCDATETIME()),@enabled date,@created int;
  -- Credential, renewal and access writes lock this same row first.
  SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
   WHERE w.account_id=@account_id;
  IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.CertificationReminderSchedule WHERE account_id=@account_id)
   INSERT dbo.CertificationReminderSchedule(account_id) VALUES(@account_id);
  SELECT @enabled=enabled_date FROM dbo.CertificationReminderSchedule WHERE account_id=@account_id;
  INSERT dbo.CertificationExpiryReminder(account_id,certification_id,expiry_date,days_before,due_date)
   SELECT c.account_id,c.id,c.expiry_date,d.days,DATEADD(day,-d.days,c.expiry_date)
   FROM dbo.CertificationRecord c
   JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1
   CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
   WHERE c.account_id=@account_id AND c.status='APPROVED' AND c.expiry_date IS NOT NULL
    AND DATEADD(day,-d.days,c.expiry_date) BETWEEN @enabled AND @today
    AND c.expiry_date BETWEEN DATEADD(day,-90,@today) AND DATEADD(day,14,@today)
    AND dbo.AccessCan(@account_id,c.person_id,'profile.view',1)=1
    AND dbo.AccessCan(@account_id,c.person_id,'skill.view',1)=1
    AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
     WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
      AND renewal.status IN('SUBMITTED','APPROVED'))
    AND NOT EXISTS(SELECT 1 FROM dbo.CertificationExpiryReminder r
     WHERE r.account_id=c.account_id AND r.certification_id=c.id
      AND r.expiry_date=c.expiry_date AND r.days_before=d.days);
  SET @created=@@ROWCOUNT;
  UPDATE dbo.CertificationReminderSchedule SET last_completed_at=SYSUTCDATETIME() WHERE account_id=@account_id;
  -- System events do not invalidate access/context workspace revisions.
  COMMIT;
  SELECT @created AS created;
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
 SELECT TOP(30) 'cert-expiry-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(2),r.days_before)+'-'+CONVERT(varchar(10),r.expiry_date,23) AS id,
  CONVERT(datetime2,r.due_date) AS at,
  CASE WHEN c.expiry_date<@today THEN N'Credential has expired'
   WHEN c.expiry_date=@today THEN N'Credential expires today'
   ELSE N'Credential expiry reminder' END AS title,
  c.certification_name+N' expires on '+CONVERT(nvarchar(10),c.expiry_date,23)+
   N'. Reminder scheduled for '+CONVERT(nvarchar(10),r.due_date,23)+
   N' ('+CONVERT(nvarchar(2),r.days_before)+N' days before expiry). Record your renewal to update your credential.' AS body,
  '/certifications?renew='+CONVERT(varchar(36),c.id) AS href
 FROM (
  SELECT account_id,certification_id,expiry_date,days_before,due_date FROM dbo.CertificationExpiryReminder
   WHERE account_id=@account_id AND due_date BETWEEN DATEADD(day,-90,@today) AND @today
  UNION
  -- Preserve the existing same-day feed even before the first scheduled run.
  SELECT c.account_id,c.id,c.expiry_date,d.days,@today FROM dbo.CertificationRecord c
   CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
   WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
    AND DATEDIFF(day,@today,c.expiry_date)=d.days
 ) r
 JOIN dbo.CertificationRecord c ON c.account_id=r.account_id AND c.id=r.certification_id AND c.expiry_date=r.expiry_date
 JOIN dbo.Account a ON a.account_id=c.account_id AND a.status='ACTIVE'
 WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
  AND r.due_date<=@today AND r.due_date>=DATEADD(day,-90,@today)
  AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
   WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
    AND renewal.status IN('SUBMITTED','APPROVED'))
 ORDER BY r.due_date DESC,c.id,r.days_before;
END;
GO
GRANT EXECUTE ON dbo.GenerateCertificationExpiryReminders TO [skill_management_runtime];
GRANT EXECUTE ON dbo.CertificationExpiryNotifications TO [skill_management_runtime];
GO
