-- Local disposable verification. Run with sqlcmd after the migration inside a transaction.
DECLARE @account uniqueidentifier=NEWID(),@lead uniqueidentifier=NEWID(),@member uniqueidentifier=NEWID(),
 @outside uniqueidentifier=NEWID(),@project uniqueidentifier=NEWID(),@grant uniqueidentifier=NEWID(),@id uniqueidentifier=NEWID();
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@account,CONVERT(varchar(36),@account),'Announcement test',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@account,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active)
 VALUES(@account,@lead,'Lead','A1',1),(@account,@member,'Member','A2',1),(@account,@outside,'Outside','A3',1);
INSERT dbo.BusinessProject(account_id,id,name,active) VALUES(@account,@project,'Test project',1);
INSERT dbo.BusinessProjectMember VALUES(@account,@project,@member,1);
INSERT dbo.BusinessResponsibility VALUES(@account,@grant,@lead,'BUSINESS_OPERATIONS','PROJECT',@project,'ALLOW',1,NULL,'Fixture');
IF dbo.AnnouncementGrantUsable(@account,@lead,@grant)<>0 THROW 50000,'Implicit publish grant.',1;
INSERT dbo.AnnouncementPublisher VALUES(@account,@grant,@lead,'PROJECT',@project);
UPDATE dbo.BusinessResponsibility SET person_id=@outside WHERE account_id=@account AND id=@grant;
IF dbo.AnnouncementGrantUsable(@account,@outside,@grant)<>0 THROW 50000,'Publishing transferred with changed responsibility.',1;
UPDATE dbo.BusinessResponsibility SET person_id=@lead WHERE account_id=@account AND id=@grant;
DECLARE @def nvarchar(max)=(SELECT 'POLL' AS kind,N'Which session?' AS title,JSON_QUERY('["A","B"]') AS options,JSON_QUERY('[]') AS exports,
 JSON_QUERY((SELECT 'PROJECT' AS kind,@project AS id FOR JSON PATH)) AS audience FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @payload nvarchar(max)=(SELECT @grant AS grantId,0 AS revision,CONVERT(varchar(30),DATEADD(day,-1,SYSUTCDATETIME()),126)+'Z' AS startsAt,
 CONVERT(varchar(30),DATEADD(day,1,SYSUTCDATETIME()),126)+'Z' AS endsAt,JSON_QUERY(@def) AS definition,CAST(1 AS bit) AS publish FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @out TABLE(json nvarchar(max)); DECLARE @result nvarchar(max);
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@lead,'PREVIEW',@id,@payload;
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.audienceCount'),'')<>'1' THROW 50000,'Preview audience count mismatch.',1;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@lead,'DRAFT',@id,@payload;
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.state'),'')<>'PUBLISHED' THROW 50000,'Publish failed.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@id AND action='announcement.published')
 THROW 50000,'Publish was not audited.',1;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@outside,'FEED';
SELECT @result=json FROM @out;
IF EXISTS(SELECT 1 FROM OPENJSON(@result,'$.items')) THROW 50000,'Feed leaked audience data.',1;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@member,'FEED',NULL,N'{}','member@soprasteria.com';
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.items[0].definition.title'),'')<>'Which session?' OR JSON_VALUE(@result,'$.person.email')<>'member@soprasteria.com'
 THROW 50000,'Member feed failed.',1;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@member,'ANSWER',@id,N'{"revision":1,"answers":{"vote":"B"}}','member@soprasteria.com';
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@lead,'EXPORT',@id;
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.responses[0].answers.vote'),'')<>'B' THROW 50000,'Export failed.',1;
UPDATE dbo.BusinessProjectMember SET active=0 WHERE account_id=@account AND project_id=@project AND person_id=@member;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@lead,'EXPORT',@id;
SELECT @result=json FROM @out;
IF EXISTS(SELECT 1 FROM OPENJSON(@result,'$.responses')) THROW 50000,'Revoked member still exported.',1;
UPDATE dbo.BusinessProjectMember SET active=1 WHERE account_id=@account AND project_id=@project AND person_id=@member;
DELETE dbo.AnnouncementPublisher WHERE account_id=@account AND responsibility_id=@grant;
DELETE @out;
INSERT @out EXEC dbo.AnnouncementWorkspace @account,@member,'FEED';
SELECT @result=json FROM @out;
IF EXISTS(SELECT 1 FROM OPENJSON(@result,'$.items')) THROW 50000,'Revoked announcement remained visible.',1;
DECLARE @admin uniqueidentifier=NEWID(),@template nvarchar(max),@template_revision int;
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES(@account,@admin,'Template admin','A4',1);
INSERT dbo.BusinessResponsibility VALUES(@account,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Fixture');
SET @template=(SELECT @lead AS personId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DELETE @out;
INSERT @out EXEC dbo.AnnouncementTemplateAccess @account,@admin,'TEMPLATE_OPTIONS',NULL,@template;
SELECT @result=json FROM @out;
IF ISNULL(JSON_VALUE(@result,'$.items[0].eligible'),'')<>'true' OR JSON_VALUE(@result,'$.items[0].assigned')<>'false'
 THROW 50000,'Template scope unavailable.',1;
SET @template=JSON_MODIFY(@template,'$.enabled',CAST(1 AS bit));
DELETE @out;
INSERT @out EXEC dbo.AnnouncementTemplateAccess @account,@admin,'TEMPLATE_PREVIEW',@grant,@template;
SELECT @result=json FROM @out;
IF dbo.AnnouncementGrantUsable(@account,@lead,@grant)<>0 THROW 50000,'Preview changed a live grant.',1;
SET @template_revision=TRY_CONVERT(int,JSON_VALUE(@result,'$.revision'));
SET @template=JSON_MODIFY(@template,'$.revision',@template_revision);
DELETE @out;
INSERT @out EXEC dbo.AnnouncementTemplateAccess @account,@admin,'TEMPLATE_APPLY',@grant,@template;
IF dbo.AnnouncementGrantUsable(@account,@lead,@grant)<>1 THROW 50000,'Template did not grant publishing.',1;
SET @template=JSON_MODIFY(JSON_MODIFY(@template,'$.enabled',CAST(0 AS bit)),'$.revision',@template_revision+1);
DELETE @out;
INSERT @out EXEC dbo.AnnouncementTemplateAccess @account,@admin,'TEMPLATE_APPLY',@grant,@template;
IF dbo.AnnouncementGrantUsable(@account,@lead,@grant)<>0 THROW 50000,'Template removal did not revoke publishing.',1;
IF (SELECT COUNT(*) FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@lead AND action='announcement.publisher.changed')<>2
 THROW 50000,'Template changes were not audited.',1;
SELECT 'Announcement and template SQL checks passed' AS result;
GO
