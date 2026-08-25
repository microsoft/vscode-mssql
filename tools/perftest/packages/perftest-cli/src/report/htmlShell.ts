/**
 * Shared HTML shell + components for all perftest reports (Phase-3 M14,
 * design language per the owner's benchmark.html): CSS-variable design
 * system, panel cards, KPI tiles, status pills, collapsible sections, chart
 * cards. Self-contained — no external assets, opens as file://.
 * Factored for Phase-4 in-product reuse.
 */

export function esc(text: string): string {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export type PillKind = "ok" | "warn" | "fail" | "info";

const SHELL_CSS = `
:root {
  color-scheme: light;
  --bg: #f6f8fb; --panel: #ffffff; --panel-alt: #f2f5f9;
  --line: #d9e0ea; --grid: #e2e8f0; --text: #172033; --muted: #64748b;
  --ok: #087f5b; --warn: #b45309; --fail: #b42318; --info: #2563eb;
  --shadow: 0 4px 14px rgba(15, 23, 42, .05);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header.top-bar { padding: 14px 22px 12px; background: linear-gradient(180deg,#fff 0%,#f8fafc 100%);
  border-bottom: 1px solid var(--line); display: flex; justify-content: space-between;
  align-items: baseline; gap: 12px; flex-wrap: wrap; }
header.top-bar h1 { margin: 0; font-size: 22px; }
header.top-bar .sub { margin-top: 4px; color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
main { padding: 14px 22px 40px; max-width: 1400px; margin: 0 auto; }
h2 { margin: 0; font-size: 15px; }
h3 { margin: 0 0 6px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
a { color: var(--info); text-decoration: none; }
a:hover { text-decoration: underline; }
.spacer { height: 10px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 11px; box-shadow: var(--shadow); min-width: 0; }
details.panel.section { padding: 0; overflow: hidden; margin-bottom: 10px; }
details.panel.section > summary { padding: 11px 13px; cursor: pointer; list-style: none;
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-weight: 600; }
details.panel.section > summary::-webkit-details-marker { display: none; }
details.panel.section > summary::before { content: "\\25B8"; font-size: 11px; color: var(--muted);
  transition: transform .12s; }
details.panel.section[open] > summary::before { transform: rotate(90deg); }
details.panel.section > summary .section-title { font-size: 15px; }
details.panel.section > summary .section-subtitle { color: var(--muted); font-weight: 400; font-size: 12px; }
.section-body { padding: 0 13px 13px; }
.pill { display: inline-flex; min-height: 18px; padding: 2px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap; align-items: center; border: 1px solid; }
.pill.ok { background: #ecfdf5; color: var(--ok); border-color: rgba(8,127,91,.25); }
.pill.warn { background: #fffbeb; color: var(--warn); border-color: rgba(180,83,9,.25); }
.pill.fail { background: #fff1f2; color: var(--fail); border-color: rgba(180,35,24,.25); }
.pill.info { background: #eff6ff; color: var(--info); border-color: rgba(37,99,235,.25); }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 10px; }
.kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 10px 12px; box-shadow: var(--shadow); }
.kpi .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.kpi .value { font-size: 20px; font-weight: 650; margin-top: 3px; font-variant-numeric: tabular-nums; }
.kpi .value .unit { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 3px; }
.kpi.ok .value { color: var(--ok); } .kpi.warn .value { color: var(--warn); }
.kpi.fail .value { color: var(--fail); }
.chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 10px; }
.chart { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
.chart-title { font-weight: 600; font-size: 12px; margin-bottom: 6px; }
.chart-caption { color: var(--muted); font-size: 11px; margin-top: 6px; }
table.data { border-collapse: collapse; width: 100%; font-size: 12px; }
table.data th { text-align: left; color: var(--muted); font-size: 11px; text-transform: uppercase;
  letter-spacing: .03em; padding: 6px 8px; border-bottom: 1px solid var(--line); }
table.data td { padding: 5px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
table.data tr:hover td { background: var(--panel-alt); }
.scroll-x { overflow-x: auto; }
`;

export function pill(label: string, kind: PillKind): string {
    return `<span class="pill ${kind}">${esc(label)}</span>`;
}

export interface Kpi {
    label: string;
    value: string;
    unit?: string;
    kind?: PillKind | "plain";
}

export function kpiRow(kpis: Kpi[]): string {
    return (
        `<div class="kpis">` +
        kpis
            .map(
                (kpi) =>
                    `<div class="kpi ${kpi.kind && kpi.kind !== "plain" && kpi.kind !== "info" ? kpi.kind : ""}">` +
                    `<div class="label">${esc(kpi.label)}</div>` +
                    `<div class="value">${esc(kpi.value)}${kpi.unit ? `<span class="unit">${esc(kpi.unit)}</span>` : ""}</div></div>`,
            )
            .join("") +
        `</div>`
    );
}

export function section(
    title: string,
    subtitle: string,
    bodyHtml: string,
    options: { open?: boolean; pills?: string[] } = {},
): string {
    return (
        `<details class="panel section"${options.open === false ? "" : " open"}>` +
        `<summary><span class="section-title">${esc(title)}</span>` +
        (options.pills ?? []).join(" ") +
        `<span class="section-subtitle">${esc(subtitle)}</span></summary>` +
        `<div class="section-body">${bodyHtml}</div></details>`
    );
}

export function chartCard(title: string, svg: string, caption?: string): string {
    return (
        `<div class="chart"><div class="chart-title">${esc(title)}</div>${svg}` +
        (caption ? `<div class="chart-caption">${esc(caption)}</div>` : "") +
        `</div>`
    );
}

export function dataTable(
    headers: Array<{ label: string; numeric?: boolean }>,
    rows: string[][],
): string {
    const head = headers.map((h) => `<th>${esc(h.label)}</th>`).join("");
    const body = rows
        .map(
            (row) =>
                `<tr>${row.map((cell, i) => `<td${headers[i]?.numeric ? ' class="num"' : ""}>${cell}</td>`).join("")}</tr>`,
        )
        .join("");
    return `<div class="scroll-x"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function pageShell(options: {
    title: string;
    subtitle: string;
    statusPill?: { label: string; kind: PillKind };
    body: string;
}): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="top-bar">
  <div>
    <h1>${esc(options.title)}</h1>
    <div class="sub">${esc(options.subtitle)}</div>
  </div>
  ${options.statusPill ? `<span class="pill ${options.statusPill.kind}" style="font-size:13px;padding:5px 12px;">${esc(options.statusPill.label)}</span>` : ""}
</header>
<main>
${options.body}
</main>
</body>
</html>`;
}
