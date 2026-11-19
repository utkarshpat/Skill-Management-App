-- Apply the feedback rule to the installed standalone transitions. Combined
-- decisions use the same transitions inside the submission transaction.
DECLARE @claim nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.TransitionSkillClaim',N'P')),
 @certification nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.CertificationWorkspace',N'P'));
DECLARE @claimHeader int=CHARINDEX(N'PROCEDURE dbo.TransitionSkillClaim',@claim),
 @certificationHeader int=CHARINDEX(N'PROCEDURE dbo.CertificationWorkspace',@certification);
DECLARE @claimGuard nvarchar(300)=N'IF LEN(LTRIM(RTRIM(ISNULL(@feedback,N''''))))=0 THROW 51000,''Feedback required.'',1;',
 @claimValue nvarchar(150)=N'ELSE LTRIM(RTRIM(@feedback)) END,',
 @certificationGuard nvarchar(300)=N'IF LEN(LTRIM(RTRIM(@feedback)))=0 OR LEN(JSON_VALUE(@payload,''$.feedback''))>2000 THROW 51000,''Review feedback required.'',1;';
IF ISNULL(@claimHeader,0)=0 OR ISNULL(@certificationHeader,0)=0
 OR CHARINDEX(@claimGuard,@claim)=0 OR CHARINDEX(@claimValue,@claim)=0
 OR CHARINDEX(@certificationGuard,@certification)=0
 THROW 51000,'The installed approval feedback checks could not be updated.',1;

SET @claim=REPLACE(@claim,@claimGuard,N'IF @action IN (''REJECT'',''REQUEST_CHANGES'') AND LEN(LTRIM(RTRIM(ISNULL(@feedback,N''''))))=0 THROW 51000,''Feedback required.'',1;');
SET @claim=REPLACE(@claim,@claimValue,N'ELSE LTRIM(RTRIM(ISNULL(@feedback,N''''))) END,');
SET @certification=REPLACE(@certification,@certificationGuard,N'IF (@operation IN (''REJECT'',''REQUEST_CHANGES'') AND LEN(LTRIM(RTRIM(@feedback)))=0) OR LEN(JSON_VALUE(@payload,''$.feedback''))>2000 THROW 51000,''Review feedback is required for rejection or changes and must be within 2,000 characters.'',1;');

SET @claim=N'ALTER '+SUBSTRING(@claim,@claimHeader,LEN(@claim));
SET @certification=N'ALTER '+SUBSTRING(@certification,@certificationHeader,LEN(@certification));
EXEC sys.sp_executesql @claim;
EXEC sys.sp_executesql @certification;
GO
