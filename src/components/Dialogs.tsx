import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import OP from '../core';
import { useStore, S } from '../store';
import * as ops from '../lib/taskOps';
import Icon from './Icon';
import { TaskEditor } from './Drawer';
import type { BoxCondition, BoxRule, BoxStyle, CustomField, Resource, Row } from '../types';
import { version } from '../../package.json';
import { projectFromTable } from '../lib/importTable';
import { shareUrl } from '../lib/share';
import { loadProject } from '../lib/actions';

const U = OP.util;
const STATUSES = ['Draft', 'In review', 'Approved', 'Baselined', 'Final'];

function Modal({ title, children, onSubmit, okLabel = 'Save', cancelLabel = 'Cancel', noOk, backdropClose, onClose }: {
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
        <div className="dlg-head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close" onClick={close}><Icon name="x" /></button></div>
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
    <Modal title="Project information" onSubmit={fd => {
      const bad: string[] = [];
      const hol = parseDates(fd.get('holidays'), bad);
      if (bad.length) st.toast('Ignored invalid holiday dates: ' + bad.join(', '), true);
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
        pp.holidays = hol;
        pp.customFields = cfs;
        const keep = new Set(cfs.map(f => f.id));
        pp.tasks.forEach(t => { Object.keys(t.custom).forEach(id => { if (!keep.has(id)) delete t.custom[id]; }); });
      });
    }}>
      <F label="Project name" name="name" value={p.name} />
      <div className="row2"><F label="Issuing organisation" name="organization" value={p.organization} /><F label="Project manager" name="manager" value={p.manager} /></div>
      <div className="row2">
        <label className="field"><span>Status</span><select className="sel" name="status" defaultValue={p.status}>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select></label>
        <F label="Date of issue" name="issueDate" value={p.issueDate} type="date" />
      </div>
      <div className="row2"><F label="Project start date" name="start" value={p.start} type="date" required /><F label="Status date (for tracking)" name="statusDate" value={p.statusDate} type="date" /></div>
      <div className="row3">
        <F label="Budget" name="budget" value={p.budget} type="number" min={0} step={1000} />
        <F label="Currency symbol" name="currency" value={p.currency} />
        <F label="Hours per working day" name="hoursPerDay" value={p.hoursPerDay} type="number" min={1} max={24} step={0.5} />
      </div>
      <label className="field"><span>Holidays (one date per line, YYYY-MM-DD) — non-working days besides weekends</span>
        <textarea className="inp" name="holidays" rows={3} defaultValue={(p.holidays || []).join('\n')} /></label>
      <div className="field"><span>Custom task fields</span>
        <div className="mini-list">
          {fields.map((f, k) => (
            <div className="mini-row cf" key={f.id}>
              <input className="inp" aria-label="Field name" placeholder="e.g. Owner" value={f.name} onChange={e => patchField(k, { name: e.target.value })} />
              <select className="sel" aria-label="Field type" value={f.type} onChange={e => patchField(k, { type: e.target.value as CustomField['type'] })}>
                <option value="text">Text</option><option value="number">Number</option>
              </select>
              <button type="button" className="icon-btn" aria-label="Remove field" onClick={() => setFields(fields.filter((_, i) => i !== k))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setFields(fields.concat([{ id: 'c' + Date.now().toString(36) + fields.length, name: '', type: 'text' }]))}><Icon name="plus" />Add field</button>
        </div>
      </div>
    </Modal>
  );
}

function RecurringDialog() {
  const st = useStore();
  return (
    <Modal title="Recurring task" okLabel="Create" onSubmit={fd => {
      const name = String(fd.get('name')).trim(), first = U.parseDate(String(fd.get('first')));
      if (!name || first == null) return false;
      ops.createRecurring({
        name, first, duration: Math.max(0, +fd.get('duration')! || 0),
        count: Math.max(1, Math.min(104, +fd.get('count')! || 1)), every: Math.max(1, +fd.get('every')! || 1), unit: String(fd.get('unit'))
      });
      st.setView('gantt');
    }}>
      <F label="Task name" name="name" value="Sprint review" required />
      <div className="row3">
        <F label="Duration (days)" name="duration" value={1} type="number" min={0} step={0.5} />
        <F label="First occurrence" name="first" value={U.iso(st.s.startDn)} type="date" required />
        <F label="Occurrences" name="count" value={4} type="number" min={1} max={104} />
      </div>
      <div className="row2">
        <label className="field"><span>Repeat</span><select className="sel" name="unit" defaultValue="week">
          <option value="week">Weekly</option><option value="month">Monthly</option><option value="day">Daily (working days)</option>
        </select></label>
        <F label="Every" name="every" value={2} type="number" min={1} max={52} />
      </div>
      <p className="muted small">Creates a summary task with one subtask per occurrence, each fixed with a “Start no earlier than” date.</p>
    </Modal>
  );
}

function ResourceDialog({ uid }: { uid: number }) {
  const st = useStore(), r = st.p.resources.find(x => x.uid === uid) as Resource;
  if (!r) return null;
  const rates = (r.rates || []).map(e => e.from + ' ' + e.rate).join('\n');
  return (
    <Modal title={r.name || 'Resource'} onSubmit={fd => {
      const bad: string[] = [];
      const vac = parseDates(fd.get('vacations'), bad);
      const rateList: { from: string; rate: number }[] = [];
      String(fd.get('rates') || '').split('\n').forEach(line => {
        const m = /^\s*(\d{4}-\d{2}-\d{2})[\s,;]+(\d+(?:\.\d+)?)\s*$/.exec(line);
        if (m) rateList.push({ from: m[1], rate: +m[2] });
        else if (line.trim()) bad.push(line.trim());
      });
      if (bad.length) st.toast('Ignored: ' + bad.join(', '), true);
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
        <label className="field"><span>Working days</span><div className="chk-row">
          {[1, 2, 3, 4, 5, 6, 0].map(d => <label key={d} className="chk"><input type="checkbox" name="wd" value={d} defaultChecked={r.workDays.includes(d)} />{U.DAYS[d]}</label>)}
        </div></label>
        <label className="field"><span>Vacations / days off (one date per line, YYYY-MM-DD)</span><textarea className="inp" name="vacations" rows={3} defaultValue={r.vacations.join('\n')} /></label>
        <label className="field"><span>Rate changes (one per line: effective date and new hourly rate)</span><textarea className="inp" name="rates" rows={3} placeholder="2026-04-01 8500" defaultValue={rates} /></label>
        <p className="muted small">Working days and vacations set when this person is available: they drive overallocation warnings and resource leveling.</p>
      </>}
      {r.kind === 'Material' && <F label="Material label (unit)" name="materialLabel" value={r.materialLabel} placeholder="e.g. licences, servers" />}
      {r.kind !== 'Cost'
        ? <F label={'Cost per use (' + st.p.currency + ')'} name="costPerUse" value={r.costPerUse} type="number" min={0} step={100} />
        : <p className="muted">Cost resources (travel, licences, fees) have no rate: enter the amount on each task assignment.</p>}
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
    <Modal title="About OpenPlan" cancelLabel="Close" noOk>
      <div className="about-head">
        <img src="./assets/OpenPlan.png" alt="" width={44} height={44} />
        <div><h3>OpenPlan</h3><span className="muted">Version {version} · Free, browser-based project planning</span></div>
      </div>
      <p>Plan with a WBS, Gantt chart, critical path, network diagram, resources, leveling, baselines, tracking, earned value, budget and reports. Your project is saved automatically in this browser only; use <b>File › Save</b> to keep a copy as an .openplan file.</p>
      <section className="about-sec">
        <h4>Keyboard shortcuts</h4>
        <table className="about-keys"><tbody>{SHORTCUTS.map(([keys, action]) => <tr key={action}><td>{keys}</td><td>{action}</td></tr>)}</tbody></table>
      </section>
      <section className="about-sec">
        <h4>Tips</h4>
        <dl className="about-tips">
          <dt>Rename the project</dt><dd>Click the name in the title bar. <kbd>Enter</kbd> saves, <kbd>Esc</kbd> cancels.</dd>
          <dt>Gantt chart</dt><dd>Drag a bar to move it (sets a “Start no earlier than” constraint), drag its right edge to change the duration, or drag it onto another bar to link the two.</dd>
          <dt>Predecessors</dt><dd>Type task IDs separated by commas. Link types are FS (default), SS, FF and SF, with optional lag, e.g. <code>3, 5SS+2d, 7FF-1d</code>.</dd>
        </dl>
      </section>
      <p className="about-foot muted">Open source under the <a href="https://github.com/MNSBaanu/OpenPlan/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT License</a> · <a href="https://github.com/MNSBaanu/OpenPlan" target="_blank" rel="noreferrer">Source on GitHub</a> · Made by MNS Baanu</p>
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
    if (file.size > 5 * 1024 * 1024) { S().toast('That file is larger than 5 MB. Choose a CSV task list.', true); return; }
    setText(await file.text());
  };
  return (
    <Modal title="Import tasks from Excel or CSV" okLabel="Import" onSubmit={() => {
      if (!ok) return false;
      loadProject(ok.project, 'Imported ' + ok.tasks + ' task' + (ok.tasks > 1 ? 's' : '') + (ok.warnings.length ? '. ' + ok.warnings.join('; ') + '.' : ''));
    }}>
      <p>Copy the task list in Excel or Google Sheets and paste it below, or choose a CSV file. Columns are matched by their headings: Task Name, Duration, Predecessors, Resources, Level or WBS, % Complete and Notes. Without headings, the columns are read as task name, duration and predecessors.</p>
      <textarea className="inp mono" id="import-text" rows={9} value={text} onChange={e => setText(e.target.value)} aria-label="Task list"
        placeholder={['Task Name, Duration, Predecessors', 'Design, 5', 'Build, 10, 1', 'Launch, 0, 2'].join('\n')} />
      <div className="row-actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" />Choose CSV file…</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={e => pickFile(e.target.files?.[0])} />
      </div>
      {ok && <p className="muted">Found {ok.tasks} task{ok.tasks > 1 ? 's' : ''} and {ok.resources} resource{ok.resources === 1 ? '' : 's'}. Importing replaces the current plan, which you can bring back from File › Open › Restore Previous Project.</p>}
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
    try { await navigator.clipboard.writeText(url); S().toast('Share link copied'); }
    catch { inputRef.current?.select(); S().toast('Press Ctrl+C to copy the selected link.'); }
  };
  return (
    <Modal title="Share a copy of this plan" cancelLabel="Close" noOk>
      <p>Anyone who opens this link gets their own copy of the plan in their browser. Their changes don't affect yours. The plan travels inside the link and is never uploaded.</p>
      <div className="share-row">
        <input ref={inputRef} className="inp" id="share-url" readOnly value={url || 'Creating link…'} aria-label="Share link" onFocus={e => e.target.select()} />
        <button type="button" className="btn primary" disabled={!url} onClick={copy}><Icon name="link" />Copy link</button>
      </div>
      {url && <p className="muted small">Link length: {Math.ceil(url.length / 1024)} KB.{url.length > 8000 ? ' Some chat and email apps cut off long links; if it does not open, send the .openplan file instead.' : ''}</p>}
      {error && <p className="alert inline">Could not create the link: {error}</p>}
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
  const t = st.p.tasks.find(x => x.uid === uid);
  const r = t ? st.s.rows.find((x: Row) => x.task.uid === t.uid) : undefined;
  if (!t || !r) return null;
  // Edits commit immediately through the store, exactly like the side drawer.
  // onSubmit returns false so an accidental form submit (Enter) cannot close the dialog.
  return (
    <Modal title={'Task ' + r.id + ' · WBS ' + r.wbs} cancelLabel="Close" noOk backdropClose onSubmit={() => false}>
      <TaskEditor st={st} t={t} r={r} />
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
    <Modal title="WBS box content" okLabel="Apply" onSubmit={() => { st.setUI({ wbsBox: rows }); }}>
      <p className="muted">Choose which info lines each WBS box shows below the task name. The name is always shown.</p>
      <div className="chk-list">
        {WBS_BOX_ROWS.map(r => (
          <label key={r.key} className="chk"><input type="checkbox" checked={rows.includes(r.key)} onChange={() => toggle(r.key)} />{r.label}</label>
        ))}
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
    case 'bool': return c.value ? 'yes' : 'no';
    case 'res': {
      const r = p.resources.find(x => x.uid === c.value);
      return r ? r.name : String(c.value ?? '');
    }
    case 'type': return { FixedUnits: 'Fixed units', FixedWork: 'Fixed work', FixedDuration: 'Fixed duration' }[String(c.value)] || String(c.value ?? '');
    case 'constraint': return String(c.value || 'ASAP');
    default: return String(c.value ?? '');
  }
}

function condSummary(rule: BoxRule, p: { resources: Resource[] }): string {
  if (!rule.conditions.length) return 'All tasks';
  return rule.conditions.map(c => {
    const op = (opsOf(c.field) || []).find(o => o.key === c.op);
    const label = op ? op.label : c.op;
    return op?.noValue ? `${fieldOf(c.field).label} ${label}` : `${fieldOf(c.field).label} ${label} ${valueLabel(c, p)}`;
  }).join(' and ');
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
    <button type="button" className={'sw none' + (!value ? ' on' : '')} title="Not set (fall through to other rules)" aria-label="No color" onClick={() => onChange('')} />
    {allowTransparent && <button type="button" className={'sw trans' + (value === 'transparent' ? ' on' : '')} title="Transparent fill" aria-label="Transparent" onClick={() => onChange('transparent')} />}
    {BS_PALETTE.map(c => <button type="button" key={c} className={'sw' + (value === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />)}
    <input className="inp hex" value={value} placeholder="#hex" aria-label="Custom hex color" onChange={e => onChange(e.target.value.trim())} />
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
      {BS_FIELDS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
    <select className="sel" value={op.key} onChange={e => onChange({ ...c, op: e.target.value })}>
      {list.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
    {!op.noValue && (f.kind === 'bool' ? <select className="sel" value={c.value ? 'true' : 'false'} onChange={e => onChange({ ...c, value: e.target.value === 'true' })}>
        <option value="true">yes</option><option value="false">no</option>
      </select> : f.kind === 'res' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: +e.target.value })}>
        {st.p.resources.map(r => <option key={r.uid} value={String(r.uid)}>{r.name || r.initials || r.uid}</option>)}
      </select> : f.kind === 'type' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value })}>
        <option value="FixedUnits">Fixed units</option><option value="FixedWork">Fixed work</option><option value="FixedDuration">Fixed duration</option>
      </select> : f.kind === 'constraint' ? <select className="sel" value={String(c.value)} onChange={e => onChange({ ...c, value: e.target.value })}>
        {['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'].map(k => <option key={k} value={k}>{k}</option>)}
      </select> : f.kind === 'num' ? <input className="inp" type="number" value={Number(c.value) || 0} onChange={e => onChange({ ...c, value: +e.target.value })} /> :
        <input className="inp" value={String(c.value ?? '')} onChange={e => onChange({ ...c, value: e.target.value })} />)}
    <button type="button" className="icon-btn" aria-label="Remove condition" onClick={onRemove}><Icon name="x" /></button>
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
    <Modal title={rule.builtin ? 'Built-in rule (read only)' : (rule.name || 'Rule')} okLabel="Save rule" noOk={rule.builtin} cancelLabel={rule.builtin ? 'Close' : 'Cancel'} onClose={onClose} onSubmit={() => { onSave(draft); }}>
      {rule.builtin && <p className="muted">Built-in rules cannot be edited. Duplicate one to tweak it, or disable it here:</p>}
      {rule.builtin && <label className="toggle"><input type="checkbox" checked={draft.enabled} onChange={e => { patch({ enabled: e.target.checked }); onSave({ ...draft, enabled: e.target.checked }); }} />Enabled</label>}
      {!rule.builtin && <>
        <F label="Rule name" name="rname" value={draft.name} onChange={(e: any) => patch({ name: e.target.value })} />
        <div className="row2">
          <label className="field"><span>Apply to</span>
            <label className="toggle"><input type="checkbox" checked={draft.views.includes('wbs')} onChange={() => toggleView('wbs')} />WBS chart</label>
            <label className="toggle"><input type="checkbox" checked={draft.views.includes('network')} onChange={() => toggleView('network')} />Network diagram</label>
          </label>
          <label className="field"><span>Scope</span>
            <select className="sel" value={draft.scope} onChange={e => patch({ scope: e.target.value as BoxRule['scope'] })}>
              <option value="partial">Partial — only the attributes set below</option>
              <option value="full">Full — override everything set below</option>
            </select>
          </label>
        </div>
        <p className="muted">Partial rules merge attribute by attribute (several can apply at once); a full rule replaces the merged result wholesale. Evaluation order = list order.</p>
        <div className="field"><span>Conditions (combined with AND)</span>
          <div className="mini-list">
            {draft.conditions.map((c, k) => <CondRow key={k} c={c} onChange={nc => patch({ conditions: draft.conditions.map((x, i) => i === k ? nc : x) })} onRemove={() => patch({ conditions: draft.conditions.filter((_, i) => i !== k) })} />)}
            <button type="button" className="btn ghost" onClick={() => patch({ conditions: draft.conditions.concat([{ field: 'percentComplete', op: 'gte', value: 50 }]) })}><Icon name="plus" />Add condition</button>
          </div>
        </div>
        <div className="field"><span>Border color</span>
          <ColorPicker value={draft.style.borderColor || ''} onChange={v => patchStyle(v ? { borderColor: v } : { borderColor: undefined, borderWidth: undefined, borderDash: undefined })} />
        </div>
        <div className="row3">
          <label className="field"><span>Border width</span>
            <select className="sel" value={draft.style.borderWidth || ''} onChange={e => patchStyle({ borderWidth: e.target.value ? +e.target.value as 1 | 2 | 3 : undefined })}>
              <option value="">Not set</option><option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option>
            </select>
          </label>
          <label className="field"><span>Line style</span>
            <select className="sel" value={draft.style.borderDash || ''} onChange={e => patchStyle({ borderDash: e.target.value as BoxStyle['borderDash'] })}>
              <option value="">Not set</option><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
            </select>
          </label>
          <label className="field"><span>Bold text</span>
            <label className="toggle"><input type="checkbox" checked={!!draft.style.bold} onChange={e => patchStyle({ bold: e.target.checked || undefined })} />Bold</label>
          </label>
        </div>
        <div className="field"><span>Fill color</span>
          <ColorPicker value={draft.style.fillColor || ''} allowTransparent onChange={v => patchStyle({ fillColor: v || undefined })} />
        </div>
        <div className="field"><span>Text color</span>
          <ColorPicker value={draft.style.textColor || ''} onChange={v => patchStyle({ textColor: v || undefined })} />
        </div>
        <div className="field"><span>Shadow color (empty = no shadow)</span>
          <ColorPicker value={draft.style.shadowColor || ''} onChange={v => patchStyle({ shadowColor: v || undefined, shadowX: v ? (draft.style.shadowX ?? 3) : undefined, shadowY: v ? (draft.style.shadowY ?? 3) : undefined })} />
        </div>
        <div className="row2">
          <F label="Shadow offset X (-4..4)" name="shx" type="number" min={-4} max={4} value={draft.style.shadowX ?? 3} onChange={(e: any) => patchStyle({ shadowX: Math.max(-4, Math.min(4, +e.target.value || 0)) })} />
          <F label="Shadow offset Y (-4..4)" name="shy" type="number" min={-4} max={4} value={draft.style.shadowY ?? 3} onChange={(e: any) => patchStyle({ shadowY: Math.max(-4, Math.min(4, +e.target.value || 0)) })} />
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
    <Modal title="Box style rules" okLabel="Done" onSubmit={() => { }} backdropClose>
      <p className="muted">Rules restyle WBS and network boxes. They are evaluated top to bottom: matching <b>partial</b> rules merge attribute by attribute, then the first matching <b>full</b> rule overrides the result. A per-task custom color beats every rule.</p>
      <div className="rule-list">
        {rules.map((r, i) => <div className="rule-row" key={r.id}>
          <input type="checkbox" aria-label={'Enable ' + r.name} checked={r.enabled} onChange={() => commit(rs => { rs[i].enabled = !rs[i].enabled; })} />
          <div className="rule-main">
            <span className="rule-name">{r.name}{r.builtin && <span className="rule-badge">built-in</span>}<span className="rule-badge">{r.scope}</span><span className="rule-badge">{r.views.join(' + ')}</span></span>
            <span className="rule-cond">{condSummary(r, st.p)}</span>
          </div>
          <div className="rule-prev" style={previewStyle(r.style)}>Aa</div>
          <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" /></button>
          <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)}><Icon name="down" /></button>
          <button type="button" className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEdit({ index: i, rule: r })}><Icon name="settings" /></button>
          <button type="button" className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => commit(rs => { rs.splice(i + 1, 0, { ...r, id: 'r' + Date.now().toString(36), name: r.name + ' copy', builtin: false }); })}><Icon name="copy" /></button>
          <button type="button" className="icon-btn" title={r.builtin ? 'Built-in rules cannot be deleted' : 'Delete'} aria-label="Delete" disabled={r.builtin} onClick={() => commit(rs => { rs.splice(i, 1); })}><Icon name="trash" /></button>
        </div>)}
      </div>
      <div className="dlg-foot" style={{ justifyContent: 'flex-start', paddingLeft: 0, paddingRight: 0 }}>
        <button type="button" className="btn" disabled={rules.length >= BS_MAX} onClick={() => setEdit({ index: -1, rule: newRuleDraft() })}><Icon name="plus" />New rule</button>
        <span className="muted">{rules.length} / {BS_MAX} rules</span>
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
  const t = st.p.tasks.find(x => x.uid === uids[0]);
  const [color, setColor] = useState(t?.customStyle?.fillColor || '');
  return (
    <Modal title={'Custom box color — ' + (uids.length > 1 ? uids.length + ' tasks' : (t?.name || 'task'))} okLabel="Apply" onSubmit={() => { ops.setCustomStyle(uids, color ? { fillColor: color } : null); }}>
      <div className="field"><span>Fill color (overrides all rules)</span>
        <ColorPicker value={color} allowTransparent onChange={setColor} />
      </div>
      <p className="muted">Leave the color empty to clear the custom style and go back to rule-driven styling.</p>
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
    case 'about': return <AboutDialog />;
    case 'import': return <ImportDialog />;
    case 'share': return <ShareDialog />;
    case 'confirm': return <ConfirmDialog {...dialog.props} />;
    case 'wbsbox': return <WbsBoxDialog />;
    case 'boxstyles': return <BoxStylesDialog />;
    case 'boxcolor': return <BoxColorDialog uids={dialog.props.uids} />;
    default: return null;
  }
}
