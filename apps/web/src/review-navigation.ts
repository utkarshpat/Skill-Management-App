export function reviewView(params: URLSearchParams): 'queue' | 'team' | 'recommendations' {
  const tab = params.get('tab');
  if (tab === 'recommendations') return 'recommendations';
  if (tab === 'analytics' || tab === 'team') return 'team';
  return 'queue';
}
