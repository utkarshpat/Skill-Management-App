import { Search, X } from 'lucide-react';
import { useRef } from 'react';

export function PortfolioSearch({
  label,
  query,
  onChange,
}: {
  label: string;
  query: string;
  onChange: (query: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="skills-query">
      <Search size={17} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={`${label}…`}
        maxLength={100}
        value={query}
        onChange={event => onChange(event.target.value)}
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search query"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
