// Paginated printing for the chart views (PRD M18 / 6.7): pages are cut between
// node rows so no box is ever sliced across a page, with a configurable header
// and footer. The browser's own print preview shows the result.
import OP from '../core';
import { t } from '../i18n';
import { viewName, type Store, type PrintConfig, type PrintSlot } from '../store';
import { viewSvgString } from './actions';

const U = OP.util, IO = OP.io;

const PAPERS: Record<string, [number, number]> = { a4: [297, 210], a3: [420, 297], letter: [279, 216] };
const MARGIN = 12; // mm, left/right; top/bottom leave room for header/footer

// Bounding boxes of the chart's node groups, read from the generated SVG markup.
function nodeBoxes(svg: SVGSVGElement): { y0: number; y1: number }[] {
  const boxes: { y0: number; y1: number }[] = [];
  svg.querySelectorAll('g.wnode, g.nnode, g.onode, g.anno').forEach(g => {
    const rect = g.querySelector('rect.anno-box') || g.querySelector('rect');
    if (!rect) return;
    const y = +rect.getAttribute('y')!, h = +rect.getAttribute('height')!;
    if (h > 0) boxes.push({ y0: y, y1: y + h });
  });
  return boxes;
}

// Page slice boundaries in SVG units: each cut avoids intersecting any node box.
function pageCuts(H: number, pageH: number, boxes: { y0: number; y1: number }[]): number[] {
  const cuts: number[] = [];
  let y = 0;
  const spans = (c: number) => boxes.some(b => b.y0 < c - 0.5 && c + 0.5 < b.y1);
  while (y < H - 1) {
    let target = y + pageH;
    if (target >= H - 1) { cuts.push(H); break; }
    // Walk the target down until it lands in a gap between node rows.
    let c = target;
    while (c > y + 40 && spans(c)) c -= 4;
    if (c <= y + 40) c = target; // dense chart: fall back to a straight cut
    cuts.push(c);
    y = c;
  }
  if (!cuts.length) cuts.push(H);
  return cuts;
}

function slotText(slot: PrintSlot, page: number, total: number, projectName: string): string {
  switch (slot.type) {
    case 'page': return t('Page {n} of {m}', { n: page, m: total });
    case 'date': return new Date().toLocaleDateString();
    case 'project': return projectName;
    case 'custom': return slot.text;
    default: return '';
  }
}

function slotRow(slots: [PrintSlot, PrintSlot, PrintSlot], page: number, total: number, name: string, cls: string): string {
  const cell = (s: PrintSlot) => '<span>' + U.esc(slotText(s, page, total, name)) + '</span>';
  return '<div class="' + cls + '">' + cell(slots[0]) + cell(slots[1]) + cell(slots[2]) + '</div>';
}

// Print the current chart view with pagination. Gantt keeps the classic
// single-page fit (its SVG is one very wide strip).
export function printView(st: Store, cfg: PrintConfig) {
  const str = viewSvgString(st);
  if (!str) { window.print(); return; }
  const title = st.p.name + ' — ' + viewName(st.view);
  if (st.view === 'gantt') { IO.printSVG(svgEl(str), title); return; }

  const svg = svgEl(str);
  const vb = (svg.getAttribute('viewBox') || '0 0 0 0').split(' ');
  const W = Number(svg.getAttribute('width')) || +vb[2];
  const H = Number(svg.getAttribute('height')) || +vb[3];
  const [pw0, ph0] = PAPERS[cfg.paper] ?? PAPERS.a4;
  const [pw, ph] = cfg.orient === 'portrait' ? [ph0, pw0] : [pw0, ph0];
  const printableW = pw - 2 * MARGIN, printableH = ph - 2 * MARGIN - 10; // 10mm for header+footer
  const scale = printableW / W;
  const pageH = printableH / scale;
  const cuts = pageCuts(H, pageH, nodeBoxes(svg));
  const total = cuts.length;
  const art = IO.standaloneSVG(svg);

  const pages = cuts.map((end, i) => {
    const start = i === 0 ? 0 : cuts[i - 1];
    const slice = art.replace(
      /<svg([^>]*?)viewBox="[^"]*"/,
      '<svg$1viewBox="0 ' + start + ' ' + W + ' ' + (end - start) + '"'
    );
    return (
      '<div class="page">' +
      slotRow(cfg.header, i + 1, total, st.p.name, 'hd') +
      '<div class="art">' + slice + '</div>' +
      slotRow(cfg.footer, i + 1, total, st.p.name, 'ft') +
      '</div>'
    );
  }).join('\n');

  const css =
    '@page{size:' + pw + 'mm ' + ph + 'mm;margin:0}' +
    'body{margin:0;font:10pt system-ui,sans-serif;color:#000}' +
    '.page{width:' + pw + 'mm;height:' + ph + 'mm;page-break-after:always;position:relative;box-sizing:border-box;padding:' + (MARGIN + 5) + 'mm ' + MARGIN + 'mm}' +
    '.page:last-child{page-break-after:auto}' +
    '.hd,.ft{position:absolute;left:' + MARGIN + 'mm;right:' + MARGIN + 'mm;display:flex;justify-content:space-between;height:5mm}' +
    '.hd{top:4mm}.ft{bottom:4mm}' +
    '.art svg{width:100%;height:auto;display:block}';

  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  const w = f.contentWindow!;
  w.onafterprint = () => setTimeout(() => f.remove(), 0);
  setTimeout(() => f.remove(), 60000);
  w.document.write('<!doctype html><title>' + U.esc(title) + '</title><style>' + css + '</style>' + pages);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function svgEl(str: string): SVGSVGElement {
  return new DOMParser().parseFromString(str, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}
