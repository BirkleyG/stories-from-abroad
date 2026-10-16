import { useMemo, useState } from "react";
import { formatNumber } from "./ui";

function shortDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function niceMax(value) {
  if (value <= 5) return 5;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

// Bars for the primary series, optional line for a second series. Pure SVG, no dependencies.
export function TrendChart({ labels, bars, line, barLabel, lineLabel, area = false, height = 220 }) {
  const [hover, setHover] = useState(-1);
  const width = 720;
  const pad = { top: 14, right: 12, bottom: 26, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...(bars || []), ...(line || [])));
  const count = labels.length;
  const step = innerW / Math.max(1, count);
  const x = (index) => pad.left + step * index + step / 2;
  const y = (value) => pad.top + innerH - (value / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  const labelEvery = Math.ceil(count / 8);
  const linePoints = line ? line.map((value, index) => `${x(index)},${y(value)}`).join(" ") : "";
  const areaPath = area && line && line.length
    ? `M ${x(0)},${pad.top + innerH} L ${line.map((value, index) => `${x(index)},${y(value)}`).join(" L ")} L ${x(count - 1)},${pad.top + innerH} Z`
    : "";

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${barLabel || lineLabel} over time`} onMouseLeave={() => setHover(-1)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="admin-chart-grid" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="admin-chart-axis">{formatNumber(tick)}</text>
          </g>
        ))}
        {bars ? bars.map((value, index) => (
          <rect
            key={labels[index]}
            x={x(index) - Math.max(1.5, step * 0.34)}
            width={Math.max(3, step * 0.68)}
            y={y(value)}
            height={Math.max(value ? 1.5 : 0, pad.top + innerH - y(value))}
            rx="1.5"
            className={`admin-chart-bar${hover === index ? " is-hover" : ""}`}
          />
        )) : null}
        {areaPath ? <path d={areaPath} className="admin-chart-area" /> : null}
        {line ? <polyline points={linePoints} className="admin-chart-line" fill="none" /> : null}
        {line && count <= 40 ? line.map((value, index) => <circle key={labels[index]} cx={x(index)} cy={y(value)} r="2.6" className="admin-chart-dot" />) : null}
        {labels.map((label, index) => (
          index % labelEvery === 0 || index === count - 1 ? (
            <text key={label} x={x(index)} y={height - 8} textAnchor="middle" className="admin-chart-axis">{shortDate(label)}</text>
          ) : null
        ))}
        {labels.map((label, index) => (
          <rect key={`hit-${label}`} x={pad.left + step * index} y={pad.top} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(index)} />
        ))}
        {hover >= 0 ? <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} className="admin-chart-cursor" /> : null}
      </svg>
      {hover >= 0 ? (
        <div className="admin-chart-tip" style={{ left: `${Math.min(88, Math.max(12, (x(hover) / width) * 100))}%` }}>
          <strong>{shortDate(labels[hover])}</strong>
          {bars ? <span><i className="swatch bar" /> {barLabel}: {formatNumber(bars[hover])}</span> : null}
          {line ? <span><i className="swatch line" /> {lineLabel}: {formatNumber(line[hover])}</span> : null}
        </div>
      ) : null}
      <div className="admin-chart-legend">
        {bars ? <span><i className="swatch bar" /> {barLabel}</span> : null}
        {line ? <span><i className="swatch line" /> {lineLabel}</span> : null}
      </div>
    </div>
  );
}

// Compact trend line for an item's own panel.
export function Sparkline({ values, labels, label }) {
  const max = Math.max(1, ...values);
  const width = 240;
  const height = 48;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${index * step},${height - 4 - (value / max) * (height - 10)}`).join(" ");
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <div className="admin-sparkline" title={labels ? `${label}: ${formatNumber(total)} (${labels[0]} to ${labels[labels.length - 1]})` : label}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <polyline points={points} fill="none" className="admin-chart-line" />
      </svg>
    </div>
  );
}

export function RankList({ rows, empty, format = formatNumber }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="admin-empty-inline">{empty}</p>;
  return (
    <ol className="admin-rank-list">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="admin-rank-row">
            <span className="admin-rank-label">{row.label}{row.sub ? <small>{row.sub}</small> : null}</span>
            <strong>{format(row.value)}</strong>
          </div>
          <div className="admin-rank-bar"><span style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

// Column chart for small fixed series, like hours of the day or days of the week.
export function BarStrip({ items, format = formatNumber }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="admin-barstrip" role="list">
      {items.map((item) => (
        <div key={item.key} className="admin-barstrip-col" role="listitem" title={`${item.title || item.label}: ${format(item.value)}`}>
          <span className="admin-barstrip-fill" style={{ height: `${Math.max(item.value ? 4 : 0, (item.value / max) * 100)}%` }} />
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

// Sortable table. Columns: { id, label, hint, align, render(row), sort(row) }.
export function DataTable({ columns, rows, rowKey, defaultSort, empty, onRowClick, selectedKey, pageSize = 0 }) {
  const [sort, setSort] = useState(defaultSort ? { id: defaultSort, dir: -1 } : null);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.id === sort.id);
    if (!column) return rows;
    const get = column.sort || (() => 0);
    return [...rows].sort((left, right) => {
      const a = get(left);
      const b = get(right);
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return a > b ? sort.dir : -sort.dir;
    });
  }, [rows, columns, sort]);

  if (!rows.length) return <p className="admin-empty-inline">{empty}</p>;
  const visible = pageSize && !showAll ? sorted.slice(0, pageSize) : sorted;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table is-data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} className={column.align === "right" ? "is-right" : ""} title={column.hint || ""}>
                {column.sort ? (
                  <button type="button" className={`admin-th-sort${sort?.id === column.id ? " is-active" : ""}`} onClick={() => setSort((current) => (current?.id === column.id ? { id: column.id, dir: -current.dir } : { id: column.id, dir: -1 }))}>
                    {column.label}{sort?.id === column.id ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={rowKey(row)} className={`${onRowClick ? "is-clickable" : ""}${selectedKey && selectedKey === rowKey(row) ? " is-selected" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((column) => (
                <td key={column.id} className={column.align === "right" ? "is-right" : ""}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageSize && sorted.length > pageSize ? (
        <button type="button" className="admin-mini-button admin-table-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      ) : null}
    </div>
  );
}

// A grid of small labelled numbers: [{ label, value, hint }].
export function MetricGrid({ metrics, columns = 4 }) {
  return (
    <dl className="admin-metric-grid" style={{ "--cols": columns }}>
      {metrics.map((metric) => (
        <div key={metric.label} className="admin-metric" title={metric.hint || ""}>
          <dd>{metric.value}</dd>
          <dt>{metric.label}</dt>
        </div>
      ))}
    </dl>
  );
}
