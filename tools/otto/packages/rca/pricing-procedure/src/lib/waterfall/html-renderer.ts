import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { makeEnvelope, makeNotice, makeSummary } from '../contracts/envelope';
import { PricingCliError } from '../contracts/errors';
import type { Envelope } from '../contracts/types';
import type { WaterfallBar, WaterfallExample, WaterfallLane } from './schema';

export interface RenderWaterfallHtmlArgs {
  example: string;
  output: string;
  json: boolean;
  failOn: 'none' | 'warn' | 'changed' | 'partial' | 'no_match' | 'unsupported';
}

export interface RenderWaterfallHtmlResult {
  output_file: string;
  bar_count: number;
  overwrite_count: number;
  unresolved_count: number;
  sections: string[];
}

function readJsonFile<T>(path: string): T {
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (payload && typeof payload === 'object' && 'result' in payload) {
      return (payload as { result: T }).result;
    }
    return payload as T;
  } catch (error) {
    throw new PricingCliError(
      'json_parse_error',
      `Could not parse JSON file: ${path}`,
      { path, error: error instanceof Error ? error.message : String(error) },
      'Check that the file contains valid JSON.',
    );
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value: number | null): string {
  if (value === null) {
    return 'unresolved';
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

function barClass(bar: WaterfallBar): string {
  if (bar.operation === 'base' || bar.operation === 'final') {
    return 'bar-base';
  }
  if ((bar.delta ?? 0) < 0) {
    return 'bar-negative';
  }
  if ((bar.delta ?? 0) > 0) {
    return 'bar-positive';
  }
  if (bar.source === 'unresolved') {
    return 'bar-unresolved';
  }
  return 'bar-neutral';
}

interface RenderedWaterfallBar {
  bar: WaterfallBar;
  index: number;
  x: number;
  y: number;
  height: number;
  start: number;
  end: number;
  topValue: number;
  labelText: string;
}

function signedNumber(value: number | null): string {
  if (value === null) {
    return 'unresolved';
  }
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  return formatNumber(value);
}

function renderSvg(bars: readonly WaterfallBar[]): string {
  if (bars.length === 0) {
    return [
      '<svg role="img" aria-label="Pricing waterfall chart with no bars" viewBox="0 0 960 160" width="960" height="160" class="waterfall-chart">',
      '<text class="empty-chart" x="480" y="86" text-anchor="middle">No waterfall bars available.</text>',
      '</svg>',
    ].join('\n');
  }
  const barWidth = 88;
  const gap = 52;
  const leftPad = 76;
  const rightPad = 54;
  const width = Math.max(960, bars.length * (barWidth + gap) + leftPad + rightPad);
  const height = 430;
  const chartTop = 48;
  const chartBottom = 294;
  const labelY = 332;
  const tagY = 352;
  const values = bars.flatMap((bar) => {
    const start = bar.input_value ?? 0;
    const end = bar.output_value ?? (bar.delta !== null ? start + bar.delta : start);
    return [start, end, 0];
  });
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(1, (rawMax - rawMin) * 0.12);
  const minValue = rawMin - padding;
  const maxValue = rawMax + padding;
  const scale = (chartBottom - chartTop) / Math.max(1, maxValue - minValue);
  const yFor = (value: number): number => chartBottom - (value - minValue) * scale;
  const zeroY = yFor(0);

  const renderedBars: RenderedWaterfallBar[] = bars.map((bar, index) => {
    const previousEnd = index > 0 ? bars[index - 1]?.output_value ?? null : null;
    const start = bar.operation === 'base' || bar.operation === 'final'
      ? 0
      : bar.input_value ?? previousEnd ?? 0;
    const end = bar.output_value ?? (bar.delta !== null ? start + bar.delta : start);
    const yStart = yFor(start);
    const yEnd = yFor(end);
    const y = Math.min(yStart, yEnd);
    const heightValue = Math.max(4, Math.abs(yEnd - yStart));
    const x = leftPad + index * (barWidth + gap);
    const topValue = Math.max(start, end);
    const labelText = bar.operation === 'base' || bar.operation === 'final'
      ? formatNumber(end)
      : signedNumber(bar.delta ?? end - start);
    return { bar, index, x, y, height: heightValue, start, end, topValue, labelText };
  });

  const connectors = renderedBars.slice(0, -1).map((bar, index) => {
    const next = renderedBars[index + 1] as RenderedWaterfallBar;
    const y = yFor(bar.end);
    return `<line class="connector" x1="${bar.x + barWidth}" y1="${y}" x2="${next.x}" y2="${y}"></line>`;
  });

  const groups = renderedBars.map((rendered) => {
    const { bar, x, y, height: barHeight, labelText } = rendered;
    const label = escapeHtml(bar.label.length > 24 ? `${bar.label.slice(0, 21)}...` : bar.label);
    return [
      `<g class="bar-group">`,
      `<rect class="${barClass(bar)}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3"></rect>`,
      `<text class="bar-value" x="${x + barWidth / 2}" y="${Math.max(chartTop + 16, y - 9)}" text-anchor="middle">${escapeHtml(labelText)}</text>`,
      `<text class="bar-label" x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle">${label}</text>`,
      `<text class="bar-tag" x="${x + barWidth / 2}" y="${tagY}" text-anchor="middle">${escapeHtml(bar.tag ?? '')}</text>`,
      `<text class="bar-output" x="${x + barWidth / 2}" y="${tagY + 18}" text-anchor="middle">out ${escapeHtml(formatNumber(bar.output_value))}</text>`,
      `</g>`,
    ].join('');
  });

  return [
    `<svg role="img" aria-label="Pricing waterfall chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="waterfall-chart">`,
    `<line class="axis" x1="42" y1="${zeroY}" x2="${width - 36}" y2="${zeroY}"></line>`,
    `<line class="axis-y" x1="42" y1="${chartTop}" x2="42" y2="${chartBottom}"></line>`,
    `<text class="axis-label" x="38" y="${chartTop + 4}" text-anchor="end">${escapeHtml(formatNumber(rawMax))}</text>`,
    `<text class="axis-label" x="38" y="${chartBottom}" text-anchor="end">${escapeHtml(formatNumber(rawMin))}</text>`,
    ...connectors,
    ...groups,
    `</svg>`,
  ].join('\n');
}

function renderRows(example: WaterfallExample): string {
  return renderBarRows(example.bars);
}

function renderBarRows(bars: readonly WaterfallBar[]): string {
  return bars.map((bar) => [
    '<tr>',
    `<td>${escapeHtml(bar.label)}</td>`,
    `<td>${escapeHtml(bar.tag ?? '')}</td>`,
    `<td>${escapeHtml(bar.operation)}</td>`,
    `<td>${escapeHtml(formatNumber(bar.input_value))}</td>`,
    `<td>${escapeHtml(formatNumber(bar.delta))}</td>`,
    `<td>${escapeHtml(formatNumber(bar.output_value))}</td>`,
    `<td>${escapeHtml(bar.source)}</td>`,
    `<td><code>${escapeHtml(bar.formula ?? '')}</code></td>`,
    '</tr>',
  ].join('')).join('\n');
}

function renderMappings(example: WaterfallExample): string {
  if (example.context_mappings.length === 0) {
    return '<p class="empty">No context mappings were provided.</p>';
  }
  return [
    '<table><thead><tr><th>Context Tag</th><th>Context Node</th><th>Object</th><th>Field</th></tr></thead><tbody>',
    ...example.context_mappings.map((mapping) => [
      '<tr>',
      `<td>${escapeHtml(mapping.context_tag)}</td>`,
      `<td>${escapeHtml(mapping.context_node)}</td>`,
      `<td>${escapeHtml(mapping.object_name)}</td>`,
      `<td>${escapeHtml(mapping.object_field)}</td>`,
      '</tr>',
    ].join('')),
    '</tbody></table>',
  ].join('\n');
}

function laneWarnings(lane: WaterfallLane): string[] {
  const warnings = [...lane.warnings];
  if (lane.excluded_raw_step_count > 0) {
    warnings.push(`${lane.excluded_raw_step_count} raw runtime step(s) are outside this tracked-value lane.`);
  }
  return warnings;
}

function renderLanePanel(lane: WaterfallLane, index: number): string {
  const active = index === 0;
  const warnings = laneWarnings(lane);
  return [
    `<section class="tab-panel${active ? ' active' : ''}" id="panel-${escapeHtml(lane.id)}" data-testid="lane-panel-${escapeHtml(lane.id)}" role="tabpanel" aria-labelledby="tab-${escapeHtml(lane.id)}">`,
    `<div class="lane-heading">`,
    `<h2>${escapeHtml(lane.label)}</h2>`,
    `<div class="lane-meta"><span>Tracked: ${escapeHtml(lane.tracked_tag)}</span><span>Source tags: ${escapeHtml(lane.source_tags.join(', ') || 'none')}</span></div>`,
    `</div>`,
    `<div class="scroll-panel chart-wrap">${renderSvg(lane.bars)}</div>`,
    warnings.length === 0 ? '' : `<div class="lane-warnings">${warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join('\n')}</div>`,
    `<h3>Lane Evidence</h3>`,
    `<div class="table-scroll"><table><thead><tr><th>Step</th><th>Tag</th><th>Operation</th><th>Input</th><th>Delta</th><th>Output</th><th>Source</th><th>Formula</th></tr></thead><tbody>`,
    renderBarRows(lane.bars),
    `</tbody></table></div>`,
    `</section>`,
  ].join('\n');
}

function fallbackLane(example: WaterfallExample): WaterfallLane {
  return {
    id: 'waterfall',
    label: `${example.procedure.focus_tag ?? 'Pricing'} Waterfall`,
    tracked_tag: example.procedure.focus_tag ?? 'Pricing',
    bars: example.bars,
    source_tags: Array.from(new Set(example.bars.map((bar) => bar.tag).filter((tag): tag is string => Boolean(tag)))),
    excluded_raw_step_count: 0,
    warnings: [],
  };
}

export function renderWaterfallHtml(example: WaterfallExample): string {
  const title = `${example.procedure.focus_tag ?? 'Pricing'} Waterfall`;
  const lanes = example.lanes && example.lanes.length > 0 ? example.lanes : [fallbackLane(example)];
  const rawTraceLabel = example.scenario.source === 'runtime_waterfall' ? 'Raw Runtime Trace' : 'Calculation Trace';
  const warnings = [
    ...example.unresolved,
    ...example.overwrites.map((overwrite) => `${overwrite.tag}: ${overwrite.note}`),
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1d2433;
      --muted: #5d6a7c;
      --line: #cfd7e3;
      --panel: #f6f8fb;
      --blue: #1662f4;
      --positive: #00a876;
      --negative: #ff4b5f;
      --neutral: #8b7b45;
      --unresolved: #8a8f98;
    }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 48px; }
    header { border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 24px; }
    h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; font-weight: 700; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    .meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 16px; font-size: 14px; }
    .scroll-panel { overflow-x: auto; border: 1px solid var(--line); background: var(--panel); padding: 14px; }
    .chart-wrap { max-width: 100%; }
    .waterfall-chart { min-width: 960px; width: max-content; height: auto; display: block; }
    .axis { stroke: #7f8b9b; stroke-width: 1.2; }
    .axis-y { stroke: #c1cad7; stroke-width: 1; }
    .axis-label { font-size: 11px; fill: var(--muted); }
    .connector { stroke: #697386; stroke-width: 1.2; stroke-dasharray: 6 4; }
    .bar-base { fill: var(--blue); }
    .bar-positive { fill: var(--positive); }
    .bar-negative { fill: var(--negative); }
    .bar-neutral { fill: var(--neutral); }
    .bar-unresolved { fill: var(--unresolved); }
    .bar-value { font-size: 13px; font-weight: 700; fill: var(--ink); }
    .bar-label { font-size: 12px; fill: var(--ink); }
    .bar-tag { font-size: 11px; fill: var(--muted); }
    .bar-output { font-size: 10px; fill: var(--muted); }
    .table-scroll { overflow-x: auto; border: 1px solid var(--line); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: var(--panel); font-weight: 700; }
    code { white-space: pre-wrap; word-break: break-word; }
    h3 { font-size: 15px; margin: 18px 0 10px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; }
    .tab-button { appearance: none; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); font: inherit; font-size: 13px; padding: 8px 10px; cursor: pointer; }
    .tab-button.active { background: var(--blue); border-color: var(--blue); color: #fff; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .lane-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .lane-heading h2 { margin-bottom: 8px; }
    .lane-meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; }
    .lane-warnings { margin-top: 12px; }
    .warning { border-left: 4px solid var(--neutral); background: #fff8df; padding: 10px 12px; margin: 8px 0; }
    .empty { color: var(--muted); }
    .empty-chart { fill: var(--muted); font-size: 14px; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>Source: ${escapeHtml(example.scenario.source)}</span>
      <span>Version: ${escapeHtml(example.procedure.version ?? example.procedure.active_version ?? 'unknown')}</span>
      <span>Quote: ${escapeHtml(example.scenario.quote_id ?? 'n/a')}</span>
      <span>Line: ${escapeHtml(example.scenario.line_id ?? 'n/a')}</span>
    </div>
  </header>
  <section>
    <h2>Waterfall Graphs</h2>
    <div class="tabs" role="tablist" aria-label="Waterfall value lanes">
      ${lanes.map((lane, index) => `<button class="tab-button${index === 0 ? ' active' : ''}" id="tab-${escapeHtml(lane.id)}" data-target="panel-${escapeHtml(lane.id)}" data-testid="lane-tab-${escapeHtml(lane.id)}" role="tab" aria-controls="panel-${escapeHtml(lane.id)}" aria-selected="${index === 0 ? 'true' : 'false'}">${escapeHtml(lane.label)}</button>`).join('\n')}
      <button class="tab-button" id="tab-raw-runtime-trace" data-target="panel-raw-runtime-trace" data-testid="lane-tab-raw-runtime-trace" role="tab" aria-controls="panel-raw-runtime-trace" aria-selected="false">${escapeHtml(rawTraceLabel)}</button>
    </div>
    ${lanes.map((lane, index) => renderLanePanel(lane, index)).join('\n')}
    <section class="tab-panel" id="panel-raw-runtime-trace" data-testid="lane-panel-raw-runtime-trace" role="tabpanel" aria-labelledby="tab-raw-runtime-trace">
      <h2>${escapeHtml(rawTraceLabel)}</h2>
      <div class="scroll-panel chart-wrap">${renderSvg(example.bars)}</div>
      <h3>Raw Step Evidence</h3>
      <div class="table-scroll"><table><thead><tr><th>Step</th><th>Tag</th><th>Operation</th><th>Input</th><th>Delta</th><th>Output</th><th>Source</th><th>Formula</th></tr></thead><tbody>
        ${renderRows(example)}
      </tbody></table></div>
    </section>
  </section>
  <section>
    <h2>Context Mapping</h2>
    ${renderMappings(example)}
  </section>
  <section>
    <h2>Warnings And Limitations</h2>
    ${warnings.length === 0 ? '<p class="empty">No unresolved values or overwrites were detected.</p>' : warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join('\n')}
  </section>
  <script type="application/json" id="waterfall-example-data">${escapeHtml(JSON.stringify(example))}</script>
  <script>
    const buttons = Array.from(document.querySelectorAll('.tab-button'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-target');
        for (const candidate of buttons) {
          const selected = candidate === button;
          candidate.classList.toggle('active', selected);
          candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
        }
        for (const panel of panels) {
          panel.classList.toggle('active', panel.id === targetId);
        }
      });
    }
  </script>
</main>
</body>
</html>`;
}

export function runRenderWaterfallHtml(args: RenderWaterfallHtmlArgs, startedAt: number): Envelope<RenderWaterfallHtmlResult> {
  const example = readJsonFile<WaterfallExample>(args.example);
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, renderWaterfallHtml(example), 'utf8');

  const result: RenderWaterfallHtmlResult = {
    output_file: args.output,
    bar_count: (example.lanes && example.lanes.length > 0 ? example.lanes.reduce((total, lane) => total + lane.bars.length, 0) : example.bars.length),
    overwrite_count: example.overwrites.length,
    unresolved_count: example.unresolved.length,
    sections: ['waterfall_graphs', 'raw_step_evidence', 'context_mapping', 'warnings_and_limitations'],
  };
  const warnings = example.bars.length === 0
    ? [
        makeNotice(
          'waterfall_html_empty_chart',
          'The HTML file was written but the example contained no bars.',
          { output: args.output },
          'Generate a waterfall-example with at least one resolved or unresolved bar.',
        ),
      ]
    : [];

  return makeEnvelope(
    'render-waterfall-html',
    makeSummary(
      args.output,
      warnings.length > 0 ? 'Waterfall HTML rendered with no chart bars.' : 'Waterfall HTML rendered.',
      { ...result },
      '',
    ),
    result,
    {
      status: warnings.length > 0 ? 'warn' : 'ok',
      warnings,
      source_files: [args.example, args.output],
      started_at: startedAt,
    },
  );
}
