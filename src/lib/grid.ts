import OP from '../core';
import type { Store } from '../store';
import type { Row } from '../types';
import { t } from '../i18n';

const U = OP.util, M = OP.model;

/* ---------- columns ---------- */

export interface Col {
  t: string;
  w: number;
  fixed?: boolean;
  num?: boolean;
  edit?: 'duration' | 'work' | 'preds' | 'number' | 'percent' | 'date' | 'select' | 'text' | 'cftext' | 'cfnum';
  field?: string;
  options?: Record<string, string>;
  sumRo?: boolean;
  cf?: string;
  get?: (r: Row) => string;
}

const dayNum = (v: number) => (v == null || !isFinite(v) ? '' : U.num(v));
const money = (v: number) => (v == null ? '' : U.money(v));
const signedDays = (v: number) => (v == null ? '' : (v > 0 ? '+' : '') + U.num(v) + 'd');

// Column labels are getters so they are translated at render time (module-level
// t() would freeze the language before the store loads the persisted one).
export const COLS: Record<string, Col> = {
  id: { get t() { return t('ID'); }, w: 44, fixed: true },
  ind: { t: '', w: 56, fixed: true },
  name: { get t() { return t('Task Name'); }, w: 280, fixed: true },
  wbs: { get t() { return t('WBS'); }, w: 64, get: r => r.wbs },
  duration: { get t() { return t('Duration'); }, w: 76, edit: 'duration', get: r => M.fmtDuration(r.duration), sumRo: true },
  work: { get t() { return t('Work'); }, w: 80, edit: 'work', num: true, get: r => U.num(r.work) + 'h', sumRo: true },
  start: { get t() { return t('Start'); }, w: 88, get: r => U.fmt(r.startDn) },
  finish: { get t() { return t('Finish'); }, w: 88, get: r => U.fmt(r.finishDn) },
  preds: { get t() { return t('Predecessors'); }, w: 110, edit: 'preds' },
  res: { get t() { return t('Resources'); }, w: 170 },
  cost: { get t() { return t('Cost'); }, w: 110, num: true, get: r => U.money(r.cost) },
  fixedCost: { get t() { return t('Fixed cost'); }, w: 96, num: true, edit: 'number', field: 'fixedCost', get: r => String(r.task.fixedCost || 0) },
  percent: { get t() { return t('% Complete'); }, w: 90, num: true, edit: 'percent', get: r => r.percent + '%', sumRo: true },
  actualStart: { get t() { return t('Actual start'); }, w: 130, edit: 'date', field: 'actualStart', sumRo: true },
  actualFinish: { get t() { return t('Actual finish'); }, w: 130, edit: 'date', field: 'actualFinish', sumRo: true },
  constraint: { get t() { return t('Constraint'); }, w: 170, edit: 'select', field: 'constraint', options: M.CONSTRAINTS, sumRo: true },
  constraintDate: { get t() { return t('Constraint date'); }, w: 130, edit: 'date', field: 'constraintDate', sumRo: true },
  deadline: { get t() { return t('Deadline'); }, w: 130, edit: 'date', field: 'deadline', sumRo: true },
  type: { get t() { return t('Task type'); }, w: 130, edit: 'select', field: 'type', options: M.TASK_TYPES, sumRo: true },
  priority: { get t() { return t('Priority'); }, w: 74, num: true, edit: 'number', field: 'priority', get: r => String(r.task.priority) },
  slack: { get t() { return t('Total slack'); }, w: 86, num: true, get: r => U.num(r.slack) + 'd' },
  freeSlack: { get t() { return t('Free slack'); }, w: 80, num: true, get: r => (r.summary ? '' : U.num(r.freeSlack) + 'd') },
  es: { get t() { return t('ES'); }, w: 56, num: true, get: r => dayNum(r.es) },
  ef: { get t() { return t('EF'); }, w: 56, num: true, get: r => dayNum(r.ef) },
  ls: { get t() { return t('LS'); }, w: 56, num: true, get: r => dayNum(r.ls) },
  lf: { get t() { return t('LF'); }, w: 56, num: true, get: r => dayNum(r.lf) },
  bStart: { get t() { return t('Baseline start'); }, w: 104, get: r => (r.base ? U.fmt(r.base.startDn) : '') },
  bFinish: { get t() { return t('Baseline finish'); }, w: 104, get: r => (r.base ? U.fmt(r.base.finishDn) : '') },
  bCost: { get t() { return t('Baseline cost'); }, w: 110, num: true, get: r => (r.base ? U.money(r.base.cost) : '') },
  startVar: { get t() { return t('Start var.'); }, w: 80, num: true, get: r => (r.base ? signedDays(r.startVar) : '') },
  finishVar: { get t() { return t('Finish var.'); }, w: 80, num: true, get: r => (r.base ? signedDays(r.finishVar) : '') },
  costVar: { get t() { return t('Cost var.'); }, w: 100, num: true, get: r => (r.base ? U.money(r.costVar) : '') },
  actualCost: { get t() { return t('Actual cost'); }, w: 104, num: true, get: r => money(r.actualCost) },
  bcws: { get t() { return t('BCWS (PV)'); }, w: 104, num: true, get: r => money(r.bcws) },
  bcwp: { get t() { return t('BCWP (EV)'); }, w: 104, num: true, get: r => money(r.bcwp) },
  acwp: { get t() { return t('ACWP (AC)'); }, w: 104, num: true, get: r => money(r.acwp) },
  sv: { get t() { return t('SV'); }, w: 96, num: true, get: r => money(r.bcwp - r.bcws) },
  cv: { get t() { return t('CV'); }, w: 96, num: true, get: r => money(r.bcwp - r.acwp) },
  levelDelay: { get t() { return t('Leveling delay'); }, w: 100, num: true, get: r => (r.task.levelDelay ? U.num(r.task.levelDelay) + 'd' : '') },
  notes: { get t() { return t('Notes'); }, w: 200, edit: 'text', field: 'notes' }
};

export const COL_GROUPS: [string, string[]][] = [
  ['General', ['wbs', 'duration', 'work', 'start', 'finish', 'preds', 'res', 'cost', 'fixedCost', 'priority', 'type', 'notes']],
  ['Schedule', ['constraint', 'constraintDate', 'deadline', 'slack', 'freeSlack', 'es', 'ef', 'ls', 'lf', 'levelDelay']],
  ['Tracking', ['percent', 'actualStart', 'actualFinish', 'actualCost', 'bStart', 'bFinish', 'bCost', 'startVar', 'finishVar', 'costVar']],
  ['Earned value', ['bcws', 'bcwp', 'acwp', 'sv', 'cv']]
];
const COL_ORDER = ['id', 'ind', 'name'].concat(COL_GROUPS.flatMap(g => g[1]));

export function colDef(st: Store, k: string): Col | null {
  if (COLS[k]) return COLS[k];
  const m = /^cf:(.+)$/.exec(k);
  const f = m && st.p.customFields.find(x => x.id === m[1]);
  if (!f) return null;
  if (f.type === 'text' && f.values && f.values.length) {
    const options: Record<string, string> = { '': t('(none)') };
    f.values.forEach(v => { options[v] = v; });
    return { t: f.name, w: 120, edit: 'select', cf: f.id, options };
  }
  return { t: f.name, w: 120, num: f.type === 'number', edit: f.type === 'number' ? 'cfnum' : 'cftext', cf: f.id };
}

export function activeCols(st: Store): string[] {
  const ks = st.cols.filter(k => colDef(st, k));
  ['name', 'ind', 'id'].forEach(k => { if (!ks.includes(k)) ks.unshift(k); });
  return ks;
}

export function toggleCol(cols: string[], k: string, on: boolean): string[] {
  const next = cols.filter(c => c !== k);
  if (on) next.push(k);
  return next.sort((a, b) => {
    const x = COL_ORDER.indexOf(a), y = COL_ORDER.indexOf(b);
    return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
  });
}

/* ---------- filter, group, sort ---------- */

export const FILTERS: Record<string, string> = {
  all: 'All tasks', critical: 'Critical tasks', milestones: 'Milestones', summary: 'Summary tasks',
  incomplete: 'Incomplete tasks', complete: 'Completed tasks', late: 'Behind schedule', slipped: 'Slipped vs baseline',
  overalloc: 'Overallocated resources', deadline: 'Missed deadlines', conflicts: 'Constraint conflicts'
};
export const GROUPS: Record<string, string> = { none: 'No grouping', critical: 'Critical', milestone: 'Milestone', status: 'Progress status', resource: 'Resource', priority: 'Priority', type: 'Task type' };
export const SORTS: Record<string, string> = { id: 'ID', start: 'Start date', finish: 'Finish date', duration: 'Duration', name: 'Name', cost: 'Cost', priority: 'Priority', slack: 'Total slack' };

export function menuData(st: Store) {
  const filters: Record<string, string> = {};
  Object.entries(FILTERS).forEach(([k, v]) => { filters[k] = t(v); });
  st.p.resources.forEach(r => { filters['res:' + r.uid] = t('Using {name}', { name: r.name || t('(unnamed)') }); });
  const groups: Record<string, string> = {};
  Object.entries(GROUPS).forEach(([k, v]) => { groups[k] = t(v); });
  st.p.customFields.forEach(cf => { groups['cf:' + cf.id] = cf.name; });
  const sorts: Record<string, string> = {};
  Object.entries(SORTS).forEach(([k, v]) => { sorts[k] = t(v); });
  return { filters, groups, sorts };
}

function matches(st: Store, r: Row) {
  const f = st.filter, task = r.task;
  if (f === 'all') return true;
  if (f === 'summary') return r.summary;
  if (r.summary) return false;
  if (f === 'critical') return r.critical;
  if (f === 'milestones') return r.milestone;
  if (f === 'incomplete') return r.percent < 100;
  if (f === 'complete') return r.percent >= 100;
  if (f === 'late') return r.late;
  if (f === 'slipped') return !!r.slipped;
  if (f === 'overalloc') return r.over;
  if (f === 'deadline') return r.missedDeadline;
  if (f === 'conflicts') return !!r.conflict;
  const m = /^res:(\d+)$/.exec(f);
  if (m) return task.assignments.some((a: any) => a.res === +m[1]);
  return true;
}

function sortKey(st: Store, r: Row): number | string {
  switch (st.sort) {
    case 'start': return r.startDn;
    case 'finish': return r.finishDn;
    case 'duration': return -r.duration;
    case 'name': return (r.task.name || '').toLowerCase();
    case 'cost': return -r.cost;
    case 'priority': return -r.task.priority;
    case 'slack': return r.slack;
    default: return r.i;
  }
}

function groupKeys(st: Store, r: Row): string[] {
  const g = st.group, task = r.task;
  if (g === 'critical') return [r.critical ? t('Critical') : t('Not critical')];
  if (g === 'milestone') return [r.milestone ? t('Milestones') : t('Tasks')];
  if (g === 'status') return [r.percent >= 100 ? t('Complete') : r.percent > 0 ? t('In progress') : t('Not started')];
  if (g === 'priority') return [t('Priority {n}', { n: task.priority })];
  if (g === 'type') return [M.TASK_TYPES[task.type] || task.type];
  if (g === 'resource') {
    const names = task.assignments.map((a: any) => { const res = st.p.resources.find(x => x.uid === a.res); return res ? res.name || t('(unnamed)') : null; }).filter((n): n is string => !!n);
    return names.length ? names : [t('Unassigned')];
  }
  const m = /^cf:(.+)$/.exec(g);
  if (m) { const v = task.custom && task.custom[m[1]]; return [v === '' || v == null ? t('(blank)') : String(v)]; }
  return [t('All')];
}

export interface GroupItem { group: true; key: string; label: string; count: number; cost: number; startDn: number; finishDn: number }

// Rows to display, honouring filter, grouping, sorting and collapsed summaries.
export function gridItems(st: Store): (Row | GroupItem)[] {
  const rows: Row[] = st.s.rows;
  const cmp = (a: Row, b: Row) => {
    const x = sortKey(st, a), y = sortKey(st, b);
    return x < y ? -1 : x > y ? 1 : a.i - b.i;
  };
  if (st.group !== 'none') {
    const groups: Record<string, Row[]> = {}, order: string[] = [];
    rows.forEach(r => {
      if (r.summary || !matches(st, r)) return;
      groupKeys(st, r).forEach(k => {
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(r);
      });
    });
    order.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const out: (Row | GroupItem)[] = [];
    order.forEach(k => {
      const list = groups[k].sort(cmp), key = 'g:' + k;
      out.push({
        group: true, key, label: k, count: list.length,
        cost: list.reduce((a, r) => a + r.cost, 0),
        startDn: Math.min(...list.map(r => r.startDn)),
        finishDn: Math.max(...list.map(r => r.finishDn))
      });
      if (!st.collapsed[key]) out.push(...list);
    });
    return out;
  }
  const keep: Record<number, boolean> = {};
  rows.forEach(r => {
    if (!matches(st, r)) return;
    keep[r.i] = true;
    for (let q = r.parent; q >= 0; q = rows[q].parent) keep[q] = true;
  });
  const res: Row[] = [];
  const walk = (list: Row[]) => {
    list.slice().sort(cmp).forEach(r => {
      if (!keep[r.i]) return;
      res.push(r);
      if (r.summary && !st.collapsed[r.task.uid]) walk(r.children.map((c: number) => rows[c]));
    });
  };
  walk(rows.filter(r => r.parent < 0));
  return res;
}
