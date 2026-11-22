import type { ReactNode } from 'react';

/* Shared modern UI primitives: progress and status controls.
   Pure SVG + CSS, theme aware through existing CSS variables, motion-safe. */

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function ProgressBar({
  value,
  label,
  tone = 'accent',
  size = 'md',
}: {
  value: number;
  label: string;
  tone?: 'accent' | 'success' | 'warning' | 'critical';
  size?: 'sm' | 'md';
}) {
  const percent = clamp(value);
  return (
    <div
      className={'ui-progress ui-progress-' + tone + ' ui-progress-' + size}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i style={{ width: percent + '%' }} />
    </div>
  );
}

export function ProgressRing({
  value,
  label,
  size = 72,
  stroke = 8,
  tone = 'accent',
  children,
}: {
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  tone?: 'accent' | 'success' | 'warning' | 'critical' | 'ai';
  children?: ReactNode;
}) {
  const percent = clamp(value),
    radius = (size - stroke) / 2,
    circumference = 2 * Math.PI * radius;
  return (
    <div
      className={'ui-ring ui-ring-' + tone}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} aria-hidden="true">
        <circle
          className="ui-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="ui-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
        />
      </svg>
      <span className="ui-ring-label">{children ?? <strong>{Math.round(percent)}%</strong>}</span>
    </div>
  );
}
