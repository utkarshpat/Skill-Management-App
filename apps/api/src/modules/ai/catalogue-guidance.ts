import { AccessError } from '../../shared/errors.js';

type Entry = { name: string; provider?: string };
type Read = (search: string) => Promise<{ skills?: Entry[]; credentials?: Entry[] }>;

export function catalogueGuidanceRequest(message: string) {
  const match =
    /^Check the published (skill|certificate) catalogue for this name and guide me if it is missing:\s*([^\r\n]{1,100})$/i.exec(
      message.trim(),
    );
  if (!match?.[2].trim()) return;
  return { kind: match[1].toLowerCase() as 'skill' | 'certificate', search: match[2].trim() };
}

function normalized(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

function plainMarkdown(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .slice(0, 200)
    .replace(/[\\`*_\[\]<>#|]/g, '\\$&');
}

export async function catalogueGuidance(
  request: NonNullable<ReturnType<typeof catalogueGuidanceRequest>>,
  read: Read | undefined,
  capabilities: { canDraftAmendment: boolean; pages: { url: string; label: string }[] },
) {
  const { kind, search } = request;
  const query = normalized(search);
  const words = [
    ...new Set(
      query
        .split(' ')
        .filter(
          word => word.length >= 2 && !['of', 'the', 'and', 'for', 'in', 'to', 'on'].includes(word),
        ),
    ),
  ].sort((a, b) => b.length - a.length);
  const terms = [...new Set([search, ...words.slice(0, 2)])];
  const candidates = new Map<string, { text: string; score: number; exact: boolean }>();
  let incomplete = false;
  let checked = false;
  for (const term of terms) {
    if (!read) break;
    try {
      const page = await read(term);
      const entries = kind === 'skill' ? page.skills : page.credentials;
      if (!Array.isArray(entries)) {
        incomplete = true;
        continue;
      }
      checked = true;
      for (const { name, provider } of entries) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const title = normalized(name);
        const combined = normalized(`${provider ?? ''} ${name}`);
        const exact = Boolean(query && (title === query || combined === query));
        const available = new Set(combined.split(' '));
        const overlap = words.filter(word => available.has(word)).length;
        const sameSpelling =
          query &&
          (title.replaceAll(' ', '') === query.replaceAll(' ', '') ||
            combined.replaceAll(' ', '') === query.replaceAll(' ', ''));
        const score =
          (exact ? 100 : 0) +
          (sameSpelling ? 20 : 0) +
          (query && combined.includes(query) ? 10 : 0) +
          overlap;
        if (score)
          candidates.set(`${title}:${normalized(provider ?? '')}`, {
            text: plainMarkdown(name) + (provider ? ` · ${plainMarkdown(provider)}` : ''),
            score,
            exact,
          });
      }
      if ([...candidates.values()].some(item => item.exact)) break;
    } catch (error) {
      if (error instanceof AccessError && [401, 403].includes(error.status)) throw error;
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
        throw error;
      incomplete = true;
    }
  }
  const matches = [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, 5);
  const exact = matches.some(match => match.exact);
  const amendment = capabilities.pages.find(page => page.url === '/skills?tab=amendments');
  const catalogue =
    capabilities.pages.find(page => page.url === '/skills') ??
    capabilities.pages.find(
      page => page.url === (kind === 'skill' ? '/my-skills' : '/certifications'),
    );
  const canPropose = capabilities.canDraftAmendment && Boolean(amendment);
  const sources = (exact ? [catalogue] : [catalogue, canPropose ? amendment : undefined])
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
    .map(({ label, url }) => ({ label, url }));
  const status = exact
    ? 'I found an exact name match in the published catalogue.'
    : !checked
      ? 'I could not check the published catalogue from this chat.'
      : incomplete
        ? 'Part of the catalogue lookup was unavailable. I could not confirm an exact match.'
        : 'I did not find an exact name match in the published results I checked.';
  const next = exact
    ? 'Use the existing entry after checking the name and issuer where applicable.'
    : canPropose
      ? `If the ${kind} is still missing after checking the catalogue, open Catalogue amendments and propose a new ${kind} definition for review.`
      : `If the ${kind} is still missing after checking the catalogue, ask your N+1 to request a catalogue amendment. Share the official name${kind === 'certificate' ? ', issuer' : ''} and why it is needed.`;
  return {
    reply: [
      status,
      matches.length
        ? `**Published matches**\n\n${matches.map(item => `- ${item.text}${item.exact ? ' (exact name)' : ''}`).join('\n')}`
        : '',
      `**Next step**\n\n${next}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    sources,
    mode: 'read-only' as const,
    artifact: undefined,
  };
}
