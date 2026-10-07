# Organization Onboarding & SSO Integration Requirements

Ye document organization ki **IT / Security team** aur **HR / HRMS Data team** ke sath share karne ke liye banaya gaya hai. Isme Microsoft Entra ID (Azure AD) SSO setup aur Employee Database export ki exact requirements shamil hain.

**Status (7 October 2026):** Yeh onboarding data-collection checklist hai, automated HRMS/CSV/XLSX importer ka implemented contract nahi. Current approved access policy [Access Management baseline](ACCESS_MODEL_REDESIGN.md) hai. Existing authenticated APIs/SQL checks, workspace identity mapping aur preview/recheck/audit workflow remain mandatory. Production rollout ke liye [migration runbook](AZURE_MIGRATION_RUNBOOK.md) bhi follow karein.

---

## PART 1: Microsoft Entra ID (Azure AD) SSO Setup

_(Target Audience: IT Administrator / Azure Cloud & Security Team)_

Application Microsoft Entra ID (OAuth 2.0 / OIDC with PKCE) use karti hai. Iske liye Azure Portal mein **do App Registrations** configure karein: SPA web client aur delegated API. Current application contract dono client IDs explicitly validate karta hai:

### 1. Required Azure AD Configuration Parameters

Client ki IT team ko yeh non-secret IDs provide karne hain. API runtime par `ENTRA_*` values aur web build par matching `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_API_CLIENT_ID`, `VITE_ENTRA_WEB_CLIENT_ID` configure karein. Vite values build-time hain; changes ke baad web rebuild/redeploy zaroori hai. SPA ko client secret nahi dena hai:

| Parameter Key         | Description                                              | Example Format                         |
| --------------------- | -------------------------------------------------------- | -------------------------------------- |
| `ENTRA_TENANT_ID`     | Organization ka Azure Directory (Tenant) ID              | `8f219b4a-39ab-42cb-b1ec-91b42749f76a` |
| `ENTRA_API_CLIENT_ID` | Backend API App Registration ka Application (Client) ID  | `3b8908f4-4a25-4c07-a61b-9f33b1e327a1` |
| `ENTRA_WEB_CLIENT_ID` | Frontend Web App Registration ka Application (Client) ID | `9c43a0d1-72f1-4a1e-84b2-29cb115e519c` |

### 2. Azure App Registration Configuration Steps

1. **Web Frontend App (`ENTRA_WEB_CLIENT_ID`)**:
   - **Platform**: Single-page application (SPA).
   - **Redirect URI**: `https://<our-app-domain>/` (aur current local default `http://127.0.0.1:5173/`). Code ka default `window.location.origin + '/'` hai. Exact origin/port, trailing slash aur scheme Entra SPA registration se match hone chahiye. Agar `VITE_AUTH_REDIRECT_URI` explicitly set karein, us exact supported URI ko register karein; `/auth/callback` default route nahi hai. Same URI post-logout redirect ke liye use hoti hai.
   - **Grant Type**: Authorization Code Flow with PKCE.
2. **Backend API App (`ENTRA_API_CLIENT_ID`)**:
   - **Expose an API**: Application ID URI set karein (e.g., `api://<api-client-id>`).
   - **Add Scope**: Delegated scope `access_as_user` add karein; consent organization ki approved security policy ke according configure karein. Web client `api://<api-client-id>/access_as_user` request karta hai.
   - Web App ko is scope ke liye authorized client application mein add karein.
3. **Required JWT Token Claims**:
   - Token version: `2.0` (`ver: "2.0"`).
   - API **access token** validate hota hai, ID token nahi. `iss` configured tenant ka v2 issuer, `aud` API client ID, RS256 signature, `exp`, `iat`, `nbf`, `tid`, UUID `oid`, `scp` containing `access_as_user`, `azp` web client ID aur `ver=2.0` enforced hain. `preferred_username` / `upn` required authorization claims nahi hain. Identity `(tenant ID, object ID)` se mapped hoti hai; email/display name se account auto-link nahi hota.

---

## PART 2: Employee Database (HRMS) Data Requirements

_(Target Audience: HR Operations / Database & BI Team)_

Platform par employees ka profile banane aur **reporting hierarchy & skill verification** automate karne ke liye unke internal database (Workday, Darwinbox, SAP SuccessFactors, BambooHR, etc.) se ye fields chahiye:

### 1. Mandatory Identity & SSO Mapping Fields

| Field Name        | Data Type        | Description                                                   | Mandatory?        | Example                                |
| ----------------- | ---------------- | ------------------------------------------------------------- | ----------------- | -------------------------------------- |
| `employee_code`   | Text (max 40)    | Unique Employee Code / Staff ID                               | **YES**           | `EMP10245`                             |
| `display_name`    | Text (max 100)   | Full Name                                                     | **YES**           | `Rahul Sharma`                         |
| `email`           | Text (max 120)   | Work email/UPN for HR reconciliation; not the identity key    | **YES**           | `rahul.sharma@company.com`             |
| `entra_object_id` | UUID (36 chars)  | Azure AD User Object ID (SSO mapping ke liye)                 | **YES (for SSO)** | `c41e8f22-5401-49b0-9dc1-3c0b4352a101` |
| `active`          | Boolean / String | Employment status (`TRUE` / `FALSE` ya `ACTIVE` / `INACTIVE`) | **YES**           | `TRUE`                                 |

### 2. Organization Placement & Reporting Hierarchy (Crucial)

> **Note**: Current direct-manager skill review ek explicitly implemented relationship policy hai: current active manager, exact assigned reviewer, active claimant, reviewable state, matching scoped DENY aur no-self-review checks preserve hone chahiye. Hierarchy, title, department ya manager flag se general access nahi milta. Recommendations ko independently effective `learning.recommend` permission aur authorized recipient scope chahiye. Placement data wider TEAM/DEPARTMENT/ORGANIZATION access enable nahi karta.

| Field Name              | Data Type      | Description                                | Mandatory?                    | Example                  |
| ----------------------- | -------------- | ------------------------------------------ | ----------------------------- | ------------------------ |
| `manager_employee_code` | Text (max 40)  | Direct reporting manager ka Employee Code  | **YES** _(Top head ka blank)_ | `EMP10012`               |
| `delivery_unit`         | Text (max 100) | Top-level division ya business unit        | **YES**                       | `Digital Transformation` |
| `department`            | Text (max 100) | Division ke andar ka department / function | **YES**                       | `Engineering`            |
| `team`                  | Text (max 100) | Department ke andar sub-team / pod         | Optional                      | `Core Platform`          |

### 3. Job Profile & Designation Details

| Field Name  | Data Type      | Description                                 | Mandatory? | Example                   |
| ----------- | -------------- | ------------------------------------------- | ---------- | ------------------------- |
| `job_title` | Text (max 100) | Employee ka current job title / designation | Optional   | `Senior Backend Engineer` |
| `grade`     | Text (max 40)  | Career band / internal level                | Optional   | `L4` ya `Band 3B`         |

### 4. Requested additional responsibility (approval required)

| Field Name   | Allowed Values                                                                               | Description                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `admin_role` | `Catalogue Admin`<br>`People Admin`<br>`Access Admin`<br>_(Leave blank for normal employee)_ | Requested responsibility only; label se access auto-grant nahi hota. Approved implemented template/scope plus explicit access-admin approval required. |

---

## PART 3: Ready-to-Use CSV Sample Template

Organization data collection/reconciliation ke liye is format mein `.csv` ya `.xlsx` export provide kar sakti hai. **Is sample ko current CLI ya UI mein directly upload/import nahi karna:** generic CSV/XLSX/HRMS ingestion abhi implemented nahi hai. Existing `access:import` development-only local JSON bootstrap hai, organization HRMS import nahi. Employee profiles, Entra mapping, org nodes/reporting aur approved access assignments current governed APIs/setup process se explicitly provision honge. `active` strings ko reviewed processing mein boolean mein normalize karna hoga; `admin_role` remains a request.

```csv
employee_code,display_name,email,entra_object_id,manager_employee_code,delivery_unit,department,team,job_title,grade,active,admin_role
EMP10001,Vikram Mehta,vikram.mehta@company.com,a1234567-1111-2222-3333-444455556666,,Digital Services,Technology,,CTO,E2,TRUE,Access Admin
EMP10012,Pooja Nair,pooja.nair@company.com,b2345678-2222-3333-4444-555566667777,EMP10001,Digital Services,Technology,Platform Pod,Engineering Manager,L6,TRUE,
EMP10245,Rahul Sharma,rahul.sharma@company.com,c3456789-3333-4444-5555-666677778888,EMP10012,Digital Services,Technology,Platform Pod,Senior Backend Engineer,L4,TRUE,
EMP10246,Neha Singh,neha.singh@company.com,d4567890-4444-5555-6666-777788889999,EMP10012,Digital Services,Technology,Platform Pod,Frontend Engineer,L3,TRUE,
EMP10050,Suresh Patel,suresh.patel@company.com,e5678901-5555-6666-7777-888899990000,EMP10001,Corporate,Human Resources,L&D,Head of Learning,L6,TRUE,Catalogue Admin
```

---

## PART 4: Data Validation & Ingestion Rules

1. **Identity and approval before provisioning**:
   - Tenant/workspace verified ho; employee codes and mapped Entra object IDs unique ho. Email change account identity change nahi hai. Cross-tenant IDs ko same person samajhkar auto-link nahi karna.
   - Unknown/inactive/unmapped identities ko access deny hona chahiye; first authorized access administrator ko reviewed setup process se provision karein. CSV ka `admin_role`, title ya reporting level authority nahi deta.
   - HR reconciliation template mein email requested hai, lekin current People & Access person payload email field persist nahi karta. Is field ko current API payload mein unsupported key ki tarah send nahi karein.
2. **Manager Must Exist**:
   - `manager_employee_code` khud dataset ke andar ek valid aur `active = TRUE` employee hona chahiye.
   - Self-reporting (`employee_code == manager_employee_code`) strictly forbidden hai.
3. **Circular Loops Strictly Rejected**:
   - Reporting chain mein koi circular reporting (e.g., A reports to B, and B reports to A) nahi honi chahiye.
4. **Delivery Unit & Department Tree**:
   - Delivery Unit top-level root hota hai.
   - Department Delivery Unit ke under map hota hai.
   - Team hamesha Department ke under aati hai.

---

## Rollout acceptance

- Approved sample data aur mapping preview/review karein, sensitive data repository/logs mein na rakhein.
- Mapped employee ka own dashboard/skills/learning verify karein; unmapped/inactive/wrong-tenant user denied ho.
- Current assigned manager review allowed; unrelated manager, changed manager, self-review aur matching DENY blocked ho.
- Additional responsibilities effective access explanations se verify karein; role labels ko permission proof na maanein.
- Identity/runtime configuration, current schema, private Blob access aur rollback requirements migration runbook se verify karein. Yeh checklist khud data migration, deployment ya acceptance complete hone ka evidence nahi hai.

## PART 5: Privacy & Security (Data Not Required)

Organization ko clearly inform karein ki hume niche diya gaya data **bilkul nahi chahiye**:

- ❌ **No Passwords / Hashes** (Authentication strictly Microsoft SSO handle karega).
- ❌ **No Compensation / Salary / Payroll data**.
- ❌ **No Personal Government IDs** (Aadhaar, SSN, PAN, Passport).
- ❌ **No Personal Banking or Home details**.
- ❌ **No Performance Review Ratings or Disciplinary records**.
