SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]LeadAudit[_]%' THROW 52000,'Use the isolated audit database.',1;
BEGIN TRANSACTION;
DECLARE @a uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),@employee uniqueidentifier=NEWID();
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@a,'excel-audit','Excel audit',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@a,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@a,@admin,'Audit Admin','001',1),(@a,@employee,'Audit Employee','002',1);
INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Test administrator');
INSERT dbo.CertificationRecord(account_id,id,person_id,revision,certification_name,provider,category,issue_date,expiry_date,credential_id,credential_url,notes,status,requires_skill_link)
 VALUES(@a,NEWID(),@employee,1,'Oracle SQL','Oracle','Data','2024-01-01','2027-01-01','abc','','','APPROVED',0);
DECLARE @workbook nvarchar(max)=N'{"rows":[{"row":9,"section":"CERTIFICATION","employee":"002","name":"Oracle SQL","issuer":"Oracle","category":"Data","issued":"2024-01-01","expiry":"2027-01-01","credential":"abc","source":"Legacy","sourceId":"ABC","status":"APPROVED"}]}';
CREATE TABLE #result(json nvarchar(max));
INSERT #result EXEC dbo.ExcelBulkData @a,@admin,'certifications','IMPORT',@workbook,1;
IF NOT EXISTS(SELECT 1 FROM #result WHERE JSON_VALUE(json,'$.duplicates')='1' AND JSON_VALUE(json,'$.changed')='0')
 THROW 52000,'An exact imported duplicate was not skipped.',1;
SET @workbook=JSON_MODIFY(@workbook,'$.rows[0].expiry','2028-01-01');
BEGIN TRY
 EXEC dbo.ExcelBulkData @a,@admin,'certifications','PREVIEW',@workbook;
 THROW 52000,'Conflicting approved certificate metadata was not flagged.',1;
END TRY BEGIN CATCH
 IF ERROR_NUMBER()<>51000 OR ERROR_MESSAGE() NOT LIKE 'CERTIFICATION, row 9: Existing approved certificate has different%' BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
 END;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
SELECT 'PASS: exact duplicates are skipped and conflicting approved rows are flagged' AS result;
