import type { ReactNode } from 'react';

/* Shared modern UI primitives: progress, charts, loading and toggle controls.
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

export interface DonutSlice {
  value: number;
  label: string;
  color: string;
  href?: string;
}
export function DonutChart({
  slices,
  size = 120,
  stroke = 20,
  centerLabel,
  caption,
}: {
  slices: DonutSlice[];
  size?: number;
  stroke?: number;
  centerLabel?: ReactNode;
  caption: string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - stroke) / 2,
    circumference = 2 * Math.PI * radius;
  let offset = 0;
  const visible = slices.filter(slice => slice.value > 0);
  return (
    <figure className="ui-donut" aria-label={caption}>
      <div className="ui-donut-figure" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={'0 0 ' + size + ' ' + size}
          role="img"
          aria-hidden="true"
        >
          <circle
            className="ui-donut-track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
          />
          {visible.map(slice => {
            const fraction = total ? slice.value / total : 0,
              length = fraction * circumference;
            const dash = Math.max(0, length - 2); // small gap between segments
            const circle = (
              <circle
                key={slice.label}
                className="ui-donut-slice"
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={stroke}
                stroke={slice.color}
                strokeDasharray={dash + ' ' + (circumference - dash)}
                strokeDashoffset={-offset}
                transform={'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'}
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        <span className="ui-donut-center">{centerLabel ?? <strong>{total}</strong>}</span>
      </div>
      <figcaption>
        <span className="sr-only">{caption}</span>
        <ul>
          {visible.map(slice => (
            <li key={slice.label}>
              <i style={{ background: slice.color }} />
              <span>{slice.label}</span>
              <strong>{slice.value}</strong>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export function Sparkline({
  points,
  label,
  width = 120,
  height = 34,
  tone = 'accent',
}: {
  points: number[];
  label: string;
  width?: number;
  height?: number;
  tone?: 'accent' | 'success' | 'ai';
}) {
  const values = points.filter(point => Number.isFinite(point));
  if (values.length < 2) return null;
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const stepX = width / (values.length - 1),
    pad = 3;
  const coords = values.map(
    (value, index) =>
      [index * stepX, pad + (1 - (value - min) / range) * (height - pad * 2)] as const,
  );
  const path = coords
    .map(([x, y], index) => (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1))
    .join(' ');
  const area = path + ' L ' + width + ' ' + height + ' L 0 ' + height + ' Z';
  return (
    <svg
      className={'ui-sparkline ui-sparkline-' + tone}
      width={width}
      height={height}
      viewBox={'0 0 ' + width + ' ' + height}
      role="img"
      aria-label={label}
    >
      <path className="ui-sparkline-area" d={area} />
      <path className="ui-sparkline-line" d={path} />
      <circle
        className="ui-sparkline-dot"
        cx={coords[coords.length - 1][0]}
        cy={coords[coords.length - 1][1]}
        r={2.6}
      />
    </svg>
  );
}

export function MiniBars({
  values,
  label,
  tone = 'accent',
  height = 44,
}: {
  values: number[];
  label: string;
  tone?: 'accent' | 'success' | 'ai';
  height?: number;
}) {
  const clean = values.filter(value => Number.isFinite(value));
  if (!clean.length) return null;
  const max = Math.max(...clean, 1);
  return (
    <div className={'ui-bars ui-bars-' + tone} role="img" aria-label={label} style={{ height }}>
      {clean.map((value, index) => (
        <i key={index} style={{ height: Math.max(6, Math.round((value / max) * 100)) + '%' }} />
      ))}
    </div>
  );
}

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading', size = 22 }: { label?: string; size?: number }) {
  return (
    <span
      className="ui-spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">{icon}</span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={'ui-toggle' + (checked ? ' is-on' : '')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'critical' | 'ai';
}) {
  return <span className={'ui-badge ui-badge-' + tone}>{children}</span>;
}
