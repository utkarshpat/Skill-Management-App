-- Add employee profile metadata and a preview-bound, insert-only workbook action.
ALTER TABLE dbo.AccessPerson ADD work_email nvarchar(254) NULL, work_location nvarchar(100) NULL;
GO
SET QUOTED_IDENTIFIER ON;
CREATE UNIQUE INDEX UX_AccessPerson_WorkEmail ON dbo.AccessPerson(account_id,work_email) WHERE work_email IS NOT NULL;
GO

CREATE OR ALTER PROCEDURE dbo.ExcelEmployeeBulkData
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@kind varchar(20),
 @operation varchar(12),@payload nvarchar(max)=N'{}',@revision int=NULL
AS
BEGIN
 SET NOCOUNT ON;
 SET XACT_ABORT ON;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
   SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id)
   THROW 51003,'Workspace denied.',1;
 IF @kind IS NULL OR @kind<>'employees' OR @operation IS NULL OR @operation NOT IN('ACCESS','PREVIEW','IMPORT')
   OR @payload IS NULL OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>4000000
   THROW 51000,'Invalid employee workbook request.',1;
 DECLARE @current int,@allowed bit;
 SELECT @current=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 SET @allowed=CASE WHEN @current IS NOT NULL AND dbo.AccessCan(@account_id,@actor_id,'profile.view',1)=1
   AND dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1
   AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1
   AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END;
 IF @operation='ACCESS' BEGIN
   SELECT (SELECT @allowed AS canImport FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
   COMMIT; RETURN;
 END;
 IF @allowed=0 THROW 51003,'Employee import requires administration access.',1;
 IF @operation='IMPORT' AND (@revision IS NULL OR @revision<>@current)
   THROW 51009,'Workspace changed. Preview the workbook again.',1;

 SELECT row_num,NEWID() AS id,TRIM(employee) AS employee,TRIM(name) AS name,
   NULLIF(LOWER(TRIM(work_email)),N'') AS work_email,NULLIF(TRIM(work_location),N'') AS work_location,
   NULLIF(TRIM(job_title),N'') AS job_title,NULLIF(TRIM(grade),N'') AS grade,
   NULLIF(TRIM(primary_skill),N'') AS primary_skill,NULLIF(TRIM(delivery_unit),N'') AS delivery_unit,
   NULLIF(TRIM(portfolio),N'') AS portfolio,NULLIF(TRIM(client),N'') AS client,
   NULLIF(TRIM(project),N'') AS project,NULLIF(TRIM(manager_code),N'') AS manager_code,
   CAST(NULL AS uniqueidentifier) AS skill_id,CAST(NULL AS uniqueidentifier) AS department_id,
   CAST(NULL AS uniqueidentifier) AS team_id,CAST(NULL AS uniqueidentifier) AS manager_id
 INTO #employees
 FROM OPENJSON(@payload,'$.rows') WITH (
   row_num int '$.row', employee nvarchar(max) '$.employee', name nvarchar(max) '$.name',
   work_email nvarchar(max) '$.workEmail', work_location nvarchar(max) '$.workLocation',
   job_title nvarchar(max) '$.jobTitle', grade nvarchar(max) '$.grade', primary_skill nvarchar(max) '$.primarySkill',
   delivery_unit nvarchar(max) '$.deliveryUnit', portfolio nvarchar(max) '$.portfolio', client nvarchar(max) '$.client',
   project nvarchar(max) '$.project', manager_code nvarchar(max) '$.manager');
 DECLARE @count int=@@ROWCOUNT,@badRow int,@error nvarchar(2048),@examples nvarchar(max);
 IF @count NOT BETWEEN 1 AND 1000 OR (SELECT COUNT(DISTINCT row_num) FROM #employees)<>@count
   THROW 51000,'Enter 1 to 1,000 distinct employee rows.',1;
 SELECT TOP (1) @badRow=row_num FROM #employees WHERE row_num<2 OR employee IS NULL OR employee=N'' OR name IS NULL OR name=N''
   OR DATALENGTH(employee)>80 OR DATALENGTH(name)>200 OR DATALENGTH(work_email)>508
   OR (work_email IS NOT NULL AND (work_email NOT LIKE N'%_@_%._%' OR work_email LIKE N'% %' OR work_email LIKE N'%@%@%'))
   OR DATALENGTH(work_location)>200 OR DATALENGTH(job_title)>200 OR DATALENGTH(grade)>80
   OR DATALENGTH(primary_skill)>200 OR DATALENGTH(delivery_unit)>200 OR DATALENGTH(portfolio)>200
   OR DATALENGTH(client)>200 OR DATALENGTH(project)>200 OR DATALENGTH(manager_code)>80
 ORDER BY row_num;
 IF @badRow IS NOT NULL BEGIN
   SET @error=CONCAT(N'Employees, row ',@badRow,N': check the employee code, name and profile fields.'); THROW 51000,@error,1;
 END;
 SELECT TOP (1) @badRow=e.row_num FROM #employees e WHERE
   EXISTS(SELECT 1 FROM #employees duplicate WHERE duplicate.row_num<e.row_num
     AND (duplicate.employee=e.employee OR duplicate.work_email=e.work_email))
   OR EXISTS(SELECT 1 FROM dbo.AccessPerson p WHERE p.account_id=@account_id
     AND (p.employee_code=e.employee OR p.work_email=e.work_email))
 ORDER BY e.row_num;
 IF @badRow IS NOT NULL BEGIN
   SET @error=CONCAT(N'Employees, row ',@badRow,N': employee code or work email already exists.'); THROW 51000,@error,1;
 END;
 UPDATE e SET skill_id=s.skill_id,department_id=d.node_id,team_id=t.node_id,manager_id=COALESCE(batch.id,m.person_id)
 FROM #employees e
 LEFT JOIN dbo.SkillCatalogue s ON s.account_id=@account_id AND s.status='PUBLISHED' AND s.display_name=e.primary_skill COLLATE Latin1_General_100_CI_AS
 LEFT JOIN dbo.AccessOrgNode u ON u.account_id=@account_id AND u.active=1 AND u.kind='DELIVERY_UNIT'
   AND u.parent_id IS NULL AND u.display_name=e.delivery_unit
 LEFT JOIN dbo.AccessOrgNode p ON p.account_id=@account_id AND p.active=1 AND p.kind='PORTFOLIO'
   AND p.parent_id=u.node_id AND p.display_name=e.portfolio
 LEFT JOIN dbo.AccessOrgNode d ON d.account_id=@account_id AND d.active=1 AND d.kind='DEPARTMENT'
   AND d.parent_id=p.node_id AND d.display_name=e.client
 LEFT JOIN dbo.AccessOrgNode t ON t.account_id=@account_id AND t.active=1 AND t.kind='TEAM'
   AND t.parent_id=d.node_id AND t.display_name=e.project
 LEFT JOIN #employees batch ON batch.employee=e.manager_code
 LEFT JOIN dbo.AccessPerson m ON m.account_id=@account_id AND m.active=1 AND m.employee_code=e.manager_code;
 SELECT TOP (1) @badRow=e.row_num,
   @error=CASE
     WHEN e.primary_skill IS NOT NULL AND e.skill_id IS NULL THEN N'Primary Skill must match a published catalogue skill.'
     WHEN e.manager_code IS NOT NULL AND e.manager_id IS NULL THEN N'Manager Employee Code must match an active employee or a row in this workbook.'
     ELSE N'Enter an existing active Delivery Unit, Portfolio and Account/Client, with an optional Project in that account.'
   END
 FROM #employees e WHERE (e.primary_skill IS NOT NULL AND e.skill_id IS NULL)
   OR (e.manager_code IS NOT NULL AND e.manager_id IS NULL)
   OR ((e.delivery_unit IS NOT NULL OR e.portfolio IS NOT NULL OR e.client IS NOT NULL OR e.project IS NOT NULL)
      AND (e.department_id IS NULL OR (e.project IS NOT NULL AND e.team_id IS NULL)))
 ORDER BY e.row_num;
 IF @badRow IS NOT NULL BEGIN
   SET @error=CONCAT(N'Employees, row ',@badRow,N': ',@error); THROW 51000,@error,1;
 END;

 -- Validate the proposed reporting chain, including managers newly imported in the same workbook.
 CREATE TABLE #reporting_edges(person_id uniqueidentifier NOT NULL PRIMARY KEY,manager_id uniqueidentifier NULL);
 INSERT #reporting_edges SELECT id,manager_id FROM #employees;
 INSERT #reporting_edges
   SELECT p.person_id,a.manager_id FROM dbo.AccessPerson p
   LEFT JOIN dbo.AccessOrgAssignment a ON a.account_id=p.account_id AND a.person_id=p.person_id
   WHERE p.account_id=@account_id AND p.active=1;
 ;WITH reporting AS (
   SELECT row_num,id AS person_id,manager_id,0 AS depth FROM #employees WHERE manager_id IS NOT NULL
   UNION ALL
   SELECT r.row_num,e.person_id,e.manager_id,r.depth+1 FROM reporting r
   JOIN #reporting_edges e ON e.person_id=r.manager_id WHERE r.depth<201
 )
 SELECT @badRow=MIN(r.row_num) FROM reporting r WHERE r.depth=201
   OR (r.manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM #reporting_edges e WHERE e.person_id=r.manager_id))
 OPTION (MAXRECURSION 202);
 IF @badRow IS NOT NULL BEGIN
   SET @error=CONCAT(N'Employees, row ',@badRow,N': reporting line is circular, inactive or invalid.'); THROW 51000,@error,1;
 END;
 IF @operation='PREVIEW'
   SELECT @examples=(SELECT TOP (20) e.row_num AS row,N'Employees' AS section,
     CONCAT_WS(N' · ',CONCAT(e.employee,N' — ',e.name),e.work_email,e.work_location,e.job_title,e.grade,e.primary_skill,
       CASE WHEN e.department_id IS NOT NULL THEN CONCAT_WS(N' → ',e.delivery_unit,e.portfolio,e.client,e.project) END,
       CASE WHEN e.manager_id IS NOT NULL THEN CONCAT(N'Manager ',COALESCE(b.name,p.display_name),N' (',e.manager_code,N')') END) AS label
     FROM #employees e
     LEFT JOIN #employees b ON b.id=e.manager_id
     LEFT JOIN dbo.AccessPerson p ON p.account_id=@account_id AND p.person_id=e.manager_id
     ORDER BY e.row_num FOR JSON PATH);
 ELSE BEGIN
   INSERT dbo.AccessPerson(account_id,person_id,employee_code,display_name,active,job_title,grade,primary_capability_id,work_email,work_location)
     SELECT @account_id,id,employee,name,1,job_title,grade,skill_id,work_email,work_location FROM #employees;
   INSERT dbo.AccessOrgAssignment(account_id,person_id,manager_id,department_id,team_id)
     SELECT @account_id,id,manager_id,CASE WHEN team_id IS NULL THEN department_id END,team_id
     FROM #employees WHERE manager_id IS NOT NULL OR department_id IS NOT NULL;
   IF EXISTS(SELECT 1 FROM #employees e WHERE e.manager_id IS NOT NULL AND dbo.AccessReportingValid(@account_id,e.id)<>1)
     THROW 51000,'Reporting line changed. Preview again.',1;
   INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json)
     SELECT @account_id,@current+ROW_NUMBER() OVER (ORDER BY e.row_num),@actor_id,'person.created',e.id,
      (SELECT e.employee AS employeeCode,e.name AS displayName,CAST(1 AS bit) AS active,e.job_title AS jobTitle,e.grade,
        e.skill_id AS primaryCapabilityId,CASE WHEN e.team_id IS NULL THEN e.department_id END AS departmentId,
        e.team_id AS teamId,e.manager_id AS managerId,
        N'Employee workbook' AS source FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
     FROM #employees e;
   SET @current+=@count;
   UPDATE dbo.AccessWorkspace SET revision=@current WHERE account_id=@account_id;
 END;
 SELECT (SELECT @current AS revision,@count AS changed,0 AS duplicates,@count AS added,
   JSON_QUERY(@examples) AS examples FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT;
 END TRY BEGIN CATCH
   IF @@TRANCOUNT>0 ROLLBACK;
   THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ExcelEmployeeBulkData TO [skill_management_runtime];
GO

CREATE OR ALTER PROCEDURE dbo.ReadPeopleAdministration
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@mode varchar(12),@person_id uniqueidentifier=NULL,
 @kind varchar(12)=NULL,@query nvarchar(100)=N'',@page int=1,@node_kind varchar(20)=NULL,@parent_id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 THROW 51003,'People administration denied.',1;
 SET @query=LTRIM(RTRIM(ISNULL(@query,N'')));
 IF @mode='DIRECTORY' BEGIN
  IF @kind IS NULL OR @kind NOT IN('people','templates','nodes') OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid directory search.',1;
  IF @kind='nodes' AND (@node_kind IS NULL OR @node_kind NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','TEAM') OR @node_kind='DELIVERY_UNIT' AND @parent_id IS NOT NULL OR @node_kind<>'DELIVERY_UNIT' AND @parent_id IS NULL) THROW 51000,'Choose the preceding organization level.',1;
  DECLARE @offset int=(@page-1)*10,@total int,@items nvarchar(max);
  IF @kind='people' AND LEN(@query)<2 BEGIN
   SELECT (SELECT @revision AS revision,JSON_QUERY('[]') AS items,0 AS total,@page AS page,10 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
   COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;RETURN;
  END;
  IF @kind='people' BEGIN
   SELECT @total=COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND (CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0);
   SET @items=(SELECT LOWER(CONVERT(varchar(36),person_id)) AS id,display_name AS name,employee_code AS employeeCode,active FROM dbo.AccessPerson WHERE account_id=@account_id AND (CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0) ORDER BY display_name,person_id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH);
  END ELSE IF @kind='templates' BEGIN
   SELECT @total=COUNT(*) FROM dbo.AccountRole WHERE account_id=@account_id AND (@query=N'' OR CHARINDEX(@query,display_name)>0);
   SET @items=(SELECT LOWER(CONVERT(varchar(36),r.role_id)) AS id,r.display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission p WHERE p.account_id=r.account_id AND p.role_id=r.role_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole r WHERE r.account_id=@account_id AND (@query=N'' OR CHARINDEX(@query,r.display_name)>0) ORDER BY r.display_name,r.role_id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH);
  END ELSE BEGIN
   DECLARE @nodes TABLE(id uniqueidentifier PRIMARY KEY,name nvarchar(100),parent_id uniqueidentifier,kind varchar(20));
   INSERT @nodes SELECT node_id,display_name,parent_id,kind FROM dbo.AccessOrgNode WHERE account_id=@account_id AND active=1 AND kind=@node_kind AND (parent_id=@parent_id OR parent_id IS NULL AND @parent_id IS NULL) AND (@query=N'' OR CHARINDEX(@query,display_name)>0)
   AND CASE WHEN kind='TEAM' THEN dbo.BusinessScopeValid(@account_id,'DEPARTMENT',parent_id) ELSE dbo.BusinessScopeValid(@account_id,kind,node_id) END=1;
   SELECT @total=COUNT(*) FROM @nodes;
   SET @items=(SELECT LOWER(CONVERT(varchar(36),id)) AS id,name,LOWER(CONVERT(varchar(36),parent_id)) AS parentId,kind,CAST(1 AS bit) AS active FROM @nodes ORDER BY name,id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
  END;
  SELECT (SELECT @revision AS revision,JSON_QUERY(COALESCE(@items,'[]')) AS items,@total AS total,@page AS page,10 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END ELSE IF @mode='PERSON' BEGIN
  IF @person_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person_id) THROW 51004,'Person unavailable.',1;
  DECLARE @path TABLE(id uniqueidentifier PRIMARY KEY,kind varchar(20),name nvarchar(100),parent_id uniqueidentifier,active bit);
  ;WITH ancestry AS (
   SELECT n.node_id,n.kind,n.display_name,n.parent_id,n.active,0 AS depth FROM dbo.AccessOrgAssignment a JOIN dbo.AccessOrgNode n ON n.account_id=a.account_id AND n.node_id=COALESCE(a.team_id,a.department_id) WHERE a.account_id=@account_id AND a.person_id=@person_id
   UNION ALL SELECT n.node_id,n.kind,n.display_name,n.parent_id,n.active,p.depth+1 FROM dbo.AccessOrgNode n JOIN ancestry p ON p.parent_id=n.node_id WHERE n.account_id=@account_id AND p.depth<3
  ) INSERT @path SELECT DISTINCT node_id,kind,display_name,parent_id,active FROM ancestry;
  SELECT (SELECT @revision AS revision,
   JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),p.person_id)) AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active,p.job_title AS jobTitle,p.grade,p.work_email AS workEmail,p.work_location AS workLocation,
    LOWER(CONVERT(varchar(36),p.primary_capability_id)) AS primaryCapabilityId,c.display_name AS primaryCapabilityName,c.status AS primaryCapabilityStatus,
    CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(@account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson report ON report.account_id=a.account_id AND report.person_id=a.person_id AND report.active=1 WHERE a.account_id=@account_id AND a.manager_id=p.person_id AND a.person_id<>p.person_id AND dbo.AccessReportingValid(@account_id,a.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
    JSON_QUERY(dbo.BusinessProjection(@account_id,p.person_id)) AS business,
    JSON_QUERY(COALESCE((SELECT '['+STRING_AGG(CONVERT(nvarchar(max),'"'+LOWER(CONVERT(varchar(36),role_id))+'"'),',')+']' FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=p.person_id),'[]')) AS roleIds,
    JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=p.person_id FOR JSON PATH)) AS overrides
    FROM dbo.AccessPerson p LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id WHERE p.account_id=@account_id AND p.person_id=@person_id FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER)) AS person,
   JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),r.role_id)) AS id,r.display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission p WHERE p.account_id=r.account_id AND p.role_id=r.role_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole r JOIN dbo.AccessPersonRole a ON a.account_id=r.account_id AND a.role_id=r.role_id WHERE a.account_id=@account_id AND a.person_id=@person_id FOR JSON PATH)) AS roles,
   JSON_QUERY((SELECT JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),id)) AS id,kind,name,LOWER(CONVERT(varchar(36),parent_id)) AS parentId,active FROM @path FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
    JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),person_id)) AS personId,LOWER(CONVERT(varchar(36),department_id)) AS departmentId,LOWER(CONVERT(varchar(36),team_id)) AS teamId,LOWER(CONVERT(varchar(36),manager_id)) AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@person_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS assignments,
    JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),p.person_id)) AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active FROM dbo.AccessPerson p JOIN dbo.AccessOrgAssignment a ON a.account_id=p.account_id AND a.manager_id=p.person_id WHERE a.account_id=@account_id AND a.person_id=@person_id FOR JSON PATH)) AS people
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS organization
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END ELSE THROW 51000,'Invalid administration read.',1;
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadPeopleAdministration TO [skill_management_runtime];
GO
