import copy
import importlib.util
import tempfile
import unittest
import zipfile
import sys
from pathlib import Path
from xml.sax.saxutils import escape

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("prepare_real_users", Path(__file__).with_name("prepare-real-users.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RosterPreparationTests(unittest.TestCase):
    def workbook(self, directory, rows):
        path = Path(directory) / "synthetic.xlsx"
        content = []
        for index, row in enumerate([module.HEADERS] + rows, 1):
            cells = []
            for column, value in enumerate(row):
                letter = "AB" if column == 6 else chr(65 + column)
                cells.append(f'<c r="{letter}{index}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
            content.append(f'<row r="{index}">{"".join(cells)}</row>')
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Users" sheetId="1" r:id="rId1"/></sheets></workbook>')
            archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
            archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(content) + '</sheetData></worksheet>')
        return path

    def rows(self):
        return [[str(code), f"Person {code}", f"p{code}@example.com", "Project A" if code < 3 else "Project B", "Office", "Client"] for code in range(1, 5)]

    def test_roster_keeps_source_fields_and_codes(self):
        with tempfile.TemporaryDirectory(prefix="real-user-preview-test-") as directory:
            users = module.read_users(self.workbook(directory, self.rows()))
        self.assertEqual(len(users), 4)
        self.assertEqual(users[0]["clientAccountName"], "Client")
        self.assertEqual(users[0]["assignmentLocation"], "Office")

    def test_duplicate_codes_emails_missing_values_and_extra_columns_fail(self):
        invalid = []
        for column, value in [(0, "1"), (2, "P1@example.com"), (2, ""), (0, "not-a-code")]:
            rows = self.rows()
            rows[1][column] = value
            invalid.append(rows)
        rows = self.rows()
        rows[1].append("unexpected AB column")
        invalid.append(rows)
        for rows in invalid:
            with self.subTest(rows=rows), tempfile.TemporaryDirectory(prefix="real-user-preview-test-") as directory:
                with self.assertRaises(ValueError):
                    module.read_users(self.workbook(directory, rows))

    def test_reporting_has_one_root_no_self_review_and_no_identity_auto_link(self):
        with tempfile.TemporaryDirectory(prefix="real-user-preview-test-") as directory:
            users = module.read_users(self.workbook(directory, self.rows()))
        account = "00000000-0000-4000-8000-000000000001"
        tenant = "00000000-0000-4000-8000-000000000002"
        result = module.prepare(users, account, tenant, "1", "2", "3")
        self.assertEqual([u["managerEmployeeCode"] for u in result["users"]], [None, "1", "2", "2"])
        self.assertTrue(all(u["entraObjectId"] is None for u in users))
        self.assertTrue(all(u["activation"] == "PENDING_VERIFIED_ENTRA_BINDING" for u in users))
        self.assertEqual(len({u["personId"] for u in users}), 4)
        again = module.prepare(copy.deepcopy(users), account, tenant, "1", "2", "3")
        self.assertEqual([u["personId"] for u in users], [u["personId"] for u in again["users"]])
        self.assertEqual(len(result["accessIntent"]["capabilityLeadProjectScopes"]), 2)
        with self.assertRaises(ValueError):
            module.prepare(copy.deepcopy(users), account, tenant, "1", "1", "3")
        with self.assertRaises(ValueError):
            module.prepare(copy.deepcopy(users), account, tenant, "1", "2", "99")


if __name__ == "__main__":
    unittest.main()
