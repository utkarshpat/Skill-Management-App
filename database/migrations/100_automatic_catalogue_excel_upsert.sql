CREATE OR ALTER PROCEDURE dbo.ResolveExcelCatalogueRow
 @account uniqueidentifier,@section varchar(24),@definition nvarchar(max),
 @target uniqueidentifier OUTPUT,@unchanged bit OUTPUT
AS BEGIN
 SET NOCOUNT ON;
 DECLARE @name nvarchar(100)=JSON_VALUE(@definition,'$.name'),
  @category nvarchar(80)=JSON_VALUE(@definition,'$.category'),
  @description nvarchar(2000)=JSON_VALUE(@definition,'$.description'),
  @active bit=TRY_CONVERT(bit,JSON_VALUE(@definition,'$.active')),
  @status varchar(20)=JSON_VALUE(@definition,'$.status'),
  @issuer uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@definition,'$.providerId'));
 DECLARE @candidates TABLE(id uniqueidentifier PRIMARY KEY);
 IF @target IS NULL BEGIN
  IF @section='PROVIDER'
   INSERT @candidates SELECT id FROM dbo.CredentialProvider WHERE account_id=@account
    AND LOWER(LTRIM(RTRIM(name)))=LOWER(@name);
  ELSE IF @section='CERTIFICATION'
   INSERT @candidates SELECT id FROM dbo.CredentialDefinition WHERE account_id=@account AND provider_id=@issuer
    AND LOWER(LTRIM(RTRIM(name)))=LOWER(@name);
  ELSE
   INSERT @candidates SELECT skill_id FROM dbo.SkillCatalogue WHERE account_id=@account
    AND LOWER(LTRIM(RTRIM(display_name)))=LOWER(@name);
  IF (SELECT COUNT(*) FROM @candidates)>1 THROW 51000,'Multiple entries match this name. Use the exported ID.',1;
  SELECT @target=id FROM @candidates;
 END;
 SET @unchanged=0;
 IF @target IS NULL RETURN;
 IF @section='PROVIDER' AND EXISTS(
  SELECT 1 FROM dbo.CredentialProvider WHERE account_id=@account AND id=@target
   AND name COLLATE Latin1_General_100_BIN2=@name COLLATE Latin1_General_100_BIN2 AND active=@active
 ) SET @unchanged=1;
 IF @section='CERTIFICATION' AND EXISTS(
  SELECT 1 FROM dbo.CredentialDefinition WHERE account_id=@account AND id=@target AND provider_id=@issuer
   AND name COLLATE Latin1_General_100_BIN2=@name COLLATE Latin1_General_100_BIN2
   AND category COLLATE Latin1_General_100_BIN2=@category COLLATE Latin1_General_100_BIN2
   AND description COLLATE Latin1_General_100_BIN2=@description COLLATE Latin1_General_100_BIN2 AND active=@active
 ) AND (JSON_QUERY(@definition,'$.relatedSkillIds') IS NULL OR (
  NOT EXISTS(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@definition,'$.relatedSkillIds')
   EXCEPT SELECT skill_id FROM dbo.CredentialSkillMapping WHERE account_id=@account AND credential_id=@target)
  AND NOT EXISTS(SELECT skill_id FROM dbo.CredentialSkillMapping WHERE account_id=@account AND credential_id=@target
   EXCEPT SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@definition,'$.relatedSkillIds'))
 )) SET @unchanged=1;
 IF @section='SKILL' AND EXISTS(
  SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account AND skill_id=@target
   AND display_name COLLATE Latin1_General_100_BIN2=@name COLLATE Latin1_General_100_BIN2
   AND category COLLATE Latin1_General_100_BIN2=@category COLLATE Latin1_General_100_BIN2
   AND description COLLATE Latin1_General_100_BIN2=@description COLLATE Latin1_General_100_BIN2 AND status=@status
 ) BEGIN
  IF NOT EXISTS(
   SELECT rank,name COLLATE Latin1_General_100_BIN2,description COLLATE Latin1_General_100_BIN2
    FROM OPENJSON(@definition,'$.levels') WITH(rank int,name nvarchar(60),description nvarchar(1000))
   EXCEPT SELECT rank,display_name COLLATE Latin1_General_100_BIN2,description COLLATE Latin1_General_100_BIN2
    FROM dbo.SkillProficiencyLevel WHERE account_id=@account AND skill_id=@target
  ) AND (SELECT COUNT(*) FROM dbo.SkillProficiencyLevel WHERE account_id=@account AND skill_id=@target)=4
   SET @unchanged=1;
 END;
END;
GO
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.ExcelBulkData',N'P'));
DECLARE @header int=CHARINDEX(N'PROCEDURE dbo.ExcelBulkData',@definition);
DECLARE @cursor nvarchar(120)=N'DECLARE workbook_rows CURSOR LOCAL FAST_FORWARD FOR';
DECLARE @write nvarchar(120)=N'SET @command=(SELECT @commandId AS id';
DECLARE @afterWrite nvarchar(250)=N'SELECT @current=revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;';
DECLARE @counts nvarchar(150)=N'@count AS changed,@skipped AS duplicates';
DECLARE @issuer nvarchar(200)=N'FROM dbo.CredentialProvider WHERE account_id=@account_id AND active=1';
IF ISNULL(@header,0)=0 OR CHARINDEX(N'Catalogue Excel export requires catalogue administration access.',@definition)=0
 OR CHARINDEX(@cursor,@definition)=0 OR CHARINDEX(@write,@definition)=0 OR CHARINDEX(@afterWrite,@definition)=0
 OR CHARINDEX(@counts,@definition)=0 OR CHARINDEX(@issuer,@definition)=0
 THROW 51000,'Automatic catalogue import requires migration 099.',1;
SET @definition=N'ALTER '+SUBSTRING(@definition,@header,LEN(@definition));
SET @definition=REPLACE(@definition,@cursor,N'DECLARE @added int=0,@updated int=0,@unchangedCount int=0;
  DECLARE @catalogueTargets TABLE(section varchar(24),id uniqueidentifier,PRIMARY KEY(section,id));
  '+@cursor);
SET @definition=REPLACE(@definition,@issuer,N'FROM dbo.CredentialProvider WHERE account_id=@account_id');
SET @definition=REPLACE(@definition,@write,N'DECLARE @unchanged bit,@appliedId uniqueidentifier;
    EXEC dbo.ResolveExcelCatalogueRow @account_id,@section,@definition,@target OUTPUT,@unchanged OUTPUT;
    SET @appliedId=COALESCE(@target,@commandId);
    IF EXISTS(SELECT 1 FROM @catalogueTargets WHERE section=@section AND id=@appliedId)
     THROW 51000,''The same catalogue entry appears more than once.'',1;
    INSERT @catalogueTargets VALUES(@section,@appliedId);
    IF @unchanged=1 BEGIN
     SET @unchangedCount+=1;
     FETCH NEXT FROM workbook_rows INTO @row;
     CONTINUE;
    END;
    IF @target IS NULL SET @added+=1; ELSE SET @updated+=1;
    '+@write);
SET @definition=REPLACE(@definition,@counts,@counts+N',@added AS added,@updated AS updated,@unchangedCount AS unchanged');
EXEC sys.sp_executesql @definition;
GO
