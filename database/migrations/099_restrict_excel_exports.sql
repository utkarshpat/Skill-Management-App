-- Keep catalogue and personal certification workbooks behind the bulk administration gates.
-- Scoped Analytics exports continue to use the existing report permission and scope checks.
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.ExcelBulkData',N'P'));
DECLARE @catalogue nvarchar(250)=N'IF @catalogueAdmin=0 AND dbo.AccessCan(@account_id,@actor_id,''skill.view'',1)<>1 THROW 51003,''Catalogue access denied.'',1;';
DECLARE @personal nvarchar(250)=N'IF @portfolio=0 AND dbo.AccessCan(@account_id,@actor_id,''skill.view'',1)<>1 THROW 51003,''Certification access denied.'',1;';
DECLARE @procedureHeader int=CHARINDEX(N'PROCEDURE dbo.ExcelBulkData',@definition);
IF @definition IS NULL OR ISNULL(@procedureHeader,0)=0 OR CHARINDEX(@catalogue,@definition)=0 OR CHARINDEX(@personal,@definition)=0
 THROW 51000,'Excel export migration requires the original 098 procedure.',1;
SET @definition=N'ALTER '+SUBSTRING(@definition,@procedureHeader,LEN(@definition));
SET @definition=REPLACE(@definition,@catalogue,N'IF @catalogueAdmin<>1 THROW 51003,''Catalogue Excel export requires catalogue administration access.'',1;');
SET @definition=REPLACE(@definition,@personal,N'IF @portfolio=0 AND @admin<>1 THROW 51003,''Certification Excel export requires administration access.'',1;');
EXEC sys.sp_executesql @definition;
GO
