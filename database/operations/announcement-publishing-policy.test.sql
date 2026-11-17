-- Local rollback verification after migrations 102, 103 and 104.
DECLARE @account uniqueidentifier=NEWID(),@lead uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),
 @member uniqueidentifier=NEWID(),@outsider uniqueidentifier=NEWID(),@project uniqueidentifier=NEWID(),
 @lead_grant uniqueidentifier=NEWID(),@admin_grant uniqueidentifier=NEWID();
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@account,CONVERT(varchar(36),@account),'Template policy test',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@account,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@account,@lead,'Lead','TP1',1),(@account,@admin,'Admin','TP2',1),(@account,@member,'Member','TP3',1),(@account,@outsider,'Outside','TP4',1);
INSERT dbo.BusinessProject(account_id,id,name,active) VALUES(@account,@project,'Template project',1);
INSERT dbo.BusinessProjectMember VALUES(@account,@project,@member,1);
INSERT dbo.BusinessResponsibility VALUES
 (@account,@lead_grant,@lead,'BUSINESS_OPERATIONS','PROJECT',@project,'ALLOW',1,NULL,'Fixture'),
 (@account,@admin_grant,@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture');
IF dbo.AnnouncementGrantUsable(@account,@lead,@lead_grant)<>1
 OR dbo.AnnouncementGrantUsable(@account,@admin,@admin_grant)<>1
 OR dbo.AnnouncementGrantUsable(@account,@outsider,@lead_grant)<>0
 THROW 50000,'Unexpected template publishing eligibility.',1;
DECLARE @out TABLE(json nvarchar(max));
DECLARE @result nvarchar(max);
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@lead,'FEED';
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.canPublish'),'')<>'true' THROW 50000,'Publishing discovery still relies on the retired template.',1;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@admin,'MANAGE';
SELECT @result=json FROM @out;
IF NOT EXISTS(SELECT 1 FROM OPENJSON(@result,'$.scopes') WHERE JSON_VALUE(value,'$.id')=CONVERT(varchar(36),@project))
 OR EXISTS(SELECT 1 FROM OPENJSON(@result,'$.scopes') WHERE JSON_VALUE(value,'$.kind')='ORGANIZATION')
 THROW 50000,'Admin audience discovery is not limited to concrete scopes.',1;
DECLARE @concrete nvarchar(max)=(SELECT JSON_QUERY((SELECT 'PROJECT' AS kind,@project AS id FOR JSON PATH)) AS audience FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
IF (SELECT COUNT(*) FROM dbo.AnnouncementAudience(@account,@admin,@admin_grant,@concrete))<>1
 OR (SELECT COUNT(*) FROM dbo.AnnouncementAudience(@account,@lead,@lead_grant,@concrete))<>1
 OR EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(@account,@admin,@admin_grant,N'{"audience":[{"kind":"ORGANIZATION"}]}'))
 THROW 50000,'Audience execution expanded an assignment.',1;
INSERT dbo.BusinessResponsibility VALUES
 (@account,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'DENY',1,DATEADD(day,1,SYSUTCDATETIME()),'Fixture');
IF dbo.AnnouncementGrantUsable(@account,@admin,@admin_grant)<>0 THROW 50000,'Admin DENY was bypassed.',1;
UPDATE dbo.BusinessResponsibility SET active=0 WHERE account_id=@account AND id=@lead_grant;
IF EXISTS(SELECT 1 FROM dbo.AnnouncementAudience(@account,@lead,@lead_grant,@concrete))
 THROW 50000,'Revoked Business Analytics could still publish.',1;
SELECT 'Publishing template policy checks passed' AS result;
GO
