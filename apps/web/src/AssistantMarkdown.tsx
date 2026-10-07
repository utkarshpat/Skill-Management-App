import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Model-authored links render as text. Navigation is a separate explicit action
// using server-provided destinations and a fresh permission check.
export function assistantUrl(url: string): string {
  if (!/^\/(?!\/)/.test(url) || url.includes('\\')) return '';
  try {
    const parsed = new URL(url, 'https://workspace.invalid');
    return [
      '/workspace',
      '/profile',
      '/my-skills',
      '/skills',
      '/skill-reviews',
      '/learning',
      '/access',
    ].includes(parsed.pathname) && parsed.origin === 'https://workspace.invalid'
      ? parsed.pathname + parsed.search + parsed.hash
      : '';
  } catch {
    return '';
  }
}
export default function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="assistant-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        urlTransform={assistantUrl}
        components={{
          a: ({ children }) => <span>{children}</span>,
          h1: ({ children }) => <h2>{children}</h2>,
          table: ({ children }) => (
            <div
              className="assistant-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Response table"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
