-- Azure SQL / SQL Server. Apply to a dedicated development database with sqlcmd.
-- No real employee data or credentials are seeded. Schema only; access still needs server-side policy.
SET XACT_ABORT ON;
SET NOCOUNT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL
    CREATE TABLE dbo.SchemaMigration (version int NOT NULL PRIMARY KEY, applied_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME());
  IF EXISTS (SELECT 1 FROM dbo.SchemaMigration WHERE version = 1)
    THROW 50001, 'Migration 001 is already applied.', 1;

  CREATE TABLE dbo.Account (
    account_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    account_code nvarchar(100) NOT NULL UNIQUE,
    display_name nvarchar(200) NOT NULL,
    entra_tenant_id uniqueidentifier NOT NULL UNIQUE,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','CLOSED')),
    created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    record_version rowversion NOT NULL
  );
  CREATE TABLE dbo.DeliveryUnit (
    account_id uniqueidentifier NOT NULL REFERENCES dbo.Account(account_id),
    delivery_unit_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    display_name nvarchar(200) NOT NULL,
    PRIMARY KEY(account_id, delivery_unit_id),
    UNIQUE(account_id, display_name)
  );
  CREATE TABLE dbo.Department (
    account_id uniqueidentifier NOT NULL,
    department_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    delivery_unit_id uniqueidentifier NOT NULL,
    display_name nvarchar(200) NOT NULL,
    PRIMARY KEY(account_id, department_id),
    FOREIGN KEY(account_id, delivery_unit_id) REFERENCES dbo.DeliveryUnit(account_id, delivery_unit_id),
    UNIQUE(account_id, delivery_unit_id, display_name)
  );
  CREATE TABLE dbo.Team (
    account_id uniqueidentifier NOT NULL,
    team_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    department_id uniqueidentifier NOT NULL,
    display_name nvarchar(200) NOT NULL,
    PRIMARY KEY(account_id, team_id),
    FOREIGN KEY(account_id, department_id) REFERENCES dbo.Department(account_id, department_id),
    UNIQUE(account_id, department_id, display_name)
  );
  CREATE TABLE dbo.AppUser (
    account_id uniqueidentifier NOT NULL REFERENCES dbo.Account(account_id),
    user_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    entra_object_id uniqueidentifier NOT NULL,
    employee_code nvarchar(100) NOT NULL,
    display_name nvarchar(200) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','LEFT')),
    created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    record_version rowversion NOT NULL,
    PRIMARY KEY(account_id, user_id),
    UNIQUE(account_id, entra_object_id),
    UNIQUE(account_id, employee_code)
  );
  CREATE TABLE dbo.TeamMembership (
    account_id uniqueidentifier NOT NULL,
    membership_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    user_id uniqueidentifier NOT NULL,
    team_id uniqueidentifier NOT NULL,
    valid_from datetime2(7) NOT NULL,
    valid_until datetime2(7) NULL,
    PRIMARY KEY(account_id, membership_id),
    FOREIGN KEY(account_id, user_id) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, team_id) REFERENCES dbo.Team(account_id, team_id),
    CHECK(valid_until IS NULL OR valid_until > valid_from)
  );
  CREATE TABLE dbo.ReportingRelationship (
    account_id uniqueidentifier NOT NULL,
    relationship_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    employee_id uniqueidentifier NOT NULL,
    manager_id uniqueidentifier NOT NULL,
    valid_from datetime2(7) NOT NULL,
    valid_until datetime2(7) NULL,
    created_by uniqueidentifier NOT NULL,
    created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    record_version rowversion NOT NULL,
    PRIMARY KEY(account_id, relationship_id),
    FOREIGN KEY(account_id, employee_id) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, manager_id) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, created_by) REFERENCES dbo.AppUser(account_id, user_id),
    CHECK(employee_id <> manager_id),
    CHECK(valid_until IS NULL OR valid_until > valid_from)
  );
  -- Historical interval overlap must additionally be checked transactionally by the service.
  CREATE UNIQUE INDEX UX_Reporting_Open ON dbo.ReportingRelationship(account_id, employee_id) WHERE valid_until IS NULL;
  CREATE INDEX IX_Reporting_Manager ON dbo.ReportingRelationship(account_id, manager_id, valid_from, valid_until);

  CREATE TABLE dbo.AppRole (
    role_code varchar(40) NOT NULL PRIMARY KEY,
    display_name nvarchar(100) NOT NULL
  );
  INSERT dbo.AppRole VALUES
    ('EMPLOYEE','Employee'), ('MANAGER','Manager / N+1'),
    ('DEPARTMENT_HEAD','Department Head / N+2'), ('DELIVERY_UNIT_HEAD','Delivery Unit Head'),
    ('CHRO','CHRO'), ('CAPABILITY_LEAD','Capability Lead');

  CREATE TABLE dbo.Permission (
    permission_code varchar(100) NOT NULL PRIMARY KEY,
    description nvarchar(300) NOT NULL
  );
  INSERT dbo.Permission VALUES
    ('profile.view','View permitted profile data'), ('profile.edit','Edit permitted profile fields'),
    ('skill.view','View published skills'), ('skill.claim','Create a skill claim'),
    ('skill.verify','Verify an assigned claim'), ('skill.catalogue.propose','Propose a skill definition'),
    ('skill.catalogue.manage','Govern skill taxonomy'), ('evidence.view','View authorized evidence'),
    ('evidence.submit','Submit own evidence'), ('assessment.view','View assessments'),
    ('assessment.approve','Approve assigned assessments'), ('learning.view','View learning plans'),
    ('learning.manage','Manage learning plans'), ('learning.approve','Approve learning proposals'),
    ('demand.view','View authorized demand'), ('demand.create','Create project demand'),
    ('demand.approve','Approve project demand'), ('matching.view','View matches'),
    ('matching.run','Run matching'), ('matching.shortlist','Shortlist a candidate'),
    ('reports.view','View scoped reports'), ('reports.export','Export scoped reports'),
    ('users.view','View authorized users'), ('users.manage','Manage users'),
    ('permissions.manage','Manage grants within separately enforced delegation limits'),
    ('audit.view','View authorized audit history'), ('request.create','Create a request'),
    ('request.view','View requests'), ('request.assign','Assign a request'),
    ('request.approve','Approve requests subject to routing and delegation policy'),
    ('request.resolve','Resolve requests'), ('incident.create','Report an incident'),
    ('incident.view','View incidents'), ('incident.assign','Assign incidents'), ('incident.resolve','Resolve incidents');

  CREATE TABLE dbo.UserRole (
    account_id uniqueidentifier NOT NULL,
    assignment_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    user_id uniqueidentifier NOT NULL,
    role_code varchar(40) NOT NULL REFERENCES dbo.AppRole(role_code),
    valid_from datetime2(7) NOT NULL,
    valid_until datetime2(7) NULL,
    revoked_at datetime2(7) NULL,
    granted_by uniqueidentifier NOT NULL,
    PRIMARY KEY(account_id, assignment_id),
    FOREIGN KEY(account_id, user_id) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, granted_by) REFERENCES dbo.AppUser(account_id, user_id),
    CHECK(valid_until IS NULL OR valid_until > valid_from)
  );
  CREATE TABLE dbo.RolePermission (
    role_code varchar(40) NOT NULL REFERENCES dbo.AppRole(role_code),
    permission_code varchar(100) NOT NULL REFERENCES dbo.Permission(permission_code),
    default_scope varchar(30) NOT NULL CHECK(default_scope IN ('OWN','TEAM','DEPARTMENT','DELIVERY_UNIT','ORGANIZATION','CAPABILITY')),
    PRIMARY KEY(role_code, permission_code, default_scope)
  );
  -- Conservative initial defaults. Higher roles have no automatic grant/admin authority.
  INSERT dbo.RolePermission VALUES
    ('EMPLOYEE','profile.view','OWN'), ('EMPLOYEE','profile.edit','OWN'),
    ('EMPLOYEE','skill.view','ORGANIZATION'), ('EMPLOYEE','skill.claim','OWN'),
    ('EMPLOYEE','evidence.view','OWN'), ('EMPLOYEE','evidence.submit','OWN'),
    ('EMPLOYEE','learning.view','OWN'), ('EMPLOYEE','learning.manage','OWN'),
    ('EMPLOYEE','request.create','OWN'), ('EMPLOYEE','request.view','OWN'),
    ('EMPLOYEE','incident.create','OWN'), ('EMPLOYEE','incident.view','OWN'),
    ('MANAGER','profile.view','TEAM'), ('MANAGER','assessment.view','TEAM'),
    ('MANAGER','skill.verify','TEAM'), ('MANAGER','assessment.approve','TEAM'),
    ('MANAGER','evidence.view','TEAM'), ('MANAGER','learning.view','TEAM'),
    ('MANAGER','reports.view','TEAM'),
    ('DEPARTMENT_HEAD','reports.view','DEPARTMENT'),
    ('DELIVERY_UNIT_HEAD','reports.view','DELIVERY_UNIT'),
    ('CHRO','reports.view','ORGANIZATION'),
    ('DEPARTMENT_HEAD','skill.catalogue.propose','CAPABILITY'),
    ('DELIVERY_UNIT_HEAD','skill.catalogue.propose','CAPABILITY'),
    ('CHRO','skill.catalogue.propose','CAPABILITY'),
    ('CAPABILITY_LEAD','skill.catalogue.manage','CAPABILITY'),
    ('CAPABILITY_LEAD','reports.view','CAPABILITY');

  CREATE TABLE dbo.UserPermission (
    account_id uniqueidentifier NOT NULL,
    grant_id uniqueidentifier NOT NULL DEFAULT NEWSEQUENTIALID(),
    user_id uniqueidentifier NOT NULL,
    permission_code varchar(100) NOT NULL REFERENCES dbo.Permission(permission_code),
    effect varchar(5) NOT NULL CHECK(effect IN ('ALLOW','DENY')),
    scope_kind varchar(30) NOT NULL CHECK(scope_kind IN ('OWN','TEAM','DEPARTMENT','DELIVERY_UNIT','ORGANIZATION','CAPABILITY','SPECIFIC_RESOURCE')),
    scope_id uniqueidentifier NULL,
    resource_type varchar(100) NULL,
    valid_from datetime2(7) NOT NULL,
    valid_until datetime2(7) NULL,
    reason nvarchar(1000) NOT NULL CHECK(LEN(LTRIM(RTRIM(reason))) > 0),
    granted_by uniqueidentifier NOT NULL,
    revoked_at datetime2(7) NULL,
    revoked_by uniqueidentifier NULL,
    revoke_reason nvarchar(1000) NULL,
    created_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    record_version rowversion NOT NULL,
    PRIMARY KEY(account_id, grant_id),
    FOREIGN KEY(account_id, user_id) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, granted_by) REFERENCES dbo.AppUser(account_id, user_id),
    FOREIGN KEY(account_id, revoked_by) REFERENCES dbo.AppUser(account_id, user_id),
    CHECK(valid_until IS NULL OR valid_until > valid_from),
    CHECK((scope_kind IN ('OWN','ORGANIZATION','CAPABILITY') AND scope_id IS NULL AND resource_type IS NULL)
      OR (scope_kind IN ('TEAM','DEPARTMENT','DELIVERY_UNIT') AND scope_id IS NOT NULL AND resource_type IS NULL)
      OR (scope_kind = 'SPECIFIC_RESOURCE' AND scope_id IS NOT NULL AND resource_type IS NOT NULL AND LEN(LTRIM(RTRIM(resource_type))) > 0)),
    CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND LEN(LTRIM(RTRIM(revoke_reason))) > 0))
  );
  CREATE INDEX IX_Permission_User ON dbo.UserPermission(account_id, user_id, permission_code, valid_from, valid_until);

  CREATE TABLE dbo.AuditEvent (
    account_id uniqueidentifier NOT NULL REFERENCES dbo.Account(account_id),
    event_id bigint IDENTITY(1,1) NOT NULL,
    actor_id uniqueidentifier NULL,
    action_code varchar(100) NOT NULL,
    resource_type varchar(100) NOT NULL,
    resource_id uniqueidentifier NULL,
    outcome varchar(20) NOT NULL CHECK(outcome IN ('SUCCESS','DENIED','FAILED')),
    request_id uniqueidentifier NOT NULL,
    occurred_at datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY(account_id, event_id),
    FOREIGN KEY(account_id, actor_id) REFERENCES dbo.AppUser(account_id, user_id)
  );
  CREATE INDEX IX_Audit_Time ON dbo.AuditEvent(account_id, occurred_at);
  INSERT dbo.SchemaMigration(version) VALUES (1);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
