import { useEffect, useState, type JSX } from 'react';
import OP from '../core';
import { useApp, ask, viewName, ZOOMS, PREV_STORE } from '../store';
import { t } from '../i18n';
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
        <button className="qat-btn home" title={t('OpenPlan home')} aria-label={t('OpenPlan home')} onClick={() => { location.hash = ''; }}><img className="app-icon" src={LOGO_MARK} alt="" /></button>
        <button className="qat-btn" title={t('Save (Ctrl+S)')} aria-label={t('Save')} onClick={() => runAction('save')}><Icon name="save" /></button>
        <button className="qat-btn" title={t('Undo (Ctrl+Z)')} aria-label={t('Undo')} disabled={!st.undo.length} onClick={st.undoAct}><Icon name="undo" /></button>
        <button className="qat-btn" title={t('Redo (Ctrl+Y)')} aria-label={t('Redo')} disabled={!st.redo.length} onClick={st.redoAct}><Icon name="redo" /></button>
      </div>
      <div className="title">
        {renaming
          ? <input className="title-inp" aria-label={t('Project name')} defaultValue={st.p.name} size={st.p.name.length || 8} autoFocus onFocus={e => e.target.select()}
              onBlur={e => rename(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.value = st.p.name; if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
          : <button className="title-btn" title={t('Rename project')} onClick={() => setRenaming(true)}>{st.p.name}</button>}
        {' - OpenPlan'}
      </div>
      <div className="tb-right">
        <button className="qat-btn lang-btn" title={st.lang === 'zh-CN' ? 'Switch to English' : '切换到中文'} aria-label={t('Switch language')}
          onClick={() => st.setUI({ lang: st.lang === 'zh-CN' ? 'en-US' : 'zh-CN' })}>
          {st.lang === 'zh-CN' ? 'EN' : '中'}
        </button>
        <button className="qat-btn" title={t('Dark / light')} aria-label={t('Toggle dark mode')} onClick={() => st.setUI({ theme: st.theme === 'dark' ? 'light' : 'dark' })}>
          <Icon name={st.theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="qat-btn" title={t('Share a copy as a link')} aria-label={t('Share a copy as a link')} onClick={() => runAction('share')}><Icon name="link" /></button>
        <button className="qat-btn" title={t('About OpenPlan')} aria-label={t('About')} onClick={() => st.openDialog('about')}><Icon name="info" /></button>
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
      <span>{t('Ready')}</span>
      <span className="sb-sep" />
      <span className="hide-sm">{t('New Tasks : Auto Scheduled')}</span>
      <span className="sb-sep hide-sm" />
      <span className="save-state">
        {st.saveState === 'ok' ? <><Icon name="check" />{t('Saved in this browser')}</>
          : <span style={{ color: 'var(--warn)' }}><Icon name="alert" />{st.saveState === 'full' ? t('Project too large for autosave — use File › Save') : t('Browser storage unavailable — use File › Save')}</span>}
      </span>
      <span className="spacer" />
      <div className="sb-views">
        {SB_VIEWS.map(([v, icon]) => (
          <button key={v} className={st.view === v ? 'active' : ''} title={viewName(v)} aria-label={viewName(v)} onClick={() => st.setView(v)}><Icon name={icon} /></button>
        ))}
      </div>
      <div className="sb-zoom" title={t('Timescale zoom')}>
        <button className="z-btn" aria-label={t('Zoom out')} onClick={() => setZoom(zi - 1)}>−</button>
        <input type="range" min={0} max={3} step={1} value={zi} aria-label={t('Timescale zoom')} onChange={e => setZoom(+e.target.value)} />
        <button className="z-btn" aria-label={t('Zoom in')} onClick={() => setZoom(zi + 1)}>+</button>
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
    const err = saveVersion(name || t('Version {n}', { n: list.length + 1 }), st.p);
    if (err) { st.toast(err, true); return; }
    st.toast(t('Version saved'));
    setName('');
    setList(listVersions());
  };
  const restore = (v: Version) => ask(t('Restore “{name}”? The current plan can be restored from File › Open › Restore Previous Project.', { name: v.name }), () => {
    try { loadProject(OP.io.fromJSON(v.json), t('Version “{name}” restored', { name: v.name })); } catch (e: any) { st.toast(t('Could not restore: {msg}', { msg: e.message }), true); }
  }, t('Restore'));
  return <>
    <h1>{t('Versions')}</h1>
    <p className="bs-note">{t('Save named copies of your plan, for example before a big change, and go back to any of them later. Versions are kept in this browser only; save a project file to keep a copy elsewhere.')}</p>
    <form className="ver-form" onSubmit={save}>
      <input className="inp" id="version-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('Version name, e.g. Before sprint 2')} aria-label={t('Version name')} maxLength={80} />
      <button className="btn primary" type="submit"><Icon name="save" />{t('Save version')}</button>
    </form>
    {list.length ? (
      <table className="data ver-list">
        <thead><tr><th>{t('Version')}</th><th>{t('Plan')}</th><th>{t('Saved')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
        <tbody>{list.map(v => (
          <tr key={v.id}>
            <td>{v.name}</td><td>{v.project}</td><td>{new Date(v.at).toLocaleString()}</td>
            <td className="ver-acts">
              <button className="btn" onClick={() => restore(v)}>{t('Restore')}</button>
              <button className="icon-btn" title={t('Delete')} aria-label={t('Delete {name}', { name: v.name })} onClick={() => { deleteVersion(v.id); setList(listVersions()); }}><Icon name="trash" /></button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    ) : <p className="muted">{t('No versions saved yet.')}</p>}
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
  const p = st.p, s = st.s, page = st.bsPage, img = hasImage(st), vName = viewName(st.view);
  let body: JSX.Element;
  if (page === 'new') {
    body = <><h1>{t('New')}</h1><div className="bs-cards">
      <button className="bs-card" onClick={() => runAction('new')}><div className="bs-thumb blank" /><b>{t('Blank Project')}</b></button>
      <button className="bs-card" onClick={() => runAction('sample')}><div className="bs-thumb sample"><i /><i /><i /></div><b>{t('Sample Project')}</b></button>
    </div><h2 className="bs-sub">{t('Templates')}</h2><div className="bs-cards">
      {TEMPLATES.map(tpl => (
        <button key={tpl.id} className="bs-card" onClick={() => openTemplate(tpl)}>
          <div className="bs-thumb sample"><i /><i /><i /></div><b>{tpl.name}</b><span className="bs-card-sub">{tpl.desc}</span>
        </button>
      ))}
    </div></>;
  } else if (page === 'open') {
    body = <><h1>{t('Open')}</h1>
      <Tile icon="upload" title={t('Browse…')} sub={t('OpenPlan project files (.openplan, .json)')} act="open" />
      <Tile icon="table" title={t('Import from Excel or CSV…')} sub={t('Paste a task list from a spreadsheet, or choose a CSV file')} act="import" />
      <Tile icon="file" title={t('Import from MS Project (.xml)…')} sub={t('Open a Microsoft Project XML exchange file as this project')} act="import-msp" />
      <Tile icon="layers" title={t('Insert as Subproject…')} sub={t('Add another project file under a new summary task')} act="insert" />
      <Tile icon="undo" title={t('Restore Previous Project')} sub={t('Bring back the plan that was open before the last New, Open or Sample')} act="restore" disabled={!hasPrevious()} />
    </>;
  } else if (page === 'save') {
    body = <><h1>{t('Save')}</h1>
      <Tile icon="save" title={t('Save')} sub={t('Save to an OpenPlan (.openplan) file on your computer; Ctrl+S saves back to the same file')} act="save" />
      <Tile icon="save" title={t('Save As…')} sub={t('Save a copy under a new name or location')} act="saveas" />
      <Tile icon="link" title={t('Share a copy as a link')} sub={t('Anyone with the link gets their own copy; nothing is uploaded')} act="share" />
      <p className="bs-note">{st.saveState === 'ok' ? t('Your work is also saved automatically in this browser.')
        : st.saveState === 'full' ? t('This project is too large for browser storage: save a project file to keep your work.')
        : t('Browser storage is unavailable: download a project file to keep your work.')}</p></>;
  } else if (page === 'versions') {
    body = <VersionsPage />;
  } else if (page === 'export') {
    body = <><h1>{t('Export')}</h1>
      <Tile icon="table" title={t('Excel workbook (.xlsx)')} sub={t('Task table with real dates, costs and slack')} act="xlsx" />
      <Tile icon="table" title={t('CSV (.csv)')} sub={t('The same table as plain text, for any spreadsheet')} act="csv" />
      <Tile icon="file" title={t('MS Project (.xml)')} sub={t('Exchange format understood by Microsoft Project and compatible tools')} act="mspxml" />
      <Tile icon="note" title={t('Word WBS dictionary (.doc)')} sub={t('Cover page, one section per task and a task list appendix')} act="wbsdoc" />
      <Tile icon="copy" title={t('Copy picture to clipboard')} sub={t('High-resolution PNG (2×) of the current view')} act="copyimg" disabled={!img} />
      <Tile icon="image" title={t('Picture of the {view} (.png)', { view: vName })} sub={img ? t('For Word reports') : t('Switch to Gantt, Network, WBS or Team Chart first')} act="png" disabled={!img} />
      <Tile icon="image" title={t('Vector picture (.svg)')} sub={t('Sharp at any size')} act="svg" disabled={!img} /></>;
  } else if (page === 'print') {
    body = <><h1>{t('Print')}</h1><Tile icon="printer" title={t('Print {view}', { view: vName })} sub={t('Use “Save as PDF” in the print dialog to create a PDF')} act="print" /></>;
  } else if (page === 'about') {
    body = <><h1>{t('About')}</h1><img className="logo" src="./assets/OpenPlan.png" alt="OpenPlan" height={48} />
      <p className="bs-note">{t('Free, browser-based project planning: Gantt chart, critical path, network diagram, WBS, resources, leveling, baselines, tracking, earned value and reports.')}</p>
      <Tile icon="info" title={t('Keyboard shortcuts and help')} sub={t('Editing tips for the task table and Gantt chart')} act="about" />
      <button className="bs-tile" onClick={() => st.setUI({ guide: true, backstage: false })}><Icon name="check" /><div><b>{t('Getting started guide')}</b><span>{t('Show the four-step checklist again')}</span></div></button></>;
  } else {
    const props: [string, string][] = [
      [t('Start'), U.fmtLong(s.startDn)], [t('Finish'), U.fmtLong(s.finishDn)], [t('Duration'), t('{n} days', { n: U.num(s.duration) })],
      [t('Cost'), U.money(s.totalCost, p.currency)], [t('Budget'), p.budget ? U.money(p.budget, p.currency) : '—'], [t('Work'), t('{n} hrs', { n: U.num(s.totalWork) })],
      [t('Tasks'), String(p.tasks.length)], [t('Resources'), String(p.resources.length)], [t('Status'), p.status], [t('Manager'), p.manager || '—'], [t('Organisation'), p.organization || '—']
    ];
    body = <><h1>{t('Info')}</h1><div className="bs-cols">
      <div><h2>{p.name}</h2>
        <Tile icon="info" title={t('Project Information')} sub={t('Name, start date, status date, budget, calendar and custom fields')} act="settings" />
        <button className="bs-tile" onClick={() => st.setUI({ backstage: false, tab: 'project' })}>
          <Icon name="layers" /><div><b>{p.baseline ? t('Baseline saved') : t('No baseline')}</b>
            <span>{p.baseline ? t('Saved {date}', { date: U.fmtLong(U.parseDate(p.baseline.savedAt.slice(0, 10))) }) : t('Project › Set Baseline saves the current plan for tracking')}</span></div>
        </button>
      </div>
      <div className="bs-props"><h3>{t('Project Properties')}</h3>{props.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    </div></>;
  }
  return (
    <div className="backstage">
      <nav className="bs-nav">
        <button className="bs-back" aria-label={t('Back')} onClick={() => st.setUI({ backstage: false })}><Icon name="up" /></button>
        {PAGES.map(([k, label]) => <button key={k} className={'bs-item' + (page === k ? ' on' : '')} onClick={() => st.setUI({ bsPage: k })}>{t(label)}</button>)}
      </nav>
      <div className="bs-body">{body}</div>
    </div>
  );
}
