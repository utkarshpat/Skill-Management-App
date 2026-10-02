-- Apply with the migration identity, not the runtime service identity.
-- The runtime receives EXECUTE on this procedure only; no table-wide read grant.
CREATE OR ALTER PROCEDURE dbo.GetOwnProfile
  @tenant_id uniqueidentifier,
  @object_id uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @account_id uniqueidentifier, @user_id uniqueidentifier;
  SELECT @account_id=a.account_id, @user_id=u.user_id
  FROM dbo.Account a JOIN dbo.AppUser u ON u.account_id=a.account_id
  WHERE a.entra_tenant_id=@tenant_id AND u.entra_object_id=@object_id
    AND a.status='ACTIVE' AND u.status='ACTIVE';

  IF @user_id IS NULL RETURN;
  DECLARE @now datetime2(7)=SYSUTCDATETIME();
  DECLARE @overrides TABLE(effect varchar(5));
  INSERT @overrides SELECT p.effect FROM dbo.UserPermission p WHERE p.account_id=@account_id
    AND p.user_id=@user_id AND p.permission_code='profile.view'
    AND p.revoked_at IS NULL AND p.valid_from<=@now AND (p.valid_until IS NULL OR @now<p.valid_until)
    AND (p.scope_kind IN ('OWN','ORGANIZATION')
      OR (p.scope_kind='SPECIFIC_RESOURCE' AND p.scope_id=@user_id AND p.resource_type='profile')
      OR EXISTS(SELECT 1 FROM dbo.TeamMembership m JOIN dbo.Team t ON t.account_id=m.account_id AND t.team_id=m.team_id
        JOIN dbo.Department d ON d.account_id=t.account_id AND d.department_id=t.department_id
        WHERE m.account_id=@account_id AND m.user_id=@user_id AND m.valid_from<=@now
          AND (m.valid_until IS NULL OR @now<m.valid_until)
          AND ((p.scope_kind='TEAM' AND p.scope_id=t.team_id)
            OR (p.scope_kind='DEPARTMENT' AND p.scope_id=t.department_id)
            OR (p.scope_kind='DELIVERY_UNIT' AND p.scope_id=d.delivery_unit_id))));
  IF EXISTS(SELECT 1 FROM @overrides WHERE effect='DENY') RETURN;

  IF NOT EXISTS(SELECT 1 FROM dbo.UserRole r JOIN dbo.RolePermission p ON p.role_code=r.role_code
    WHERE r.account_id=@account_id AND r.user_id=@user_id AND r.revoked_at IS NULL
    AND r.valid_from<=@now AND (r.valid_until IS NULL OR @now<r.valid_until)
    AND p.permission_code='profile.view' AND p.default_scope IN ('OWN','ORGANIZATION'))
    AND NOT EXISTS(SELECT 1 FROM @overrides WHERE effect='ALLOW') RETURN;

  SELECT u.user_id AS id,u.display_name AS displayName,u.employee_code AS employeeCode,
    a.display_name AS organization,u.status
  FROM dbo.AppUser u JOIN dbo.Account a ON a.account_id=u.account_id
  WHERE u.account_id=@account_id AND u.user_id=@user_id;
  SELECT DISTINCT r.role_code AS role FROM dbo.UserRole r
  WHERE r.account_id=@account_id AND r.user_id=@user_id AND r.revoked_at IS NULL
    AND r.valid_from<=@now AND (r.valid_until IS NULL OR @now<r.valid_until);
END;
