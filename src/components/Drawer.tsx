import OP from '../core';
import { useApp, type Store } from '../store';
import * as ops from '../lib/taskOps';
import Field, { DateField } from './Field';
import Icon from './Icon';
import type { Project, Resource, Row, Task } from '../types';

const U = OP.util, M = OP.model;
const VIEWS = ['gantt', 'wbs'];

function Stat({ v, k }: { v: React.ReactNode; k: string }) { return <div className="stat"><b>{v}</b><span>{k}</span></div>; }
const varDays = (v: number) => (v > 0 ? '+' : '') + U.num(v) + 'd';

const defaultUnits = (res: Resource) => (res.kind === 'Work' ? Math.min(100, res.maxUnits) : res.kind === 'Material' ? 1 : 0);

function Opts({ map }: { map: Record<string, string> }) {
  return <>{Object.entries(map).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;
}

export default function Drawer() {
  const st = useApp();
  const t = st.sel.length === 1 ? st.p.tasks.find(x => x.uid === st.sel[0]) : null;
  const r = t ? st.s.rows.find((x: Row) => x.task.uid === t.uid) : undefined;
  if (!st.drawer || !t || !r || !VIEWS.includes(st.view)) return null;
  return (
    <aside className="drawer open">
      <div className="drawer-head">
        <h2>Task {r.id} <span className="muted small">· WBS {r.wbs}</span></h2>
        <button className="icon-btn" title="Close panel" aria-label="Close panel" onClick={() => st.setUI({ drawer: false })}><Icon name="x" /></button>
      </div>
      <div className="drawer-body"><TaskEditor st={st} t={t} r={r} /></div>
    </aside>
  );
}

// Task editor fields shared by the side drawer (Gantt/WBS) and the task details dialog (Network).
export function TaskEditor({ st, t, r }: { st: Store; t: Task; r: Row }) {
  const p = st.p, uid = t.uid, leaf = !r.summary, cur = p.currency;
  const edit = (fn: (t: Task, p: Project) => void | false) => st.commit(pp => fn(ops.findTask(pp, uid), pp));
  const set = (key: keyof Task, v: any) => edit(x => { (x as any)[key] = v; });
  const dated = t.constraint !== 'ASAP' && t.constraint !== 'ALAP';
  const unitLabel = (resUid: number) => {
    const res = p.resources.find(x => x.uid === resUid);
    return !res ? '' : res.kind === 'Material' ? (res.materialLabel || 'qty') : res.kind === 'Cost' ? cur : '%';
  };
  const rows = st.s.rows;
  const validPred = (x: Row) => {
    if (x.task.uid === uid) return false;
    for (let q = r.parent; q >= 0; q = rows[q].parent) if (q === x.i) return false;
    for (let q = x.parent; q >= 0; q = rows[q].parent) if (q === r.i) return false;
    return true;
  };
  const free = p.resources.filter(x => !t.assignments.some(a => a.res === x.uid));

  const setPredLink = (k: number, patch: Partial<Task['preds'][number]>) => {
    const next = { ...t.preds[k], ...patch };
    const trial: Project = U.clone(p);
    ops.findTask(trial, uid).preds[k] = next;
    if (OP.schedule(trial, { cycleOnly: true }).cycle.length) { st.toast('That link would create a dependency loop.', true); return; }
    edit(x => { x.preds[k] = next; });
  };
  const addPred = () => {
    const idx = M.indexByUid(p), i = idx[uid];
    for (let j = i - 1; j >= 0; j--) {
      const c = p.tasks[j];
      if (!M.isSummary(p, j) && !t.preds.some(l => l.uid === c.uid)) {
        const txt = M.formatPreds(p, t);
        ops.setPreds(uid, (txt ? txt + ', ' : '') + (idx[c.uid] + 1));
        return;
      }
    }
    st.toast('No earlier task available to link.');
  };

  return (
    <>
      <label className="field"><span>Name</span><Field className="inp" fk="d:name" value={t.name} onCommit={v => { set('name', v); }} /></label>
        {r.conflict && <div className="alert inline"><Icon name="alert" />{r.conflict}.</div>}
        {r.missedDeadline && <div className="alert inline"><Icon name="deadline" />Finishes {U.fmt(r.finishDn)}, after its deadline.</div>}

        {leaf && <>
          <div className="row3">
            <label className="field"><span>Duration</span><Field className="inp" fk="d:duration" value={M.fmtDuration(r.duration)} onCommit={v => {
              const d = M.parseDuration(v, p.hoursPerDay);
              if (d == null) { st.toast('Enter a duration like 5, 5d, 2w or 16h.', true); return false; }
              edit((x, pp) => { ops.setDuration(pp, x, d); });
            }} /></label>
            <label className="field"><span>Work (hours)</span><Field className="inp" fk="d:work" value={U.num(r.work)} onCommit={v => {
              const hrs = parseFloat(v);
              if (!isFinite(hrs)) return false;
              let err = '';
              edit((x, pp) => { err = ops.setWork(pp, x, hrs); if (err) return false; });
              if (err) { st.toast(err, true); return false; }
            }} /></label>
            <label className="field"><span>% complete</span><Field className="inp" type="number" min={0} max={100} step={5} fk="d:percent" value={String(t.percent || 0)}
              onCommit={v => ops.setPercent(uid, Math.max(0, Math.min(100, Math.round(+v || 0))))} /></label>
          </div>
          <div className="row3">
            <label className="field"><span>Task type</span><select className="sel" value={t.type} onChange={e => set('type', e.target.value)}><Opts map={M.TASK_TYPES} /></select></label>
            <label className="field"><span>Effort driven</span><label className="toggle" style={{ height: 24, padding: 0 }}><input type="checkbox" checked={t.effortDriven} onChange={e => set('effortDriven', e.target.checked)} />Yes</label></label>
            <label className="field"><span>Milestone</span><label className="toggle" style={{ height: 24, padding: 0 }}><input type="checkbox" checked={t.milestone} onChange={e => {
              const on = e.target.checked;
              edit(x => { x.milestone = on; x.duration = on ? 0 : (x.duration || 1); });
            }} />Yes</label></label>
          </div>
          <div className="row2">
            <label className="field"><span>Constraint</span><select className="sel" value={t.constraint} onChange={e => {
              const v = e.target.value;
              edit(x => {
                x.constraint = v;
                if (v === 'ASAP' || v === 'ALAP') x.constraintDate = '';
                else if (!x.constraintDate) x.constraintDate = U.iso(r.startDn);
              });
            }}><Opts map={M.CONSTRAINTS} /></select></label>
            <label className="field"><span>Constraint date</span><DateField className="inp" disabled={!dated} value={t.constraintDate}
              onCommit={v => { edit(x => { x.constraintDate = v; if (v && x.constraint === 'ASAP') x.constraint = 'SNET'; }); }} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Deadline</span><DateField className="inp" fk="d:deadline" value={t.deadline} onCommit={v => set('deadline', v)} /></label>
            <label className="field"><span>Priority (0–1000)</span><Field className="inp" type="number" min={0} max={1000} step={50} value={String(t.priority)}
              onCommit={v => { set('priority', Math.max(0, Math.min(1000, Math.round(+v || 0)))); }} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Actual start</span><DateField className="inp" value={t.actualStart} onCommit={v => {
              edit(x => { x.actualStart = v; if (!v) { x.percent = 0; x.actualFinish = ''; } });
            }} /></label>
            <label className="field"><span>Actual finish</span><DateField className="inp" value={t.actualFinish} onCommit={v => {
              edit(x => { x.actualFinish = v; if (v) { x.percent = 100; if (!x.actualStart) x.actualStart = U.iso(r.startDn); } else if (x.percent >= 100) x.percent = 99; });
            }} /></label>
          </div>
        </>}
        <div className="row2">
          <label className="field"><span>Fixed cost ({cur})</span><Field className="inp" type="number" min={0} step={1000} value={String(t.fixedCost || 0)}
            onCommit={v => { set('fixedCost', Math.max(0, +v || 0)); }} /></label>
          {!leaf && <label className="field"><span>Priority (0–1000)</span><Field className="inp" type="number" value={String(t.priority)}
            onCommit={v => { set('priority', Math.max(0, Math.min(1000, Math.round(+v || 0)))); }} /></label>}
        </div>

        <div className="stats">
          <Stat v={U.fmt(r.startDn)} k="Start" /><Stat v={U.fmt(r.finishDn)} k="Finish" /><Stat v={M.fmtDuration(r.duration)} k="Duration" />
          <Stat v={U.num(r.slack) + 'd'} k="Total slack" /><Stat v={leaf ? U.num(r.freeSlack) + 'd' : '—'} k="Free slack" />
          <Stat v={r.critical ? <span style={{ color: 'var(--critical-edge)' }}>Yes</span> : 'No'} k="Critical" />
          <Stat v={U.num(r.es) + ' / ' + U.num(r.ef)} k="ES / EF (day)" /><Stat v={U.num(r.ls) + ' / ' + U.num(r.lf)} k="LS / LF (day)" />
          <Stat v={U.num(r.work) + 'h'} k="Work" /><Stat v={U.money(r.cost)} k="Cost" /><Stat v={U.money(r.actualCost)} k="Actual cost" /><Stat v={r.percent + '%'} k="Complete" />
        </div>

        {r.base && <>
          <div className="section-title">Baseline</div>
          <div className="stats">
            <Stat v={U.fmt(r.base.startDn)} k="Baseline start" /><Stat v={U.fmt(r.base.finishDn)} k="Baseline finish" /><Stat v={U.money(r.base.cost)} k="Baseline cost" />
            <Stat v={varDays(r.startVar)} k="Start variance" /><Stat v={varDays(r.finishVar)} k="Finish variance" /><Stat v={U.money(r.costVar)} k="Cost variance" />
          </div>
        </>}
        {t.levelDelay > 0 && <>
          <div className="section-title">Leveling delay<button className="btn ghost" onClick={() => set('levelDelay', 0)}><Icon name="x" />Clear</button></div>
          <div className="muted small">Delayed {U.num(t.levelDelay)} working days to resolve a resource overallocation.</div>
        </>}

        <div className="section-title">Predecessors<button className="btn ghost" onClick={addPred}><Icon name="plus" />Add</button></div>
        <div className="mini-list">
          {!t.preds.length && <div className="muted small">No predecessors.</div>}
          {t.preds.map((l, k) => (
            <div className="mini-row pred" key={k}>
              <select className="sel" value={l.uid} onChange={e => setPredLink(k, { uid: +e.target.value })}>
                {rows.filter(validPred).map((x: Row) => <option key={x.task.uid} value={x.task.uid}>{x.id}. {x.task.name || '(unnamed)'}</option>)}
              </select>
              <select className="sel" value={l.type} title="Link type" onChange={e => setPredLink(k, { type: e.target.value as any })}>
                {M.LINK_TYPES.map((ty: string) => <option key={ty}>{ty}</option>)}
              </select>
              <Field className="inp" type="number" step={1} value={String(l.lag || 0)} title="Lag (days)" onCommit={v => { setPredLink(k, { lag: +v || 0 }); }} />
              <button className="icon-btn" aria-label="Remove" onClick={() => edit(x => { x.preds.splice(k, 1); })}><Icon name="x" /></button>
            </div>
          ))}
        </div>

        {leaf && <>
          <div className="section-title">Resources</div>
          <div className="mini-list">
            {t.assignments.map((a, k) => {
              const res = p.resources.find(x => x.uid === a.res);
              return (
                <div className="mini-row asg" key={k}>
                  <select className="sel" value={a.res} aria-label="Resource" onChange={e => {
                    const v = +e.target.value, nr = p.resources.find(x => x.uid === v);
                    if (!nr) return;
                    edit((x, pp) => { ops.changeAssignments(pp, x, () => { x.assignments[k] = { res: v, units: defaultUnits(nr) }; }); });
                  }}>
                    {p.resources.filter(x => x.uid === a.res || !t.assignments.some(b => b.res === x.uid)).map(x => <option key={x.uid} value={x.uid}>{(x.name || '(unnamed)') + (x.kind !== 'Work' ? ' (' + x.kind.toLowerCase() + ')' : '')}</option>)}
                  </select>
                  <label className="unit-inp"><Field className="inp" type="number" min={0} step={res && res.kind === 'Work' ? 5 : 1} value={String(a.units)}
                    onCommit={v => { edit((x, pp) => { ops.setUnits(pp, x, k, Math.max(0, +v || 0)); }); }} /><span>{unitLabel(a.res)}</span></label>
                  <button className="icon-btn" aria-label="Remove" onClick={() => edit((x, pp) => { ops.changeAssignments(pp, x, () => { x.assignments.splice(k, 1); }); })}><Icon name="x" /></button>
                </div>
              );
            })}
            {p.resources.length
              ? <select className="sel" data-fk="d:addres" value="" disabled={!free.length} onChange={e => {
                  const v = +e.target.value, res = p.resources.find(x => x.uid === v);
                  if (!res) return;
                  edit((x, pp) => { ops.changeAssignments(pp, x, () => { x.assignments.push({ res: v, units: defaultUnits(res) }); }); });
                }}>
                  <option value="">{free.length ? '+ Assign a resource…' : 'All resources assigned'}</option>
                  {free.map(x => <option key={x.uid} value={x.uid}>{x.name} — {x.kind === 'Work' ? (x.role || x.type) + ' (' + x.maxUnits + '%)' : x.kind}</option>)}
                </select>
              : <div className="muted small">Add people in the Resource Sheet first.</div>}
            <div className="muted small">Work: % of the person’s day · Material: quantity · Cost: amount.{t.effortDriven ? ' Effort driven: adding people shortens the task, total work stays the same.' : ''}</div>
          </div>

          {!t.milestone && t.duration > 1 && <>
            <div className="section-title">Split task<button className="btn ghost" onClick={() => edit(x => { x.splits.push({ at: Math.max(0.5, Math.floor(x.duration / 2)), gap: 2 }); })}><Icon name="plus" />Add split</button></div>
            <div className="mini-list">
              {!t.splits.length && <div className="muted small">Pause the work part-way through, e.g. while waiting for feedback.</div>}
              {t.splits.map((sp, k) => (
                <div className="mini-row split" key={k}>
                  <span className="muted small">After</span>
                  <Field className="inp" type="number" min={0.5} step={0.5} value={String(sp.at)} onCommit={v => { edit(x => { x.splits[k].at = Math.max(0.5, Math.min(x.duration - 0.5, +v || 0.5)); }); }} />
                  <span className="muted small">days, pause</span>
                  <Field className="inp" type="number" min={0.5} step={0.5} value={String(sp.gap)} onCommit={v => { edit(x => { x.splits[k].gap = Math.max(0.5, +v || 0.5); }); }} />
                  <span className="muted small">days{sp.at >= t.duration ? ' (after the task ends: ignored)' : ''}</span>
                  <button className="icon-btn" aria-label="Remove split" onClick={() => edit(x => { x.splits.splice(k, 1); })}><Icon name="x" /></button>
                </div>
              ))}
            </div>
          </>}
        </>}

        {p.customFields.length > 0 && <>
          <div className="section-title">Custom fields</div>
          {p.customFields.map(f => (
            <label className="field" key={f.id}><span>{f.name}</span>
              <Field className="inp" type={f.type === 'number' ? 'number' : 'text'} value={t.custom[f.id] == null ? '' : String(t.custom[f.id])}
                onCommit={v => { edit(x => { x.custom[f.id] = f.type === 'number' ? (v === '' ? '' : +v) : v; }); }} />
            </label>
          ))}
        </>}
        <label className="field"><span>Notes</span>
          <textarea className="inp" defaultValue={t.notes} key={uid + ':' + t.notes} onBlur={e => { if (e.target.value !== t.notes) set('notes', e.target.value); }} />
        </label>
    </>
  );
}

