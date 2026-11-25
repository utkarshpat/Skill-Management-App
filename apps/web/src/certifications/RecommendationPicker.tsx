import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

type Option = { id: string; name: string };

export function RecommendationPicker<T extends Option>({
  label,
  placeholder,
  query,
  selected,
  options,
  onQueryChange,
  onSelect,
  describe,
  status,
  actions,
  maxLength,
  required,
}: {
  label: string;
  placeholder: string;
  query: string;
  selected?: T;
  options: T[];
  onQueryChange: (value: string) => void;
  onSelect: (option: T) => void;
  describe: (option: T) => string;
  status?: ReactNode;
  actions?: ReactNode;
  maxLength?: number;
  required?: boolean;
}) {
  const id = useId();
  const listId = `${id}-results`;
  const input = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const activeIndex = open ? options.findIndex(option => option.id === activeId) : -1;

  useEffect(() => {
    if (activeIndex >= 0) activeOption.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, activeId]);

  function close() {
    setOpen(false);
    setActiveId(undefined);
  }

  function select(option: T) {
    onSelect(option);
    input.current?.focus();
    close();
  }

  return (
    <div
      className="cert-recommend-picker"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          input.current?.focus();
          close();
        }
      }}
    >
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className="cert-recommend-picker-field">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-required={required}
          autoComplete="off"
          maxLength={maxLength}
          placeholder={placeholder}
          value={selected?.name ?? query}
          onClick={event => {
            if (selected && !open) event.currentTarget.select();
            setOpen(true);
          }}
          onChange={event => {
            onQueryChange(event.target.value);
            setActiveId(undefined);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const down = event.key === 'ArrowDown';
              const next =
                activeIndex < 0
                  ? down
                    ? 0
                    : options.length - 1
                  : Math.max(0, Math.min(options.length - 1, activeIndex + (down ? 1 : -1)));
              setActiveId(options[next]?.id);
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              select(options[activeIndex]);
            }
          }}
        />
        {selected ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </div>
      {open && (
        <div className="cert-recommend-picker-results">
          <ul id={listId} role="listbox" aria-labelledby={`${id}-label`}>
            {options.map((option, index) => {
              const description = describe(option);
              return (
                <li
                  key={option.id}
                  id={`${listId}-${index}`}
                  ref={index === activeIndex ? activeOption : undefined}
                  role="option"
                  aria-selected={option.id === selected?.id}
                  data-active={index === activeIndex || undefined}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => select(option)}
                >
                  <span>
                    <strong>{option.name}</strong>
                    {description && <small>{description}</small>}
                  </span>
                  {option.id === selected?.id && <Check size={16} aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
          {status && <div className="cert-recommend-picker-status">{status}</div>}
          {actions && (
            <div
              className="cert-recommend-picker-actions"
              onClick={() => {
                input.current?.focus();
                setActiveId(undefined);
              }}
            >
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
