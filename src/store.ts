import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import OP from './core';
import type { Project, Schedule, ViewName } from './types';
import { capHistory } from './lib/history';

const STORE = 'openplan.project';
export const PREV_STORE = 'openplan.project.previous';
const UISTORE = 'openplan.ui';

export const DEFAULT_COLS = ['id', 'ind', 'name', 'duration', 'start', 'finish', 'preds', 'res', 'cost'];
export const ZOOMS = ['day', 'week', 'month', 'quarter'] as const;
export const VIEW_NAMES: Record<ViewName, string> = {
  gantt: 'Gantt Chart', board: 'Task Board', network: 'Network Diagram', wbs: 'WBS Chart', resources: 'Resource Sheet',
  org: 'Team Chart', workload: 'Resource Usage', budget: 'Cost & Budget', reports: 'Reports'
};
const VIEW_TABS: Partial<Record<ViewName, string>> = {
  gantt: 'task', board: 'task', resources: 'resource', org: 'resource', workload: 'resource', reports: 'report', budget: 'report'
};

export interface UIState {
  view: ViewName;
  zoom: string;
  critical: boolean;
  gridW: number;
  ganttHide: 'none' | 'table' | 'chart';
  drawer: boolean;
  netScope: string;
  netDates: boolean;
  netZoom: number;
  wbsDepth: number;
  filter: string;
  group: string;
  sort: string;
  cols: string[];
  showBaseline: boolean;
  report: string;
  tab: string;
  timeline: boolean;
  ribbonMin: boolean;
  theme: 'light' | 'dark';
  bars: string;
  fullYear: boolean;
  guide: boolean;
  wbsBox: string[];
  annoSel: string | null;
  annoEdit: string | null;
}

const UI_DEFAULTS: UIState = {
  view: 'gantt', zoom: 'week', critical: true, gridW: 600, ganttHide: 'none', drawer: window.innerWidth > 1100, netScope: 'all', netDates: false,
  netZoom: 1, wbsDepth: 99, filter: 'all', group: 'none', sort: 'id', cols: DEFAULT_COLS.slice(), showBaseline: true,
  report: 'overview', tab: 'task', timeline: true, ribbonMin: false, theme: 'light', bars: 'teal', fullYear: false, guide: true,
  wbsBox: ['wbs'], annoSel: null, annoEdit: null
};
const PERSISTED_UI: (keyof UIState)[] = ['view', 'zoom', 'critical', 'gridW', 'ganttHide', 'drawer', 'netDates', 'wbsDepth', 'filter', 'group', 'sort', 'cols', 'showBaseline', 'report', 'tab', 'timeline', 'theme', 'bars', 'fullYear', 'guide', 'wbsBox'];

export interface Dialog { type: string; props?: any }
export type SaveState = 'ok' | 'full' | 'off';

export interface Store extends UIState {
  p: Project;
  s: Schedule;
  undo: string[];
  redo: string[];
  saveState: SaveState;
  sel: number[];
  anchor: number | null;
  collapsed: Record<string, boolean>;
  backstage: boolean;
  bsPage: string;
  menu: string | null;
  dialog: Dialog | null;
  toastMsg: { text: string; err: boolean; id: number } | null;
  pendingFocus: string | null;

  setUI: (patch: Partial<Store>) => void;
  setView: (view: ViewName) => void;
  commit: (fn: (p: Project) => void | false) => boolean;
  undoAct: () => void;
  redoAct: () => void;
  replaceProject: (p: Project, msg?: string) => void;
  select: (uids: number[], anchor?: number | null) => void;
  toast: (text: string, err?: boolean) => void;
  openDialog: (type: string, props?: any) => void;
  closeDialog: () => void;
}

function loadUI(): Partial<UIState> {
  try {
    const ui = JSON.parse(localStorage.getItem(UISTORE) || '{}');
    const out: any = {};
    // Keep only values of the expected type, so stale or edited settings cannot break rendering.
    PERSISTED_UI.forEach(k => {
      const v = ui[k], def = UI_DEFAULTS[k];
      if (v == null) return;
      if (Array.isArray(def) ? Array.isArray(v) && v.every((x: unknown) => typeof x === 'string') : typeof v === typeof def) out[k] = v;
    });
    if (out.view && !(out.view in VIEW_NAMES)) delete out.view;
    if (out.theme && out.theme !== 'light' && out.theme !== 'dark') delete out.theme;
    if (out.zoom && !(ZOOMS as readonly string[]).includes(out.zoom)) delete out.zoom;
    if (out.ganttHide && !['none', 'table', 'chart'].includes(out.ganttHide)) delete out.ganttHide;
    if (out.gridW != null && !(out.gridW >= 160 && out.gridW <= 2400)) delete out.gridW;
    return out;
  } catch {
    return {};
  }
}

function saveUI(st: Store) {
  try {
    const ui: any = {};
    PERSISTED_UI.forEach(k => { ui[k] = st[k]; });
    localStorage.setItem(UISTORE, JSON.stringify(ui));
  } catch { /* storage unavailable */ }
}

let loadError = false, autosaveBlocked = false;

function persistNow(json: string): SaveState {
  if (autosaveBlocked) return 'off';
  try {
    localStorage.setItem(STORE, json);
    return 'ok';
  } catch (e: any) {
    return e && (e.name === 'QuotaExceededError' || e.code === 22) ? 'full' : 'off';
  }
}

// Autosave is debounced; pending changes are written when the page is hidden or closed.
let pending: string | null = null, timer = 0;
function flush() {
  clearTimeout(timer);
  if (pending == null) return;
  const state = persistNow(pending);
  pending = null;
  useStore.setState({ saveState: state });
}
function persist(json: string) {
  pending = json;
  clearTimeout(timer);
  timer = window.setTimeout(flush, 300);
}

function loadProject(): Project {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORE); } catch { /* storage unavailable */ }
  if (saved) {
    try {
      return OP.io.fromJSON(saved);
    } catch {
      // Keep the unreadable copy; if it cannot be kept, never overwrite it.
      loadError = true;
      try { localStorage.setItem(STORE + '.unreadable-' + Date.now(), saved); } catch { autosaveBlocked = true; }
    }
  }
  return OP.model.normalize(OP.demo());
}

const initial = loadProject();
let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  ...UI_DEFAULTS,
  ...loadUI(),
  p: initial,
  s: OP.schedule(initial),
  undo: [],
  redo: [],
  saveState: loadError ? (autosaveBlocked ? 'off' : 'ok') : persistNow(JSON.stringify(initial)),
  sel: [],
  anchor: null,
  collapsed: {},
  backstage: false,
  bsPage: 'info',
  menu: null,
  dialog: null,
  toastMsg: null,
  pendingFocus: null,

  setUI: patch => {
    // Dates are formatted by the engine, so rebuild the schedule to redraw every chart and table.
    if ('fullYear' in patch) { OP.util.setFullYear(patch.fullYear); patch = { ...patch, s: OP.schedule(get().p) }; }
    set(patch);
    if (Object.keys(patch).some(k => (PERSISTED_UI as string[]).includes(k))) saveUI(get());
  },

  setView: view => {
    const tab = VIEW_TABS[view] || get().tab;
    get().setUI({ view, tab, netZoom: 1, backstage: false, menu: null });
  },

  // Every change to the project goes through commit() so it can be undone.
  commit: fn => {
    const before = JSON.stringify(get().p);
    const next: Project = JSON.parse(before);
    if (fn(next) === false) return false;
    const after = JSON.stringify(next);
    if (after === before) return false;
    const undo = capHistory(get().undo.concat([before]));
    set({ p: next, s: OP.schedule(next), undo, redo: [] });
    persist(after);
    return true;
  },

  undoAct: () => {
    const { undo, redo, p } = get();
    if (!undo.length) return;
    const text = undo[undo.length - 1], prev = JSON.parse(text);
    set({ p: prev, s: OP.schedule(prev), undo: undo.slice(0, -1), redo: capHistory(redo.concat([JSON.stringify(p)])) });
    persist(text);
  },

  redoAct: () => {
    const { undo, redo, p } = get();
    if (!redo.length) return;
    const text = redo[redo.length - 1], next = JSON.parse(text);
    set({ p: next, s: OP.schedule(next), redo: redo.slice(0, -1), undo: capHistory(undo.concat([JSON.stringify(p)])) });
    persist(text);
  },

  // The replaced project is kept in browser storage so it can be restored after a reload.
  replaceProject: (p, msg) => {
    OP.model.normalize(p);
    const old = JSON.stringify(get().p);
    try { localStorage.setItem(PREV_STORE, old); } catch { /* storage unavailable */ }
    set({ p, s: OP.schedule(p), undo: capHistory(get().undo.concat([old])), redo: [], sel: [], collapsed: {} });
    persist(JSON.stringify(p));
    if (msg) get().toast(msg);
  },

  select: (uids, anchor = null) => set({ sel: uids, anchor: anchor ?? (uids[0] ?? null) }),

  toast: (text, err = false) => set({ toastMsg: { text, err, id: ++toastId } }),
  openDialog: (type, props) => set({ dialog: { type, props }, menu: null }),
  closeDialog: () => set({ dialog: null })
}));
OP.util.setFullYear(useStore.getState().fullYear);

// Non-reactive access for event handlers and helpers.
export const S = () => useStore.getState();

// Store access for views: re-renders on project and view changes, but not on toasts, menus or dialogs.
export function useApp(): Store {
  return useStore(useShallow((s: Store) => {
    const { toastMsg, menu, dialog, pendingFocus, ...rest } = s;
    return rest;
  })) as Store;
}

window.addEventListener('pagehide', flush);

// Another tab saved the project: show its version here so the two tabs don't overwrite each other.
window.addEventListener('storage', e => {
  if (e.key !== STORE || !e.newValue) return;
  try {
    const p = OP.io.fromJSON(e.newValue);
    pending = null;
    clearTimeout(timer);
    useStore.setState({ p, s: OP.schedule(p), sel: [] });
    S().toast('Project updated from another tab');
  } catch { /* ignore unreadable data */ }
});

if (loadError) {
  setTimeout(() => S().toast(autosaveBlocked
    ? 'Your autosaved project could not be read and was left untouched. Autosave is off: use File › Save.'
    : 'Your autosaved project could not be read. A copy was kept in browser storage and the sample project was opened.', true));
}

export function taskByUid(uid: number) { return S().p.tasks.find(t => t.uid === uid) || null; }
export function resByUid(uid: number) { return S().p.resources.find(r => r.uid === uid) || null; }
export function rowByUid(uid: number) { return S().s.rows.find((r: any) => r.task.uid === uid) || null; }

// Focus an element by its data-fk key once React has rendered.
export function focusKey(fk: string, select = true) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-fk="' + fk + '"]');
    if (!el) return;
    el.focus();
    if (select && el.select) try { el.select(); } catch { /* not selectable */ }
  });
}

export function ask(message: string, onOk: () => void, okLabel = 'OK', title = 'Please confirm') {
  S().openDialog('confirm', { message, onOk, okLabel, title });
}

OP.notify = (text: string) => S().toast(text, true);
