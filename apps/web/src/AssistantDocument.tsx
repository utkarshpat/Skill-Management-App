import { useState } from 'react';
import { Link } from 'react-router';
import { FormDialog } from './FormDialog';
import { AssistantRichText } from './AssistantRichText';
export interface AiDocument {
  content: string;
  sources?: { label: string; url: string }[];
}
export function AssistantDocument({
  document,
  onClose,
}: {
  document: AiDocument;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <FormDialog
      title="AI document"
      readOnly
      onClose={onClose}
      footer={
        <>
          <span role="status">{notice}</span>
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(document.content);
                setNotice('Markdown copied.');
              } catch {
                setNotice('Copy unavailable. Select and copy the document text.');
              }
            }}
          >
            Copy Markdown
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([document.content], { type: 'text/markdown;charset=utf-8' }),
              );
              const link = window.document.createElement('a');
              link.href = url;
              link.download = 'ai-document.md';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setNotice('Markdown download started.');
            }}
          >
            Download .md
          </button>
          <button className="admin-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <article className="assistant-document">
        <p className="document-label">AI-generated · Review before using</p>
        <AssistantRichText>{document.content}</AssistantRichText>
        {document.sources?.length && (
          <aside className="assistant-document-sources">
            <h3>Sources</h3>
            {document.sources.map(source => (
              <Link key={source.url} to={source.url} onClick={onClose}>
                {source.label}
              </Link>
            ))}
          </aside>
        )}
      </article>
    </FormDialog>
  );
}
