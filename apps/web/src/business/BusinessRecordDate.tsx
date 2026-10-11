export function BusinessRecordDate({ value, by }: { value: unknown; by?: unknown }) {
  if (typeof value !== 'string' || !value) return <span>—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>—</span>;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const label = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  }).format(date);
  return (
    <span className="bo-record-date">
      <time dateTime={value} title={dateOnly ? label : date.toLocaleString()}>
        {label}
      </time>
      {typeof by === 'string' && by.trim() && <small>by {by}</small>}
    </span>
  );
}
