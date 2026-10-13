import { useEffect, useState, type JSX } from 'react';
import OP from '../core';
import { useApp, ask, VIEW_NAMES, ZOOMS, PREV_STORE } from '../store';
import { hasImage, loadProject, openTemplate, runAction } from '../lib/actions';
import { TEMPLATES } from '../lib/templates';
import { deleteVersion, listVersions, saveVersion, type Version } from '../lib/versions';
import Icon from './Icon';
import type { ViewName } from '../types';

const U = OP.util;
const LOGO_MARK = './assets/OpenPlan.png';

/* ---------- title bar ---------- */

export function TitleBar() {
  const st = useApp();
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { document.title = st.p.name + ' - OpenPlan'; }, [st.p.name]);
  const rename = (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (name && name !== st.p.name) st.commit(pp => { pp.name = name; });
  };
  return (
    <header className="titlebar">
      <div className="qat">
        <button className="qat-btn home" title="OpenPlan home" aria-label="OpenPlan home" onClick={() => { location.hash = ''; }}><img className="app-icon" src={LOGO_MARK} alt="" /></button>
        <button className="qat-btn" title="Save (Ctrl+S)" aria-label="Save" onClick={() => runAction('save')}><Icon name="save" /></button>
        <button className="qat-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!st.undo.length} onClick={st.undoAct}><Icon name="undo" /></button>
        <button className="qat-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!st.redo.length} onClick={st.redoAct}><Icon name="redo" /></button>
      </div>
      <div className="title">
        {renaming
          ? <input className="title-inp" aria-label="Project name" defaultValue={st.p.name} size={st.p.name.length || 8} autoFocus onFocus={e => e.target.select()}
              onBlur={e => rename(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.value = st.p.name; if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
          : <button className="title-btn" title="Rename project" onClick={() => setRenaming(true)}>{st.p.name}</button>}
        {' - OpenPlan'}
      </div>
      <div className="tb-right">
        <button className="qat-btn" title="Dark / light" aria-label="Toggle dark mode" onClick={() => st.setUI({ theme: st.theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={st.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="qat-btn" title="Share a copy as a link" aria-label="Share a copy as a link" onClick={() => runAction('share')}><Icon name="link" /></button>
        <button className="qat-btn" title="About OpenPlan" aria-label="About" onClick={() => st.openDialog('about')}><Icon name="info" /></button>
      </div>
    </header>
  );
}

/* ---------- status bar ---------- */

const SB_VIEWS: [ViewName, string][] = [['gantt', 'gantt'], ['board', 'columns'], ['resources', 'users'], ['network', 'network'], ['reports', 'report']];

export function StatusBar() {
  const st = useApp();
  const zi = ZOOMS.indexOf(st.zoom as any);
  const setZoom = (i: number) => st.setUI({ zoom: ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))] });
  return (
    <footer className="statusbar">
      <span>Ready</span>
      <span className="sb-sep" />
      <span className="hide-sm">New Tasks : Auto Scheduled</span>
      <span className="sb-sep hide-sm" />
      <span className="save-state">
        {st.saveState === 'ok' ? <><Icon name="check" />Saved in this browser</>
          : <span style={{ color: 'var(--warn)' }}><Icon name="alert" />{st.saveState === 'full' ? 'Project too large for autosave — use File › Save' : 'Browser storage unavailable — use File › Save'}</span>}
      </span>
      <span className="spacer" />
      <div className="sb-views">
        {SB_VIEWS.map(([v, icon]) => (
          <button key={v} className={st.view === v ? 'active' : ''} title={VIEW_NAMES[v]} aria-label={VIEW_NAMES[v]} onClick={() => st.setView(v)}><Icon name={icon} /></button>
        ))}
      </div>
      <div className="sb-zoom" title="Timescale zoom">
        <button className="z-btn" aria-label="Zoom out" onClick={() => setZoom(zi - 1)}>−</button>
        <input type="range" min={0} max={3} step={1} value={zi} aria-label="Timescale zoom" onChange={e => setZoom(+e.target.value)} />
        <button className="z-btn" aria-label="Zoom in" onClick={() => setZoom(zi + 1)}>+</button>
      </div>
    </footer>
  );
}

/* ---------- File backstage ---------- */

const PAGES: [string, string][] = [['info', 'Info'], ['new', 'New'], ['open', 'Open'], ['save', 'Save'], ['versions', 'Versions'], ['export', 'Export'], ['print', 'Print'], ['about', 'About']];

function Tile({ icon, title, sub, act, disabled }: { icon: string; title: string; sub: string; act: string; disabled?: boolean }) {
  return (
    <button className="bs-tile" disabled={disabled} onClick={() => runAction(act)}>
      <Icon name={icon} /><div><b>{title}</b><span>{sub}</span></div>
    </button>
  );
}

function VersionsPage() {
  const st = useApp();
  const [list, setList] = useState(listVersions), [name, setName] = useState('');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const err = saveVersion(name || 'Version ' + (list.length + 1), st.p);
    if (err) { st.toast(err, true); return; }
    st.toast('Version saved');
    setName('');
    setList(listVersions());
  };
  const restore = (v: Version) => ask('Restore “' + v.name + '”? The current plan can be restored from File › Open › Restore Previous Project.', () => {
    try { loadProject(OP.io.fromJSON(v.json), 'Version “' + v.name + '” restored'); } catch (e: any) { st.toast('Could not restore: ' + e.message, true); }
  }, 'Restore');
  return <>
    <h1>Versions</h1>
    <p className="bs-note">Save named copies of your plan, for example before a big change, and go back to any of them later. Versions are kept in this browser only; save a project file to keep a copy elsewhere.</p>
    <form className="ver-form" onSubmit={save}>
      <input className="inp" id="version-name" value={name} onChange={e => setName(e.target.value)} placeholder="Version name, e.g. Before sprint 2" aria-label="Version name" maxLength={80} />
      <button className="btn primary" type="submit"><Icon name="save" />Save version</button>
    </form>
    {list.length ? (
      <table className="data ver-list">
        <thead><tr><th>Version</th><th>Plan</th><th>Saved</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.map(v => (
          <tr key={v.id}>
            <td>{v.name}</td><td>{v.project}</td><td>{new Date(v.at).toLocaleString()}</td>
            <td className="ver-acts">
              <button className="btn" onClick={() => restore(v)}>Restore</button>
              <button className="icon-btn" title="Delete" aria-label={'Delete ' + v.name} onClick={() => { deleteVersion(v.id); setList(listVersions()); }}><Icon name="trash" /></button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    ) : <p className="muted">No versions saved yet.</p>}
  </>;
}

function hasPrevious() {
  try { return !!localStorage.getItem(PREV_STORE); } catch { return false; }
}

export function Backstage() {
  const st = useApp();
  useEffect(() => {
    if (!st.backstage) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') st.setUI({ backstage: false }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.backstage]);
  if (!st.backstage) return null;
  const p = st.p, s = st.s, page = st.bsPage, img = hasImage(st), viewName = VIEW_NAMES[st.view];
  let body: JSX.Element;
  if (page === 'new') {
    body = <><h1>New</h1><div className="bs-cards">
      <button className="bs-card" onClick={() => runAction('new')}><div className="bs-thumb blank" /><b>Blank Project</b></button>
      <button className="bs-card" onClick={() => runAction('sample')}><div className="bs-thumb sample"><i /><i /><i /></div><b>Sample Project</b></button>
    </div><h2 className="bs-sub">Templates</h2><div className="bs-cards">
      {TEMPLATES.map(t => (
        <button key={t.id} className="bs-card" onClick={() => openTemplate(t)}>
          <div className="bs-thumb sample"><i /><i /><i /></div><b>{t.name}</b><span className="bs-card-sub">{t.desc}</span>
        </button>
      ))}
    </div></>;
  } else if (page === 'open') {
    body = <><h1>Open</h1>
      <Tile icon="upload" title="Browse…" sub="OpenPlan project files (.openplan, .json)" act="open" />
      <Tile icon="table" title="Import from Excel or CSV…" sub="Paste a task list from a spreadsheet, or choose a CSV file" act="import" />
      <Tile icon="file" title="Import from MS Project (.xml)…" sub="Open a Microsoft Project XML exchange file as this project" act="import-msp" />
      <Tile icon="layers" title="Insert as Subproject…" sub="Add another project file under a new summary task" act="insert" />
      <Tile icon="undo" title="Restore Previous Project" sub="Bring back the plan that was open before the last New, Open or Sample" act="restore" disabled={!hasPrevious()} />
    </>;
  } else if (page === 'save') {
    body = <><h1>Save</h1>
      <Tile icon="save" title="Save" sub="Save to an OpenPlan (.openplan) file on your computer; Ctrl+S saves back to the same file" act="save" />
      <Tile icon="save" title="Save As…" sub="Save a copy under a new name or location" act="saveas" />
      <Tile icon="link" title="Share a copy as a link" sub="Anyone with the link gets their own copy; nothing is uploaded" act="share" />
      <p className="bs-note">{st.saveState === 'ok' ? 'Your work is also saved automatically in this browser.'
        : st.saveState === 'full' ? 'This project is too large for browser storage: save a project file to keep your work.'
        : 'Browser storage is unavailable: download a project file to keep your work.'}</p></>;
  } else if (page === 'versions') {
    body = <VersionsPage />;
  } else if (page === 'export') {
    body = <><h1>Export</h1>
      <Tile icon="table" title="Excel workbook (.xlsx)" sub="Task table with real dates, costs and slack" act="xlsx" />
      <Tile icon="table" title="CSV (.csv)" sub="The same table as plain text, for any spreadsheet" act="csv" />
      <Tile icon="file" title="MS Project (.xml)" sub="Exchange format understood by Microsoft Project and compatible tools" act="mspxml" />
      <Tile icon="note" title="Word WBS dictionary (.doc)" sub="Cover page, one section per task and a task list appendix" act="wbsdoc" />
      <Tile icon="copy" title="Copy picture to clipboard" sub="High-resolution PNG (2×) of the current view" act="copyimg" disabled={!img} />
      <Tile icon="image" title={'Picture of the ' + viewName + ' (.png)'} sub={img ? 'For Word reports' : 'Switch to Gantt, Network, WBS or Team Chart first'} act="png" disabled={!img} />
      <Tile icon="image" title="Vector picture (.svg)" sub="Sharp at any size" act="svg" disabled={!img} /></>;
  } else if (page === 'print') {
    body = <><h1>Print</h1><Tile icon="printer" title={'Print ' + viewName} sub="Use “Save as PDF” in the print dialog to create a PDF" act="print" /></>;
  } else if (page === 'about') {
    body = <><h1>About</h1><img className="logo" src="./assets/OpenPlan.png" alt="OpenPlan" height={48} />
      <p className="bs-note">Free, browser-based project planning: Gantt chart, critical path, network diagram, WBS, resources, leveling, baselines, tracking, earned value and reports.</p>
      <Tile icon="info" title="Keyboard shortcuts and help" sub="Editing tips for the task table and Gantt chart" act="about" />
      <button className="bs-tile" onClick={() => st.setUI({ guide: true, backstage: false })}><Icon name="check" /><div><b>Getting started guide</b><span>Show the four-step checklist again</span></div></button></>;
  } else {
    const props: [string, string][] = [
      ['Start', U.fmtLong(s.startDn)], ['Finish', U.fmtLong(s.finishDn)], ['Duration', U.num(s.duration) + ' days'],
      ['Cost', U.money(s.totalCost, p.currency)], ['Budget', p.budget ? U.money(p.budget, p.currency) : '—'], ['Work', U.num(s.totalWork) + ' hrs'],
      ['Tasks', String(p.tasks.length)], ['Resources', String(p.resources.length)], ['Status', p.status], ['Manager', p.manager || '—'], ['Organisation', p.organization || '—']
    ];
    body = <><h1>Info</h1><div className="bs-cols">
      <div><h2>{p.name}</h2>
        <Tile icon="info" title="Project Information" sub="Name, start date, status date, budget, calendar and custom fields" act="settings" />
        <button className="bs-tile" onClick={() => st.setUI({ backstage: false, tab: 'project' })}>
          <Icon name="layers" /><div><b>{p.baseline ? 'Baseline saved' : 'No baseline'}</b>
            <span>{p.baseline ? 'Saved ' + U.fmtLong(U.parseDate(p.baseline.savedAt.slice(0, 10))) : 'Project › Set Baseline saves the current plan for tracking'}</span></div>
        </button>
      </div>
      <div className="bs-props"><h3>Project Properties</h3>{props.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    </div></>;
  }
  return (
    <div className="backstage">
      <nav className="bs-nav">
        <button className="bs-back" aria-label="Back" onClick={() => st.setUI({ backstage: false })}><Icon name="up" /></button>
        {PAGES.map(([k, label]) => <button key={k} className={'bs-item' + (page === k ? ' on' : '')} onClick={() => st.setUI({ bsPage: k })}>{label}</button>)}
      </nav>
      <div className="bs-body">{body}</div>
    </div>
  );
}
