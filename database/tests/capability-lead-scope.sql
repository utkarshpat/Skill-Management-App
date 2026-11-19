SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]LeadAudit[_]%' THROW 52000,'Use the isolated lead audit database.',1;
BEGIN TRANSACTION;
DECLARE @a uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),@lead uniqueidentifier=NEWID(),
 @employee uniqueidentifier=NEWID(),@unit uniqueidentifier=NEWID(),@portfolio uniqueidentifier=NEWID(),
 @client uniqueidentifier=NEWID(),@sibling uniqueidentifier=NEWID(),@oracle uniqueidentifier=NEWID(),
 @microsoft uniqueidentifier=NEWID(),@skill uniqueidentifier=NEWID(),@claim uniqueidentifier=NEWID(),
 @cert uniqueidentifier=NEWID(),@second uniqueidentifier=NEWID(),@submission uniqueidentifier=NEWID(),@payload nvarchar(max);
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@a,'issuer-audit','Issuer audit',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@a,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@a,@admin,'Audit Manager','001',1),(@a,@lead,'Audit Lead','002',1),(@a,@employee,'Audit Employee','003',1);
INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Test administrator');
INSERT dbo.AccessOrgNode VALUES(@a,@unit,'DELIVERY_UNIT','Unit',NULL,1),
 (@a,@portfolio,'PORTFOLIO','Portfolio',@unit,1),(@a,@client,'DEPARTMENT','Client',@portfolio,1),
 (@a,@sibling,'DEPARTMENT','Sibling',@portfolio,1);
INSERT dbo.AccessOrgAssignment(account_id,person_id,department_id,manager_id) VALUES(@a,@employee,@client,NULL);
INSERT dbo.CredentialProvider VALUES(@a,@oracle,'Oracle',1,1),(@a,@microsoft,'Microsoft',1,1);
DECLARE @assignment uniqueidentifier=NEWID(),@oracleIds nvarchar(max)=CONCAT(N'["',@oracle,N'"]'),
 @microsoftIds nvarchar(max)=CONCAT(N'["',@microsoft,N'"]');
SET @payload=(SELECT 1 AS revision,@assignment AS id,@lead AS personId,CONVERT(bit,0) AS allIssuers,
 JSON_QUERY(@oracleIds) AS issuerIds,'Initial scoped lead' AS reason,@client AS scopeId,'DEPARTMENT' AS scopeKind,
 'ALLOW' AS effect,CAST(1 AS bit) AS active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.CapabilityLeadAdministration @a,@admin,'PREVIEW',@payload;
IF EXISTS(SELECT 1 FROM dbo.CapabilityLeadScope WHERE account_id=@a) THROW 52000,'Preview mutated grants.',1;
EXEC dbo.CapabilityLeadAdministration @a,@admin,'SAVE',@payload;
IF NOT EXISTS(SELECT 1 FROM dbo.AccessAudit WHERE account_id=@a AND action='capability_lead.assignment') THROW 52000,'Missing assignment audit.',1;
INSERT dbo.CapabilityLeadScope VALUES(@a,NEWID(),@lead,'DEPARTMENT',@sibling,'ALLOW',1,0,@microsoftIds);
INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision)
 VALUES(@a,@skill,'SQL Skill','Data','Fictional skill definition','PUBLISHED',1);
INSERT dbo.SkillDefinitionVersion(account_id,skill_id,definition_revision,framework_id,display_name,category,description,status)
 VALUES(@a,@skill,1,'00000000-0000-4000-8000-000000000003','SQL Skill','Data','Fictional skill definition','PUBLISHED');
INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,
 claimed_rank,level_name,level_description,experience_months,description)
 VALUES(@a,@claim,@employee,@skill,1,1,'SQL Skill','Data',1,'Foundation','Fictional level',12,'Fictional claim');
INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,credential_id,credential_url,notes,status)
 VALUES(@a,@cert,@employee,1,'Oracle SQL','Oracle','Data','2024-01-01','','','','DRAFT'),
       (@a,@second,@employee,1,'Azure Data','Microsoft','Data','2024-01-01','','','','DRAFT');
INSERT dbo.CapabilitySubmission(account_id,id,person_id,revision,status) VALUES(@a,@submission,@employee,1,'DRAFT');
INSERT dbo.CapabilitySubmissionItem(account_id,submission_id,kind,record_id,needs_review) VALUES
 (@a,@submission,'SKILL',@claim,1),(@a,@submission,'CERTIFICATION',@cert,1),(@a,@submission,'CERTIFICATION',@second,1);
INSERT dbo.SkillCertificationLink VALUES(@a,@claim,@cert,@submission,0),(@a,@claim,@second,@submission,0);
INSERT dbo.CertificationImageRecord(account_id,certification_id,evidence_id,blob_name,bytes,mime_type,file_name)
 VALUES(@a,@cert,NEWID(),'oracle-file',10,'application/pdf','oracle.pdf'),
       (@a,@second,NEWID(),'microsoft-file',10,'application/pdf','microsoft.pdf');
IF dbo.CapabilityLeadForSubmission(@a,@submission) IS NOT NULL THROW 52000,'Sibling issuer assignment expanded scope.',1;
DECLARE @analyticsGrant uniqueidentifier=NEWID();
INSERT dbo.BusinessResponsibility VALUES(@a,@analyticsGrant,@lead,'BUSINESS_OPERATIONS','DEPARTMENT',@client,'ALLOW',1,NULL,'Existing analytics assignment');
IF dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>1
 OR dbo.CapabilityLeadHasGrants(@a,@lead)<>1 THROW 52000,'Existing Business Analytics must cover all issuers in scope.',1;
IF OBJECT_ID(N'dbo.BusinessResponsibilityIssuerScope',N'U') IS NOT NULL BEGIN
 IF dbo.CapabilityLeadCoversIssuer(@a,@lead,@employee,N'Legacy uncatalogued issuer')<>1
  THROW 52000,'All issuers should cover uncatalogued historical certificates.',1;
 DECLARE @issuedEdit nvarchar(max)=(SELECT @lead AS personId,'BUSINESS_OPERATIONS' AS bundle,'DEPARTMENT' AS kind,@client AS scopeId,
  'ALLOW' AS effect,CONVERT(bit,1) AS active,'Limit existing assignment to Oracle' AS reason,JSON_QUERY(@oracleIds) AS issuerIds
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC dbo.SaveBusinessChange @a,@admin,2,'RESPONSIBILITY',@analyticsGrant,@issuedEdit;
 IF dbo.BusinessCan(@a,@lead,@employee,NULL)<>0 OR dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>0
  THROW 52000,'Selecting issuers must remove broad analytics and unrelated approvals.',1;
 SET @issuedEdit=JSON_MODIFY(@issuedEdit,'$.issuerIds',JSON_QUERY(N'[]'));
 EXEC dbo.SaveBusinessChange @a,@admin,3,'RESPONSIBILITY',@analyticsGrant,@issuedEdit;
 IF dbo.BusinessCan(@a,@lead,@employee,NULL)<>1 OR dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>1
  THROW 52000,'All issuer coverage should be restored on the same assignment.',1;
 INSERT dbo.CapabilityLeadScope VALUES(@a,NEWID(),@lead,'DEPARTMENT',@client,'DENY',1,0,@microsoftIds);
 IF dbo.BusinessIssuerDenied(@a,@lead,@employee,N'Microsoft')<>1 OR dbo.BusinessIssuerDenied(@a,@lead,@employee,N'Oracle')<>0
  THROW 52000,'Issuer denies should narrow only the matching certificate.',1;
 UPDATE dbo.CapabilityLeadScope SET active=0 WHERE account_id=@a AND effect='DENY';
END;
IF dbo.CapabilityLeadMatches(@a,@lead,@lead,@oracle)<>0 THROW 52000,'An analytics assignee may not approve their own claim.',1;
IF dbo.CapabilityLeadHasGrants(@a,@admin)<>0 THROW 52000,'Admin alone must not grant approvals.',1;
UPDATE dbo.BusinessResponsibility SET scope_id=@sibling WHERE id=@analyticsGrant AND account_id=@a;
IF dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>0 THROW 52000,'Analytics approvals crossed the assigned scope.',1;
UPDATE dbo.BusinessResponsibility SET scope_id=@client,valid_until=DATEADD(day,-1,SYSUTCDATETIME()) WHERE id=@analyticsGrant AND account_id=@a;
IF dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>0 THROW 52000,'Expired analytics assignment granted approvals.',1;
UPDATE dbo.BusinessResponsibility SET valid_until=DATEADD(day,1,SYSUTCDATETIME()),effect='DENY' WHERE id=@analyticsGrant AND account_id=@a;
IF dbo.CapabilityLeadMatches(@a,@lead,@employee,@oracle)<>0 THROW 52000,'Analytics scope deny must also block issuer approval.',1;
DELETE dbo.BusinessResponsibility WHERE id=@analyticsGrant AND account_id=@a;
SET @payload=JSON_MODIFY(JSON_MODIFY(@payload,'$.revision',(SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a)),'$.issuerIds',
 JSON_QUERY(CONCAT(N'["',@oracle,N'","',@microsoft,N'"]')));
EXEC dbo.CapabilityLeadAdministration @a,@admin,'SAVE',@payload;
IF ISNULL(dbo.CapabilityLeadForSubmission(@a,@submission),@employee)<>@lead THROW 52000,'Both issuer assignments should resolve the lead.',1;
UPDATE dbo.AccessOrgAssignment SET manager_id=@admin WHERE account_id=@a AND person_id=@employee;
IF ISNULL(dbo.CapabilityManagerForSubmission(@a,@employee),@employee)<>@admin
 OR dbo.CapabilityLeadCanReviewSubmission(@a,@lead,@submission)<>1 THROW 52000,'N+1 and Lead must both be eligible.',1;
INSERT dbo.CapabilityLeadScope VALUES(@a,NEWID(),@lead,'PORTFOLIO',@portfolio,'DENY',1,0,@microsoftIds);
IF dbo.CapabilityLeadForSubmission(@a,@submission) IS NOT NULL THROW 52000,'Scoped deny did not take precedence.',1;
UPDATE dbo.CapabilityLeadScope SET active=0 WHERE account_id=@a AND effect='DENY';
SET @payload=(SELECT @submission AS id,1 AS revision,
 JSON_QUERY((SELECT @claim AS id,1 AS revision FOR JSON PATH)) AS skills,
 JSON_QUERY((SELECT id,1 AS revision FROM (VALUES(@cert),(@second)) c(id) FOR JSON PATH)) AS certifications
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.CapabilitySubmissionWorkspace @a,@employee,'SUBMIT',@payload;
IF NOT EXISTS(SELECT 1 FROM dbo.CapabilitySubmission WHERE account_id=@a AND id=@submission AND reviewer_id=@admin AND status='SUBMITTED')
 THROW 52000,'Mixed request must preserve the N+1 assignment.',1;
CREATE TABLE #queue(json nvarchar(max));
INSERT #queue EXEC dbo.CapabilitySubmissionWorkspace @a,@lead,'QUEUE',N'{}';
IF NOT EXISTS(SELECT 1 FROM #queue WHERE json LIKE '%' + CONVERT(varchar(36),@submission) + '%')
 THROW 52000,'Lead queue omitted the request.',1;
TRUNCATE TABLE #queue;
INSERT #queue EXEC dbo.CapabilitySubmissionWorkspace @a,@admin,'QUEUE',N'{}';
IF NOT EXISTS(SELECT 1 FROM #queue WHERE json LIKE '%' + CONVERT(varchar(36),@submission) + '%')
 THROW 52000,'N+1 queue omitted the request.',1;
IF EXISTS(SELECT 1 FROM dbo.SchemaMigration WHERE version=114) BEGIN
 DECLARE @older uniqueidentifier=NEWID();
 TRUNCATE TABLE #queue;
 INSERT #queue EXEC dbo.CapabilitySubmissionWorkspace @a,@admin,'QUEUE',N'{"search":"Azure Data"}';
 IF NOT EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$.records') r
  WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id'))=@submission)
  THROW 52000,'Combined queue search missed a supporting certificate.',1;
 INSERT dbo.CapabilitySubmission(account_id,id,person_id,reviewer_id,revision,status,updated_at)
  VALUES(@a,@older,@employee,@admin,1,'SUBMITTED',DATEADD(day,-1,SYSUTCDATETIME()));
 INSERT dbo.CapabilitySubmission(account_id,id,person_id,reviewer_id,revision,status)
  SELECT TOP(50) @a,NEWID(),@employee,@admin,1,'SUBMITTED' FROM sys.all_objects;
 TRUNCATE TABLE #queue;
 INSERT #queue EXEC dbo.CapabilitySubmissionWorkspace @a,@admin,'QUEUE',N'{"page":2,"search":"Audit Employee"}';
 IF NOT EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$.records') r
  WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id'))=@older AND JSON_VALUE(r.value,'$.total')='52')
  THROW 52000,'Combined queue search and paging lost an older pending request.',1;
 DELETE dbo.CapabilitySubmission WHERE account_id=@a AND id<>@submission;
END;
EXEC dbo.CapabilitySubmissionFiles @a,@lead,@submission,@cert;
SET @payload=(SELECT @submission AS id,2 AS revision,
 JSON_QUERY((SELECT id,kind,2 AS revision,'APPROVE' AS action,'Verified fixture' AS feedback
  FROM (VALUES(@claim,'SKILL'),(@cert,'CERTIFICATION'),(@second,'CERTIFICATION')) d(id,kind) FOR JSON PATH)) AS decisions
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.CapabilitySubmissionWorkspace @a,@lead,'DECIDE',@payload;
IF NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@a AND claim_id=@claim AND reviewer_id=@lead AND status='APPROVED')
 OR (SELECT COUNT(*) FROM dbo.CertificationRecord WHERE account_id=@a AND id IN(@cert,@second) AND reviewer_id=@lead AND status='APPROVED')<>2
 THROW 52000,'Fallback failed to commit the complete mixed decision.',1;
CREATE TABLE #notice(id varchar(120),at datetime2,title nvarchar(400),subject nvarchar(400),
 body nvarchar(max),actorName nvarchar(400),actionLabel nvarchar(400),href varchar(400));
INSERT #notice EXEC dbo.ReadCapabilitySubmissionNotifications @a,@admin;
IF NOT EXISTS(SELECT 1 FROM #notice WHERE title LIKE N'Business Analytics%' AND actorName='Audit Lead'
 AND body LIKE '%CERTIFICATION APPROVED: Verified fixture%' AND body LIKE '%SKILL APPROVED: Verified fixture%')
 THROW 52000,'Responsible N+1 is missing the lead decision and comments.',1;
TRUNCATE TABLE #queue;
INSERT #queue EXEC dbo.CapabilitySubmissionWorkspace @a,@admin,'QUEUE',N'{}';
IF EXISTS(SELECT 1 FROM #queue WHERE json LIKE '%' + CONVERT(varchar(36),@submission) + '%')
 THROW 52000,'Completed request was still actionable by N+1.',1;
UPDATE dbo.CapabilityLeadScope SET issuer_ids=@oracleIds WHERE account_id=@a AND id=@assignment;
TRUNCATE TABLE #queue;
INSERT #queue EXEC dbo.ReadCapabilityLeadAnalytics @a,@lead;
IF NOT EXISTS(SELECT 1 FROM #queue WHERE JSON_VALUE(json,'$.issuers[0].issuer')='Oracle'
 AND JSON_VALUE(json,'$.issuers[0].valid')='1' AND JSON_QUERY(json,'$.issuers[1]') IS NULL)
 THROW 52000,'Analytics must intersect issuers with employee scope.',1;
IF OBJECT_ID(N'dbo.BusinessResponsibilityIssuerScope',N'U') IS NOT NULL BEGIN
 INSERT dbo.BusinessResponsibility VALUES(@a,@analyticsGrant,@lead,'BUSINESS_OPERATIONS','DEPARTMENT',@client,'ALLOW',1,NULL,'All issuer analytics');
 DECLARE @issuerBlock uniqueidentifier=NEWID();
 INSERT dbo.CapabilityLeadScope VALUES(@a,@issuerBlock,@lead,'DEPARTMENT',@client,'DENY',1,0,@microsoftIds);
 TRUNCATE TABLE #queue;
 INSERT #queue EXEC dbo.BusinessDashboard @a,@lead,N'{"dataset":"certifications","page":1,"minRank":1,"maxRank":4}',1;
 IF NOT EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$.rows') r WHERE JSON_VALUE(r.value,'$.issuer')='Oracle')
  OR EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$.rows') r WHERE JSON_VALUE(r.value,'$.issuer')='Microsoft')
  THROW 52000,'The full analytics export must respect issuer DENY without hiding permitted issuers.',1;
 IF EXISTS(SELECT 1 FROM dbo.SchemaMigration WHERE version=114) BEGIN
  TRUNCATE TABLE #queue;
  INSERT #queue EXEC dbo.ExcelBulkData @a,@lead,'certifications','EXPORT',N'{"view":"scope"}';
  IF NOT EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$."Employee Certifications"') r WHERE JSON_VALUE(r.value,'$.Issuer')='Oracle')
   OR EXISTS(SELECT 1 FROM #queue q CROSS APPLY OPENJSON(q.json,'$."Employee Certifications"') r WHERE JSON_VALUE(r.value,'$.Issuer')='Microsoft')
   THROW 52000,'Scoped Excel must enforce issuer DENY.',1;
 END;
 DELETE dbo.BusinessResponsibility WHERE account_id=@a AND id=@analyticsGrant;
 UPDATE dbo.CapabilityLeadScope SET active=0 WHERE account_id=@a AND id=@issuerBlock;
END;
DECLARE @legacy uniqueidentifier=NEWID();
-- Emulate an already-submitted row from before the combined-request requirement.
DISABLE TRIGGER dbo.CertificationRelatedSkillRequired ON dbo.CertificationRecord;
INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,credential_id,credential_url,notes,status,requires_skill_link,reviewer_id)
 VALUES(@a,@legacy,@employee,1,'Legacy Oracle','Oracle','Data','2022-01-01','','','','SUBMITTED',0,@admin);
ENABLE TRIGGER dbo.CertificationRelatedSkillRequired ON dbo.CertificationRecord;
IF dbo.CapabilityLeadCanReviewCredential(@a,@lead,@legacy)<>1 THROW 52000,'Standalone fallback not resolved.',1;
SET @payload=(SELECT @legacy AS id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.CertificationWorkspace @a,@lead,'GET',@payload;
EXEC dbo.CertificationImage @account_id=@a,@actor_id=@lead,@claim_id=@legacy,@operation='READ';
SET @payload=(SELECT @legacy AS id,1 AS revision,'Verified legacy credential' AS feedback FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.CertificationWorkspace @a,@lead,'REJECT',@payload;
IF NOT EXISTS(SELECT 1 FROM dbo.CertificationRecord WHERE account_id=@a AND id=@legacy AND reviewer_id=@lead AND status='REJECTED')
 THROW 52000,'Standalone approval failed.',1;
CREATE TABLE #certNotice(id varchar(120),at datetime2,title nvarchar(400),body nvarchar(max),
 actorName nvarchar(400),actionLabel nvarchar(400),href varchar(400));
INSERT #certNotice EXEC dbo.ReadCertificationNotifications @a,@admin;
IF NOT EXISTS(SELECT 1 FROM #certNotice WHERE title LIKE N'Business Analytics%' AND actorName='Audit Lead'
 AND body LIKE '%Verified legacy credential%')
 THROW 52000,'Standalone decision was missing from N+1 notifications.',1;
SET @payload=(SELECT @submission AS id,2 AS revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
BEGIN TRY
 EXEC dbo.CapabilitySubmissionWorkspace @a,@admin,'DECIDE',@payload;
 THROW 52000,'A stale N+1 decision was accepted.',1;
END TRY BEGIN CATCH
 IF ERROR_NUMBER() NOT IN(51003,51009,51010) THROW;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK;
SELECT 'PASS: parallel queues, first saved decision, scoped DENY and analytics, audited multi-issuer grants, evidence and N+1 comments' AS result;
