-- A plan can have 60 task logs of 2,000 characters each. Reserve bounded space
-- for all valid logs rather than failing late against the original creation cap.
DECLARE @constraint sysname;
SELECT @constraint=name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.LearningPlan') AND definition LIKE '%DATALENGTH%';
IF @constraint IS NOT NULL BEGIN
 DECLARE @drop nvarchar(500)=N'ALTER TABLE dbo.LearningPlan DROP CONSTRAINT '+QUOTENAME(@constraint);
 EXEC sys.sp_executesql @drop;
END;
ALTER TABLE dbo.LearningPlan ADD CONSTRAINT CK_LearningPlan_Payload CHECK(ISJSON(payload)=1 AND DATALENGTH(payload)<=524288);
