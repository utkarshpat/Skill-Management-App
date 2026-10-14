-- Read-only matching for AI conversations. No saved demands, grants or staffing decisions.
CREATE OR ALTER PROCEDURE dbo.BusinessPeopleSearch
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@payload nvarchar(max),@export bit=0 AS BEGIN
 SET NOCOUNT ON;
 -- Use the same canonical projection as BusinessContext without INSERT EXEC.
 -- Its denial path rolls back its transaction, which SQL forbids under INSERT EXEC.
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 DECLARE @context nvarchar(max),@policy nvarchar(max)=dbo.BusinessProjection(@account_id,@actor_id);
 SET @context=(SELECT w.revision,@actor_id AS actorId,SYSUTCDATETIME() AS asOf,
  dbo.BusinessHasAccess(@account_id,@actor_id) AS canView,
  CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account_id,@actor_id)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
  CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,
  dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,
  CONVERT(bit,JSON_VALUE(@policy,'$.demandView')) AS canDemandView,
  CONVERT(bit,JSON_VALUE(@policy,'$.demandCreate')) AS canDemandCreate,
  CONVERT(bit,JSON_VALUE(@policy,'$.matchingRun')) AS canMatch,
  CONVERT(bit,JSON_VALUE(@policy,'$.shortlist')) AS canShortlist,
  CONVERT(bit,JSON_VALUE(@policy,'$.approve')) AS canApprove,
  w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(JSON_QUERY(@policy,'$.scopes')) AS scopes
  FROM dbo.AccessWorkspace w JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
  WHERE w.account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF ISNULL(JSON_VALUE(@context,'$.canView'),'false')<>'true' OR ISNULL(JSON_VALUE(@context,'$.canMatch'),'false')<>'true'
  OR @export=1 AND ISNULL(JSON_VALUE(@context,'$.canExport'),'false')<>'true' THROW 51003,'Matching access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>16000 THROW 51000,'Invalid matching request.',1;
 DECLARE @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),
  @page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),
  @eligible bit=CASE JSON_VALUE(@payload,'$.onlyEligible') WHEN 'true' THEN 1 ELSE 0 END,
  @skills nvarchar(max)=JSON_QUERY(@payload,'$.skills'),@certs nvarchar(max)=JSON_QUERY(@payload,'$.certifications'),
  @required int,@requirements nvarchar(max),@total int,@eligibleTotal int,@size int=25,@offset int;
 IF @page IS NULL OR @page NOT BETWEEN 1 AND 10000 OR @skills IS NULL OR @certs IS NULL THROW 51000,'Invalid matching request.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='scopeId') AND (@scope IS NULL OR NOT EXISTS(
  SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope
  AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)) THROW 51003,'Selected scope unavailable.',1;
 SET @required=(SELECT COUNT(*) FROM OPENJSON(@skills))+(SELECT COUNT(*) FROM OPENJSON(@certs));
 IF @required NOT BETWEEN 1 AND 20 THROW 51000,'Choose 1 to 20 requirements.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@skills) s LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account_id
  AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id')) AND c.status='PUBLISHED'
  LEFT JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision
  WHERE c.skill_id IS NULL OR v.framework_id IS NULL OR v.framework_id<>'00000000-0000-4000-8000-000000000003'
  OR TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) NOT BETWEEN 1 AND 4)
  OR EXISTS(SELECT 1 FROM OPENJSON(@certs) s LEFT JOIN dbo.CredentialDefinition c ON c.account_id=@account_id AND c.id=TRY_CONVERT(uniqueidentifier,s.value) AND c.active=1
  LEFT JOIN dbo.CredentialProvider p ON p.account_id=c.account_id AND p.id=c.provider_id AND p.active=1 WHERE c.id IS NULL OR p.id IS NULL)
  THROW 51000,'Choose published four-level skills and active credentials.',1;
 IF EXISTS(SELECT JSON_VALUE(value,'$.id') FROM OPENJSON(@skills) GROUP BY JSON_VALUE(value,'$.id') HAVING COUNT(*)>1)
  OR EXISTS(SELECT value FROM OPENJSON(@certs) GROUP BY value HAVING COUNT(*)>1) THROW 51000,'Duplicate requirement.',1;
 SET @requirements=(SELECT JSON_QUERY(@skills) AS skills,JSON_QUERY(@certs) AS certifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SELECT p.person_id,p.display_name,p.employee_code INTO #people FROM dbo.AccessPerson p
  JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id;
 SELECT p.person_id,c.type,c.name,c.criterion,c.matched INTO #criteria FROM #people p
  CROSS APPLY dbo.BusinessMatchRequirements(@account_id,p.person_id,@requirements) c;
 SELECT p.person_id,p.display_name,p.employee_code,ISNULL(SUM(CONVERT(int,c.matched)),0) AS matched INTO #matches
  FROM #people p LEFT JOIN #criteria c ON c.person_id=p.person_id GROUP BY p.person_id,p.display_name,p.employee_code;
 SELECT @eligibleTotal=COUNT(*) FROM #matches WHERE matched=@required;
 SELECT @total=COUNT(*) FROM #matches WHERE @eligible=0 OR matched=@required;
 IF @export=1 AND @total>5000 THROW 51000,'Narrow the scope before exporting more than 5000 people.',1;
 IF @export=1 BEGIN SET @size=5000;SET @page=1;END;
 SET @offset=(@page-1)*@size;
 SELECT (SELECT JSON_QUERY(@context) AS context,@total AS total,@eligibleTotal AS eligibleTotal,@required AS required,@page AS page,@size AS pageSize,
  JSON_QUERY((SELECT CONVERT(varchar(36),m.person_id) AS id,m.display_name AS employee,m.employee_code AS employeeCode,m.matched,
   CONVERT(bit,CASE WHEN m.matched=@required THEN 1 ELSE 0 END) AS eligible,
   JSON_QUERY((SELECT type,name,criterion,matched FROM #criteria c WHERE c.person_id=m.person_id ORDER BY type,name FOR JSON PATH)) AS criteria
   FROM #matches m WHERE @eligible=0 OR m.matched=@required ORDER BY m.matched DESC,m.display_name,m.person_id
   OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH)) AS rows,
  JSON_QUERY((SELECT type,name,criterion FROM dbo.BusinessMatchRequirements(@account_id,@actor_id,@requirements) ORDER BY type,name FOR JSON PATH)) AS requirements
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
END;
GO
GRANT EXECUTE ON dbo.BusinessPeopleSearch TO [skill_management_runtime];
