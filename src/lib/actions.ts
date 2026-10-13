import OP from '../core';
import { S, VIEW_NAMES, ask, PREV_STORE, type Store } from '../store';
import { gridItems } from './grid';
import { toXlsx } from './xlsx';
import { toMsProjectXml, fromMsProjectXml } from './msproject';
import { fromTemplate, type Template } from './templates';
import type { Project } from '../types';

const U = OP.util, C = OP.charts, IO = OP.io;

const W = window as any;
const FS = !!W.showSaveFilePicker;
const TYPES = [{ description: 'OpenPlan project', accept: { 'application/x-openplan': ['.openplan'] } }];
let handle: any = null;

const MAX_FILE_MB = 20;
function checkSize(file: File) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error('The file is larger than ' + MAX_FILE_MB + ' MB, so it is not an OpenPlan project.');
}

async function saveFile(as: boolean) {
  const st = S();
  if (!FS) { U.download(U.slug(st.p.name) + '.openplan', IO.toJSON(st.p), 'application/x-openplan'); st.toast('Project file downloaded'); return; }
  try {
    if (as || !handle) handle = await W.showSaveFilePicker({ suggestedName: U.slug(st.p.name) + '.openplan', types: TYPES });
    const w = await handle.createWritable();
    await w.write(IO.toJSON(st.p));
    await w.close();
    st.toast('Saved to ' + handle.name);
  } catch (e: any) {
    if (e.name !== 'AbortError') st.toast('Could not save: ' + e.message, true);
  }
}

async function openHandle(h: any) {
  const file = await h.getFile();
  checkSize(file);
  S().replaceProject(IO.fromJSON(await file.text()), 'Opened ' + file.name);
  handle = h;
}

async function openFile() {
  try {
    const [h] = await W.showOpenFilePicker({ types: [{ description: 'Project files', accept: { 'application/x-openplan': ['.openplan'], 'application/json': ['.json'] } }] });
    await openHandle(h);
  } catch (e: any) {
    if (e.name !== 'AbortError') S().toast('Could not open file: ' + e.message, true);
  }
}

export function handleLaunchFiles() {
  W.launchQueue?.setConsumer((params: any) => {
    if (!params.files?.length) return;
    location.hash = 'app';
    openHandle(params.files[0]).catch((e: any) => S().toast('Could not open file: ' + e.message, true));
  });
}

export function scopeRows(st: Store) {
  if (st.netScope === 'all') return st.s.rows;
  const r = st.s.rows.find((x: any) => String(x.task.uid) === String(st.netScope));
  return r ? r.leaves.map((i: number) => st.s.rows[i]) : st.s.rows;
}

// SVG markup for the current view (null when the view is not a picture).
export function viewSvgString(st: Store, opts?: { selected?: boolean }): string | null {
  if (st.view === 'gantt') {
    return C.gantt({ p: st.p, s: st.s, rows: gridItems(st), zoom: st.zoom, critical: st.critical, table: true, flat: st.group !== 'none', baseline: st.showBaseline && !!st.p.baseline }).svg;
  }
  if (!st.s.rows.length && st.view !== 'org') return null;
  if (st.view === 'network') {
    const sr = st.netScope === 'all' ? null : st.s.rows.find((x: any) => String(x.task.uid) === String(st.netScope));
    const title = sr ? sr.wbs + ' ' + sr.task.name : st.p.name + ' — activity network';
    return C.network({ p: st.p, s: st.s, rows: scopeRows(st), critical: st.critical, dates: st.netDates, title }).svg;
  }
  if (st.view === 'wbs') return C.wbs({ p: st.p, s: st.s, depth: st.wbsDepth, box: st.wbsBox, selected: opts?.selected ? Object.fromEntries(st.sel.map((u: number) => [u, true])) : null }).svg;
  if (st.view === 'org') {
    const people = st.p.resources.filter(r => r.kind === 'Work');
    return people.length ? C.org({ p: { resources: people, currency: st.p.currency } }).svg : null;
  }
  return null;
}

export const hasImage = (st: Store) => ['gantt', 'network', 'wbs', 'org'].includes(st.view);

function svgElement(str: string): SVGSVGElement {
  return new DOMParser().parseFromString(str, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

// Replaces the current plan; the previous one can be restored from File › Open.
export function loadProject(p: Project, msg: string) {
  handle = null;
  S().setUI({ backstage: false, menu: null });
  S().replaceProject(p, msg);
}

export function openTemplate(t: Template) {
  ask('Start a new plan from the “' + t.name + '” template? The current one can be restored from File › Open › Restore Previous Project.',
    () => loadProject(fromTemplate(t), t.name + ' template loaded'), 'Use template');
}

export function runAction(a: string) {
  const st = S(), name = U.slug(st.p.name);
  st.setUI({ menu: null, backstage: false });
  switch (a) {
    case 'new':
      ask('Start a new blank project? The current one can be restored with Undo.', () => { handle = null; S().replaceProject(OP.model.blank(), 'New project created'); }, 'New project');
      break;
    case 'sample':
      ask('Open the sample project? The current one can be restored from File › Open › Restore Previous Project.', () => { handle = null; S().replaceProject(OP.demo(), 'Sample project loaded'); }, 'Open sample');
      break;
    case 'restore': {
      let text: string | null = null;
      try { text = localStorage.getItem(PREV_STORE); } catch { /* storage unavailable */ }
      if (!text) { st.toast('There is no previous project to restore.'); break; }
      try { handle = null; st.replaceProject(IO.fromJSON(text), 'Previous project restored'); } catch (e: any) { st.toast('Could not restore: ' + e.message, true); }
      break;
    }
    case 'open': if (FS) openFile(); else pickFile(false); break;
    case 'insert': pickFile(true); break;
    case 'import': st.openDialog('import'); break;
    case 'share': st.openDialog('share'); break;
    case 'save': saveFile(false); break;
    case 'saveas': saveFile(true); break;
    case 'xlsx':
      U.download(name + '-tasks.xlsx', new Blob([toXlsx(IO.taskTable(st.p), 'Tasks')], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      st.toast('Excel file downloaded');
      break;
    case 'csv': U.download(name + '-tasks.csv', '﻿' + IO.toCSV(st.p), 'text/csv'); st.toast('CSV downloaded'); break;
    case 'mspxml':
      U.download(name + '.xml', toMsProjectXml(st.p), 'application/xml');
      st.toast('MS Project XML downloaded');
      break;
    case 'import-msp': importMsProject(); break;
    case 'png': case 'svg': {
      const svg = viewSvgString(st);
      if (!svg) { st.toast('Switch to Gantt, Network, WBS or Team Chart to export an image.'); return; }
      if (a === 'png') IO.exportPNG(svgElement(svg), name + '-' + st.view);
      else IO.exportSVG(svgElement(svg), name + '-' + st.view);
      break;
    }
    case 'print': {
      const svg = viewSvgString(st);
      if (svg) IO.printSVG(svgElement(svg), st.p.name + ' — ' + VIEW_NAMES[st.view]);
      else window.print();
      break;
    }
    case 'settings': st.openDialog('settings'); break;
    case 'about': st.openDialog('about'); break;
  }
}

function pickFile(insert: boolean) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.openplan,.json,application/json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try { checkSize(file); } catch (e: any) { S().toast('Could not open file: ' + e.message, true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const st = S();
      try {
        const p: Project = IO.fromJSON(String(reader.result));
        if (insert) {
          let res = { uid: 0, warnings: [] as string[] };
          st.commit(pp => { res = IO.insertProject(pp, p); });
          st.select([res.uid], res.uid);
          st.toast('Inserted ' + file.name + ' as a subproject' + (res.warnings.length ? '. Note: ' + res.warnings.join('; ') + '.' : ''), res.warnings.length > 0);
        } else st.replaceProject(p, 'Opened ' + file.name);
      } catch (e: any) {
        st.toast('Could not open file: ' + e.message, true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Import a Microsoft Project XML file (PRD 6.2.4): tolerant parse, then load as the
// current project with an import report.
function importMsProject() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xml,application/xml,text/xml';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const st = S();
      try {
        const res = fromMsProjectXml(String(reader.result));
        handle = null;
        loadProject(res.project, 'Imported ' + res.counts.tasks + ' task(s), ' + res.counts.links + ' link(s), ' + res.counts.resources + ' resource(s) from ' + file.name);
        if (res.warnings.length) st.toast('Imported with notes: ' + res.warnings.slice(0, 3).join('; ') + (res.warnings.length > 3 ? '…' : ''), true);
      } catch (e: any) {
        st.toast('Could not import MS Project file: ' + e.message, true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
