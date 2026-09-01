'use client';

/* Lightweight SVG charts for the admin reports — no chart library, just crisp
   inline SVG that inherits the admin's CSS variables. */

import { useId, useState } from 'react';

export interface TrendPoint {
  date: string;
  cents: number;
}

/** Area + line trend chart with a built-in hover tooltip (date + value).
    Optional onPick fires with the date of the nearest point when a column is
    clicked (used to open that day's records). */
export function TrendChart({
  data,
  height = 150,
  format,
  onPick,
  labelFor,
}: {
  data: TrendPoint[];
  height?: number;
  format: (cents: number) => string;
  onPick?: (date: string) => void;
  /** how to label a point's date in the tooltip (default: MM-DD) */
  labelFor?: (date: string) => string;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const padY = 12;
  const n = data.length;
  if (n === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.cents));
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (c: number) => H - padY - (c / max) * (H - padY * 2);

  const linePts = data.map((d, i) => `${x(i)},${y(d.cents)}`).join(' ');
  const areaPts = `0,${H} ${linePts} ${W},${H}`;
  // index of the peak day, to label it
  const peak = data.reduce((m, d, i) => (d.cents > data[m].cents ? i : m), 0);
  const active = hover !== null ? data[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      {active && (
        <div className="adm-tooltip">
          <strong>{labelFor ? labelFor(active.date) : active.date.slice(5)}</strong> · {format(active.cents)}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            {/* --a-chart-line lets a theme split the line color from the accent
                (Helvetia: ink line + signal-red markers) */}
            <stop offset="0%" stopColor="var(--a-chart-line, var(--a-primary))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--a-chart-line, var(--a-primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* baseline */}
        <line x1="0" y1={H - padY} x2={W} y2={H - padY} stroke="var(--a-border)" strokeWidth="1" />
        <polygon points={areaPts} fill={`url(#fill-${gid})`} />
        <polyline
          points={linePts}
          fill="none"
          stroke="var(--a-chart-line, var(--a-primary))"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* peak marker when idle, hovered-day marker while exploring */}
        {hover === null && data[peak].cents > 0 && (
          <circle cx={x(peak)} cy={y(data[peak].cents)} r="3.5" fill="var(--a-primary)" stroke="var(--a-surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        )}
        {active && (
          <circle cx={x(hover!)} cy={y(active.cents)} r="4" fill="var(--a-primary)" stroke="var(--a-surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
        {/* invisible hit columns: hover = tooltip, click = that day's records */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - W / n / 2}
            y="0"
            width={W / n}
            height={H}
            fill="transparent"
            style={{ cursor: onPick ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(i)}
            onClick={onPick ? () => onPick(d.date) : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

export interface DonutSeg {
  label: string;
  value: number;
  color: string;
}

/** Donut chart with a centered total and a legend below. */
export function Donut({
  segments,
  format,
  centerLabel,
  size = 132,
}: {
  segments: DonutSeg[];
  format?: (v: number) => string;
  centerLabel?: string;
  size?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = 60;
  const cy = 60;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg viewBox="0 0 120 120" width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--a-border)" strokeWidth="14" />
        {total > 0 &&
          segments.map((s) => {
            const frac = s.value / total;
            const dash = frac * c;
            const el = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--a-text)">
          {centerLabel ?? String(total)}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9" fill="var(--a-faint)" letterSpacing="0.08em">
          TOTAL
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <strong>{format ? format(s.value) : s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
