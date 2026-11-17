import type { Management, Scope } from './announcement-model';
type Choice = Management['scopes'][number];

export function sameScope(a: Scope, b: Scope) {
  return a.id.toLowerCase() === b.id.toLowerCase() && a.kind === b.kind;
}
export function ancestorSelected(scope: Choice, selected: Scope[], scopes: Choice[]) {
  let current: Choice | undefined = scope;
  const visited = new Set<string>();
  while (current?.parentId && current.parentKind && !visited.has(current.id)) {
    visited.add(current.id);
    const parent: Scope = { id: current.parentId, kind: current.parentKind };
    if (selected.some(entry => sameScope(entry, parent))) return true;
    current = scopes.find(entry => sameScope(entry, parent));
  }
  return false;
}
export function orderAudienceScopes(scopes: Choice[]) {
  const order = ['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'PROJECT'];
  return [...scopes].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label),
  );
}
export function selectAudienceScope(
  scope: Choice,
  selected: Scope[],
  scopes: Choice[],
  enabled: boolean,
) {
  if (!enabled) return selected.filter(entry => !sameScope(entry, scope));
  const next = [
    ...selected.filter(entry => !sameScope(entry, scope)),
    { kind: scope.kind, id: scope.id },
  ];
  return next.filter(entry => {
    const choice = scopes.find(scope => sameScope(entry, scope));
    return !choice || !ancestorSelected(choice, next, scopes);
  });
}
