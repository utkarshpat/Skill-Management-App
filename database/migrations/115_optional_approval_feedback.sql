-- Combined decisions call these same standalone transitions. Change only their
-- feedback checks and accept the exact rules already installed by an earlier run.
DECLARE @claimId int=OBJECT_ID(N'dbo.TransitionSkillClaim',N'P'),
 @certificationId int=OBJECT_ID(N'dbo.CertificationWorkspace',N'P');
DECLARE @claim nvarchar(max)=OBJECT_DEFINITION(@claimId),
 @certification nvarchar(max)=OBJECT_DEFINITION(@certificationId);
IF @claim IS NULL
 THROW 51000,'Cannot read dbo.TransitionSkillClaim. Check the target database, installed procedure and VIEW DEFINITION permission.',1;
IF @certification IS NULL
 THROW 51000,'Cannot read dbo.CertificationWorkspace. Check the target database, installed procedure and VIEW DEFINITION permission.',1;

DECLARE @claimGuard nvarchar(300)=N'IF LEN(LTRIM(RTRIM(ISNULL(@feedback,N''''))))=0 THROW 51000,''Feedback required.'',1;',
 @claimValue nvarchar(150)=N'ELSE LTRIM(RTRIM(@feedback)) END,',
 @certificationGuard nvarchar(300)=N'IF LEN(LTRIM(RTRIM(@feedback)))=0 OR LEN(JSON_VALUE(@payload,''$.feedback''))>2000 THROW 51000,''Review feedback required.'',1;',
 @newClaimGuard nvarchar(300)=N'IF @action IN (''REJECT'',''REQUEST_CHANGES'') AND LEN(LTRIM(RTRIM(ISNULL(@feedback,N''''))))=0 THROW 51000,''Feedback required.'',1;',
 @newClaimValue nvarchar(150)=N'ELSE LTRIM(RTRIM(ISNULL(@feedback,N''''))) END,',
 @newCertificationGuard nvarchar(300)=N'IF (@operation IN (''REJECT'',''REQUEST_CHANGES'') AND LEN(LTRIM(RTRIM(@feedback)))=0) OR LEN(JSON_VALUE(@payload,''$.feedback''))>2000 THROW 51000,''Review feedback is required for rejection or changes and must be within 2,000 characters.'',1;';
IF (CHARINDEX(@claimGuard,@claim)=0 AND CHARINDEX(@newClaimGuard,@claim)=0)
 OR (CHARINDEX(@claimValue,@claim)=0 AND CHARINDEX(@newClaimValue,@claim)=0)
 THROW 51000,'Unexpected approval feedback rules in dbo.TransitionSkillClaim. The migration made no changes.',1;
IF CHARINDEX(@certificationGuard,@certification)=0 AND CHARINDEX(@newCertificationGuard,@certification)=0
 THROW 51000,'Unexpected approval feedback rules in dbo.CertificationWorkspace. The migration made no changes.',1;

DECLARE @updateClaim bit=CASE WHEN CHARINDEX(@claimGuard,@claim)>0 OR CHARINDEX(@claimValue,@claim)>0 THEN 1 ELSE 0 END,
 @updateCertification bit=CASE WHEN CHARINDEX(@certificationGuard,@certification)>0 THEN 1 ELSE 0 END;
DECLARE @claimHeader int=COALESCE(NULLIF(CHARINDEX(N'PROCEDURE dbo.TransitionSkillClaim',@claim),0),NULLIF(CHARINDEX(N'PROCEDURE [dbo].[TransitionSkillClaim]',@claim),0)),
 @certificationHeader int=COALESCE(NULLIF(CHARINDEX(N'PROCEDURE dbo.CertificationWorkspace',@certification),0),NULLIF(CHARINDEX(N'PROCEDURE [dbo].[CertificationWorkspace]',@certification),0));
IF @updateClaim=1 AND @claimHeader IS NULL
 THROW 51000,'Unexpected declaration in dbo.TransitionSkillClaim. The migration made no changes.',1;
IF @updateCertification=1 AND @certificationHeader IS NULL
 THROW 51000,'Unexpected declaration in dbo.CertificationWorkspace. The migration made no changes.',1;

IF @updateClaim=1 BEGIN
 SET @claim=REPLACE(REPLACE(@claim,@claimGuard,@newClaimGuard),@claimValue,@newClaimValue);
 SET @claim=N'ALTER '+SUBSTRING(@claim,@claimHeader,LEN(@claim));
 EXEC sys.sp_executesql @claim;
END;
IF @updateCertification=1 BEGIN
 SET @certification=REPLACE(@certification,@certificationGuard,@newCertificationGuard);
 SET @certification=N'ALTER '+SUBSTRING(@certification,@certificationHeader,LEN(@certification));
 EXEC sys.sp_executesql @certification;
END;
GO
