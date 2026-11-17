-- Point direct-report expiry reminders at the employee in Team analytics.
-- The alert grants no certificate or evidence access; the team read rechecks reporting scope.
CREATE OR ALTER PROCEDURE dbo.CertificationExpiryNotifications
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@reminder_page int=1
AS BEGIN
 SET NOCOUNT ON;
 IF @reminder_page IS NULL OR @reminder_page<1 THROW 51000,'Invalid reminder page.',1;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR
    dbo.AccessCan(@account_id,@actor_id,'skill.view',1)<>1 OR
    NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@actor_id AND active=1)
  THROW 51003,'Credential notification access denied.',1;
 DECLARE @today date=CONVERT(date,SYSUTCDATETIME());
 SELECT CASE WHEN c.person_id=@actor_id
   THEN 'cert-expiry-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(2),r.days_before)
   ELSE 'cert-expiry-direct-report-'+CONVERT(varchar(36),c.id)+'-'+CONVERT(varchar(2),r.days_before)
    +'-'+CONVERT(varchar(10),r.expiry_date,23) END AS id,
  CONVERT(datetime2,r.due_date) AS at,
  CASE WHEN c.expiry_date<@today THEN N'Credential has expired'
   WHEN c.expiry_date=@today THEN N'Credential expires today'
   ELSE N'Credential expiry reminder' END AS title,
  CASE WHEN c.person_id=@actor_id THEN c.certification_name ELSE employee.display_name+N'''s credential' END+N' expires on '+CONVERT(nvarchar(10),c.expiry_date,23)+
   N'. Reminder scheduled for '+CONVERT(nvarchar(10),r.due_date,23)+
   N' ('+CONVERT(nvarchar(2),r.days_before)+N' days before expiry).'+CASE WHEN c.person_id=@actor_id THEN N' Record your renewal to update your credential.' ELSE N'' END AS body,
  CASE WHEN c.person_id=@actor_id THEN '/certifications?renew='+LOWER(CONVERT(varchar(36),c.id)) ELSE '/skill-reviews?tab=team&person='+LOWER(CONVERT(varchar(36),c.person_id)) END AS href
 FROM (
  SELECT account_id,certification_id,expiry_date,days_before,due_date FROM dbo.CertificationExpiryReminder
   WHERE account_id=@account_id AND due_date BETWEEN DATEADD(day,-90,@today) AND @today
  UNION
  -- Preserve the existing employee milestone feed even before the first scheduled run.
  SELECT c.account_id,c.id,c.expiry_date,d.days,@today FROM dbo.CurrentCertificationRecord c
   CROSS JOIN (VALUES(14),(10),(7),(5),(3),(0)) d(days)
   WHERE c.account_id=@account_id AND c.person_id=@actor_id AND c.status='APPROVED'
    AND DATEDIFF(day,@today,c.expiry_date)=d.days
 ) r
 JOIN dbo.CurrentCertificationRecord c ON c.account_id=r.account_id AND c.id=r.certification_id AND c.expiry_date=r.expiry_date
 JOIN dbo.Account a ON a.account_id=c.account_id AND a.status='ACTIVE'
 JOIN dbo.AccessPerson employee ON employee.account_id=c.account_id AND employee.person_id=c.person_id AND employee.active=1
 WHERE c.account_id=@account_id AND c.status='APPROVED'
  AND (c.person_id=@actor_id OR (
   dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)=1
   AND dbo.AccessCan(@account_id,c.person_id,'profile.view',1)=1
   AND dbo.AccessCan(@account_id,c.person_id,'skill.view',1)=1
   AND dbo.AccessReportingValid(@account_id,c.person_id)=1
   AND dbo.AccessReportingValid(@account_id,@actor_id)=1
   AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment org
    WHERE org.account_id=@account_id AND org.person_id=c.person_id AND org.manager_id=@actor_id)
  ))
  AND r.due_date<=@today AND r.due_date>=DATEADD(day,-90,@today)
  AND NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord renewal
   WHERE renewal.account_id=c.account_id AND renewal.renewed_from_id=c.id
    AND renewal.status IN('SUBMITTED','APPROVED')
      AND dbo.CertificationRenewalValid(c.account_id,c.id,renewal.person_id,renewal.certification_name,renewal.provider,renewal.issue_date,renewal.expiry_date)=1)
 ORDER BY r.due_date DESC,c.id,r.days_before
 OFFSET ((CONVERT(bigint,@reminder_page)-1)*30) ROWS FETCH NEXT 31 ROWS ONLY;
END;
GO
