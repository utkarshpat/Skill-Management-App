"""Synthetic cutover guard tests. No company SQL connection or employee fixture."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('cutover', ROOT / 'scripts/prepare-real-user-cutover.py')
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class CutoverGuards(unittest.TestCase):
    def setUp(self):
        self.inventory = dict(mode='PREVIEW_ONLY_NO_DB_CHANGES', accountId=cutover.ACCOUNT, tenantId=cutover.TENANT,
            serverName='ssskillmgmtappsqlsrvdev', databaseName='SS-SkillMgmtApp-SQL-Dev', latestMigration=87,
            workspaceRevision=75, privateFiles=[dict(provider='sql')],
            tables=[dict(schemaName='dbo', tableName='AccessPerson', rowCount=16, snapshotSha256='A'*64),
                    dict(schemaName='dbo', tableName='BusinessProject', rowCount=0)],
            people=[dict(employeeCode=c, id=str(uuid.uuid4()), entraObjectId=None)
                    for c in sorted({'DEV-001', 'QA-001'} | {f'DEMO-NHS-{n:03}' for n in list(range(2, 15)) + [16]})])
        users = [dict(employeeCode=str(n),personId=str(uuid.uuid4()),displayName="Synthetic O'Brien",project='One' if n<10 else 'Two',
            managerEmployeeCode=None if n==0 else '0' if n==1 else '1',entraObjectId=None,activation='PENDING_VERIFIED_ENTRA_BINDING') for n in range(20)]
        self.roster = dict(mode='PREVIEW_ONLY_NO_DB_CHANGES', accountId=cutover.ACCOUNT, tenantId=cutover.TENANT,
            sourceSha256='a'*64, users=users, projects=[dict(name=n,id=str(uuid.uuid4())) for n in ['One','Two']],
            accessIntent=dict(initialAdminEmployeeCode='0',directManagerEmployeeCode='1',capabilityLeadEmployeeCode='2'))

    def render(self, inventory=None, roster=None):
        return cutover.build(inventory or self.inventory, roster or self.roster,
            (ROOT/'database/operations/real-user-cutover.template.sql').read_text(),
            (ROOT/'database/operations/real-user-cutover-preview.sql').read_text())

    def test_preview_defaults_exact_recheck_and_sql_escaping(self):
        sql=self.render()
        self.assertIn('DECLARE @apply bit=0',sql)
        self.assertIn("O''Brien",sql)
        self.assertIn("N'BusinessProject',0,NULL",sql)
        self.assertIn('SELECT * FROM #inventory EXCEPT SELECT * FROM #expected',sql)
        self.assertNotIn('{{',sql)
        self.assertNotIn('NOCHECK',sql)

    def test_wrong_tenant_or_schema_rejected(self):
        for field,value in [('tenantId',str(uuid.uuid4())),('latestMigration',88)]:
            with self.subTest(field=field):
                changed=copy.deepcopy(self.inventory);changed[field]=value
                with self.assertRaises(ValueError):self.render(inventory=changed)

    def test_real_identity_or_unknown_old_person_protected(self):
        for field,value in [('entraObjectId',str(uuid.uuid4())),('employeeCode','REAL-123')]:
            changed=copy.deepcopy(self.inventory);changed['people'][0][field]=value
            with self.assertRaises(ValueError):self.render(inventory=changed)

    def test_external_files_need_separate_manifest(self):
        changed=copy.deepcopy(self.inventory);changed['privateFiles'][0]['provider']='blob'
        with self.assertRaises(ValueError):self.render(inventory=changed)

    def test_missing_nonempty_hash_and_duplicate_table_rejected(self):
        changed=copy.deepcopy(self.inventory);del changed['tables'][0]['snapshotSha256']
        with self.assertRaises(ValueError):self.render(inventory=changed)
        changed=copy.deepcopy(self.inventory);changed['tables'].append(copy.deepcopy(changed['tables'][0]))
        with self.assertRaises(ValueError):self.render(inventory=changed)

    def test_manager_cycle_and_active_import_rejected(self):
        for field,value in [('managerEmployeeCode','0'),('activation','ACTIVE')]:
            changed=copy.deepcopy(self.roster);changed['users'][0][field]=value
            with self.assertRaises(ValueError):self.render(roster=changed)


if __name__=='__main__':unittest.main()
