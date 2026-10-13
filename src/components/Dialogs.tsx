import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import OP from '../core';
import { useStore, S, viewName } from '../store';
import { t } from '../i18n';
import * as ops from '../lib/taskOps';
import Icon from './Icon';
import { TaskEditor } from './Drawer';
import type { BoxCondition, BoxRule, BoxStyle, CustomField, Resource, Row } from '../types';
import { version } from '../../package.json';
import { projectFromTable } from '../lib/importTable';
import { shareUrl } from '../lib/share';
import { loadProject } from '../lib/actions';
import { printView } from '../lib/print';
import { toWbsDictionaryDoc } from '../lib/wbsdoc';
import type { PrintConfig, PrintSlot } from '../store';

const U = OP.util;
const STATUSES = ['Draft', 'In review', 'Approved', 'Baselined', 'Final'];

function Modal({ title, children, onSubmit, okLabel = t('Save'), cancelLabel = t('Cancel'), noOk, backdropClose, onClose }: {
  title: string; children: ReactNode; onSubmit?: (fd: FormData) => boolean | void; okLabel?: ReactNode; cancelLabel?: string; noOk?: boolean;
  backdropClose?: boolean; onClose?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Nested modals (a Modal rendered inside another Modal) must not close the whole dialog stack,
  // so the store-level close can be overridden per instance.
  const close = onClose ?? (() => S().closeDialog());
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
  }, []);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onSubmit && onSubmit(new FormData(e.currentTarget)) === false) return;
    close();
  };
  // The submit event of a form inside a modal <dialog> nested in another form never reaches
  // React's root listener, so the ok button submits programmatically instead of type="submit".
  const ok = () => {
    const form = ref.current?.querySelector('form');
    if (onSubmit && onSubmit(form ? new FormData(form) : new FormData()) === false) return;
    close();
  };
  const backdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (backdropClose && e.target === e.currentTarget) close();
  };
  return (
    <dialog ref={ref} onClose={close} onClick={backdrop} onCancel={e => { e.preventDefault(); close(); }}>
      <form onSubmit={submit}>
        <div className="dlg-head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label={t('Close')} onClick={close}><Icon name="x" /></button></div>
        <div className="dlg-body">{children}</div>
        <div className="dlg-foot">
          <button type="button" className="btn" onClick={close}>{cancelLabel}</button>
          {!noOk && <button type="button" className="btn primary" onClick={ok}>{okLabel}</button>}
        </div>
      </form>
    </dialog>
  );
}

function F({ label, name, value, type = 'text', ...rest }: { label: string; name: string; value?: any; type?: string; [k: string]: any }) {
  return <label className="field"><span>{label}</span><input className="inp" name={name} type={type} defaultValue={value ?? ''} {...rest} /></label>;
}

function parseDates(text: FormDataEntryValue | null, bad: string[]) {
  return String(text || '').split(/[\s,]+/).filter(Boolean).filter(d => {
    if (U.parseDate(d) == null) { bad.push(d); return false; }
    return true;
  });
}

function SettingsDialog() {
  const st = useStore(), p = st.p;
  // Fields keep their ids while being renamed, so task values stay with the right field.
  const [fields, setFields] = useState<CustomField[]>(() => p.customFields.map(f => ({ ...f })));
  const patchField = (k: number, patch: Partial<CustomField>) => setFields(fields.map((f, i) => (i === k ? { ...f, ...patch } : f)));
  const statuses = STATUSES.includes(p.status) || !p.status ? STATUSES : STATUSES.concat([p.status]);
  return (
    <Modal title={t('Project information')} onSubmit={fd => {
      const bad: string[] = [];
      const cfs = fields.map(f => ({ ...f, name: f.name.trim() })).filter(f => f.name);
      st.commit(pp => {
        pp.name = String(fd.get('name')).trim() || 'Untitled project';
        pp.organization = String(fd.get('organization'));
        pp.manager = String(fd.get('manager'));
        pp.status = String(fd.get('status'));
        pp.issueDate = String(fd.get('issueDate'));
        pp.start = String(fd.get('start')) || pp.start;
        pp.statusDate = String(fd.get('statusDate'));
        pp.hoursPerDay = Math.max(1, Math.min(24, +fd.get('hoursPerDay')! || 8));
        pp.budget = Math.max(0, +fd.get('budget')! || 0);
        pp.currency = String(fd.get('currency')).trim();
        pp.customFields = cfs;
        const keep = new Set(cfs.map(f => f.id));
        pp.tasks.forEach(t => { Object.keys(t.custom).forEach(id => { if (!keep.has(id)) delete t.custom[id]; }); });
      });
    }}>
      <F label={t('Project name')} name="name" value={p.name} />
      <div className="row2"><F label={t('Issuing organisation')} name="organization" value={p.organization} /><F label={t('Project manager')} name="manager" value={p.manager} /></div>
      <div className="row2">
        <label className="field"><span>{t('Status')}</span><select className="sel" name="status" defaultValue={p.status}>
          {statuses.map(s => <option key={s} value={s}>{t(s)}</option>)}
        </select></label>
        <F label={t('Date of issue')} name="issueDate" value={p.issueDate} type="date" />
      </div>
      <div className="row2"><F label={t('Project start date')} name="start" value={p.start} type="date" required /><F label={t('Status date (for tracking)')} name="statusDate" value={p.statusDate} type="date" /></div>
      <div className="row3">
        <F label={t('Budget')} name="budget" value={p.budget} type="number" min={0} step={1000} />
        <F label={t('Currency symbol')} name="currency" value={p.currency} />
        <F label={t('Hours per working day')} name="hoursPerDay" value={p.hoursPerDay} type="number" min={1} max={24} step={0.5} />
      </div>
      <p className="muted">{t('Holidays and working days are managed in Project › Change Working Time.')}</p>
      <div className="field"><span>{t('Custom task fields')}</span>
        <div className="mini-list">
          {fields.map((f, k) => (
            <div className="mini-row cf" key={f.id}>
              <input className="inp" aria-label={t('Field name')} placeholder={t('e.g. Owner')} value={f.name} onChange={e => patchField(k, { name: e.target.value })} />
              <select className="sel" aria-label={t('Field type')} value={f.type} onChange={e => patchField(k, { type: e.target.value as CustomField['type'] })}>
                <option value="text">{t('Text')}</option><option value="number">{t('Number')}</option>
              </select>
              <button type="button" className="icon-btn" aria-label={t('Remove field')} onClick={() => setFields(fields.filter((_, i) => i !== k))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setFields(fields.concat([{ id: 'c' + Date.now().toString(36) + fields.length, name: '', type: 'text' }]))}><Icon name="plus" />{t('Add field')}</button>
        </div>
      </div>
    </Modal>
  );
}

function RecurringDialog() {
  const st = useStore();
  return (
    <Modal title={t('Recurring task')} okLabel={t('Create')} onSubmit={fd => {
      const name = String(fd.get('name')).trim(), first = U.parseDate(String(fd.get('first')));
      if (!name || first == null) return false;
      ops.createRecurring({
        name, first, duration: Math.max(0, +fd.get('duration')! || 0),
        count: Math.max(1, Math.min(104, +fd.get('count')! || 1)), every: Math.max(1, +fd.get('every')! || 1), unit: String(fd.get('unit'))
      });
      st.setView('gantt');
    }}>
      <F label={t('Task name')} name="name" value="Sprint review" required />
      <div className="row3">
        <F label={t('Duration (days)')} name="duration" value={1} type="number" min={0} step={0.5} />
        <F label={t('First occurrence')} name="first" value={U.iso(st.s.startDn)} type="date" required />
        <F label={t('Occurrences')} name="count" value={4} type="number" min={1} max={104} />
      </div>
      <div className="row2">
        <label className="field"><span>{t('Repeat')}</span><select className="sel" name="unit" defaultValue="week">
          <option value="week">{t('Weekly')}</option><option value="month">{t('Monthly')}</option><option value="day">{t('Daily (working days)')}</option>
        </select></label>
        <F label={t('Every')} name="every" value={2} type="number" min={1} max={52} />
      </div>
      <p className="muted small">{t('Creates a summary task with one subtask per occurrence, each fixed with a “Start no earlier than” date.')}</p>
    </Modal>
  );
}

function ResourceDialog({ uid }: { uid: number }) {
  const st = useStore(), r = st.p.resources.find(x => x.uid === uid) as Resource;
  if (!r) return null;
  const rates = (r.rates || []).map(e => e.from + ' ' + e.rate).join('\n');
  return (
    <Modal title={r.name || t('Resource')} onSubmit={fd => {
      const bad: string[] = [];
      const vac = parseDates(fd.get('vacations'), bad);
      const rateList: { from: string; rate: number }[] = [];
      String(fd.get('rates') || '').split('\n').forEach(line => {
        const m = /^\s*(\d{4}-\d{2}-\d{2})[\s,;]+(\d+(?:\.\d+)?)\s*$/.exec(line);
        if (m) rateList.push({ from: m[1], rate: +m[2] });
        else if (line.trim()) bad.push(line.trim());
      });
      if (bad.length) st.toast(t('Ignored: {list}', { list: bad.join(', ') }), true);
      st.commit(p => {
        const x = p.resources.find(y => y.uid === uid)!;
        if (x.kind === 'Work') {
          x.workDays = fd.getAll('wd').map(Number).sort();
          x.vacations = vac;
          x.rates = rateList.sort((a, b) => (a.from < b.from ? -1 : 1));
        }
        if (x.kind === 'Material') x.materialLabel = String(fd.get('materialLabel') || '');
        if (x.kind !== 'Cost') x.costPerUse = Math.max(0, +fd.get('costPerUse')! || 0);
      });
    }}>
      {r.kind === 'Work' && <>
        <label className="field"><span>{t('Working days')}</span><div className="chk-row">
          {[1, 2, 3, 4, 5, 6, 0].map(d => <label key={d} className="chk"><input type="checkbox" name="wd" value={d} defaultChecked={r.workDays.includes(d)} />{t(U.DAYS[d])}</label>)}
        </div></label>
        <label className="field"><span>{t('Vacations / days off (one date per line, YYYY-MM-DD)')}</span><textarea className="inp" name="vacations" rows={3} defaultValue={r.vacations.join('\n')} /></label>
        <label className="field"><span>{t('Rate changes (one per line: effective date and new hourly rate)')}</span><textarea className="inp" name="rates" rows={3} placeholder="2026-04-01 8500" defaultValue={rates} /></label>
        <p className="muted small">{t('Working days and vacations set when this person is available: they drive overallocation warnings and resource leveling.')}</p>
      </>}
      {r.kind === 'Material' && <F label={t('Material label (unit)')} name="materialLabel" value={r.materialLabel} placeholder={t('e.g. licences, servers')} />}
      {r.kind !== 'Cost'
        ? <F label={t('Cost per use ({currency})', { currency: st.p.currency })} name="costPerUse" value={r.costPerUse} type="number" min={0} step={100} />
        : <p className="muted">{t('Cost resources (travel, licences, fees) have no rate: enter the amount on each task assignment.')}</p>}
    </Modal>
  );
}

const SHORTCUTS: [ReactNode, string][] = [
  [<><kbd>Enter</kbd> <kbd>↑</kbd> <kbd>↓</kbd></>, 'Move between rows'],
  [<><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd> / <kbd>←</kbd></>, 'Indent / outdent'],
  [<kbd>Ins</kbd>, 'Insert a new task'],
  [<kbd>Del</kbd>, 'Delete the selected tasks'],
  [<><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></>, 'Undo / redo'],
  [<><kbd>Ctrl</kbd>+<kbd>S</kbd></>, 'Save to a file']
];

function AboutDialog() {
  return (
    <Modal title={t('About OpenPlan')} cancelLabel={t('Close')} noOk>
      <div className="about-head">
        <img src="./assets/OpenPlan.png" alt="" width={44} height={44} />
        <div><h3>OpenPlan</h3><span className="muted">{t('Version {version} · Free, browser-based project planning', { version })}</span></div>
      </div>
      <p>{t('Plan with a WBS, Gantt chart, critical path, network diagram, resources, leveling, baselines, tracking, earned value, budget and reports. Your project is saved automatically in this browser only; use')} <b>{t('File › Save')}</b> {t('to keep a copy as an .openplan file.')}</p>
      <section className="about-sec">
        <h4>{t('Keyboard shortcuts')}</h4>
        <table className="about-keys"><tbody>{SHORTCUTS.map(([keys, action]) => <tr key={action}><td>{keys}</td><td>{t(action)}</td></tr>)}</tbody></table>
      </section>
      <section className="about-sec">
        <h4>{t('Tips')}</h4>
        <dl className="about-tips">
          <dt>{t('Rename the project')}</dt><dd>{t('Click the name in the title bar.')} <kbd>Enter</kbd> {t('saves')}, <kbd>Esc</kbd> {t('cancels')}.</dd>
          <dt>{t('Gantt chart')}</dt><dd>{t('Drag a bar to move it (sets a “Start no earlier than” constraint), drag its right edge to change the duration, or drag it onto another bar to link the two.')}</dd>
          <dt>{t('Predecessors')}</dt><dd>{t('Type task IDs separated by commas. Link types are FS (default), SS, FF and SF, with optional lag, e.g.')} <code>3, 5SS+2d, 7FF-1d</code>.</dd>
        </dl>
      </section>
      <p className="about-foot muted">{t('Open source under the')} <a href="https://github.com/MNSBaanu/OpenPlan/blob/main/LICENSE" target="_blank" rel="noreferrer">{t('MIT License')}</a> · <a href="https://github.com/MNSBaanu/OpenPlan" target="_blank" rel="noreferrer">{t('Source on GitHub')}</a> · {t('Made by MNS Baanu')}</p>
    </Modal>
  );
}

function ImportDialog() {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => {
    if (!text.trim()) return null;
    try { return projectFromTable(text); } catch (e: any) { return { error: e.message as string }; }
  }, [text]);
  const ok = result && 'project' in result ? result : null;
  const pickFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { S().toast(t('That file is larger than 5 MB. Choose a CSV task list.'), true); return; }
    setText(await file.text());
  };
  return (
    <Modal title={t('Import tasks from Excel or CSV')} okLabel={t('Import')} onSubmit={() => {
      if (!ok) return false;
      loadProject(ok.project, t(ok.tasks > 1 ? 'Imported {count} tasks' : 'Imported {count} task', { count: ok.tasks }) + (ok.warnings.length ? '. ' + ok.warnings.join('; ') + '.' : ''));
    }}>
      <p>{t('Copy the task list in Excel or Google Sheets and paste it below, or choose a CSV file. Columns are matched by their headings: Task Name, Duration, Predecessors, Resources, Level or WBS, % Complete and Notes. Without headings, the columns are read as task name, duration and predecessors.')}</p>
      <textarea className="inp mono" id="import-text" rows={9} value={text} onChange={e => setText(e.target.value)} aria-label={t('Task list')}
        placeholder={['Task Name, Duration, Predecessors', 'Design, 5', 'Build, 10, 1', 'Launch, 0, 2'].join('\n')} />
      <div className="row-actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" />{t('Choose CSV file…')}</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={e => pickFile(e.target.files?.[0])} />
      </div>
      {ok && <p className="muted">{t('Found {tasks} task(s) and {resources} resource(s). Importing replaces the current plan, which you can bring back from File › Open › Restore Previous Project.', { tasks: ok.tasks, resources: ok.resources })}</p>}
      {ok && ok.warnings.length > 0 && <p className="alert warn inline">{ok.warnings.join('; ')}.</p>}
      {result && 'error' in result && <p className="alert inline">{result.error}</p>}
    </Modal>
  );
}

function ShareDialog() {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { shareUrl(S().p).then(setUrl, (e: Error) => setError(e.message)); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); S().toast(t('Share link copied')); }
    catch { inputRef.current?.select(); S().toast(t('Press Ctrl+C to copy the selected link.')); }
  };
  return (
    <Modal title={t('Share a copy of this plan')} cancelLabel={t('Close')} noOk>
      <p>{t('Anyone who opens this link gets their own copy of the plan in their browser. Their changes don’t affect yours. The plan travels inside the link and is never uploaded.')}</p>
      <div className="share-row">
        <input ref={inputRef} className="inp" id="share-url" readOnly value={url || t('Creating link…')} aria-label={t('Share link')} onFocus={e => e.target.select()} />
        <button type="button" className="btn primary" disabled={!url} onClick={copy}><Icon name="link" />{t('Copy link')}</button>
      </div>
      {url && <p className="muted small">{t('Link length: {kb} KB.', { kb: Math.ceil(url.length / 1024) })}{url.length > 8000 ? ' ' + t('Some chat and email apps cut off long links; if it does not open, send the .openplan file instead.') : ''}</p>}
      {error && <p className="alert inline">{t('Could not create the link: {error}', { error })}</p>}
    </Modal>
  );
}

function ConfirmDialog({ title, message, okLabel, onOk }: { title: string; message: string; okLabel: string; onOk: () => void }) {
  return (
    <Modal title={title} okLabel={okLabel} onSubmit={() => { S().closeDialog(); onOk(); return false; }}>
      <p className="confirm-msg">{message}</p>
    </Modal>
  );
}

function TaskDialog({ uid }: { uid: number }) {
  const st = useStore();
  const task = st.p.tasks.find(x => x.uid === uid);
  const r = task ? st.s.rows.find((x: Row) => x.task.uid === task.uid) : undefined;
  if (!task || !r) return null;
  // Edits commit immediately through the store, exactly like the side drawer.
  // onSubmit returns false so an accidental form submit (Enter) cannot close the dialog.
  return (
    <Modal title={t('Task {id} · WBS {wbs}', { id: r.id, wbs: r.wbs })} cancelLabel={t('Close')} noOk backdropClose onSubmit={() => false}>
      <TaskEditor st={st} t={task} r={r} />
    </Modal>
  );
}

/* ---------- Multi-task batch edit (PRD M2-7) ---------- */

const MULTI = '(multiple values)';

function BatchEditDialog({ uids }: { uids: number[] }) {
  const st = useStore();
  const M = OP.model;
  const tasks = st.p.tasks.filter(t => uids.includes(t.uid));
  const rowBy = useMemo(() => new Map(st.s.rows.map((r: Row) => [r.task.uid, r])), [st.s.rows]);
  // The shared value of a field, or null when the selected tasks differ.
  const common = (get: (t: typeof tasks[number]) => string): string | null => {
    const v = get(tasks[0]);
    return tasks.every(t => get(t) === v) ? v : null;
  };
  const init = {
    duration: common(t => M.fmtDuration(t.duration)),
    start: common(t => (t.constraint === 'SNET' ? t.constraintDate : '')),
    finish: common(t => (t.constraint === 'FNLT' ? t.constraintDate : '')),
    percent: common(t => String(t.percent || 0)),
    priority: common(t => String(t.priority)),
    type: common(t => t.type),
    milestone: common(t => (t.milestone ? 'yes' : 'no')),
    res: '',
    notes: common(t => t.notes || ''),
  };
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v ?? ''])));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = (k: string, v: string) => { setF(o => ({ ...o, [k]: v })); setTouched(o => ({ ...o, [k]: true })); };
  // Fields the tasks disagree on start empty with a "(multiple values)" placeholder.
  const ph = (k: keyof typeof init) => (init[k] == null ? t(MULTI) : '');

  const save = () => {
    let changed = 0, skipped = 0, invalid = false;
    st.commit(p => {
      tasks.forEach(t => {
        const x = ops.findTask(p, t.uid);
        const summary = !!rowBy.get(t.uid)?.summary;
        // Scheduling fields (duration, start/finish constraints, assignments) are computed
        // for summary tasks, so they are skipped and reported in the toast.
        const sched = (apply: () => void) => { if (summary) skipped++; else { apply(); changed++; } };
        if (touched.duration) sched(() => {
          const d = M.parseDuration(f.duration, p.hoursPerDay);
          if (d == null) { invalid = true; return; }
          ops.setDuration(p, x, d);
        });
        if (touched.start && f.start) sched(() => { x.constraint = 'SNET'; x.constraintDate = f.start; });
        if (touched.finish && f.finish) sched(() => { x.constraint = 'FNLT'; x.constraintDate = f.finish; });
        if (touched.percent) { x.percent = Math.max(0, Math.min(100, Math.round(+f.percent || 0))); changed++; }
        if (touched.priority) { x.priority = Math.max(0, Math.min(1000, Math.round(+f.priority || 0))); changed++; }
        if (touched.type && f.type) { x.type = f.type as typeof x.type; changed++; }
        if (touched.milestone) {
          const on = f.milestone === 'yes';
          if (x.milestone !== on) { x.milestone = on; if (on) x.duration = 0; else if (!x.duration) x.duration = 1; changed++; }
        }
        if (touched.res) sched(() => {
          if (f.res === '__clear__') { ops.changeAssignments(p, x, () => { x.assignments = []; }); }
          else {
            const res = p.resources.find(r => String(r.uid) === f.res);
            if (res && !x.assignments.some(a => a.res === res.uid)) {
              ops.changeAssignments(p, x, () => { x.assignments.push({ res: res.uid, units: 1 }); });
            }
          }
        });
        if (touched.notes) { x.notes = f.notes; changed++; }
      });
    });
    if (invalid) { st.toast(t('Some values were invalid and not applied.'), true); return false; }
    st.toast(t('Updated {count} task(s)', { count: tasks.length }) + (skipped ? ' · ' + t('{count} summary field(s) skipped', { count: skipped }) : ''));
  };

  const num = (k: keyof typeof init, extra: any) =>
    <input className="inp" type="number" value={f[k]} placeholder={ph(k)} onChange={e => set(k, e.target.value)} {...extra} />;

  return (
    <Modal title={t('Edit {count} tasks', { count: tasks.length })} okLabel={t('Apply to all')} onSubmit={save}>
      <p className="muted">{t('Only fields you change are applied to every selected task in one undoable step. Fields the tasks disagree on show')} <em>{t(MULTI)}</em>{t('; typing a value overwrites all of them. Start / finish set scheduling constraints (start-no-earlier-than / finish-no-later-than).')}</p>
      <div className="row3">
        <label className="field"><span>{t('Duration')}</span>
          <input className="inp" value={f.duration} placeholder={ph('duration')} onChange={e => set('duration', e.target.value)} /></label>
        <label className="field"><span>{t('Start')}</span>
          <input className="inp" type="date" value={f.start} onChange={e => set('start', e.target.value)} /></label>
        <label className="field"><span>{t('Finish')}</span>
          <input className="inp" type="date" value={f.finish} onChange={e => set('finish', e.target.value)} /></label>
      </div>
      <div className="row3">
        <label className="field"><span>{t('% complete')}</span>{num('percent', { min: 0, max: 100, step: 5 })}</label>
        <label className="field"><span>{t('Priority (0–1000)')}</span>{num('priority', { min: 0, max: 1000, step: 50 })}</label>
        <label className="field"><span>{t('Task type')}</span>
          <select className="sel" value={f.type} onChange={e => set('type', e.target.value)}>
            <option value="">{ph('type') || t('Fixed units')}</option>
            {Object.entries(M.TASK_TYPES).map(([k, v]) => <option key={k} value={k}>{t(String(v))}</option>)}
          </select></label>
      </div>
      <div className="row3">
        <label className="field"><span>{t('Milestone')}</span>
          <select className="sel" value={touched.milestone ? f.milestone : ''} onChange={e => set('milestone', e.target.value)}>
            <option value="">{ph('milestone') || t('no')}</option>
            <option value="yes">{t('Yes')}</option>
            <option value="no">{t('No')}</option>
          </select></label>
        <label className="field"><span>{t('Resource')}</span>
          <select className="sel" value={f.res} onChange={e => set('res', e.target.value)}>
            <option value="">{t('Leave unchanged')}</option>
            <option value="__clear__">{t('Remove all assignments')}</option>
            {st.p.resources.map(r => <option key={r.uid} value={String(r.uid)}>{t('Assign: {name}', { name: r.name || t('(unnamed)') })}</option>)}
          </select></label>
        <label className="field"><span>{t('Notes')}</span>
          <input className="inp" value={f.notes} placeholder={ph('notes')} onChange={e => set('notes', e.target.value)} /></label>
      </div>
    </Modal>
  );
}

const WBS_BOX_ROWS: { key: string; label: string }[] = [
  { key: 'wbs', label: 'WBS code' },
  { key: 'start', label: 'Start date' },
  { key: 'finish', label: 'Finish date' },
  { key: 'duration', label: 'Duration' },
  { key: 'percent', label: '% complete' },
  { key: 'resources', label: 'Resources' },
  { key: 'preds', label: 'Predecessors' },
  { key: 'notes', label: 'Notes (only when present)' },
];

function WbsBoxDialog() {
  const st = useStore();
  const [rows, setRows] = useState<string[]>(st.wbsBox);
  const toggle = (k: string) => setRows(r => (r.includes(k) ? r.filter(x => x !== k) : [...r, k]));
  return (
    <Modal title={t('WBS box content')} okLabel={t('Apply')} onSubmit={() => { st.setUI({ wbsBox: rows }); }}>
      <p className="muted">{t('Choose which info lines each WBS box shows below the task name. The name is always shown.')}</p>
      <div className="chk-list">
        {WBS_BOX_ROWS.map(r => (
          <label key={r.key} className="chk"><input type="checkbox" checked={rows.includes(r.key)} onChange={() => toggle(r.key)} />{t(r.label)}</label>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Working-time calendar (PRD M8) ---------- */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function CalendarDialog() {
  const st = useStore();
  const c = st.p.calendar || { workingDays: [1, 2, 3, 4, 5], workTimes: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], exceptions: [] };
  const [days, setDays] = useState<number[]>(c.workingDays);
  const [times, setTimes] = useState<{ start: string; end: string }[]>(c.workTimes.map(w => ({ ...w })));
  const [excs, setExcs] = useState<{ date: string; working: boolean; reason: string }[]>(c.exceptions.map(e => ({ ...e })));
  const toggleDay = (d: number) => setDays(ds => (ds.includes(d) ? ds.filter(x => x !== d) : ds.concat([d]).sort((a, b) => a - b)));
  const hours = times.reduce((s, w) => s + Math.max(0, (+w.end.slice(0, 2) * 60 + +w.end.slice(3)) - (+w.start.slice(0, 2) * 60 + +w.start.slice(3))) / 60, 0);
  return (
    <Modal title={t('Change working time')} okLabel={t('Apply')} onSubmit={() => {
      if (!days.length) { st.toast(t('The calendar needs at least one working day'), true); return false; }
      if (!times.length || times.some(w => !w.start || !w.end || w.end <= w.start)) { st.toast(t('Each work time range needs an end after its start'), true); return false; }
      if (excs.some(e => !e.date)) { st.toast(t('Exception dates cannot be empty'), true); return false; }
      st.commit(pp => {
        pp.calendar = { workingDays: days, workTimes: times.map(w => ({ start: w.start, end: w.end })), exceptions: excs.map(e => ({ date: e.date, working: e.working, reason: e.reason })) };
      });
      st.toast(t('Working time updated — schedule recalculated'));
    }}>
      <p className="muted">{t('Working days drive the schedule: durations count working days only, and the Gantt chart shades non-working days.')}</p>
      <div className="field"><span>{t('Working days')}</span>
        <div className="chk-list cal-days">
          {DAY_NAMES.map((n, d) => <label key={d} className="chk"><input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />{t(n)}</label>)}
        </div>
      </div>
      <div className="field"><span>{t('Work times per working day ({hours} h/day)', { hours: hours.toFixed(1) })}</span>
        <div className="mini-list">
          {times.map((w, i) => (
            <div className="mini-row" key={i}>
              <input className="inp" type="time" aria-label={t('Start time')} value={w.start}
                onChange={e => setTimes(times.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} />
              <span className="muted">{t('to')}</span>
              <input className="inp" type="time" aria-label={t('End time')} value={w.end}
                onChange={e => setTimes(times.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label={t('Remove time range')} disabled={times.length <= 1}
                onClick={() => setTimes(times.filter((_, k) => k !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setTimes(times.concat([{ start: '18:00', end: '22:00' }]))}><Icon name="plus" />{t('Add time range')}</button>
        </div>
      </div>
      <div className="field"><span>{t('Exceptions (holidays and make-up work days)')}</span>
        <div className="mini-list">
          {excs.map((e, i) => (
            <div className="mini-row" key={i}>
              <input className="inp" type="date" aria-label={t('Date')} value={e.date}
                onChange={ev => setExcs(excs.map((x, k) => (k === i ? { ...x, date: ev.target.value } : x)))} />
              <select className="sel" aria-label={t('Type')} value={e.working ? 'work' : 'off'}
                onChange={ev => setExcs(excs.map((x, k) => (k === i ? { ...x, working: ev.target.value === 'work' } : x)))}>
                <option value="off">{t('Non-working day')}</option>
                <option value="work">{t('Working day')}</option>
              </select>
              <input className="inp" aria-label={t('Reason')} placeholder={t('e.g. National Day')} value={e.reason}
                onChange={ev => setExcs(excs.map((x, k) => (k === i ? { ...x, reason: ev.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label={t('Remove exception')}
                onClick={() => setExcs(excs.filter((_, k) => k !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setExcs(excs.concat([{ date: '', working: false, reason: '' }]))}><Icon name="plus" />{t('Add exception')}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Box style rules (PRD M14) ---------- */

const BS_PALETTE = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#78716c', '#334155', '#ffffff'];
const BS_MAX = 50;

const BS_FIELDS: { key: string; label: string; kind: 'bool' | 'num' | 'str' | 'type' | 'res' | 'constraint' }[] = [
  { key: 'isCritical', label: 'Critical', kind: 'bool' },
  { key: 'percentComplete', label: '% complete', kind: 'num' },
  { key: 'level', label: 'Outline level', kind: 'num' },
  { key: 'duration', label: 'Duration (working days)', kind: 'num' },
  { key: 'type', label: 'Task type', kind: 'type' },
  { key: 'resourceId', label: 'Resource', kind: 'res' },
  { key: 'constraintType', label: 'Constraint', kind: 'constraint' },
  { key: 'hasDeadline', label: 'Has deadline', kind: 'bool' },
  { key: 'milestone', label: 'Milestone', kind: 'bool' },
  { key: 'summary', label: 'Summary task', kind: 'bool' },
  { key: 'name', label: 'Name', kind: 'str' },
  { key: 'notes', label: 'Notes', kind: 'str' },
];

const BS_OPS: Record<string, { key: string; label: string; noValue?: boolean }[]> = {
  bool: [{ key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' }],
  num: [{ key: 'eq', label: '=' }, { key: 'neq', label: '≠' }, { key: 'gt', label: '>' }, { key: 'gte', label: '≥' }, { key: 'lt', label: '<' }, { key: 'lte', label: '≤' }],
  str: [{ key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' }, { key: 'contains', label: 'contains' }, { key: 'isEmpty', label: 'is empty', noValue: true }, { key: 'isNotEmpty', label: 'is not empty', noValue: true }],
  res: [{ key: 'eq', label: 'is assigned to' }, { key: 'neq', label: 'is not assigned to' }, { key: 'contains', label: 'name contains', noValue: false }, { key: 'isEmpty', label: 'has no resource', noValue: true }, { key: 'isNotEmpty', label: 'has a resource', noValue: true }],
  type: [{ key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' }],
  constraint: [{ key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' }],
};

const fieldOf = (key: string) => BS_FIELDS.find(f => f.key === key)!;
const opsOf = (key: string) => BS_OPS[fieldOf(key).kind];

function valueLabel(c: BoxCondition, p: { resources: Resource[] }): string {
  const f = fieldOf(c.field);
  switch (f.kind) {
    case 'bool': return c.value ? t('yes') : t('no');
    case 'res': {
      const r = p.resources.find(x => x.uid === c.value);
      return r ? r.name : String(c.value ?? '');
    }
    case 'type': return { FixedUnits: t('Fixed units'), FixedWork: t('Fixed work'), FixedDuration: t('Fixed duration') }[String(c.value)] || String(c.value ?? '');
    case 'constraint': return String(c.value || 'ASAP');
    default: return String(c.value ?? '');
  }
}

function condSummary(rule: BoxRule, p: { resources: Resource[] }): string {
  if (!rule.conditions.length) return t('All tasks');
  return rule.conditions.map(c => {
    const op = (opsOf(c.field) || []).find(o => o.key === c.op);
    const label = op ? op.label : c.op;
    return op?.noValue ? `${t(fieldOf(c.field).label)} ${t(label)}` : `${t(fieldOf(c.field).label)} ${t(label)} ${valueLabel(c, p)}`;
  }).join(t(' and '));
}

function previewStyle(st: BoxStyle): CSSProperties {
  const css: React.CSSProperties = {};
  if (st.fillColor) css.background = st.fillColor === 'transparent' ? 'transparent' : st.fillColor;
  css.border = `${st.borderWidth || 1}px ${st.borderDash === 'dashed' ? 'dashed' : st.borderDash === 'dotted' ? 'dotted' : 'solid'} ${st.borderColor || 'var(--border-strong)'}`;
  if (st.shadowColor) css.boxShadow = `${st.shadowX || 0}px ${st.shadowY || 0}px 0 ${st.shadowColor}`;
  if (st.textColor) css.color = st.textColor;
  if (st.bold) css.fontWeight = 600;
  return css;
}

function ColorPicker({ value, onChange, allowTransparent }: { value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
  return <div className="swatches">
    <button type="button" className={'sw none' + (!value ? ' on' : '')} title={t('Not set (fall through to other rules)')} aria-label={t('No color')} onClick={() => onChange('')} />
    {allowTransparent && <button type="button" className={'sw trans' + (value === 'transparent' ? ' on' : '')} title={t('Transparent fill')} aria-label={t('Transparent')} onClick={() => onChange('transparent')} />}
    {BS_PALETTE.map(c => <button type="button" key={c} className={'sw' + (value === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />)}
    <input className="inp hex" value={value} placeholder="#hex" aria-label={t('Custom hex color')} onChange={e => onChange(e.target.value.trim())} />
  </div>;
}

function CondRow({ c, onChange, onRemove }: { c: BoxCondition; onChange: (c: BoxCondition) => void; onRemove: () => void }) {
  const st = useStore();
  const f = fieldOf(c.field), list = opsOf(c.field);
  const op = list.find(o => o.key === c.op) || list[0];
  const setField = (key: string) => {
    const nf = fieldOf(key);
    const def: any = nf.kind === 'bool' ? true : nf.kind === 'num' ? 0 : nf.kind === 'res' ? (st.p.resources[0]?.uid ?? 0) : nf.kind === 'type' ? 'FixedUnits' : nf.kind === 'constraint' ? 'ASAP' : '';
    onChange({ field: key, op: opsOf(key)[0].key, value: def });
  };
  return <div className="cond-row">
    <select className="sel" value={c.field} onChange={e => setField(e.target.value)}>
      {BS_FIELDS.map(x => <option key={x.key} value={x.key}>{t(x.label)}</option>)}
    </select>
    <select className="sel" value={op.key} onChange={e => onChange({ ...c, op: e.target.value })}>
      {list.map(o => <option key={o.key} value={o.key}>{t(o.label)}</option>)}
    </select>
    {!op.noValue && (f.kind === 'bool' ? <select className="sel" value={c.value ? 'true' : 'false'} onChange={e => onChange({ ...c, value: e.target.value === 'true' })}>
        <option value="true">{t('yes')}</option><option value="false">{t('no')}</option>
      </select> : f.kind === 'res' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: +e.target.value })}>
        {st.p.resources.map(r => <option key={r.uid} value={String(r.uid)}>{r.name || r.initials || r.uid}</option>)}
      </select> : f.kind === 'type' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value })}>
        <option value="FixedUnits">{t('Fixed units')}</option><option value="FixedWork">{t('Fixed work')}</option><option value="FixedDuration">{t('Fixed duration')}</option>
      </select> : f.kind === 'constraint' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value })}>
        {['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'].map(k => <option key={k} value={k}>{k}</option>)}
      </select> : f.kind === 'num' ? <input className="inp" type="number" value={Number(c.value) || 0} onChange={e => onChange({ ...c, value: +e.target.value })} /> :
        <input className="inp" value={String(c.value ?? '')} onChange={e => onChange({ ...c, value: e.target.value })} />)}
    <button type="button" className="icon-btn" aria-label={t('Remove condition')} onClick={onRemove}><Icon name="x" /></button>
  </div>;
}

function newRuleDraft(): BoxRule {
  return {
    id: 'r' + Date.now().toString(36), name: 'New rule', enabled: true, builtin: false, scope: 'full',
    views: ['wbs', 'network'], conditions: [{ field: 'isCritical', op: 'eq', value: true }],
    style: { borderColor: '#e11d48', borderWidth: 2 },
  };
}

function RuleEditor({ rule, onSave, onClose }: { rule: BoxRule; onSave: (r: BoxRule) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<BoxRule>(() => ({ ...rule, style: { ...rule.style }, conditions: rule.conditions.map(c => ({ ...c })), views: [...rule.views] }));
  const patch = (p: Partial<BoxRule>) => setDraft(d => ({ ...d, ...p }));
  const patchStyle = (p: Partial<BoxStyle>) => setDraft(d => ({ ...d, style: { ...d.style, ...p } }));
  const toggleView = (v: 'wbs' | 'network') => patch({ views: draft.views.includes(v) ? draft.views.filter(x => x !== v) : [...draft.views, v] });
  return (
    <Modal title={rule.builtin ? t('Built-in rule (read only)') : (rule.name || t('Rule'))} okLabel={t('Save rule')} noOk={rule.builtin} cancelLabel={rule.builtin ? t('Close') : t('Cancel')} onClose={onClose} onSubmit={() => { onSave(draft); }}>
      {rule.builtin && <p className="muted">{t('Built-in rules cannot be edited. Duplicate one to tweak it, or disable it here:')}</p>}
      {rule.builtin && <label className="toggle"><input type="checkbox" checked={draft.enabled} onChange={e => { patch({ enabled: e.target.checked }); onSave({ ...draft, enabled: e.target.checked }); }} />{t('Enabled')}</label>}
      {!rule.builtin && <>
        <F label={t('Rule name')} name="rname" value={draft.name} onChange={(e: any) => patch({ name: e.target.value })} />
        <div className="row2">
          <label className="field"><span>{t('Apply to')}</span>
            <label className="toggle"><input type="checkbox" checked={draft.views.includes('wbs')} onChange={() => toggleView('wbs')} />{t('WBS chart')}</label>
            <label className="toggle"><input type="checkbox" checked={draft.views.includes('network')} onChange={() => toggleView('network')} />{t('Network diagram')}</label>
          </label>
          <label className="field"><span>{t('Scope')}</span>
            <select className="sel" value={draft.scope} onChange={e => patch({ scope: e.target.value as BoxRule['scope'] })}>
              <option value="partial">{t('Partial — only the attributes set below')}</option>
              <option value="full">{t('Full — override everything set below')}</option>
            </select>
          </label>
        </div>
        <p className="muted">{t('Partial rules merge attribute by attribute (several can apply at once); a full rule replaces the merged result wholesale. Evaluation order = list order.')}</p>
        <div className="field"><span>{t('Conditions (combined with AND)')}</span>
          <div className="mini-list">
            {draft.conditions.map((c, k) => <CondRow key={k} c={c} onChange={nc => patch({ conditions: draft.conditions.map((x, i) => i === k ? nc : x) })} onRemove={() => patch({ conditions: draft.conditions.filter((_, i) => i !== k) })} />)}
            <button type="button" className="btn ghost" onClick={() => patch({ conditions: draft.conditions.concat([{ field: 'percentComplete', op: 'gte', value: 50 }]) })}><Icon name="plus" />{t('Add condition')}</button>
          </div>
        </div>
        <div className="field"><span>{t('Border color')}</span>
          <ColorPicker value={draft.style.borderColor || ''} onChange={v => patchStyle(v ? { borderColor: v } : { borderColor: undefined, borderWidth: undefined, borderDash: undefined })} />
        </div>
        <div className="row3">
          <label className="field"><span>{t('Border width')}</span>
            <select className="sel" value={draft.style.borderWidth || ''} onChange={e => patchStyle({ borderWidth: e.target.value ? +e.target.value as 1 | 2 | 3 : undefined })}>
              <option value="">{t('Not set')}</option><option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option>
            </select>
          </label>
          <label className="field"><span>{t('Line style')}</span>
            <select className="sel" value={draft.style.borderDash || ''} onChange={e => patchStyle({ borderDash: e.target.value as BoxStyle['borderDash'] })}>
              <option value="">{t('Not set')}</option><option value="solid">{t('Solid')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option>
            </select>
          </label>
          <label className="field"><span>{t('Bold text')}</span>
            <label className="toggle"><input type="checkbox" checked={!!draft.style.bold} onChange={e => patchStyle({ bold: e.target.checked || undefined })} />{t('Bold')}</label>
          </label>
        </div>
        <div className="field"><span>{t('Fill color')}</span>
          <ColorPicker value={draft.style.fillColor || ''} allowTransparent onChange={v => patchStyle({ fillColor: v || undefined })} />
        </div>
        <div className="field"><span>{t('Text color')}</span>
          <ColorPicker value={draft.style.textColor || ''} onChange={v => patchStyle({ textColor: v || undefined })} />
        </div>
        <div className="field"><span>{t('Shadow color (empty = no shadow)')}</span>
          <ColorPicker value={draft.style.shadowColor || ''} onChange={v => patchStyle({ shadowColor: v || undefined, shadowX: v ? (draft.style.shadowX ?? 3) : undefined, shadowY: v ? (draft.style.shadowY ?? 3) : undefined })} />
        </div>
        <div className="row2">
          <F label={t('Shadow offset X (-4..4)')} name="shx" type="number" min={-4} max={4} value={draft.style.shadowX ?? 3} onChange={(e: any) => patchStyle({ shadowX: Math.max(-4, Math.min(4, +e.target.value || 0)) })} />
          <F label={t('Shadow offset Y (-4..4)')} name="shy" type="number" min={-4} max={4} value={draft.style.shadowY ?? 3} onChange={(e: any) => patchStyle({ shadowY: Math.max(-4, Math.min(4, +e.target.value || 0)) })} />
        </div>
      </>}
    </Modal>
  );
}

function BoxStylesDialog() {
  const st = useStore();
  const rules = st.p.boxRules || [];
  const [edit, setEdit] = useState<{ index: number; rule: BoxRule } | null>(null);
  const commit = (fn: (rs: BoxRule[]) => void) => {
    const rs = rules.map(r => ({ ...r, style: { ...r.style } })) as BoxRule[];
    fn(rs);
    ops.saveBoxRules(rs);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    commit(rs => { const t = rs[i]; rs[i] = rs[j]; rs[j] = t; });
  };
  return (
    <Modal title={t('Box style rules')} okLabel={t('Done')} onSubmit={() => { }} backdropClose>
      <p className="muted">{t('Rules restyle WBS and network boxes. They are evaluated top to bottom: matching')} <b>{t('partial')}</b> {t('rules merge attribute by attribute, then the first matching')} <b>{t('full')}</b> {t('rule overrides the result. A per-task custom color beats every rule.')}</p>
      <div className="rule-list">
        {rules.map((r, i) => <div className="rule-row" key={r.id}>
          <input type="checkbox" aria-label={t('Enable {name}', { name: r.name })} checked={r.enabled} onChange={() => commit(rs => { rs[i].enabled = !rs[i].enabled; })} />
          <div className="rule-main">
            <span className="rule-name">{r.name}{r.builtin && <span className="rule-badge">{t('built-in')}</span>}<span className="rule-badge">{t(r.scope)}</span><span className="rule-badge">{r.views.join(' + ')}</span></span>
            <span className="rule-cond">{condSummary(r, st.p)}</span>
          </div>
          <div className="rule-prev" style={previewStyle(r.style)}>Aa</div>
          <button type="button" className="icon-btn" title={t('Move up')} aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
          <button type="button" className="icon-btn" title={t('Move down')} aria-label={t('Move down')} disabled={i === rules.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
          <button type="button" className="icon-btn" title={t('Edit')} aria-label={t('Edit')} onClick={() => setEdit({ index: i, rule: r })}><Icon name="settings" /></button>
          <button type="button" className="icon-btn" title={t('Duplicate')} aria-label={t('Duplicate')} onClick={() => commit(rs => { rs.splice(i + 1, 0, { ...r, id: 'r' + Date.now().toString(36), name: r.name + ' copy', builtin: false }); })}><Icon name="copy" /></button>
          <button type="button" className="icon-btn" title={r.builtin ? t('Built-in rules cannot be deleted') : t('Delete')} aria-label={t('Delete')} disabled={r.builtin} onClick={() => commit(rs => { rs.splice(i, 1); })}><Icon name="trash" /></button>
        </div>)}
      </div>
      <div className="dlg-foot" style={{ justifyContent: 'flex-start', paddingLeft: 0, paddingRight: 0 }}>
        <button type="button" className="btn" disabled={rules.length >= BS_MAX} onClick={() => setEdit({ index: -1, rule: newRuleDraft() })}><Icon name="plus" />{t('New rule')}</button>
        <span className="muted">{t('{count} / {max} rules', { count: rules.length, max: BS_MAX })}</span>
      </div>
      {edit && <RuleEditor rule={edit.rule}
        onClose={() => setEdit(null)}
        onSave={r => {
          if (edit.index >= 0) commit(rs => { rs[edit.index] = r; }); else ops.saveBoxRules(rules.concat([r]));
          if (!r.builtin) setEdit(null);
        }} />}
    </Modal>
  );
}

function BoxColorDialog({ uids }: { uids: number[] }) {
  const st = useStore();
  const task = st.p.tasks.find(x => x.uid === uids[0]);
  const [color, setColor] = useState(task?.customStyle?.fillColor || '');
  return (
    <Modal title={t('Custom box color — {name}', { name: uids.length > 1 ? t('{count} tasks', { count: uids.length }) : (task?.name || t('task')) })} okLabel={t('Apply')} onSubmit={() => { ops.setCustomStyle(uids, color ? { fillColor: color } : null); }}>
      <div className="field"><span>{t('Fill color (overrides all rules)')}</span>
        <ColorPicker value={color} allowTransparent onChange={setColor} />
      </div>
      <p className="muted">{t('Leave the color empty to clear the custom style and go back to rule-driven styling.')}</p>
    </Modal>
  );
}

/* ---------- print (PRD M18) ---------- */

const SLOT_TYPES: [string, string][] = [['none', 'Nothing'], ['page', 'Page number'], ['date', 'Date'], ['project', 'Project name'], ['custom', 'Custom text']];

function SlotEditor({ label, slots, onChange }: { label: string; slots: [PrintSlot, PrintSlot, PrintSlot]; onChange: (s: [PrintSlot, PrintSlot, PrintSlot]) => void }) {
  return <div className="field"><span>{label}</span><div className="print-slots">
    {slots.map((s, i) => (
      <div key={i} className="print-slot">
        <select className="inp" value={s.type} onChange={e => {
          const next = [...slots] as [PrintSlot, PrintSlot, PrintSlot];
          next[i] = { ...s, type: e.target.value as PrintSlot['type'] };
          onChange(next);
        }}>
          {SLOT_TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        {s.type === 'custom' && <input className="inp" placeholder={t('Text')} value={s.text} onChange={e => {
          const next = [...slots] as [PrintSlot, PrintSlot, PrintSlot];
          next[i] = { ...s, text: e.target.value };
          onChange(next);
        }} />}
      </div>
    ))}
  </div></div>;
}

function PrintDialog() {
  const st = useStore();
  const [cfg, setCfg] = useState<PrintConfig>(JSON.parse(JSON.stringify(st.printCfg)));
  const upd = (patch: Partial<PrintConfig>) => setCfg(c => ({ ...c, ...patch }));
  return (
    <Modal title={t('Print {view}', { view: viewName(st.view) })} okLabel={t('Print')} onClose={() => S().closeDialog()} onSubmit={() => {
      st.setUI({ printCfg: cfg });
      printView(st, cfg);
    }}>
      <div className="two">
        <label className="field"><span>{t('Paper')}</span>
          <select className="inp" value={cfg.paper} onChange={e => upd({ paper: e.target.value as PrintConfig['paper'] })}>
            <option value="a4">A4</option><option value="a3">A3</option><option value="letter">{t('Letter')}</option>
          </select>
        </label>
        <label className="field"><span>{t('Orientation')}</span>
          <select className="inp" value={cfg.orient} onChange={e => upd({ orient: e.target.value as PrintConfig['orient'] })}>
            <option value="landscape">{t('Landscape')}</option><option value="portrait">{t('Portrait')}</option>
          </select>
        </label>
      </div>
      <SlotEditor label={t('Header (left / center / right)')} slots={cfg.header} onChange={header => upd({ header })} />
      <SlotEditor label={t('Footer (left / center / right)')} slots={cfg.footer} onChange={footer => upd({ footer })} />
      <p className="muted">{t('The chart is scaled to fit the page width and split into pages between node rows, so no box is cut across pages. The browser’s print preview shows the pages.')}</p>
    </Modal>
  );
}

/* ---------- WBS dictionary export (PRD 6.5) ---------- */

function WbsDocDialog() {
  const st = useStore();
  const [template, setTemplate] = useState<'compact' | 'full'>('full');
  const [scope, setScope] = useState<'all' | 'leaves' | 'critical'>('all');
  return (
    <Modal title={t('Export WBS dictionary to Word')} okLabel={t('Download')} onClose={() => S().closeDialog()} onSubmit={() => {
      U.download(U.slug(st.p.name) + '-wbs-dictionary.doc', toWbsDictionaryDoc(st.p, { template, scope }), 'application/msword');
      st.toast(t('Word document downloaded'));
    }}>
      <div className="two">
        <label className="field"><span>{t('Template')}</span>
          <select className="inp" value={template} onChange={e => setTemplate(e.target.value as 'compact' | 'full')}>
            <option value="full">{t('Full (all fields)')}</option><option value="compact">{t('Compact (name + duration + notes)')}</option>
          </select>
        </label>
        <label className="field"><span>{t('Tasks')}</span>
          <select className="inp" value={scope} onChange={e => setScope(e.target.value as 'all' | 'leaves' | 'critical')}>
            <option value="all">{t('All tasks')}</option><option value="leaves">{t('Leaf tasks only')}</option><option value="critical">{t('Critical path only')}</option>
          </select>
        </label>
      </div>
      <p className="muted">{t('A .doc file with a cover page, contents list, one section per task and a task list appendix. Word shows it with real heading styles, so you can insert an automatic table of contents there.')}</p>
    </Modal>
  );
}

export default function DialogHost() {
  const dialog = useStore(s => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'settings': return <SettingsDialog />;
    case 'recurring': return <RecurringDialog />;
    case 'resource': return <ResourceDialog uid={dialog.props.uid} />;
    case 'task': return <TaskDialog uid={dialog.props.uid} />;
    case 'batchedit': return <BatchEditDialog uids={dialog.props.uids} />;
    case 'about': return <AboutDialog />;
    case 'import': return <ImportDialog />;
    case 'share': return <ShareDialog />;
    case 'confirm': return <ConfirmDialog {...dialog.props} />;
    case 'wbsbox': return <WbsBoxDialog />;
    case 'calendar': return <CalendarDialog />;
    case 'boxstyles': return <BoxStylesDialog />;
    case 'boxcolor': return <BoxColorDialog uids={dialog.props.uids} />;
    case 'print': return <PrintDialog />;
    case 'wbsdoc': return <WbsDocDialog />;
    default: return null;
  }
}
