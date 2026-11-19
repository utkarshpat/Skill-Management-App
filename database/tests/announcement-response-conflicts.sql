SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]LeadAudit[_]%' THROW 52000,'Use the isolated audit database.',1;
BEGIN TRANSACTION;
DECLARE @a uniqueidentifier=NEWID(),@publisher uniqueidentifier=NEWID(),@employee uniqueidentifier=NEWID(),
 @unit uniqueidentifier=NEWID(),@portfolio uniqueidentifier=NEWID(),@client uniqueidentifier=NEWID(),
 @grant uniqueidentifier=NEWID(),@announcement uniqueidentifier=NEWID(),@definition nvarchar(max);
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@a,'answer-audit','Answer audit',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@a,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@a,@publisher,'Audit Publisher','001',1),(@a,@employee,'Audit Employee','002',1);
INSERT dbo.AccessOrgNode VALUES(@a,@unit,'DELIVERY_UNIT','Unit',NULL,1),
 (@a,@portfolio,'PORTFOLIO','Portfolio',@unit,1),(@a,@client,'DEPARTMENT','Client',@portfolio,1);
INSERT dbo.AccessOrgAssignment(account_id,person_id,department_id,manager_id) VALUES(@a,@employee,@client,NULL);
INSERT dbo.BusinessResponsibility VALUES(@a,@grant,@publisher,'BUSINESS_OPERATIONS','DEPARTMENT',@client,'ALLOW',1,NULL,'Test publisher');
SET @definition=(SELECT 'POLL' AS kind,CONVERT(bit,1) AS allowResponseUpdates,
 JSON_QUERY((SELECT 'DEPARTMENT' AS kind,@client AS id FOR JSON PATH)) AS audience FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
INSERT dbo.Announcement(account_id,id,owner_id,responsibility_id,revision,definition,state,starts_at,ends_at)
 VALUES(@a,@announcement,@publisher,@grant,1,@definition,'PUBLISHED',DATEADD(hour,-1,SYSUTCDATETIME()),DATEADD(hour,1,SYSUTCDATETIME()));
EXEC dbo.AnnouncementWorkspace @a,@employee,'ANSWER',@announcement,N'{"revision":1,"responseRevision":0,"answers":{"vote":"No"}}';
EXEC dbo.AnnouncementWorkspace @a,@employee,'ANSWER',@announcement,N'{"revision":1,"responseRevision":1,"answers":{"vote":"Yes"}}';
IF NOT EXISTS(SELECT 1 FROM dbo.AnnouncementResponse WHERE account_id=@a AND announcement_id=@announcement AND person_id=@employee
 AND response_revision=2 AND JSON_VALUE(answers,'$.vote')='Yes') THROW 52000,'The new response version was not recorded.',1;
BEGIN TRY
 EXEC dbo.AnnouncementWorkspace @a,@employee,'ANSWER',@announcement,N'{"revision":1,"responseRevision":1,"answers":{"vote":"No"}}';
 THROW 52000,'The stale edit was accepted.',1;
END TRY BEGIN CATCH
 IF ERROR_NUMBER()<>51009 OR ERROR_MESSAGE() NOT LIKE 'Your response changed.%' BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
 END;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
SELECT 'PASS: the second tab cannot replace a newer response' AS result;
