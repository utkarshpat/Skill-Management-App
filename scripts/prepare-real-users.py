"""Validate an HR workbook and prepare an account-bound, non-executing cutover preview.

No database connection, mutation, identity auto-linking, or access grant is made.
Source employee data is written only to the explicitly selected ignored output folder.
"""
import argparse
import hashlib
import json
import re
import uuid
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
HEADERS = ["Employee Code", "Employee Name", "Email Address", "Project", "Assignment Location", "Client/Account Name"]


def read_users(path):
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = {node.attrib["Id"]: node.attrib["Target"] for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = workbook.findall("s:sheets/s:sheet", NS)
        if len(sheets) != 1:
            raise ValueError("Expected one reviewed user sheet; multiple sheets need explicit selection.")
        sheet = sheets[0]
        target = relationships[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        rows = []
        for row in ET.fromstring(archive.read(target)).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                if cell.find("s:f", NS) is not None:
                    raise ValueError("Formula cells are not accepted as employee source facts.")
                column = re.sub(r"\d", "", cell.attrib["r"])
                value = cell.find("s:v", NS)
                text = value.text if value is not None and value.text else ""
                if cell.attrib.get("t") == "s":
                    text = strings[int(text)]
                elif cell.attrib.get("t") == "inlineStr":
                    text = "".join(cell.find("s:is", NS).itertext())
                cells[column] = text.strip()
            if any(cells.values()):
                rows.append((int(row.attrib["r"]), cells))
        if not rows or [rows[0][1].get(column, "") for column in "ABCDEF"] != HEADERS:
            raise ValueError("Workbook headers do not match the reviewed employee source format.")
        users, codes, emails = [], set(), set()
        for number, cells in rows[1:]:
            if any(value for column, value in cells.items() if column not in set("ABCDEF")):
                raise ValueError(f"Unexpected populated extra field at row {number}.")
            values = [cells.get(column, "") for column in "ABCDEF"]
            code, name, email, project, location, client = values
            if not re.fullmatch(r"[0-9]{1,40}", code) or not name or len(name) > 100:
                raise ValueError(f"Invalid employee identity at row {number}.")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                raise ValueError(f"Invalid work email at row {number}.")
            if code in codes or email.casefold() in emails:
                raise ValueError(f"Duplicate employee code/email at row {number}.")
            if not project or len(project) > 100 or not location or not client:
                raise ValueError(f"Missing or oversized source placement at row {number}.")
            if any(re.search(r"[\x00-\x1f\x7f]", value) for value in values):
                raise ValueError(f"Control characters in employee fields at row {number}.")
            codes.add(code)
            emails.add(email.casefold())
            users.append(dict(sourceRow=number, employeeCode=code, displayName=name, workEmail=email, project=project, assignmentLocation=location, clientAccountName=client))
        if not users:
            raise ValueError("No employees found.")
        return users


def prepare(users, account, tenant, admin, manager, lead):
    namespace = uuid.UUID(account)
    uuid.UUID(tenant)
    codes = {user["employeeCode"] for user in users}
    if len({admin, manager, lead}) != 3 or not {admin, manager, lead}.issubset(codes):
        raise ValueError("Admin, manager and lead must identify three exact employees in this workbook.")
    projects = sorted({user["project"] for user in users})
    for user in users:
        user["personId"] = str(uuid.uuid5(namespace, "real-user:" + user["employeeCode"]))
        user["managerEmployeeCode"] = None if user["employeeCode"] == admin else admin if user["employeeCode"] == manager else manager
        user["entraObjectId"] = None
        user["activation"] = "PENDING_VERIFIED_ENTRA_BINDING"
    return {
        "format": 1, "mode": "PREVIEW_ONLY_NO_DB_CHANGES", "accountId": str(namespace), "tenantId": tenant,
        "users": users, "projects": [{"name": name, "id": str(uuid.uuid5(namespace, "real-project:" + name))} for name in projects],
        "accessIntent": {
            "initialAdminEmployeeCode": admin,
            "directManagerEmployeeCode": manager,
            "capabilityLeadEmployeeCode": lead,
            "capabilityLeadProjectScopes": projects,
            "capabilityLeadRequestedActions": ["Business Analytics view", "Business Analytics export"],
            "scopeLimit": "No organization-wide grant or unrelated manager-review authority.",
            "implementationReview": "Existing Business Operations bundle includes other actions. Do not silently grant the full bundle for a view/export-only request.",
        },
        "identityPolicy": "Capture oid only from validated company sign-in, then explicitly review the binding. No automatic name/email linking or demo login for real users.",
        "cleanupPolicy": "Live inventory and reviewed snapshot are required. Do not carry demo histories/grants into fresh real-person IDs. Retain required schema, runtime bindings and approved genuine catalogue masters. Review audit/foreign-key dependencies before physical deletion.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--account", required=True)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--admin", required=True)
    parser.add_argument("--manager", required=True)
    parser.add_argument("--lead", required=True)
    args = parser.parse_args()
    users = read_users(args.workbook)
    result = prepare(users, args.account, args.tenant, args.admin, args.manager, args.lead)
    result["sourceFile"] = args.workbook.name
    result["sourceSha256"] = hashlib.sha256(args.workbook.read_bytes()).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / "real-users-preview.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": result["mode"], "users": len(users), "projects": len(result["projects"]), "managerEdges": sum(user["managerEmployeeCode"] is not None for user in users), "duplicateCodes": 0, "duplicateEmails": 0, "sourceSha256": result["sourceSha256"], "output": str(output.resolve())}))


if __name__ == "__main__":
    main()
