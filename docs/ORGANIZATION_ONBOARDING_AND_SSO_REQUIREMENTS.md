# Organization Onboarding & SSO Integration Requirements

> Updated 16 November 2026: for the current company implementation and operator-reported hosted sign-in/logout result, follow [current company operations](CURRENT_OPERATIONS.md) and [SSO/provisioning](REAL_USER_SSO.md). Historical prerequisites and example values in this checklist are not current App Service settings. Live upstream directory synchronization remains unimplemented. Keep KT enabled.

Ye document organization ki **IT / Security team** aur **HR / HRMS Data team** ke sath share karne ke liye banaya gaya hai. Isme Microsoft Entra ID (Azure AD) SSO setup aur Employee Database export ki exact requirements shamil hain.

**Status (7 October 2026; historical checklist):** Yeh onboarding data-collection checklist hai, automated HRMS/CSV/XLSX importer ka implemented contract nahi. Current approved access policy [Access Management baseline](ACCESS_MODEL_REDESIGN.md) hai. Existing authenticated APIs/SQL checks, workspace identity mapping aur preview/recheck/audit workflow remain mandatory. Current SSO ka exact configuration [REAL_USER_SSO.md](REAL_USER_SSO.md) mein hai; neeche ke purane SPA/build-time examples current flow ko describe nahi karte.

---

## PART 1: Microsoft Entra ID (Azure AD) SSO Setup

_(Target Audience: IT Administrator / Azure Cloud & Security Team)_

Current company hosting uses server-side Microsoft Entra **OIDC authorization code with PKCE**. The backend validates the ID token and issues an opaque HttpOnly application session. SAML is not configured. The application is currently reusing the user-approved GatePass India registration; protect its other consumers and do not change shared settings without the registration owner. Current IDs, exact callback URLs and operations are documented in [REAL_USER_SSO.md](REAL_USER_SSO.md).

### 1. Required Azure AD Configuration Parameters

The following table is retained only as a historical generic two-registration design example. Do not copy its sample IDs or VITE settings into the current deployment. The current runtime requires the verified tenant, Web client and API client IDs plus `PUBLIC_APP_ORIGIN`, `SERVE_WEB=true`, and a server-only `ENTRA_WEB_CLIENT_SECRET`. The secret must never be sent to the SPA/browser.

| Parameter Key         | Description                                              | Example Format                         |
| --------------------- | -------------------------------------------------------- | -------------------------------------- |
| `ENTRA_TENANT_ID`     | Organization ka Azure Directory (Tenant) ID              | `8f219b4a-39ab-42cb-b1ec-91b42749f76a` |
| `ENTRA_API_CLIENT_ID` | Backend API App Registration ka Application (Client) ID  | `3b8908f4-4a25-4c07-a61b-9f33b1e327a1` |
| `ENTRA_WEB_CLIENT_ID` | Frontend Web App Registration ka Application (Client) ID | `9c43a0d1-72f1-4a1e-84b2-29cb115e519c` |

### 2. Azure App Registration Configuration Steps

1. **Current backend Web client**: Platform **Web**. Add exact callbacks `https://<app-origin>/api/auth/callback` and `https://<app-origin>/api/auth/signed-out`. Local or preview origins must be explicitly registered and isolated; never use wildcard redirect URIs.
2. **Secret and server settings**: Store `ENTRA_WEB_CLIENT_SECRET` only in the approved server secret store. For the current company, the selected expiry is 24 months; record the actual expiration date in the organization's secret inventory and create an owner-controlled reminder before it expires. Rotate before expiry. Secret ID is not the credential value.
3. **Current token validation**: The backend validates the OIDC **ID token** (signature/JWKS, issuer, web-client audience, nonce, lifetime, tenant and UUID `oid`). It requires `preferred_username` to end in `@soprasteria.com`. The runtime identity key is `(tenant ID, object ID)` and the existing active employee binding/effective access is still required. No Graph lookup or Graph `User.Read` permission is needed for login. No email-based first-login auto-linking is implemented.
4. **Sign-out and automatic sign-in**: Bare-domain entry attempts OIDC `prompt=none`, using a remembered login hint where available; if Entra requires interaction, the user sees the Microsoft sign-in fallback. Sign-out revokes the local application session and redirects to Entra OIDC logout; this is not SAML SLO or an all-app sign-out guarantee. Corporate Conditional Access/MFA and enterprise-app assignment continue to apply.

The API's `access_as_user` scope and old SPA redirect can remain in the shared GatePass registration for other consumers. They are not requested by the current backend OIDC login flow. Do not remove them or change token settings without confirming GatePass dependencies.

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

> **Note**: Current direct-manager skill review ek explicitly implemented relationship policy hai: current active manager, exact assigned reviewer, active claimant, reviewable state, matching scoped DENY aur no-self-review checks preserve hone chahiye. Hierarchy, title, account/client ya manager flag se general access nahi milta. Recommendations ko independently effective `learning.recommend` permission aur authorized recipient scope chahiye. Placement data wider TEAM/DEPARTMENT/ORGANIZATION access enable nahi karta.

Current product labels **Portfolio/Division**, **Accounts/Clients** aur **Project** hain. Har client ke liye approved Portfolio/Division mapping mandatory hai. Data collection ke `department` aur `team` column names neeche unchanged hain: `department` Accounts/Clients placement hai, aur `team` uske andar optional single organizational Project hai. Ye structure separate multiple Business project memberships ko merge ya populate nahi karta. Migration 088 aur reviewed mapping ka live rollout pending hai.

| Field Name              | Data Type      | Description                                      | Mandatory?                    | Example                  |
| ----------------------- | -------------- | ------------------------------------------------ | ----------------------------- | ------------------------ |
| `manager_employee_code` | Text (max 40)  | Direct reporting manager ka Employee Code        | **YES** _(Top head ka blank)_ | `EMP10012`               |
| `delivery_unit`         | Text (max 100) | Top-level Delivery Unit                          | **YES**                       | `Digital Transformation` |
| `portfolio`             | Text (max 100) | Delivery Unit ke andar Portfolio/Division        | **YES**                       | `Example Division`       |
| `department`            | Text (max 100) | Portfolio/Division ke andar Accounts/Clients     | **YES**                       | `Example Client`         |
| `team`                  | Text (max 100) | Accounts/Clients ke andar organizational Project | Optional                      | `Example Project`        |

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
employee_code,display_name,email,entra_object_id,manager_employee_code,delivery_unit,portfolio,department,team,job_title,grade,active,admin_role
EMP10001,Vikram Mehta,vikram.mehta@company.com,a1234567-1111-2222-3333-444455556666,,Digital Services,Enterprise,Technology,,CTO,E2,TRUE,Access Admin
EMP10012,Pooja Nair,pooja.nair@company.com,b2345678-2222-3333-4444-555566667777,EMP10001,Digital Services,Enterprise,Technology,Platform Pod,Engineering Manager,L6,TRUE,
EMP10245,Rahul Sharma,rahul.sharma@company.com,c3456789-3333-4444-5555-666677778888,EMP10012,Digital Services,Enterprise,Technology,Platform Pod,Senior Backend Engineer,L4,TRUE,
EMP10246,Neha Singh,neha.singh@company.com,d4567890-4444-5555-6666-777788889999,EMP10012,Digital Services,Enterprise,Technology,Platform Pod,Frontend Engineer,L3,TRUE,
EMP10050,Suresh Patel,suresh.patel@company.com,e5678901-5555-6666-7777-888899990000,EMP10001,Corporate,Corporate Services,Human Resources,L&D,Head of Learning,L6,TRUE,Catalogue Admin
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
4. **Delivery Unit, Portfolio/Division, Accounts/Clients & Project Tree**:
   - Delivery Unit top-level root hota hai.
   - Portfolio/Division (`PORTFOLIO`) Delivery Unit ke under hota hai; har client ki complete mapping pehle approve honi chahiye.
   - Accounts/Clients (`DEPARTMENT`) Portfolio/Division ke under map hota hai; direct DU-to-client parent ab valid nahi hai.
   - Organizational Project (`TEAM`) hamesha Accounts/Clients ke under aata hai.
   - Direct Accounts/Clients placement bhi supported hai; organizational Project optional hai. Reporting manager separately assign hota hai.
   - India Head -> DU Head -> Portfolio Manager/Delivery Manager -> Account Manager -> Project Manager reporting guide hai, inferred person assignments ya access grants nahi.

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
