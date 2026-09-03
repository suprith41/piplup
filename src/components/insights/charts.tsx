"use client";

import { useMemo, useState } from "react";

export type StackKey = { key: string; label: string; color: string };

export type StackRow = {
  label: string;
  values: Record<string, number>;
  overlay?: number;
};

export function StackedBars({
  rows,
  keys,
  height = 220,
  overlayLabel,
}: {
  rows: StackRow[];
  keys: StackKey[];
  height?: number;
  overlayLabel?: string;
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const max = useMemo(() => {
    const peaks = rows.map((row) => keys.reduce((sum, k) => sum + (row.values[k.key] ?? 0), 0));
    return Math.max(1, ...peaks);
  }, [rows, keys]);

  const pad = { t: 12, r: overlayLabel ? 36 : 8, b: 28, l: 8 };
  const w = 640;
  const innerW = w - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const gap = 8;
  const barW = Math.max(10, (innerW - gap * (rows.length - 1)) / rows.length);
  const ticks = [0, 0.5, 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" role="img">
        {ticks.map((t) => {
          const y = pad.t + innerH * (1 - t);
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="currentColor" className="text-ink/10" />
              {overlayLabel ? (
                <text x={w - 4} y={y + 3} textAnchor="end" className="fill-ink/35" fontSize="9">
                  {Math.round(t * 100)}%
                </text>
              ) : null}
            </g>
          );
        })}
        {rows.map((row, i) => {
          const x = pad.l + i * (barW + gap);
          let y = pad.t + innerH;
          return (
            <g key={row.label}>
              {keys.map((k, ki) => {
                const v = row.values[k.key] ?? 0;
                const h = (v / max) * innerH;
                y -= h;
                return (
                  <rect
                    key={k.key}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={k.color}
                    className="origin-bottom"
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "bottom",
                      animation: `bar-rise 0.7s cubic-bezier(0.22,1,0.36,1) ${i * 0.05 + ki * 0.02}s both`,
                    }}
                  />
                );
              })}
              <rect
                x={x}
                y={pad.t}
                width={barW}
                height={innerH}
                fill="transparent"
                onMouseEnter={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({
                    i,
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                  });
                }}
                onMouseLeave={() => setHover(null)}
              />
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                className={`fill-ink/50 ${i === rows.length - 1 ? "font-medium" : ""}`}
                fontSize="9"
              >
                {row.label.replace(" 2026", "").replace(" 2025", "")}
              </text>
            </g>
          );
        })}
        {rows.some((r) => r.overlay !== undefined) ? (
          <polyline
            fill="none"
            stroke="#305eff"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={rows
              .map((row, i) => {
                const x = pad.l + i * (barW + gap) + barW / 2;
                const y = pad.t + innerH * (1 - (row.overlay ?? 0));
                return `${x},${y}`;
              })
              .join(" ")}
            className="pointer-events-none"
            style={{ animation: "line-draw 1s ease both 0.3s" }}
          />
        ) : null}
        {rows.map((row, i) =>
          row.overlay === undefined ? null : (
            <circle
              key={`dot-${row.label}`}
              cx={pad.l + i * (barW + gap) + barW / 2}
              cy={pad.t + innerH * (1 - row.overlay)}
              r="2.6"
              fill="#ffffff"
              stroke="#305eff"
              strokeWidth="1.4"
              className="pointer-events-none"
              style={{ animation: `dot-in 0.35s ease both ${0.45 + i * 0.05}s` }}
            />
          ),
        )}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-md border border-[#e6eaf2] bg-white px-3 py-2 text-[11px] shadow-lift"
          style={{ left: Math.min(hover.x, 420), top: Math.max(8, hover.y - 72) }}
        >
          <p className="font-medium text-ink">{rows[hover.i].label}</p>
          {keys.map((k) => (
            <p key={k.key} className="mt-0.5 flex justify-between gap-4 text-ink/70">
              <span>{k.label}</span>
              <span className="tabular-nums">₹{(rows[hover.i].values[k.key] ?? 0).toLocaleString("en-IN")}</span>
            </p>
          ))}
          {rows[hover.i].overlay !== undefined ? (
            <p className="mt-1 flex justify-between gap-4 text-ink">
              <span>{overlayLabel ?? "Rate"}</span>
              <span className="tabular-nums">{Math.round((rows[hover.i].overlay ?? 0) * 100)}%</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DistBar({
  slices,
}: {
  slices: Array<{ key: string; label: string; value: number; color: string }>;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-sm bg-ink/5">
      {slices.map((s, i) => (
        <span
          key={s.key}
          title={`${s.label} · ${Math.round((s.value / total) * 100)}%`}
          style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color,
            animation: `bar-widen 0.7s cubic-bezier(0.22,1,0.36,1) ${i * 0.06}s both`,
          }}
        />
      ))}
    </div>
  );
}

export function HBar({
  value,
  max,
  color,
  delay = 0,
}: {
  value: number;
  max: number;
  color: string;
  delay?: number;
}) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-sm bg-ink/5">
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          background: color,
          animation: `bar-widen 0.75s cubic-bezier(0.22,1,0.36,1) ${delay}s both`,
        }}
      />
    </div>
  );
}
