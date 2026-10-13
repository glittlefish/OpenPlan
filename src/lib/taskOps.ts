import OP from '../core';
import { ask, S, focusKey, rowByUid } from '../store';
import type { Project, Task } from '../types';

const U = OP.util, M = OP.model;

/* ---------- task-type rules (fixed units / work / duration, effort driven) ---------- */

const hpd = (p: Project) => +p.hoursPerDay || 8;
const round = (v: number) => Math.round(v * 100) / 100;
const resIn = (p: Project, uid: number) => p.resources.find(r => r.uid === uid);

export function taskWork(p: Project, t: Task) { return M.workUnits(p, t) * hpd(p) * (t.milestone ? 0 : +t.duration || 0); }

function scaleUnits(p: Project, t: Task, f: number) {
  t.assignments.forEach(a => {
    const r = resIn(p, a.res);
    if (r && r.kind === 'Work') a.units = Math.max(1, Math.round(a.units * f * 10) / 10);
  });
}

export function setDuration(p: Project, t: Task, d: number) {
  const old = +t.duration || 0;
  if (t.type === 'FixedWork' && old > 0 && d > 0 && M.workUnits(p, t) > 0) scaleUnits(p, t, old / d);
  t.duration = d;
  t.milestone = d === 0;
}

export function setWork(p: Project, t: Task, hours: number): string {
  const u = M.workUnits(p, t), d = +t.duration || 0;
  if (!u) return 'Assign a person to this task before entering work.';
  if (t.type === 'FixedDuration' && d > 0) scaleUnits(p, t, hours / (d * u * hpd(p)));
  else { t.duration = round(hours / (u * hpd(p))); t.milestone = t.duration === 0; }
  return '';
}

// Effort-driven tasks keep their total work when people are added or removed.
export function changeAssignments(p: Project, t: Task, fn: () => void) {
  const before = taskWork(p, t), u0 = M.workUnits(p, t);
  fn();
  const u1 = M.workUnits(p, t);
  if (!t.effortDriven || !u0 || !u1 || u0 === u1 || t.milestone) return;
  if (t.type === 'FixedDuration') scaleUnits(p, t, u0 / u1);
  else t.duration = round(before / (u1 * hpd(p)));
}

export function setUnits(p: Project, t: Task, k: number, units: number) {
  const before = taskWork(p, t);
  t.assignments[k].units = units;
  const r = resIn(p, t.assignments[k].res);
  if (t.type === 'FixedWork' && r && r.kind === 'Work' && before > 0) t.duration = round(before / (M.workUnits(p, t) * hpd(p)));
}

/* ---------- helpers ---------- */

export const findTask = (p: Project, uid: number) => p.tasks.find(t => t.uid === uid)!;

function selIndexes(p: Project): number[] {
  const idx = M.indexByUid(p);
  return S().sel.map(u => idx[u]).filter((i: number | undefined) => i != null).sort((a: number, b: number) => a - b);
}

// Top-most selected tasks (children of a selected summary move with it).
function selectedBlocks(p: Project): number[] {
  const out: number[] = [];
  let coveredTo = -1;
  selIndexes(p).forEach(i => {
    if (i < coveredTo) return;
    out.push(i);
    coveredTo = M.subtreeEnd(p, i);
  });
  return out;
}

function wouldLoop(mutate: (p: Project) => void) {
  const trial: Project = U.clone(S().p);
  mutate(trial);
  return OP.schedule(trial, { cycleOnly: true }).cycle.length > 0;
}

/* ---------- commands ---------- */

export function setPreds(uid: number, text: string): boolean {
  const st = S(), res = M.parsePreds(st.p, text, uid);
  if (res.errors.length) {
    st.toast('Could not read "' + res.errors.join(', ') + '". Use task IDs, e.g. 3, 5SS+2d, 7FF.', true);
    return false;
  }
  if (wouldLoop(p => { findTask(p, uid).preds = res.preds; })) { st.toast('That link would create a dependency loop.', true); return false; }
  st.commit(p => { findTask(p, uid).preds = res.preds; });
  return true;
}

export function addLink(fromUid: number, toUid: number): boolean {
  const st = S(), target = st.p.tasks.find(t => t.uid === toUid);
  if (!target || fromUid === toUid) return false;
  if (target.preds.some(l => l.uid === fromUid)) { st.toast('Those tasks are already linked.'); return false; }
  const add = (p: Project) => { findTask(p, toUid).preds.push({ uid: fromUid, type: 'FS', lag: 0 }); };
  if (wouldLoop(add)) { st.toast('That link would create a dependency loop.', true); return false; }
  st.commit(add);
  return true;
}

export function addTask(milestone: boolean) {
  const st = S(), p = st.p, ids = selIndexes(p);
  let pos: number, lvl: number;
  if (ids.length) {
    const i = ids[ids.length - 1];
    if (M.isSummary(p, i) && !st.collapsed[p.tasks[i].uid]) { pos = i + 1; lvl = p.tasks[i].level + 1; }
    else { pos = M.subtreeEnd(p, i); lvl = p.tasks[i].level; }
  } else {
    pos = p.tasks.length;
    lvl = pos ? p.tasks[pos - 1].level : 1;
  }
  let uid = 0;
  st.commit(pp => {
    const t = M.newTask(pp, { name: milestone ? 'New milestone' : 'New task', level: lvl, duration: milestone ? 0 : 1, milestone });
    uid = t.uid;
    pp.tasks.splice(pos, 0, t);
  });
  st.setUI({ view: 'gantt', filter: 'all', group: 'none' });
  st.select([uid], uid);
  focusKey(uid + ':name');
}

export function addTaskNamed(name: string) {
  const st = S(), p = st.p, last = p.tasks[p.tasks.length - 1];
  const lvl = last ? (M.isSummary(p, p.tasks.length - 1) ? last.level + 1 : last.level) : 1;
  let uid = 0;
  st.commit(pp => { const t = M.newTask(pp, { name, level: lvl }); uid = t.uid; pp.tasks.push(t); });
  st.select([uid], uid);
}

// Insert a new task relative to a reference task, staying in the current view (WBS).
// where: 'before'/'after' = sibling of the reference, 'child' = subtask of the reference.
// refUid null = append at the end, at the last task's level. Returns the new task's uid.
export function addTaskNear(refUid: number | null, where: 'before' | 'after' | 'child'): number {
  const st = S(), p = st.p;
  let pos: number, lvl: number;
  if (refUid == null) {
    pos = p.tasks.length;
    lvl = pos ? p.tasks[pos - 1].level : 1;
  } else {
    const i = M.indexByUid(p)[refUid];
    if (i == null) return 0;
    const ref = p.tasks[i];
    if (where === 'child') { pos = i + 1; lvl = ref.level + 1; }
    else if (where === 'before') { pos = i; lvl = ref.level; }
    else { pos = M.subtreeEnd(p, i); lvl = ref.level; }
  }
  let uid = 0;
  st.commit(pp => {
    const t = M.newTask(pp, { name: 'New task', level: lvl, duration: 1 });
    uid = t.uid;
    pp.tasks.splice(pos, 0, t);
  });
  st.select([uid], uid);
  return uid;
}

// Move a task with its whole subtree to become the sibling right after the target task.
// Levels shift so the moved block keeps its internal outline shape.
export function moveSubtreeTo(uid: number, targetUid: number): boolean {
  const st = S(), p = st.p, idx = M.indexByUid(p);
  const i = idx[uid], ti = idx[targetUid];
  if (i == null || ti == null || uid === targetUid) return false;
  if (ti > i && ti < M.subtreeEnd(p, i)) { st.toast('A task cannot be moved into its own subtree.', true); return false; }
  st.commit(pp => {
    const a = M.indexByUid(pp)[uid], e = M.subtreeEnd(pp, a);
    const block = pp.tasks.splice(a, e - a);
    const t = M.indexByUid(pp)[targetUid];
    if (t == null) { pp.tasks.splice(a, 0, ...block); return false; }
    const shift = pp.tasks[t].level - block[0].level;
    block.forEach(x => { x.level += shift; });
    pp.tasks.splice(M.subtreeEnd(pp, t), 0, ...block);
  });
  return true;
}

/* ---------- copy / paste (shared by the Gantt and WBS context menus) ---------- */

// Each clipboard entry is a block: a task followed by its subtree, deep-cloned.
const clip: Task[][] = [];
export const hasClip = () => clip.length > 0;

// Copies each task with its whole subtree. A task already covered by an earlier
// selected subtree is not copied twice. Returns the number of tasks copied.
export function copyTasks(uids: number[]): number {
  const st = S(), p = st.p, idx = M.indexByUid(p);
  const picks = [...new Set(uids)].map(u => idx[u]).filter((i): i is number => i != null).sort((a, b) => a - b);
  clip.length = 0;
  const covered = new Set<number>();
  let count = 0;
  for (const i of picks) {
    if (covered.has(i)) continue;
    const e = M.subtreeEnd(p, i);
    for (let k = i; k < e; k++) covered.add(k);
    clip.push(JSON.parse(JSON.stringify(p.tasks.slice(i, e))));
    count += e - i;
  }
  if (count) st.toast('Copied ' + count + ' task' + (count > 1 ? 's' : '') + '.');
  else st.toast('Nothing to copy.', true);
  return count;
}

// Pastes the clipboard after the reference task (or at the end when null), as its
// sibling. Internal predecessor links are remapped to the new uids; links to tasks
// outside the copied block are kept as they were. Returns the new top-level uids.
export function pasteTasks(refUid: number | null): number[] {
  if (!clip.length) return [];
  const st = S(), p = st.p;
  let pos: number, lvl: number;
  if (refUid == null) {
    pos = p.tasks.length;
    lvl = pos ? p.tasks[pos - 1].level : 1;
  } else {
    const i = M.indexByUid(p)[refUid];
    if (i == null) return [];
    pos = M.subtreeEnd(p, i);
    lvl = p.tasks[i].level;
  }
  const tops: number[] = [];
  st.commit(pp => {
    let at = pos;
    for (const block of clip) {
      const map: Record<number, number> = {};
      const clones = block.map(t => {
        const c = JSON.parse(JSON.stringify(t)) as Task;
        c.uid = pp.nextUid++;
        map[t.uid] = c.uid;
        c.level += lvl - block[0].level;
        return c;
      });
      clones.forEach(c => { c.preds = c.preds.map(l => map[l.uid] != null ? { ...l, uid: map[l.uid] } : l); });
      pp.tasks.splice(at, 0, ...clones);
      tops.push(clones[0].uid);
      at += clones.length;
    }
  });
  if (tops.length) st.select(tops, tops[0]);
  return tops;
}

export function indent(dir: 1 | -1) {
  S().commit(p => {
    selectedBlocks(p).forEach(i => {
      const end = M.subtreeEnd(p, i), t = p.tasks[i];
      if (dir > 0 && (i === 0 || t.level > p.tasks[i - 1].level)) return;
      if (dir < 0 && t.level <= 1) return;
      for (let k = i; k < end; k++) p.tasks[k].level += dir;
    });
    M.normalizeLevels(p);
  });
}

export function move(dir: 1 | -1) {
  const st = S(), blocks = selectedBlocks(st.p);
  if (blocks.length !== 1) { st.toast('Select one task (or one summary) to move.'); return; }
  st.commit(p => {
    const i = blocks[0], end = M.subtreeEnd(p, i), lv = p.tasks[i].level;
    let k: number;
    if (dir < 0) {
      for (k = i - 1; k >= 0 && p.tasks[k].level > lv; k--);
      if (k < 0 || p.tasks[k].level !== lv) return false;
      const block = p.tasks.splice(i, end - i);
      p.tasks.splice(k, 0, ...block);
    } else {
      if (end >= p.tasks.length || p.tasks[end].level !== lv) return false;
      const end2 = M.subtreeEnd(p, end);
      const block = p.tasks.splice(i, end - i);
      p.tasks.splice(end2 - block.length, 0, ...block);
    }
  });
}

export function linkSelected() {
  const st = S(), ids = selIndexes(st.p);
  if (ids.length < 2) return;
  const link = (p: Project) => {
    for (let k = 1; k < ids.length; k++) {
      const a = p.tasks[ids[k - 1]], b = p.tasks[ids[k]];
      if (!b.preds.some(l => l.uid === a.uid)) b.preds.push({ uid: a.uid, type: 'FS', lag: 0 });
    }
  };
  if (wouldLoop(link)) { st.toast('Linking these tasks would create a dependency loop.', true); return; }
  st.commit(link);
}

export function unlinkSelected() {
  const st = S(), set = new Set(st.sel);
  st.commit(p => {
    p.tasks.forEach(t => {
      if (st.sel.length === 1 && set.has(t.uid)) t.preds = [];
      else if (set.has(t.uid)) t.preds = t.preds.filter(l => !set.has(l.uid));
    });
  });
}

export function deleteSelected() {
  const st = S(), blocks = selectedBlocks(st.p);
  if (!blocks.length) return;
  const uids: number[] = [];
  blocks.forEach(i => { for (let k = i; k < M.subtreeEnd(st.p, i); k++) uids.push(st.p.tasks[k].uid); });
  const run = () => { S().commit(p => { M.removeTasks(p, uids); }); S().select([]); };
  if (uids.length > 1) ask('Delete ' + uids.length + ' tasks (including subtasks)?', run, 'Delete');
  else run();
}

export function setPercent(uid: number, v: number) {
  const r = rowByUid(uid);
  if (!r) return;
  S().commit(p => {
    const t = findTask(p, uid);
    t.percent = v;
    if (v > 0 && !t.actualStart) t.actualStart = U.iso(r.startDn);
    if (v >= 100 && !t.actualFinish) t.actualFinish = U.iso(r.finishDn);
    if (v < 100) t.actualFinish = '';
    if (v === 0) t.actualStart = '';
  });
}

export function markPercent(v: number) {
  const st = S(), rows = st.sel.map(rowByUid).filter((r: any) => r && !r.summary);
  if (!rows.length) { st.toast('Select tasks first (summaries are updated from their subtasks).'); return; }
  st.commit(p => {
    rows.forEach((r: any) => {
      const t = findTask(p, r.task.uid);
      t.percent = v;
      if (v > 0 && !t.actualStart) t.actualStart = U.iso(r.startDn);
      if (v >= 100) { if (!t.actualFinish) t.actualFinish = U.iso(r.finishDn); } else t.actualFinish = '';
      if (v === 0) t.actualStart = '';
    });
  });
}

// Set progress on every task to what the plan says should be done by the status date.
export function updateAsScheduled() {
  const st = S(), s = st.s, statusIdx = s.cal.finishIndex(s.statusDn);
  let n = 0;
  st.commit(p => {
    s.rows.forEach((r: any) => {
      if (r.summary) return;
      const t = findTask(p, r.task.uid), sp = r.ef - r.es;
      let pct = sp > 0 ? Math.max(0, Math.min(1, (statusIdx - r.es) / sp)) : (statusIdx >= r.es ? 1 : 0);
      pct = Math.round(pct * 100);
      if (pct <= (+t.percent || 0)) return;
      t.percent = pct; n++;
      if (!t.actualStart) t.actualStart = U.iso(r.startDn);
      if (pct >= 100 && !t.actualFinish) t.actualFinish = U.iso(r.finishDn);
    });
  });
  st.toast(n ? 'Updated ' + n + ' tasks to ' + U.fmt(s.statusDn) : 'Nothing to update — tasks are already at or ahead of the status date.');
}

export function setBaseline() {
  const run = () => {
    const st = S();
    st.setUI({ showBaseline: true });
    st.commit(p => { OP.setBaseline(p); if (p.status === 'Draft') p.status = 'Baselined'; });
    st.toast('Baseline saved — variances and earned value are now measured against it');
  };
  if (S().p.baseline) ask('Replace the existing baseline with the current plan?', run, 'Replace');
  else run();
}

export function clearBaseline() {
  ask('Clear the baseline?', () => S().commit(p => { p.baseline = null; }), 'Clear');
}

export function levelAll() {
  const st = S();
  let res: any = null;
  st.commit(p => { res = OP.level(p); });
  if (!res || (!res.moved && !res.unresolved.length)) st.toast('No overallocations to level.');
  else if (res.unresolved.length) st.toast('Leveled ' + res.moved + ' tasks. Still overallocated: ' + res.unresolved.join(', ') + ' (assigned above max units, or on tasks that cannot move: started, in progress or Must start/finish on)', true);
  else st.toast('Leveled — delayed ' + res.moved + ' task' + (res.moved === 1 ? '' : 's'));
}

export function clearLeveling() { S().commit(p => { p.tasks.forEach(t => { t.levelDelay = 0; }); }); }

export function createRecurring(o: { name: string; duration: number; first: number; count: number; every: number; unit: string }) {
  const st = S(), cal = st.s.cal, ids = selIndexes(st.p);
  const pos = ids.length ? M.subtreeEnd(st.p, ids[ids.length - 1]) : st.p.tasks.length;
  const lvl = ids.length ? st.p.tasks[ids[ids.length - 1]].level : 1;
  let head = 0;
  st.commit(p => {
    const summary = M.newTask(p, { name: o.name, level: lvl, notes: 'Recurring: every ' + o.every + ' ' + o.unit + (o.every > 1 ? 's' : '') + ', ' + o.count + ' times' });
    head = summary.uid;
    const list = [summary];
    for (let k = 0; k < o.count; k++) {
      let dn: number;
      if (o.unit === 'week') dn = o.first + k * 7 * o.every;
      else if (o.unit === 'day') dn = cal.date(cal.indexOf(o.first) + k * o.every);
      else {
        // Clamp to the month's last day so "every month from 31 Jan" gives 28/29 Feb, not 3 Mar.
        const dt = U.toDate(o.first), y = dt.getUTCFullYear(), m = dt.getUTCMonth() + k * o.every;
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        dn = Math.round(Date.UTC(y, m, Math.min(dt.getUTCDate(), last)) / 864e5);
      }
      list.push(M.newTask(p, { name: o.name + ' ' + (k + 1), level: lvl + 1, duration: o.duration, milestone: o.duration === 0, constraint: 'SNET', constraintDate: U.iso(dn) }));
    }
    p.tasks.splice(pos, 0, ...list);
  });
  st.select([head], head);
}

export function addResource() {
  const st = S();
  let uid = 0;
  st.commit(p => {
    const r = M.newResource(p, { name: '', type: 'Full-time', reportsTo: p.resources.length ? p.resources[0].uid : null });
    uid = r.uid;
    p.resources.push(r);
  });
  st.setView('resources');
  focusKey('r' + uid + ':name');
}

// ---- Network diagram: manual node positions (persisted in project.netPos) ----

export function setNetPos(uid: number, x: number, y: number): boolean {
  const st = S();
  if (st.p.tasks.findIndex(t => t.uid === uid) < 0) return false;
  st.commit(p => {
    if (!p.netPos) p.netPos = {};
    p.netPos[uid] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
  });
  return true;
}

export function removeNetPos(uid: number) {
  const st = S();
  if (!st.p.netPos || !(uid in st.p.netPos)) return;
  st.commit(p => { delete p.netPos![uid]; });
}

export function resetNetLayout() {
  const st = S();
  if (!st.p.netPos || !Object.keys(st.p.netPos).length) return;
  st.commit(p => { p.netPos = {}; });
}
