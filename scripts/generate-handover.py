"""Extract this repository's reviewed table DDL; never connects to a database.

This is a repository-specific extractor, not a general T-SQL parser. Dynamic
CHECK removals are explicitly reconciled below. Retains original declarations.
"""
from pathlib import Path
import re
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/api/src/modules/knowledge-transfer"

def balanced(text, opening):
    depth, quoted, i = 0, False, opening
    while i < len(text):
        c = text[i]
        if c == "'":
            if quoted and i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0:
                    return text[opening + 1:i], i + 1
        i += 1
    raise ValueError('Unbalanced DDL')

def split_items(text):
    depth, quoted, start, result, i = 0, False, 0, [], 0
    while i < len(text):
        c = text[i]
        if c == "'":
            if quoted and i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c == ',' and depth == 0:
                result.append(text[start:i].strip())
                start = i + 1
        i += 1
    result.append(text[start:].strip())
    return result

def cols(text):
    return [x.strip() for x in text.split(',')]

tables, removed, views, inputs = {}, [], {}, []

def add_items(table, body, source):
    t = tables[table]
    for raw in split_items(body):
        raw = re.sub(r'\s+', ' ', raw).strip()
        constraint = re.match(r'(?:CONSTRAINT\s+\w+\s+)?(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b', raw, re.I)
        if constraint:
            t['constraints'].append({'sql': raw, 'source': source})
            if constraint[1].upper() == 'PRIMARY KEY':
                t['pk'] = cols(balanced(raw, raw.index('('))[0])
            elif constraint[1].upper() == 'UNIQUE':
                t['unique'].append(cols(balanced(raw, raw.index('('))[0]))
            fk = re.search(r'FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+dbo\.(\w+)\s*\(([^)]+)\)', raw, re.I)
            if fk:
                t['fks'].append({'columns': cols(fk[1]), 'target': fk[2], 'targetColumns': cols(fk[3]), 'source': source})
            continue
        m = re.match(r'(\w+)\s+([a-zA-Z][a-zA-Z0-9_]*(?:\s*\([^)]*\))?)(.*)', raw)
        if not m:
            raise ValueError(f'Unknown item {table}: {raw}')
        name, dtype, tail = m.groups()
        assert name not in t['columns'], (table, name)
        t['columns'][name] = {'type': dtype.replace(' ', ''), 'nullable': not bool(re.search(r'\bNOT NULL\b', tail, re.I)), 'declaration': raw, 'source': source}
        if re.search(r'\bPRIMARY KEY\b', tail, re.I):
            t['pk'] = [name]
            t['columns'][name]['nullable'] = False
        if re.search(r'\bUNIQUE\b', tail, re.I):
            t['unique'].append([name])
        fk = re.search(r'REFERENCES\s+dbo\.(\w+)\s*\(([^)]+)\)', tail, re.I)
        if fk:
            t['fks'].append({'columns': [name], 'target': fk[1], 'targetColumns': cols(fk[2]), 'source': source})

for path in sorted((ROOT / 'database/migrations').glob('*.sql')):
    source = path.name
    inputs.append(source)
    try:
        source_text = path.read_text(encoding='utf-8-sig')
    except UnicodeDecodeError:
        source_text = path.read_text(encoding='cp1252')
    text = re.sub(r'--[^\n]*', '', source_text)
    events = []
    for m in re.finditer(r'\bCREATE TABLE\s+dbo\.(\w+)\s*\(', text, re.I):
        body, end = balanced(text, m.end() - 1)
        events.append((m.start(), 'create', m[1], body))
    for m in re.finditer(r'^\s*ALTER TABLE\s+dbo\.(\w+)\s+ADD\s+([^;]+);', text, re.I | re.M):
        events.append((m.start(), 'add', m[1], m[2]))
    for m in re.finditer(r'^\s*DROP TABLE\s+dbo\.(\w+)\s*;', text, re.I | re.M):
        events.append((m.start(), 'drop', m[1], ''))
    for m in re.finditer(r'\bCREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+dbo\.(\w+)\s*\(', text, re.I):
        body, end = balanced(text, m.end() - 1)
        suffix = text[end:text.index(';', end)].strip()
        events.append((m.start(), 'index', m[3], {'name':m[2], 'unique':bool(m[1]), 'columns':split_items(body), 'filter':suffix, 'source':source}))
    for _, kind, name, body in sorted(events):
        if kind == 'create':
            assert name not in tables
            tables[name] = {'source':source, 'columns':{}, 'pk':[], 'unique':[], 'fks':[], 'constraints':[], 'indexes':[]}
            add_items(name, body, source)
        elif kind == 'add':
            add_items(name, body, source)
        elif kind == 'index':
            tables[name]['indexes'].append(body)
        elif kind == 'drop':
            removed.append(name)
            del tables[name]
    for m in re.finditer(r'^CREATE VIEW dbo\.(\w+) AS\s*([\s\S]+?)(?=^GO\s*$)', text, re.I | re.M):
        views[m[1]] = {'sql':m[2].strip(), 'source':source}

# Dynamic CHECK removals in 010, 015, 023, 044 are selected from sys.check_constraints.
tables['SkillClaimDraft']['columns']['status']['declaration'] = tables['SkillClaimDraft']['columns']['status']['declaration'].replace(" CHECK(status='DRAFT')", '')
tables['LearningPlan']['columns']['payload']['declaration'] = re.sub(r'\s+CHECK\(ISJSON\(payload\)=1 AND DATALENGTH\(payload\)<=65536\)', '', tables['LearningPlan']['columns']['payload']['declaration'])
tables['WorkflowRecord']['columns']['status']['declaration'] = tables['WorkflowRecord']['columns']['status']['declaration'].replace(" CHECK(status IN ('SUBMITTED','CANCELLED'))", '')
tables['WorkflowEvent']['columns']['action']['declaration'] = tables['WorkflowEvent']['columns']['action']['declaration'].replace(" CHECK(action IN ('CREATE','COMMENT','CANCEL'))", '')
tables['ProficiencyFramework']['constraints'] = [item for item in tables['ProficiencyFramework']['constraints'] if item['sql'] != "CHECK(account_id IS NOT NULL OR framework_key='enterprise-v1')"]

for name,t in tables.items():
    assert t['pk'], name
    assert set(t['pk']) <= t['columns'].keys()
    for fk in t['fks']:
        target = tables[fk['target']]
        assert set(fk['columns']) <= t['columns'].keys(), (name,fk)
        assert set(fk['targetColumns']) <= target['columns'].keys(), (name,fk)
        assert len(fk['columns']) == len(fk['targetColumns'])
        assert fk['targetColumns'] in [target['pk'], *target['unique']], (name,fk)

# Everything below is generated only from reviewed repository inputs. No .env,
# real employee rows, SQL connection, deployment credentials or model access.
import hashlib
import sys
document = (ROOT / 'docs/HANDOVER.md').read_text(encoding='utf-8')
slug = lambda value: re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
sections = []
for part in re.split(r'^## ', document, flags=re.M)[1:]:
    title, _, content = part.partition('\n')
    sections.append({'id':slug(title),'title':title,'content':content.strip(), 'source':'docs/HANDOVER.md'})
baseline = (ROOT / 'docs/ACCESS_MODEL_REDESIGN.md').read_text(encoding='utf-8')
sections.append({'id':'approved-access-baseline','title':'Approved Access Baseline','content':baseline,'source':'docs/ACCESS_MODEL_REDESIGN.md'})
routes=[]
for path in sorted((ROOT/'apps/api/src/modules').rglob('*routes.ts')):
    source=path.relative_to(ROOT).as_posix()
    text=path.read_text(encoding='utf-8')
    for m in re.finditer(r'\bapp\.(get|post|put|patch|delete)\(\s*[\'\"]([^\'\"]+)[\'\"]',text):
        routes.append({'method':m[1].upper(),'path':m[2],'module':path.parent.name,'source':source})
procedures={}
for path in sorted((ROOT/'database/migrations').glob('*.sql')):
    try:
        text=path.read_text(encoding='utf-8-sig')
    except UnicodeDecodeError:
        text=path.read_text(encoding='cp1252')
    for m in re.finditer(r'\bCREATE\s+(?:OR ALTER\s+)?(PROCEDURE|FUNCTION|VIEW)\s+dbo\.(\w+)\b',text,re.I):
        tail=text[m.end():]
        signature=re.split(r'\bAS\b',tail,maxsplit=1,flags=re.I)[0].strip()[:1800]
        procedures[m[2]]={'name':m[2],'kind':m[1].upper(),'signature':signature,'source':path.relative_to(ROOT).as_posix()}
groups={
 'Identity foundation':['SchemaMigration','Account','DeliveryUnit','Department','Team','AppUser','TeamMembership','ReportingRelationship','AppRole','Permission','UserRole','RolePermission','UserPermission','AuditEvent'],
 'Access & organization':['AccessWorkspace','AccessRuntimeAccount','AccountRole','AccessPerson','AccountRolePermission','AccessPersonRole','AccessPersonOverride','AccessAudit','AccessOrgNode','AccessOrgAssignment','AccessImplementedScope'],
 'Skills & claims':['SkillCatalogue','ProficiencyFramework','ProficiencyLevel','SkillDefinitionVersion','SkillVersionCriterion','SkillClaimDraft','SkillClaimNotification','SkillClaimEvidence'],
 'Learning & recommendations':['LearningPlan','LearningSession','LearningQuiz','LearningAttempt','LearningRecommendation','LearningRecommendationEvent'],
 'Requests & incidents':['WorkflowRecord','WorkflowEvent'],
 'AI & budget':['AiConversation','AiAccountBudget','AiActorBudget'],
}
assert set(sum(groups.values(), []))==set(tables), 'Update schema domain groups for new tables'
for name,t in tables.items():
    t['domain']=next(group for group,names in groups.items() if name in names)
data={'title':'Cognitive Intelligence Lab','version':re.search(r'^Version: (\d{4}-\d{2}-\d{2})',document,re.M)[1],'basis':'Repository source and migrations; not live introspection',
 'revision':hashlib.sha256((document+baseline+json.dumps(tables,sort_keys=True)+json.dumps(routes)+json.dumps(procedures,sort_keys=True)).encode()).hexdigest()[:16],
 'sections':sections,'schema':{'migrations':inputs,'tables':tables,'views':views,'removedTables':removed},
 'routes':routes,'procedures':list(procedures.values()),'groups':groups}
output='// Generated by npm run docs:generate. Edit docs/HANDOVER.md or reviewed source instead.\nexport default '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n'
target=OUT/'content.generated.ts'
reference=ROOT/'docs/REFERENCE.generated.json'
reference_output=json.dumps({'version':data['version'],'revision':data['revision'],'basis':data['basis'],'schema':data['schema'],'routes':data['routes'],'procedures':data['procedures'],'groups':data['groups']},ensure_ascii=False,indent=2)+'\n'
if '--check' in sys.argv:
    if ('--offline-only' not in sys.argv and (not target.exists() or target.read_text(encoding='utf-8')!=output)) or not reference.exists() or reference.read_text(encoding='utf-8')!=reference_output:
        raise SystemExit('Handover output is stale. Run npm run docs:generate.')
else:
    reference.write_text(reference_output,encoding='utf-8',newline='\n')
    if '--offline-only' not in sys.argv:
        OUT.mkdir(parents=True,exist_ok=True)
        target.write_text(output,encoding='utf-8',newline='\n')
print(json.dumps({'sections':len(sections),'tables':len(tables),'columns':sum(len(t['columns']) for t in tables.values()),'foreignKeys':sum(len(t['fks']) for t in tables.values()),'routes':len(routes),'sqlObjects':len(procedures),'revision':data['revision']}))
