"""Build a snapshot-bound, preview-first company cutover script; never connects to SQL.

Employee data and generated SQL belong only in ignored artifacts. The source template
contains no employee records. Exact inventory equality is required at execution time.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid

ACCOUNT = '0abd9bd3-7a7e-47b2-bea2-efbb86110cfa'
TENANT = '8b87af7d-8647-4dc7-8df4-5f69a2011bb5'


def literal(value):
    return "N'" + value.replace("'", "''") + "'"


def build(inventory, roster, template, inventory_sql):
    for item in (inventory, roster):
        if str(uuid.UUID(item['accountId'])) != ACCOUNT or str(uuid.UUID(item['tenantId'])) != TENANT:
            raise ValueError('Wrong company account/tenant')
        if item['mode'] != 'PREVIEW_ONLY_NO_DB_CHANGES':
            raise ValueError('Expected a read-only source preview')
    if inventory['serverName'].lower() != 'ssskillmgmtappsqlsrvdev' or inventory['databaseName'] != 'SS-SkillMgmtApp-SQL-Dev':
        raise ValueError('Wrong company server/database')
    if inventory['latestMigration'] != 87:
        raise ValueError('Schema must be reviewed again')
    users = roster['users']
    if len(users) != 20 or len({u['personId'] for u in users}) != 20 or len({u['employeeCode'] for u in users}) != 20:
        raise ValueError('Expected the reviewed 20 distinct employees')
    if len(roster['projects']) != 2 or any(u['entraObjectId'] is not None or u['activation'] != 'PENDING_VERIFIED_ENTRA_BINDING' for u in users):
        raise ValueError('Only the reviewed pending identity transition is supported')
    intent = roster['accessIntent']
    codes = {u['employeeCode'] for u in users}
    admin, manager, lead = (intent[k] for k in ('initialAdminEmployeeCode', 'directManagerEmployeeCode', 'capabilityLeadEmployeeCode'))
    if len({admin, manager, lead}) != 3 or not {admin, manager, lead}.issubset(codes):
        raise ValueError('Designated people must be distinct roster employees')
    projects = {p['name'] for p in roster['projects']}
    for user in users:
        expected_manager = None if user['employeeCode'] == admin else admin if user['employeeCode'] == manager else manager
        if user['managerEmployeeCode'] != expected_manager or user['project'] not in projects:
            raise ValueError('Reporting/project mapping differs from reviewed policy')
    source_hash = roster['sourceSha256']
    if len(source_hash) != 64 or any(c not in '0123456789abcdefABCDEF' for c in source_hash):
        raise ValueError('Invalid workbook checksum')
    # Explicit, reviewed legacy identities; a prefix/name is never deletion authority.
    expected_codes = {'DEV-001', 'QA-001'} | {f'DEMO-NHS-{n:03}' for n in list(range(2, 15)) + [16]}
    if {p['employeeCode'] for p in inventory['people']} != expected_codes or len(inventory['people']) != 16:
        raise ValueError('Legacy people changed; obtain a fresh reviewed inventory')
    if any(p['entraObjectId'] is not None for p in inventory['people']):
        raise ValueError('Verified identities must not be deleted by this operation')
    if {str(uuid.UUID(p['id'])) for p in inventory['people']} & {u['personId'] for u in users}:
        raise ValueError('Real and demo identities must be disjoint')
    if any(p['provider'] != 'sql' for p in inventory.get('privateFiles', [])):
        raise ValueError('External private objects need a separate deletion manifest')
    tables = inventory['tables']
    if len({(t['schemaName'], t['tableName']) for t in tables}) != len(tables):
        raise ValueError('Duplicate table inventory')
    for t in tables:
        if t['schemaName'] != 'dbo' or not isinstance(t['rowCount'], int) or t['rowCount'] < 0:
            raise ValueError('Invalid table inventory')
        fingerprint = t.get('snapshotSha256')
        if fingerprint is None and t['rowCount'] == 0:
            continue  # SQL inventory omits NULL hashes for empty tables.
        if not isinstance(fingerprint, str) or len(fingerprint) != 64 or any(c not in '0123456789ABCDEFabcdef' for c in fingerprint):
            raise ValueError('Invalid fingerprint')
    # Reuse precisely the inventory algorithm that produced the reviewed hashes.
    start = inventory_sql.index(' DECLARE tables CURSOR')
    end = inventory_sql.index(' CLOSE tables; DEALLOCATE tables;') + len(' CLOSE tables; DEALLOCATE tables;')
    recheck = inventory_sql[start:end]
    values = ',\n'.join('(' + ','.join([literal(t['schemaName']), literal(t['tableName']), str(t['rowCount']), literal(t['snapshotSha256']) if t.get('snapshotSha256') else 'NULL']) + ')' for t in tables)
    manifest = json.dumps(roster, ensure_ascii=False, separators=(',', ':'))
    snapshot = json.dumps(inventory, ensure_ascii=False, separators=(',', ':'))
    replacements = {
        '{{EXPECTED}}': values, '{{REVISION}}': str(inventory['workspaceRevision']),
        '{{RECHECK}}': recheck, '{{ROSTER}}': literal(manifest), '{{SNAPSHOT}}': literal(snapshot),
        '{{SOURCE_HASH}}': roster['sourceSha256'],
        '{{ROSTER_HASH}}': hashlib.sha256(manifest.encode('utf-16-le')).hexdigest().upper(),
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    if '{{' in template:
        raise ValueError('Unresolved template token')
    return template


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--roster', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    inventory = json.loads(args.inventory.read_text(encoding='utf-8-sig'))
    roster = json.loads(args.roster.read_text(encoding='utf-8-sig'))
    template = (root / 'database/operations/real-user-cutover.template.sql').read_text(encoding='utf-8')
    inventory_sql = (root / 'database/operations/real-user-cutover-preview.sql').read_text(encoding='utf-8')
    result = build(inventory, roster, template, inventory_sql)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf-8-sig')
    print(json.dumps({'output': str(args.output.resolve()), 'default': 'PREVIEW_ONLY', 'users': 20, 'projects': 2, 'revision': inventory['workspaceRevision']}))


if __name__ == '__main__':
    main()
