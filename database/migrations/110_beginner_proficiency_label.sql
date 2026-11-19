-- Rename rank one of the shared four-level framework. Stored claim snapshots are retained.
DECLARE @framework uniqueidentifier = '00000000-0000-4000-8000-000000000003';
IF NOT EXISTS (
 SELECT 1 FROM dbo.ProficiencyLevel
 WHERE framework_id = @framework AND rank = 1 AND display_name IN (N'Foundation', N'Beginner')
)
 THROW 51000, 'The shared four-level proficiency framework is missing its rank-one level.', 1;

UPDATE dbo.ProficiencyLevel
SET display_name = N'Beginner'
WHERE framework_id = @framework AND rank = 1 AND display_name = N'Foundation';
GO
