-- Bound audit lookup avoids scanning workspace history for each recovery.
CREATE INDEX IX_AccessAudit_WorkflowRecovery ON dbo.AccessAudit(account_id,target_id,actor_id,action);
GO
-- Read-only recovery of exactly the authenticated actor's already committed command.
-- This procedure never authorizes a new mutation using an old preview.
CREATE OR ALTER PROCEDURE dbo.BusinessWorkflowRecovery @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(30),@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @workspace int;SELECT @workspace=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>40000 OR @operation IS NULL OR @operation NOT IN('PROPOSE','SAVE_DEMAND','APPROVE_AMENDMENT','REJECT_AMENDMENT','SHORTLIST') THROW 51000,'Invalid recovery.',1;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
 @action varchar(50)=CASE @operation WHEN 'PROPOSE' THEN 'business.amendment.proposed' WHEN 'SAVE_DEMAND' THEN 'business.demand.created' WHEN 'APPROVE_AMENDMENT' THEN 'business.amendment.approved' WHEN 'REJECT_AMENDMENT' THEN 'business.amendment.rejected' ELSE 'business.candidate.shortlisted' END;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessAudit a WHERE a.account_id=@account_id AND a.actor_id=@actor_id AND a.target_id=@id AND a.action=@action AND ISJSON(a.after_json)=1
 AND NOT EXISTS(SELECT [key],value COLLATE Latin1_General_100_BIN2,type FROM OPENJSON(@payload) EXCEPT SELECT [key],value COLLATE Latin1_General_100_BIN2,type FROM OPENJSON(a.after_json) WHERE [key]<>'accessRevision')
 AND NOT EXISTS(SELECT [key],value COLLATE Latin1_General_100_BIN2,type FROM OPENJSON(a.after_json) WHERE [key]<>'accessRevision' EXCEPT SELECT [key],value COLLATE Latin1_General_100_BIN2,type FROM OPENJSON(@payload))) BEGIN
  SELECT N'null' AS json;COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;RETURN;
 END;
 IF @operation='PROPOSE' AND dbo.BusinessAmendCan(@account_id,@actor_id)<>1 THROW 51003,'Amendment access denied.',1;
 IF @operation='SAVE_DEMAND' AND (dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'demand.create')=1 OR dbo.BusinessDemandCan(@account_id,@actor_id,@id)<>1 OR dbo.BusinessResponsibilityUsable(@account_id,@actor_id,TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')))<>1) THROW 51003,'Demand access denied.',1;
 IF @operation IN('APPROVE_AMENDMENT','REJECT_AMENDMENT') AND (dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.catalogue.manage',0)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'request.approve')=1) THROW 51003,'Amendment decision access denied.',1;
 IF @operation='SHORTLIST' BEGIN
  DECLARE @kind varchar(20),@scope uniqueidentifier,@requirements nvarchar(max);SELECT @kind=scope_kind,@scope=scope_id,@requirements=requirements FROM dbo.BusinessDemand WHERE account_id=@account_id AND id=@id;
  IF dbo.BusinessDemandCan(@account_id,@actor_id,@id)<>1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.view')=1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.run')=1 OR dbo.BusinessLegacyDenied(@account_id,@actor_id,'matching.shortlist')=1 OR dbo.BusinessCan(@account_id,@actor_id,@person,NULL)<>1 OR dbo.BusinessScopeMatches(@account_id,@person,@kind,@scope)<>1 THROW 51003,'Shortlist access denied.',1;
  IF (SELECT COUNT(*) FROM dbo.BusinessMatchRequirements(@account_id,@person,@requirements) WHERE matched=1)<>(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.skills'))+(SELECT COUNT(*) FROM OPENJSON(@requirements,'$.certifications')) THROW 51009,'Candidate no longer meets every requirement.',1;
 END;
 SELECT (SELECT @id AS id,CAST(1 AS bit) AS saved,CAST(1 AS bit) AS replayed FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.BusinessWorkflowRecovery TO [skill_management_runtime];
GO
