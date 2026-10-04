-- Personal study drafts and informal practice. Neither updates claims or plan completion.
CREATE TABLE dbo.LearningSession(
 account_id uniqueidentifier NOT NULL,plan_id uniqueidentifier NOT NULL,task_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 revision int NOT NULL CHECK(revision>0),payload nvarchar(max) NOT NULL CHECK(ISJSON(payload)=1 AND DATALENGTH(payload)<=20000),updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,plan_id,task_id),FOREIGN KEY(account_id,plan_id) REFERENCES dbo.LearningPlan(account_id,plan_id)
);
CREATE TABLE dbo.LearningQuiz(
 account_id uniqueidentifier NOT NULL,quiz_id uniqueidentifier NOT NULL,plan_id uniqueidentifier NOT NULL,task_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 title nvarchar(120) NOT NULL,provider nvarchar(80) NOT NULL,questions nvarchar(max) NOT NULL CHECK(ISJSON(questions)=1 AND DATALENGTH(questions)<=128000),created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 PRIMARY KEY(account_id,quiz_id),FOREIGN KEY(account_id,plan_id) REFERENCES dbo.LearningPlan(account_id,plan_id)
);
CREATE INDEX IX_LearningQuiz_Owner ON dbo.LearningQuiz(account_id,person_id,plan_id,task_id,created_at);
CREATE TABLE dbo.LearningAttempt(
 account_id uniqueidentifier NOT NULL,attempt_id uniqueidentifier NOT NULL,quiz_id uniqueidentifier NOT NULL,person_id uniqueidentifier NOT NULL,
 answers nvarchar(1000) NOT NULL CHECK(ISJSON(answers)=1),score int NOT NULL CHECK(score>=0),total int NOT NULL CHECK(total BETWEEN 1 AND 20),submitted_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CHECK(score<=total),PRIMARY KEY(account_id,attempt_id),FOREIGN KEY(account_id,quiz_id) REFERENCES dbo.LearningQuiz(account_id,quiz_id)
);
GO
CREATE OR ALTER PROCEDURE dbo.OwnLearningPractice
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@plan_id uniqueidentifier,@task_id uniqueidentifier,@action varchar(20),@payload nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@document nvarchar(max),@status varchar(10);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'learning.view',1)<>1 OR (@action<>'READ' AND dbo.AccessCan(@account_id,@actor_id,'learning.manage',1)<>1) THROW 51003,'Learning denied.',1;
 SELECT @document=payload,@status=status FROM dbo.LearningPlan WHERE account_id=@account_id AND plan_id=@plan_id AND person_id=@actor_id;
 IF @document IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(@document,'$.tasks') WHERE TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id'))=@task_id) THROW 51004,'Own task unavailable.',1;
 IF @action='READ' BEGIN
  SELECT revision,payload FROM dbo.LearningSession WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
  SELECT quiz_id AS id,title,provider,questions,created_at AS createdAt FROM dbo.LearningQuiz WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id ORDER BY created_at DESC,quiz_id;
  SELECT a.attempt_id AS id,a.quiz_id AS quizId,a.answers,a.score,a.total,a.submitted_at AS submittedAt FROM dbo.LearningAttempt a JOIN dbo.LearningQuiz q ON q.account_id=a.account_id AND q.quiz_id=a.quiz_id WHERE q.account_id=@account_id AND q.plan_id=@plan_id AND q.task_id=@task_id AND q.person_id=@actor_id AND a.person_id=@actor_id ORDER BY a.submitted_at DESC,a.attempt_id;
 END ELSE BEGIN
  IF @status<>'ACTIVE' THROW 51010,'Resume your plan first.',1;
  IF ISJSON(@payload)<>1 OR @payload IS NULL OR DATALENGTH(@payload)>128000 THROW 51000,'Invalid payload.',1;
  DECLARE @target uniqueidentifier=@task_id;
  IF @action='SESSION' BEGIN
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('revision','notes','minutes','resources')) OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')),-1)<0 OR JSON_VALUE(@payload,'$.notes') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.notes'))>4000 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@payload,'$.minutes')),-1) NOT BETWEEN 0 AND 480 OR JSON_QUERY(@payload,'$.resources') IS NULL OR LEFT(LTRIM(JSON_QUERY(@payload,'$.resources')),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@payload,'$.resources'))>5 THROW 51000,'Invalid session.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.resources') WHERE NULLIF(JSON_VALUE(value,'$.label'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.label'))>240 OR JSON_VALUE(value,'$.url') IS NULL OR JSON_VALUE(value,'$.url') NOT LIKE 'https://%' OR DATALENGTH(JSON_VALUE(value,'$.url'))>2000) OR EXISTS(SELECT 1 FROM OPENJSON(@payload,'$.resources') r CROSS APPLY OPENJSON(r.value) f WHERE f.[key] NOT IN ('label','url')) THROW 51000,'Invalid resource.',1;
   DECLARE @current int;SELECT @current=revision FROM dbo.LearningSession WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
   IF ISNULL(@current,0)<>TRY_CONVERT(int,JSON_VALUE(@payload,'$.revision')) THROW 51009,'Session changed.',1;
   IF @current IS NULL INSERT dbo.LearningSession(account_id,plan_id,task_id,person_id,revision,payload) VALUES(@account_id,@plan_id,@task_id,@actor_id,1,@payload);
   ELSE UPDATE dbo.LearningSession SET revision=revision+1,payload=@payload,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id;
  END ELSE IF @action='QUIZ' BEGIN
   DECLARE @quiz_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@questions nvarchar(max)=JSON_QUERY(@payload,'$.questions');
   IF @quiz_id IS NULL OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','title','provider','questions')) OR NULLIF(JSON_VALUE(@payload,'$.title'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.title'))>240 OR NULLIF(JSON_VALUE(@payload,'$.provider'),'') IS NULL OR DATALENGTH(JSON_VALUE(@payload,'$.provider'))>160 OR @questions IS NULL OR LEFT(LTRIM(@questions),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(@questions)) NOT BETWEEN 1 AND 20 THROW 51000,'Invalid quiz.',1;
   IF (SELECT COUNT(*) FROM dbo.LearningQuiz WHERE account_id=@account_id AND person_id=@actor_id)>=100 OR (SELECT COUNT(*) FROM dbo.LearningQuiz WHERE account_id=@account_id AND plan_id=@plan_id AND task_id=@task_id AND person_id=@actor_id)>=30 THROW 51010,'Practice limit reached.',1;
   IF EXISTS(SELECT 1 FROM OPENJSON(@questions) WHERE NULLIF(JSON_VALUE(value,'$.prompt'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.prompt'))>1200 OR NULLIF(JSON_VALUE(value,'$.explanation'),'') IS NULL OR DATALENGTH(JSON_VALUE(value,'$.explanation'))>1200 OR ISNULL(TRY_CONVERT(int,JSON_VALUE(value,'$.correctIndex')),-1) NOT BETWEEN 0 AND 3 OR JSON_QUERY(value,'$.options') IS NULL OR LEFT(LTRIM(JSON_QUERY(value,'$.options')),1)<>'[' OR (SELECT COUNT(*) FROM OPENJSON(value,'$.options'))<>4) OR EXISTS(SELECT 1 FROM OPENJSON(@questions) q CROSS APPLY OPENJSON(q.value,'$.options') o WHERE o.type<>1 OR NULLIF(o.value,'') IS NULL OR DATALENGTH(o.value)>600) THROW 51000,'Invalid question.',1;
   INSERT dbo.LearningQuiz(account_id,quiz_id,plan_id,task_id,person_id,title,provider,questions) VALUES(@account_id,@quiz_id,@plan_id,@task_id,@actor_id,JSON_VALUE(@payload,'$.title'),JSON_VALUE(@payload,'$.provider'),@questions);SET @target=@quiz_id;
  END ELSE IF @action='ATTEMPT' BEGIN
   DECLARE @attempt_id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.id')),@answer_quiz uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.quizId')),@answers nvarchar(max)=JSON_QUERY(@payload,'$.answers'),@key nvarchar(max),@score int,@total int;
   IF @attempt_id IS NULL OR @answer_quiz IS NULL OR @answers IS NULL OR LEFT(LTRIM(@answers),1)<>'[' OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','quizId','answers')) THROW 51000,'Invalid attempt.',1;
   SELECT @key=questions FROM dbo.LearningQuiz WHERE account_id=@account_id AND quiz_id=@answer_quiz AND person_id=@actor_id AND plan_id=@plan_id AND task_id=@task_id;
   IF @key IS NULL THROW 51004,'Own quiz unavailable.',1;
   SET @total=(SELECT COUNT(*) FROM OPENJSON(@key));
   IF (SELECT COUNT(*) FROM OPENJSON(@answers))<>@total OR EXISTS(SELECT 1 FROM OPENJSON(@answers) WHERE type<>2 OR TRY_CONVERT(int,value) IS NULL OR value<>CONVERT(nvarchar(10),TRY_CONVERT(int,value)) OR TRY_CONVERT(int,value) NOT BETWEEN 0 AND 3) THROW 51000,'Answer all questions.',1;
   IF EXISTS(SELECT 1 FROM dbo.LearningAttempt WHERE account_id=@account_id AND attempt_id=@attempt_id) BEGIN
    IF NOT EXISTS(SELECT 1 FROM dbo.LearningAttempt WHERE account_id=@account_id AND attempt_id=@attempt_id AND person_id=@actor_id AND quiz_id=@answer_quiz AND answers=@answers) THROW 51009,'Attempt already exists.',1;
    COMMIT;RETURN;
   END;
   IF (SELECT COUNT(*) FROM dbo.LearningAttempt WHERE account_id=@account_id AND quiz_id=@answer_quiz AND person_id=@actor_id)>=10 THROW 51010,'Attempt limit reached.',1;
   SELECT @score=COUNT(*) FROM OPENJSON(@key) q JOIN OPENJSON(@answers) a ON a.[key]=q.[key] WHERE TRY_CONVERT(int,a.value)=TRY_CONVERT(int,JSON_VALUE(q.value,'$.correctIndex'));
   INSERT dbo.LearningAttempt(account_id,attempt_id,quiz_id,person_id,answers,score,total) VALUES(@account_id,@attempt_id,@answer_quiz,@actor_id,@answers,@score,@total);SET @target=@attempt_id;
  END ELSE THROW 51000,'Invalid practice action.',1;
  UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
  INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,'learning.'+LOWER(@action),@target,N'{"saved":true}');
 END;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.OwnLearningPractice TO [skill_management_runtime];
