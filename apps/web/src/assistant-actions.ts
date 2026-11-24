import { isPhaseTwoPage, phaseTwoVisible } from './release-features';

export interface AssistantPage {
  label: string;
  url: string;
  canOpenSkillClaim?: boolean;
}
export function canonicalAssistantDestination(input: string): string | undefined {
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(input, 'https://workspace.invalid');
  } catch {
    return undefined;
  }
  if (
    parsed.origin !== 'https://workspace.invalid' ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    return undefined;
  const path = parsed.pathname,
    query = parsed.searchParams;
  if (!phaseTwoVisible && isPhaseTwoPage(path)) return undefined;
  const uuid = (value: string | null) =>
    Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  if (path === '/requests' && query.size === 1 && uuid(query.get('record')))
    return `/requests?record=${encodeURIComponent(query.get('record')!)}`;
  if (path === '/my-skills' && query.size === 1 && uuid(query.get('claim')))
    return `/my-skills?claim=${encodeURIComponent(query.get('claim')!)}`;
  if (path === '/my-skills' && query.size === 1 && uuid(query.get('submission')))
    return `/my-skills?submission=${encodeURIComponent(query.get('submission')!)}`;
  if (path === '/skill-reviews') {
    if (query.size === 1 && uuid(query.get('claim')))
      return `/skill-reviews?claim=${encodeURIComponent(query.get('claim')!)}`;
    if (query.size === 2 && query.get('tab') === 'queue' && uuid(query.get('submission')))
      return `/skill-reviews?submission=${encodeURIComponent(query.get('submission')!)}&tab=queue`;
    if (
      query.size === 2 &&
      query.get('type') === 'certifications' &&
      uuid(query.get('certification'))
    )
      return `/skill-reviews?type=certifications&certification=${encodeURIComponent(query.get('certification')!)}`;
    if (query.size === 1 && query.get('type') === 'certifications')
      return '/skill-reviews?type=certifications';
  }
  if (path === '/certifications' && query.size === 1 && uuid(query.get('record')))
    return `/certifications?record=${encodeURIComponent(query.get('record')!)}`;
  const exact = path + parsed.search;
  if (exact === '/') return '/profile';
  if (exact === '/access') return '/access?view=overview';
  if (
    [
      '/workspace',
      '/profile',
      '/my-skills',
      '/certifications',
      '/skills',
      '/skills?tab=amendments',
      '/skill-reviews',
      '/learning',
      '/requests',
      '/business',
    ].includes(exact)
  )
    return exact;
  return /^\/access\?view=(overview|people|roles|assignments|organization|skills|audit)$/.test(
    exact,
  )
    ? exact
    : undefined;
}
export function assistantNavigationTargets(
  content: string,
  sources: { url?: string }[],
  pages: AssistantPage[],
) {
  const sourceUrls = sources
    .map(source => source.url && canonicalAssistantDestination(source.url))
    .filter((url): url is string => Boolean(url));
  // Generated text can suggest a known page. Exact records come from server sources.
  const suggestedPages = [...content.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)]
    .map(match => canonicalAssistantDestination(match[1]))
    .filter((url): url is string => pages.some(page => page.url === url));
  const urls = [...new Set([...sourceUrls, ...suggestedPages])];
  return pages.flatMap(page =>
    urls
      .filter(url => {
        if (url === page.url) return true;
        if (url.startsWith('/skill-reviews?type=certifications'))
          return (
            url.includes('&certification=') && page.url === '/skill-reviews?type=certifications'
          );
        if (url.startsWith('/skill-reviews?claim='))
          return page.url === '/skill-reviews' && page.canOpenSkillClaim === true;
        return url.split('?')[0] === page.url && !pages.some(item => item.url === url);
      })
      .map(url => ({ ...page, url })),
  );
}
