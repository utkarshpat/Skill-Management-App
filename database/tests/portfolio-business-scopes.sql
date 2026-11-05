-- Run only in the explicitly created local portfolio audit database. All fixtures roll back.
SET NOCOUNT ON; SET XACT_ABORT ON;
IF DB_NAME() NOT LIKE 'SkillMgmt[_]PortfolioAudit[_]%' THROW 52000,'Use the isolated local portfolio audit database.',1;
DECLARE @a uniqueidentifier=NEWID(),@admin uniqueidentifier=NEWID(),@analyst uniqueidentifier=NEWID(),
 @employee uniqueidentifier=NEWID(),@other uniqueidentifier=NEWID(),@unit uniqueidentifier=NEWID(),
 @portfolio uniqueidentifier=NEWID(),@second uniqueidentifier=NEWID(),@client uniqueidentifier=NEWID(),
 @otherClient uniqueidentifier=NEWID(),@grant uniqueidentifier=NEWID(),@deny uniqueidentifier=NEWID();
BEGIN TRANSACTION;
INSERT dbo.Account(account_id,account_code,display_name,entra_tenant_id) VALUES(@a,'portfolio-scope-check','Customer Delivery India',NEWID());
INSERT dbo.AccessWorkspace(account_id,revision,personal_baseline_enabled) VALUES(@a,1,1);
INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES
 (@a,@admin,'Neha Rao','710901',1),(@a,@analyst,'Rohan Mehta','710902',1),
 (@a,@employee,'Aditi Menon','710903',1),(@a,@other,'Arjun Sethi','710904',1);
INSERT dbo.AccessOrgNode VALUES(@a,@unit,'DELIVERY_UNIT','India Delivery',NULL,1),
 (@a,@portfolio,'PORTFOLIO','Financial Services',@unit,1),(@a,@second,'PORTFOLIO','Public Services',@unit,1),
 (@a,@client,'DEPARTMENT','Northstar Bank',@portfolio,1),(@a,@otherClient,'DEPARTMENT','City Transit',@second,1);
INSERT dbo.AccessOrgAssignment(account_id,person_id,department_id,manager_id) VALUES(@a,@employee,@client,@admin),(@a,@other,@otherClient,@admin);
INSERT dbo.BusinessResponsibility VALUES(@a,NEWID(),@admin,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,'Explicit test administration');
IF dbo.BusinessScopeValid(@a,'PORTFOLIO',@portfolio)<>1 THROW 52000,'Active portfolio rejected',1;
IF dbo.BusinessScopeCovers(@a,'DELIVERY_UNIT',@unit,'PORTFOLIO',@portfolio)<>1 OR dbo.BusinessScopeCovers(@a,'PORTFOLIO',@portfolio,'DEPARTMENT',@client)<>1 THROW 52000,'Hierarchy coverage missing',1;
IF dbo.BusinessScopeCovers(@a,'PORTFOLIO',@portfolio,'DEPARTMENT',@otherClient)<>0 THROW 52000,'Sibling scope leak',1;
DECLARE @payload nvarchar(max)=(SELECT @analyst AS personId,'BUSINESS_OPERATIONS' AS bundle,'PORTFOLIO' AS kind,@portfolio AS scopeId,'ALLOW' AS effect,CAST(1 AS bit) AS active,'Reviewed Financial Services analytics' AS reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.SaveBusinessChange @a,@admin,1,'RESPONSIBILITY',@grant,@payload;
IF NOT EXISTS(SELECT 1 FROM dbo.AccessAudit WHERE account_id=@a AND target_id=@grant) THROW 52000,'Responsibility change not audited',1;
IF (SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@a)<>2 THROW 52000,'Responsibility revision not advanced',1;
IF (SELECT COUNT(*) FROM dbo.BusinessVisiblePeople(@a,@analyst,NULL))<>1 OR NOT EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@a,@analyst,NULL) WHERE person_id=@employee) THROW 52000,'Portfolio population leak',1;
IF EXISTS(SELECT 1 FROM dbo.BusinessHierarchy(@a,@analyst) WHERE id IN(@second,@otherClient)) THROW 52000,'Unauthorized hierarchy discovery',1;
IF (SELECT COUNT(*) FROM dbo.BusinessHierarchy(@a,@analyst))<>3 THROW 52000,'Authorized hierarchy discovery incomplete',1;
IF JSON_VALUE(dbo.BusinessProjection(@a,@analyst),'$.scopes[0].label')<>'Financial Services' THROW 52000,'Portfolio label missing',1;
DECLARE @query nvarchar(max)=(SELECT 'people' AS dataset,'' AS search,'' AS status,'' AS validity,'' AS category,'' AS issuer,1 AS minRank,4 AS maxRank,1 AS page,'employee_asc' AS sort,@portfolio AS hierarchyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
EXEC dbo.BusinessDashboard @a,@analyst,@query,0;
EXEC dbo.BusinessDashboard @a,@analyst,@query,1;
DECLARE @provider uniqueidentifier=NEWID(),@credential uniqueidentifier=NEWID();
INSERT dbo.CredentialProvider VALUES(@a,@provider,'Oracle',1,1);
INSERT dbo.CredentialDefinition VALUES(@a,@credential,'Oracle Database SQL',@provider,'Databases','SQL reporting credential',1,1);
DECLARE @matching nvarchar(max)=(SELECT JSON_QUERY('[]') AS skills,JSON_QUERY('["'+CONVERT(varchar(36),@credential)+'"]') AS certifications,1 AS page,CAST(0 AS bit) AS onlyEligible,@portfolio AS hierarchyId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
DECLARE @matched TABLE(json nvarchar(max));
INSERT @matched EXEC dbo.BusinessPeopleSearch @a,@analyst,@matching,1;
IF (SELECT TRY_CONVERT(int,JSON_VALUE(json,'$.total')) FROM @matched)<>1 OR (SELECT JSON_VALUE(json,'$.rows[0].employee') FROM @matched)<>'Aditi Menon' THROW 52000,'Filtered matching export population leak',1;
INSERT dbo.BusinessResponsibility VALUES(@a,@deny,@analyst,'BUSINESS_OPERATIONS','DEPARTMENT',@client,'DENY',1,DATEADD(day,1,SYSUTCDATETIME()),'Scoped client restriction');
IF EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@a,@analyst,NULL)) THROW 52000,'Client DENY did not subtract from portfolio',1;
UPDATE dbo.BusinessResponsibility SET scope_kind='DELIVERY_UNIT',scope_id=@unit WHERE account_id=@a AND id=@deny;
IF dbo.BusinessResponsibilityUsable(@a,@analyst,@grant)<>0 THROW 52000,'DU DENY did not cover portfolio grant',1;
UPDATE dbo.BusinessResponsibility SET valid_until=DATEADD(day,-1,SYSUTCDATETIME()) WHERE account_id=@a AND id=@deny;
IF dbo.BusinessResponsibilityUsable(@a,@analyst,@grant)<>1 THROW 52000,'Expired DENY remained effective',1;
UPDATE dbo.AccessOrgNode SET active=0 WHERE account_id=@a AND node_id=@unit;
IF dbo.BusinessScopeValid(@a,'PORTFOLIO',@portfolio)<>0 OR EXISTS(SELECT 1 FROM dbo.BusinessVisiblePeople(@a,@analyst,NULL)) THROW 52000,'Inactive DU failed open',1;
UPDATE dbo.AccessOrgNode SET active=1 WHERE account_id=@a AND node_id=@unit;
UPDATE dbo.BusinessResponsibility SET active=0 WHERE account_id=@a AND id=@grant;
IF EXISTS(SELECT 1 FROM dbo.BusinessHierarchy(@a,@analyst)) THROW 52000,'Revoked grant retained hierarchy',1;
UPDATE dbo.BusinessResponsibility SET active=1 WHERE account_id=@a AND id=@grant;
DECLARE @forged nvarchar(max)=JSON_MODIFY(@query,'$.hierarchyId',CONVERT(varchar(36),@otherClient)),@rejected bit=0;
BEGIN TRY
 EXEC dbo.BusinessDashboard @a,@analyst,@forged,1;
END TRY BEGIN CATCH
 IF ERROR_NUMBER()<>51003 THROW;
 SET @rejected=1;
END CATCH;
IF @@TRANCOUNT>0 ROLLBACK;
IF @rejected<>1 THROW 52000,'Forged hierarchy export was accepted',1;
SELECT 'PASS: audited/revisioned Portfolio save; active ancestry; sibling isolation; analytics/matching/export; DU/client DENY; expiry; revocation; hierarchy discovery; forged export; rolled back' AS result;
