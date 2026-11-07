import { h, svg, fmtNum } from './lib.js';

/** Stacked bars: cached requests (teal) under uncached (blue). */
export function barChart(series, { height = 220 } = {}) {
  const W = 760;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const inner = height - pad.t - pad.b;
  const max = Math.max(1, ...series.map((s) => s.requests));
  const bw = (W - pad.l - pad.r) / Math.max(1, series.length);
  const base = height - pad.b;
  const bars = series.map((s, i) => {
    const x = pad.l + i * bw + bw * 0.15;
    const w = Math.max(1, bw * 0.7);
    const total = (s.requests / max) * inner;
    const cached = (Math.min(s.cached, s.requests) / max) * inner;
    return svg('g', null,
      svg('title', null, `${label(s.t)}: ${fmtNum(s.requests)} requests, ${fmtNum(s.cached)} cached`),
      svg('rect', { x, y: base - total, width: w, height: Math.max(0, total - cached), fill: '#7FB4FF', rx: 2 }),
      svg('rect', { x, y: base - cached, width: w, height: cached, fill: '#5CE0C6', rx: 2 }));
  });
  const first = series[0];
  const last = series[series.length - 1];
  return svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img', 'aria-label': `Requests over time: ${series.length} data points, peak ${fmtNum(max)}` },
    svg('line', { x1: pad.l, x2: W - pad.r, y1: base, y2: base, stroke: '#2A3842' }),
    bars,
    first && svg('text', { x: pad.l, y: height - 6, fill: '#8FA1AB', 'font-size': 12, 'font-family': 'IBM Plex Mono, monospace' }, label(first.t)),
    last && series.length > 1 && svg('text', { x: W - pad.r, y: height - 6, fill: '#8FA1AB', 'font-size': 12, 'text-anchor': 'end', 'font-family': 'IBM Plex Mono, monospace' }, label(last.t)));
}

function label(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {return String(t);}
  return String(t).length > 10 ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const legend = () => h('div', { class: 'row small soft' },
  h('span', { class: 'row', style: undefined }, h('i', { class: 'swatch s-cached' }), 'Cached'),
  h('span', { class: 'row' }, h('i', { class: 'swatch s-uncached' }), 'Uncached'));
