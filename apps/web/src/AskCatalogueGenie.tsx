import { Sparkles } from 'lucide-react';
import { useState } from 'react';

export function AskCatalogueGenie({
  kind,
  search,
}: {
  kind: 'skill' | 'certificate';
  search: string;
}) {
  const [error, setError] = useState('');
  if (!search.trim()) return null;
  return (
    <>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const name = search.trim().replace(/\s+/g, ' ').slice(0, 100);
          const prompt = `Check the published ${kind} catalogue for this name and guide me if it is missing: ${name}`;
          const accepted = !window.dispatchEvent(
            new CustomEvent('assistant-context-request', { cancelable: true, detail: { prompt } }),
          );
          setError(accepted ? '' : 'Skill Genie is unavailable or busy. Try again in a moment.');
        }}
      >
        <Sparkles size={16} aria-hidden="true" /> Find matches with Skill Genie
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
