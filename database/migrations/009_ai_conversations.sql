CREATE TABLE dbo.AiConversation (
 account_id uniqueidentifier NOT NULL,
 person_id uniqueidentifier NOT NULL,
 conversation_id uniqueidentifier NOT NULL,
 revision int NOT NULL,
 title nvarchar(100) NOT NULL,
 payload nvarchar(max) NOT NULL,
 updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT PK_AiConversation PRIMARY KEY(account_id,person_id,conversation_id),
 CONSTRAINT FK_AiConversation_Person FOREIGN KEY(account_id,person_id) REFERENCES dbo.AccessPerson(account_id,person_id),
 CONSTRAINT CK_AiConversation_Json CHECK(ISJSON(payload)=1 AND DATALENGTH(payload)<=524288),
 CONSTRAINT CK_AiConversation_Revision CHECK(revision>0)
);
GO
CREATE OR ALTER PROCEDURE dbo.OwnAiConversations
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@operation varchar(8),
 @conversation_id uniqueidentifier=NULL,@revision int=0,@payload nvarchar(max)=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Assistant access denied.',1;
 IF @operation='list'
 SELECT conversation_id AS id,title,updated_at AS updatedAt FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id ORDER BY updated_at DESC,conversation_id;
 ELSE IF @operation='read'
 BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id AND conversation_id=@conversation_id) THROW 51004,'Conversation unavailable.',1;
 SELECT payload,revision,updated_at AS updatedAt FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id AND conversation_id=@conversation_id;
 END
 ELSE IF @operation='delete'
 DELETE FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id AND conversation_id=@conversation_id;
 ELSE IF @operation='save'
 BEGIN
 IF @conversation_id IS NULL OR ISJSON(@payload)<>1 OR DATALENGTH(@payload)>524288 OR NULLIF(JSON_VALUE(@payload,'$.title'),'') IS NULL THROW 51000,'Invalid conversation.',1;
 DECLARE @current int;
 SELECT @current=revision FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id AND conversation_id=@conversation_id;
 IF (@current IS NULL AND @revision<>0) OR (@current IS NOT NULL AND @current<>@revision) THROW 51009,'Conversation changed.',1;
 IF @current IS NULL
 INSERT dbo.AiConversation(account_id,person_id,conversation_id,revision,title,payload) VALUES(@account_id,@actor_id,@conversation_id,1,LEFT(JSON_VALUE(@payload,'$.title'),100),@payload);
 ELSE UPDATE dbo.AiConversation SET revision=revision+1,title=LEFT(JSON_VALUE(@payload,'$.title'),100),payload=@payload,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND person_id=@actor_id AND conversation_id=@conversation_id;
 ;WITH retained AS (SELECT *,ROW_NUMBER() OVER(ORDER BY updated_at DESC,CASE WHEN conversation_id=@conversation_id THEN 0 ELSE 1 END,conversation_id) AS position FROM dbo.AiConversation WHERE account_id=@account_id AND person_id=@actor_id)
 DELETE FROM retained WHERE position>2;
 END
 ELSE THROW 51000,'Invalid operation.',1;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.OwnAiConversations TO [skill_management_runtime];
