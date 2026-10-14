import { useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent as RMouseEvent } from 'react';
import OP from '../core';
import { useApp, S, ask, focusKey, rowByUid, type Store } from '../store';
import { t } from '../i18n';
import { activeCols, colDef, gridItems, menuData, type GroupItem } from '../lib/grid';
import * as ops from '../lib/taskOps';
import Field, { DateField } from '../components/Field';
import Icon from '../components/Icon';
import ContextMenu, { type CtxItem } from '../components/ContextMenu';
import type { Row } from '../types';

const U = OP.util, M = OP.model, C = OP.charts;

// The chart element and its geometry, so ribbon commands can scroll it.
let chartEl: HTMLDivElement | null = null;
let chartGeom: any = null;

export function scrollToSelected() {
  const st = S();
  if (!chartEl || !chartGeom) return;
  const r = st.sel.length ? rowByUid(st.sel[0]) : null;
  chartEl.scrollLeft = Math.max(0, chartGeom.X(r ? r.startDn : st.s.startDn) - 60);
}

function taskUids(st: Store) { return gridItems(st).filter((x): x is Row => !(x as GroupItem).group).map(r => r.task.uid); }

function clickSelect(uid: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  const st = S();
  if (e.shiftKey && st.anchor != null) {
    const list = taskUids(st), a = list.indexOf(st.anchor), b = list.indexOf(uid);
    if (a >= 0 && b >= 0) { st.select(list.slice(Math.min(a, b), Math.max(a, b) + 1), st.anchor); return; }
  }
  if (e.ctrlKey || e.metaKey) {
    const next = st.sel.includes(uid) ? st.sel.filter(u => u !== uid) : st.sel.concat([uid]);
    st.select(next, uid);
    return;
  }
  st.select([uid], uid);
}

function navFrom(uid: number, field: string, dir: 1 | -1) {
  const list = taskUids(S()), i = list.indexOf(uid) + dir;
  if (i >= list.length) focusKey('new');
  else if (i >= 0) focusKey(list[i] + ':' + field);
}

/* ---------- cell commits ---------- */

function commitCell(k: string, uid: number, v: string): boolean | void {
  const st = S(), r = rowByUid(uid), c = colDef(st, k);
  if (!r || !c) return false;
  const edit = (fn: (t: any, p: any) => void | false) => st.commit(p => fn(ops.findTask(p, uid), p));
  if (k === 'name') { edit(t => { t.name = v; }); return; }
  if (k === 'preds') return ops.setPreds(uid, v);
  if (k === 'duration') {
    const d = M.parseDuration(v, st.p.hoursPerDay);
    if (d == null) { st.toast(t('Enter a duration like 5, 5d, 2w or 16h.'), true); return false; }
    edit((t, p) => { ops.setDuration(p, t, d); });
    return;
  }
  if (k === 'work') {
    const hrs = parseFloat(v.replace(/[^\d.]/g, ''));
    if (!isFinite(hrs)) { st.toast(t('Enter work in hours, e.g. 40.'), true); return false; }
    let err = '';
    edit((t, p) => { err = ops.setWork(p, t, hrs); if (err) return false; });
    if (err) { st.toast(err, true); return false; }
    return;
  }
  if (k === 'percent') { ops.setPercent(uid, Math.max(0, Math.min(100, Math.round(parseFloat(v) || 0)))); return; }
  if (c.edit === 'number') {
    edit(t => {
      t[c.field!] = Math.max(0, +v.replace(/[^\d.-]/g, '') || 0);
      if (c.field === 'priority') t.priority = Math.min(1000, Math.round(t.priority));
    });
    return;
  }
  if (c.cf) { edit(t => { t.custom[c.cf!] = c.edit === 'cfnum' ? (v === '' ? '' : +v || 0) : v; }); return; }
  if (c.field) {
    edit(t => {
      t[c.field!] = v;
      if (c.field === 'constraint' && (v === 'ASAP' || v === 'ALAP')) t.constraintDate = '';
      if (c.field === 'constraint' && v !== 'ASAP' && v !== 'ALAP' && !t.constraintDate) t.constraintDate = U.iso(r.startDn);
      if (c.field === 'constraintDate' && v && t.constraint === 'ASAP') t.constraint = 'SNET';
      if (c.field === 'actualFinish' && v) { t.percent = 100; if (!t.actualStart) t.actualStart = U.iso(r.startDn); }
    });
  }
}

/* ---------- timeline ---------- */

function Timeline({ st }: { st: Store }) {
  const s = st.s, span = Math.max(1, s.finishDn - s.startDn + 1);
  const pct = (dn: number) => Math.max(0, Math.min(100, (dn - s.startDn) / span * 100));
  const lanes: number[] = [];
  const phases = s.rows.filter((r: Row) => r.task.level === 1 && !r.milestone).map((r: Row) => {
    let lane = 0;
    while (lanes[lane] != null && lanes[lane] >= r.startDn) lane++;
    lanes[lane] = r.finishDn;
    const l = pct(r.startDn);
    return { r, lane, l, w: Math.max(0.8, pct(r.finishDn + 1) - l) };
  });
  // Lanes beyond the three styled ones stack below the track, which grows to fit them.
  const extra = Math.max(0, lanes.length - 3);
  const laneStyle = (lane: number) => (lane < 3 ? {} : { top: 57 + (lane - 3) * 18, height: 15 });
  const today = U.todayDn();
  const pick = (uid: number) => { st.select([uid], uid); requestAnimationFrame(scrollToSelected); };
  return (
    <div className="timeline">
      <div className="tl-inner">
        <div className="tl-date start">{t('Start')}<b>{U.fmtLong(s.startDn)}</b></div>
        <div className="tl-track" style={extra ? { height: 58 + extra * 18 } : undefined}>
          {phases.map(({ r, lane, l, w }: any) => (
            <div key={r.task.uid} className={'tl-seg lane' + (lane < 3 ? lane : 2)} style={{ left: l + '%', width: w + '%', ...laneStyle(lane) }}
              title={r.task.name + ': ' + U.fmt(r.startDn) + ' – ' + U.fmt(r.finishDn)} onClick={() => pick(r.task.uid)}>
              <span>{r.task.name}</span><small>{U.fmt(r.startDn)} – {U.fmt(r.finishDn)}</small>
            </div>
          ))}
          {s.rows.filter((r: Row) => r.milestone).map((r: Row) => (
            <div key={r.task.uid} className="tl-ms" style={{ left: pct(r.startDn + 1) + '%' }} title={r.task.name + ' — ' + U.fmt(r.startDn)} onClick={() => pick(r.task.uid)}><i /></div>
          ))}
          {today >= s.startDn && today <= s.finishDn && <div className="tl-today" style={{ left: pct(today) + '%' }} title={t('Today')} />}
        </div>
        <div className="tl-date finish">{t('Finish')}<b>{U.fmtLong(s.finishDn)}</b></div>
      </div>
    </div>
  );
}

/* ---------- grid ---------- */

function Indicators({ st, r }: { st: Store; r: Row }) {
  const task = r.task, out: JSX.Element[] = [];
  if (st.critical && r.critical && !r.summary) out.push(<span key="c" className="crit" title={t('On the critical path')}><Icon name="flag" /></span>);
  if (r.over) out.push(<span key="o" className="over" title={t('A resource on this task is overallocated')}><Icon name="alert" /></span>);
  if (r.conflict) out.push(<span key="x" className="crit" title={r.conflict}><Icon name="alert" /></span>);
  if (r.missedDeadline) out.push(<span key="d" className="crit" title={t('Finishes after its deadline')}><Icon name="deadline" /></span>);
  if (!r.summary && task.constraint !== 'ASAP') out.push(<span key="p" title={M.CONSTRAINTS[task.constraint] + (task.constraintDate ? ' ' + U.fmt(U.parseDate(task.constraintDate)) : '')}><Icon name="pin" /></span>);
  if (r.late && !r.summary) out.push(<span key="l" className="over" title={t('Behind schedule at the status date')}><Icon name="clock" /></span>);
  if (r.percent >= 100) out.push(<span key="k" className="done" title={t('Complete')}><Icon name="check" /></span>);
  if (task.levelDelay) out.push(<span key="v" title={t('Delayed {n}d by leveling', { n: U.num(task.levelDelay) })}><Icon name="balance" /></span>);
  if (task.notes) out.push(<span key="n" title={task.notes}><Icon name="note" /></span>);
  return <td className="ind"><span className="ind-icons">{out}</span></td>;
}

// Notes column: multi-line text wraps in the cell; click (or keyboard navigation) to edit.
function NotesCell({ st, r }: { st: Store; r: Row }) {
  const [edit, setEdit] = useState(false);
  const task = r.task, uid = task.uid;
  const focusSel = () => { if (!(st.sel.length === 1 && st.sel[0] === uid)) st.select([uid], uid); };
  if (edit) return (
    <td className="notes-cell" onBlur={() => setEdit(false)}>
      <Field className="cell notes" fk={uid + ':notes'} value={task.notes || ''} autoFocus spellCheck
        aria-label={t('Task {id} notes', { id: r.id })} onFocus={focusSel}
        onCommit={v => { commitCell('notes', uid, v); }}
        onNav={d => { setEdit(false); navFrom(uid, 'notes', d); }} />
    </td>
  );
  return (
    <td className="notes-cell" title={task.notes} onClick={e => { clickSelect(uid, e); setEdit(true); }}>
      <div className="notes-view">{task.notes || ''}</div>
      {/* Invisible anchor so keyboard navigation (focusKey) can reach this cell. */}
      <Field className="notes-ghost" fk={uid + ':notes'} value={task.notes || ''} tabIndex={-1} aria-hidden="true"
        onFocus={() => { focusSel(); setEdit(true); requestAnimationFrame(() => focusKey(uid + ':notes', false)); }}
        onCommit={() => {}} />
    </td>
  );
}

function Cell({ st, k, r, idx }: { st: Store; k: string; r: Row; idx: any }) {
  const c = colDef(st, k)!, task = r.task, uid = task.uid;
  const focusSel = () => { if (!(st.sel.length === 1 && st.sel[0] === uid)) st.select([uid], uid); };
  if (k === 'id') return <td className="id" onClick={e => clickSelect(uid, e)}>{r.id}</td>;
  if (k === 'ind') return <Indicators st={st} r={r} />;
  if (k === 'notes') return <NotesCell st={st} r={r} />;
  if (k === 'name') {
    const lvl = st.group !== 'none' ? 1 : task.level;
    return (
      <td>
        <div className="namecell" style={{ paddingLeft: (lvl - 1) * 16 + 4 }}>
          {r.summary && st.group === 'none'
            ? <button className="caret" aria-label={t('Expand or collapse')} onClick={() => st.setUI({ collapsed: { ...st.collapsed, [uid]: !st.collapsed[uid] } })}><Icon name={st.collapsed[uid] ? 'chevR' : 'chevD'} /></button>
            : <span className="caret none" />}
          <Field className="cell name" fk={uid + ':name'} value={task.name} placeholder={t('Task name')} spellCheck aria-label={t('Task {id} name', { id: r.id })}
            onFocus={focusSel} onCommit={v => commitCell('name', uid, v)} onNav={d => navFrom(uid, 'name', d)} />
        </div>
      </td>
    );
  }
  if (k === 'res') {
    return (
      <td className="ro linkish" title={r.summary ? '' : t('Click to assign resources')}
        onClick={() => { st.select([uid], uid); st.setUI({ drawer: true }); focusKey('d:addres', false); }}>
        {r.summary ? '' : r.names || (st.p.resources.length ? t('+ assign') : '')}
      </td>
    );
  }
  if (k === 'preds') {
    return <td><Field className="cell" fk={uid + ':preds'} value={M.formatPreds(st.p, task, idx)} spellCheck={false} aria-label={t('Task {id} predecessors', { id: r.id })}
      onFocus={focusSel} onCommit={v => commitCell('preds', uid, v)} onNav={d => navFrom(uid, 'preds', d)} /></td>;
  }
  const ro = !c.edit || (r.summary && c.sumRo);
  const fieldVal = c.field ? String((task as unknown as Record<string, unknown>)[c.field] ?? '') : '';
  const val = c.get ? c.get(r) : c.cf ? (task.custom[c.cf] == null ? '' : String(task.custom[c.cf])) : fieldVal;
  if (ro) return <td className={'ro' + (c.num ? ' num' : '')}>{val}</td>;
  const fk = uid + ':' + k, label = t('Task {id} {col}', { id: r.id, col: c.t });
  if (c.edit === 'date') return <td><DateField className="cell" fk={fk} value={fieldVal} aria-label={label} onFocus={focusSel} onCommit={v => { commitCell(k, uid, v); }} /></td>;
  if (c.edit === 'select') {
    const selVal = c.cf ? (task.custom[c.cf] == null ? '' : String(task.custom[c.cf])) : fieldVal;
    return <td><select className="cell" data-fk={fk} value={selVal} aria-label={label} onFocus={focusSel} onChange={e => commitCell(k, uid, e.target.value)}>
      {Object.entries(c.options!).map(([key, optLabel]) => <option key={key} value={key}>{optLabel}</option>)}
    </select></td>;
  }
  return <td><Field className={'cell' + (c.num ? ' num' : '')} fk={fk} value={val} spellCheck={false} aria-label={label}
    onFocus={focusSel} onCommit={v => commitCell(k, uid, v)} onNav={d => navFrom(uid, k, d)} /></td>;
}

function Grid({ st, list, onCtx }: { st: Store; list: (Row | GroupItem)[]; onCtx: (uid: number, x: number, y: number) => void }) {
  const ks = activeCols(st), idx = useMemo(() => M.indexByUid(st.p), [st.p]);
  const selSet = new Set(st.sel);
  return (
    <>
      <table className="grid">
        <colgroup>{ks.map(k => <col key={k} style={{ width: colDef(st, k)!.w }} />)}</colgroup>
        <thead><tr>{ks.map(k => <th key={k} className={colDef(st, k)!.num ? 'num' : undefined}>{colDef(st, k)!.t}</th>)}</tr></thead>
        <tbody>
          {list.map((item: any) => item.group
            ? (
              <tr key={item.key} className="grouprow"><td colSpan={ks.length}>
                <div className="namecell">
                  <button className="caret" onClick={() => st.setUI({ collapsed: { ...st.collapsed, [item.key]: !st.collapsed[item.key] } })}><Icon name={st.collapsed[item.key] ? 'chevR' : 'chevD'} /></button>
                  <b>{item.label}</b><span className="muted small">&nbsp;· {item.count === 1 ? t('{n} task', { n: item.count }) : t('{n} tasks', { n: item.count })} · {U.money(item.cost, st.p.currency)}</span>
                </div>
              </td></tr>
            )
            : (
              <tr key={item.task.uid} className={(selSet.has(item.task.uid) ? 'sel ' : '') + (item.summary ? 'summary' : '')}
                onContextMenu={e => { e.preventDefault(); onCtx(item.task.uid, e.clientX, e.clientY); }}>
                {ks.map(k => <Cell key={k} st={st} k={k} r={item} idx={idx} />)}
              </tr>
            ))}
          {st.filter === 'all' && st.group === 'none' && (
            <tr className="newrow">
              <td className="id">{st.p.tasks.length + 1}</td><td />
              <td><div className="namecell" style={{ paddingLeft: 4 }}><span className="caret none" />
                <Field className="cell" fk="new" value="" placeholder={t('Type a new task name and press Enter…')} spellCheck
                  onCommit={v => { if (v.trim()) ops.addTaskNamed(v.trim()); return false; }} onNav={() => focusKey('new', false)} />
              </div></td>
              <td colSpan={Math.max(1, ks.length - 3)} />
            </tr>
          )}
        </tbody>
      </table>
      {!st.p.tasks.length && <div className="empty"><h3>{t('No tasks yet')}</h3><div>{t('Type a task name in the row above, or load the sample from File › New.')}</div></div>}
      {!!st.p.tasks.length && !list.length && <div className="empty"><h3>{t('No matching tasks')}</h3><div>{t('Change the filter to see more tasks.')}</div></div>}
    </>
  );
}

/* ---------- chart drag editing ---------- */

let drag: any = {};

function onChartPointerDown(e: React.PointerEvent<HTMLDivElement>) {
  const gEl = (e.target as Element).closest('.gbar') as SVGGElement | null;
  if (!gEl || e.button !== 0 || !chartGeom) return;
  const uid = +gEl.dataset.uid!, r = rowByUid(uid), pos = chartGeom.pos[uid];
  if (!r || !pos || r.summary) return;
  const svg = chartEl!.querySelector('svg')!, rect = svg.getBoundingClientRect();
  const sx = e.clientX - rect.left, ns = 'http://www.w3.org/2000/svg';
  drag = { uid, r, x0: e.clientX, y0: e.clientY, mode: !r.milestone && sx > pos.e - 7 ? 'resize' : 'move', moved: false, svg, rect, pos, suppress: false };
  drag.ghost = document.createElementNS(ns, 'rect');
  drag.ghost.setAttribute('class', 'ghost');
  drag.ghost.setAttribute('x', pos.s); drag.ghost.setAttribute('y', pos.y - 7);
  drag.ghost.setAttribute('width', Math.max(pos.e - pos.s, 4)); drag.ghost.setAttribute('height', 14);
  drag.line = document.createElementNS(ns, 'line'); drag.line.setAttribute('class', 'ghostline');
  drag.tip = document.createElementNS(ns, 'text'); drag.tip.setAttribute('class', 'ghost-t');
  window.addEventListener('pointermove', dragMove);
  window.addEventListener('pointerup', dragEnd, { once: true });
}

function setTip(e: PointerEvent, text: string) {
  drag.tip.textContent = text;
  drag.tip.setAttribute('x', e.clientX - drag.rect.left + 12);
  drag.tip.setAttribute('y', e.clientY - drag.rect.top - 10);
}

function dragMove(e: PointerEvent) {
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
  if (!drag.moved) { drag.moved = true; drag.svg.append(drag.ghost, drag.line, drag.tip); }
  const g = chartGeom, pos = drag.pos, days = Math.round(dx / g.ppd);
  if (drag.mode !== 'resize' && Math.abs(dy) > C.ROW * 0.7) drag.mode = 'link';
  if (drag.mode === 'link') {
    drag.ghost.style.display = 'none';
    drag.line.setAttribute('x1', pos.e); drag.line.setAttribute('y1', pos.y);
    drag.line.setAttribute('x2', e.clientX - drag.rect.left); drag.line.setAttribute('y2', e.clientY - drag.rect.top);
    setTip(e, t('Link to…'));
  } else if (drag.mode === 'move') {
    const cal = S().s.cal;
    drag.ghost.setAttribute('x', pos.s + days * g.ppd);
    setTip(e, t('Start {date}', { date: U.fmt(cal.date(cal.indexOf(drag.r.startDn + days))) }));
  } else {
    const cal = S().s.cal, nf = Math.max(drag.r.startDn, drag.r.finishDn + days);
    drag.ghost.setAttribute('width', Math.max(g.ppd, pos.e - pos.s + days * g.ppd));
    setTip(e, t('Finish {date}', { date: U.fmt(Math.max(drag.r.startDn, cal.date(Math.max(0, cal.finishIndex(nf) - 1)))) }));
  }
}

function dragEnd(e: PointerEvent) {
  window.removeEventListener('pointermove', dragMove);
  if (!drag.moved) return;
  drag.suppress = true;
  [drag.ghost, drag.line, drag.tip].forEach((n: Element) => n.remove());
  const st = S(), r = drag.r, uid = drag.uid, cal = st.s.cal, days = Math.round((e.clientX - drag.x0) / chartGeom.ppd);
  if (drag.mode === 'link') {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gbar') as SVGGElement | null;
    const tu = target ? +target.dataset.uid! : 0;
    if (tu && ops.addLink(uid, tu)) st.toast(t('Linked {a} → {b} (finish-to-start)', { a: r.id, b: rowByUid(tu)!.id }));
  } else if (drag.mode === 'move') {
    if (!days) return;
    const ns = cal.date(cal.indexOf(r.startDn + days)), t0 = r.task;
    const shift = cal.indexOf(ns) - cal.indexOf(r.startDn);
    // Report when links keep the task from moving as far as it was dropped.
    const report = (msg: string) => {
      const after = rowByUid(uid);
      st.toast(after && after.startDn > ns ? t('{msg}. Its predecessors keep it from starting before {date}.', { msg, date: U.fmt(after.startDn) }) : msg);
    };
    if (t0.actualStart) {
      st.commit(p => { ops.findTask(p, uid).actualStart = U.iso(ns); });
      report(t('Actual start moved to {date}', { date: U.fmt(ns) }));
    } else if (t0.constraint === 'MSO' || t0.constraint === 'MFO') {
      // Hard constraints move with the bar instead of being replaced.
      st.commit(p => {
        const t = ops.findTask(p, uid), cd = U.parseDate(t.constraintDate);
        t.constraintDate = t.constraint === 'MSO' || cd == null ? U.iso(ns) : U.iso(cal.date(Math.max(0, cal.indexOf(cd) + shift)));
      });
      report(t('{constraint} date moved', { constraint: M.CONSTRAINTS[t0.constraint] }));
    } else {
      const apply = () => {
        S().commit(p => { const t = ops.findTask(p, uid); t.constraint = 'SNET'; t.constraintDate = U.iso(ns); });
        report(t('Start no earlier than {date}', { date: U.fmt(ns) }));
      };
      if (t0.constraint === 'ASAP' || t0.constraint === 'SNET') apply();
      else ask(t('Replace the “{constraint}” constraint with “Start no earlier than {date}”?', { constraint: M.CONSTRAINTS[t0.constraint], date: U.fmt(ns) }), apply, t('Replace'));
    }
  } else {
    if (!days) return;
    const nf = Math.max(r.startDn, r.finishDn + days);
    const gaps = (r.task.splits || []).reduce((a: number, sp: any) => a + (sp.at > 0 && sp.at < r.duration ? +sp.gap || 0 : 0), 0);
    const nd = Math.max(1, cal.finishIndex(nf) - cal.indexOf(r.startDn) - gaps);
    st.commit(p => { ops.setDuration(p, ops.findTask(p, uid), nd); });
  }
}

/* ---------- view ---------- */

export default function GanttView() {
  const st = useApp();
  const list = useMemo(() => gridItems(st), [st.s, st.filter, st.group, st.sort, st.collapsed]);
  const md = menuData(st);
  const gridRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [ctx, setCtx] = useState<{ uid: number; x: number; y: number } | null>(null);
  // Right-clicking a task row or bar: keep a multi-selection when the task is part of it.
  const openCtx = (uid: number, x: number, y: number) => {
    if (!st.sel.includes(uid)) st.select([uid], uid);
    setCtx({ uid, x, y });
  };
  const ctxItems = (uid: number): CtxItem[] => [
    { label: t('Copy'), icon: 'copy', onClick: () => ops.copyTasks(st.sel.includes(uid) ? st.sel : [uid]) },
    { label: t('Paste'), icon: 'paste', disabled: !ops.hasClip(), onClick: () => ops.pasteTasks(uid) },
    { hr: true },
    { label: t('Insert task before'), icon: 'plus', onClick: () => { const u = ops.addTaskNear(uid, 'before'); if (u) focusKey(u + ':name'); } },
    { label: t('Insert task after'), icon: 'plus', onClick: () => { const u = ops.addTaskNear(uid, 'after'); if (u) focusKey(u + ':name'); } },
    { label: t('Fill down (Ctrl+D)'), icon: 'down', onClick: () => ops.fillDown() },
    ...(st.sel.length > 1 ? [{ label: t('Batch edit {n} tasks…', { n: st.sel.length }), icon: 'settings', onClick: () => st.openDialog('batchedit', { uids: st.sel }) }] : []),
  ];

  const g = useMemo(() => C.gantt({
    p: st.p, s: st.s, rows: list, zoom: st.zoom, critical: st.critical, baseline: st.showBaseline && !!st.p.baseline
  }), [st.p, st.s, list, st.zoom, st.critical, st.showBaseline, st.lang]);
  chartGeom = g;

  // Selection highlight is drawn into the existing SVG so selecting does not rebuild the chart.
  useLayoutEffect(() => {
    const svg = chartEl?.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.gsel').forEach(n => n.remove());
    const before = svg.querySelector('.gbar'), w = svg.getAttribute('width') || '0';
    st.sel.forEach(uid => {
      const ps = g.pos[uid];
      if (!ps || !before) return;
      const rc = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rc.setAttribute('class', 'gsel');
      rc.setAttribute('x', '0'); rc.setAttribute('y', String(C.HDR + ps.row * C.ROW));
      rc.setAttribute('width', w); rc.setAttribute('height', String(C.ROW));
      svg.insertBefore(rc, before);
    });
  }, [g, st.sel]);

  const conflicts = st.s.rows.filter((r: Row) => r.conflict).length;
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    if (syncing.current) { syncing.current = false; return; }
    syncing.current = true;
    to.scrollTop = from.scrollTop;
  };

  const hide = st.ganttHide;
  const startSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget, split = el.parentElement!, grid = gridRef.current!;
    const x0 = e.clientX, total = split.clientWidth - el.offsetWidth;
    const w0 = hide === 'table' ? 0 : hide === 'chart' ? total : grid.offsetWidth;
    el.classList.add('drag');
    el.setPointerCapture(e.pointerId);
    // Dropping the splitter near an edge hides that pane.
    const at = (ev: PointerEvent) => {
      const w = Math.max(0, Math.min(total, w0 + ev.clientX - x0));
      const h: typeof hide = w < 80 ? 'table' : total - w < 120 ? 'chart' : 'none';
      return { h, w: Math.max(160, Math.min(2400, w)) };
    };
    const mv = (ev: PointerEvent) => { const { h, w } = at(ev); split.dataset.hide = h; if (h === 'none') grid.style.width = w + 'px'; };
    const up = (ev: PointerEvent) => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', mv);
      const { h, w } = at(ev), gridW = h === 'none' ? w : st.gridW;
      split.dataset.hide = h;
      grid.style.width = gridW + 'px';
      S().setUI({ ganttHide: h, gridW });
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
  };

  const onChartClick = (e: RMouseEvent<HTMLDivElement>) => {
    if (drag.suppress) { drag.suppress = false; return; }
    const b = (e.target as Element).closest('.gbar') as SVGGElement | null;
    if (b) clickSelect(+b.dataset.uid!, e);
  };

  return (
    <div className="view gantt-view">
      {st.timeline && st.p.tasks.length > 0 && <Timeline st={st} />}
      {st.s.cycle.length > 0 && <div className="alert"><Icon name="alert" />{t('Dependency loop between tasks {ids}. Remove one of the links to fix the schedule.', { ids: st.s.cycle.join(', ') })}</div>}
      {conflicts > 0 && st.filter !== 'conflicts' && (
        <div className="alert warn"><Icon name="alert" />{conflicts > 1
          ? t('{n} tasks have a constraint that conflicts with its links.', { n: conflicts })
          : t('{n} task has a constraint that conflicts with its links.', { n: conflicts })}{' '}
          <button className="linkbtn" onClick={() => st.setUI({ filter: 'conflicts' })}>{t('Show them')}</button></div>
      )}
      {(st.filter !== 'all' || st.group !== 'none') && (
        <div className="alert info"><Icon name="filter" />{st.group !== 'none'
          ? t('Showing: {filter}, grouped by {group}', { filter: md.filters[st.filter] || st.filter, group: md.groups[st.group] || st.group })
          : t('Showing: {filter}', { filter: md.filters[st.filter] || st.filter })}{' '}
          <button className="linkbtn" onClick={() => st.setUI({ filter: 'all', group: 'none' })}>{t('Show all tasks')}</button></div>
      )}
      <div className="split" data-hide={hide}>
        <div className="grid-pane" ref={gridRef} style={{ width: st.gridW }} onScroll={e => sync(e.currentTarget, chartEl)}
          onPaste={e => {
            // Multi-cell pastes from Excel (TSV/CSV) fill the grid; single-cell pastes go into the input.
            const text = e.clipboardData.getData('text/plain');
            if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
            const fk = (document.activeElement as HTMLElement | null)?.dataset?.fk || '';
            const m = /^(\d+):(.+)$/.exec(fk);
            if (!m) return;
            e.preventDefault();
            ops.pasteCells(text, +m[1], m[2]);
          }}>
          <Grid st={st} list={list} onCtx={openCtx} />
        </div>
        <div className="splitter" title={t('Drag to resize, or to either edge to hide a side')} onPointerDown={startSplit}>
          <div className="split-btns" onPointerDown={e => e.stopPropagation()}>
            {hide !== 'table' && (
              <button className="flip" title={hide === 'chart' ? t('Show the chart') : t('Hide the task table')} aria-label={hide === 'chart' ? t('Show the chart') : t('Hide the task table')}
                onClick={() => st.setUI({ ganttHide: hide === 'chart' ? 'none' : 'table' })}><Icon name="chevR" /></button>
            )}
            {hide !== 'chart' && (
              <button title={hide === 'table' ? t('Show the task table') : t('Hide the chart')} aria-label={hide === 'table' ? t('Show the task table') : t('Hide the chart')}
                onClick={() => st.setUI({ ganttHide: hide === 'table' ? 'none' : 'chart' })}><Icon name="chevR" /></button>
            )}
          </div>
        </div>
        <div className="chart-pane" ref={el => { chartEl = el; }}
          onScroll={e => sync(e.currentTarget, gridRef.current)}
          onClick={onChartClick}
          onDoubleClick={e => { if ((e.target as Element).closest('.gbar')) st.setUI({ drawer: true }); }}
          onContextMenu={e => {
            const b = (e.target as Element).closest('.gbar') as SVGGElement | null;
            if (!b) return;
            e.preventDefault();
            openCtx(+b.dataset.uid!, e.clientX, e.clientY);
          }}
          onKeyDown={e => {
            const b = (e.target as Element).closest('.gbar') as SVGGElement | null;
            if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); clickSelect(+b.dataset.uid!, e); st.setUI({ drawer: true }); }
          }}
          onPointerDown={onChartPointerDown}
          dangerouslySetInnerHTML={{ __html: g.svg + '<div style="height:' + C.ROW * 2 + 'px"></div>' }} />
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.uid)} onClose={() => setCtx(null)} />}
    </div>
  );
}
