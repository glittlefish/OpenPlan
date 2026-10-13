import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import OP from '../core';
import { useStore, S, focusKey, DEFAULT_COLS, type Store } from '../store';
import { COL_GROUPS, COLS, gridItems, menuData, toggleCol } from '../lib/grid';
import { hasImage, runAction } from '../lib/actions';
import * as ops from '../lib/taskOps';
import { scrollToSelected } from '../views/GanttView';
import Icon from './Icon';
import type { ViewName } from '../types';

const U = OP.util;
const TABS: [string, string, string][] = [['task', 'Task', 'gantt'], ['resource', 'Resource', 'users'], ['report', 'Report', 'report'], ['project', 'Project', 'target'], ['view', 'View', 'layers'], ['format', 'Format', 'sparkle']];

/* ---------- building blocks ---------- */

type BtnProps = { icon: string; label: ReactNode; title?: string; onClick: () => void; disabled?: boolean; on?: boolean; accent?: boolean };

function Big({ icon, label, title, onClick, disabled, on, accent }: BtnProps) {
  return (
    <button className={'rb big' + (on ? ' on' : '') + (accent ? ' accent' : '')} disabled={disabled} title={title} onClick={onClick}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  );
}
function Small({ icon, label, title, onClick, disabled, on }: BtnProps) {
  return (
    <button className={'rb small' + (on ? ' on' : '')} disabled={disabled} title={title || String(label)} onClick={onClick}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  );
}
function Ico({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return <button className="rb ico" title={title} aria-label={title} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>;
}
const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="rgroup"><div className="rg-body">{children}</div><div className="rg-label">{label}</div></div>
);
const Stack = ({ children }: { children: ReactNode }) => <div className="rstack">{children}</div>;
const RowBox = ({ children }: { children: ReactNode }) => <div className="rrow">{children}</div>;

// Arrow keys move between the menu's buttons and checkboxes.
function menuKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}

function DropBig({ id, icon, label, children, st }: { id: string; icon: string; label: ReactNode; children: ReactNode; st: Store }) {
  const open = st.menu === id;
  const wrap = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const w = wrap.current, m = menu.current;
    if (!open || !w || !m) return;
    const r = w.getBoundingClientRect();
    m.style.position = 'fixed';
    m.style.top = r.bottom + 'px';
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
    // The position is measured once, so close the menu when its button moves.
    const close = () => S().setUI({ menu: null }), ribbon = w.closest('.ribbon');
    addEventListener('resize', close);
    ribbon?.addEventListener('scroll', close);
    return () => { removeEventListener('resize', close); ribbon?.removeEventListener('scroll', close); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="rb big drop" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => st.setUI({ menu: open ? null : id })}><Icon name={icon} /><span>{label} ▾</span></button>
      <div id={id} ref={menu} role="menu" className={'menu left' + (open ? ' open' : '')} onKeyDown={menuKeys}>{children}</div>
    </div>
  );
}
function MenuItem({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return <button role="menuitem" disabled={disabled} onClick={() => { S().setUI({ menu: null }); onClick(); }}><Icon name={icon} />{label}</button>;
}

function Check({ label, checked, onChange, disabled, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className={'rcheck' + (disabled ? ' off' : '')} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />{label}
    </label>
  );
}
function SelectRow({ label, value, map, onChange }: { label: string; value: string; map: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <label className="rselect"><span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {Object.entries(map).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

/* ---------- commands ---------- */

// Commands that edit the task list switch to the Gantt Chart first.
function inGantt(fn: () => void) { return () => { if (S().view !== 'gantt') S().setView('gantt'); fn(); }; }

function setAllCollapsed(collapse: boolean) {
  const st = S();
  if (!collapse) { st.setUI({ collapsed: {} }); return; }
  const collapsed: Record<string, boolean> = Object.fromEntries(st.s.rows.filter(r => r.summary).map(r => [r.task.uid, true]));
  gridItems({ ...st, collapsed: {} }).forEach(it => { if ('group' in it) collapsed[it.key] = true; });
  st.setUI({ collapsed });
}

function assignResources() {
  const st = S();
  if (st.sel.length !== 1) { st.toast('Select one task first, then choose Assign Resources.'); return; }
  if (!['gantt', 'network', 'wbs'].includes(st.view)) st.setView('gantt');
  st.setUI({ drawer: true });
  focusKey('d:addres', false);
}

function nextOverallocation() {
  const st = S();
  let first: any = null;
  st.s.rows.forEach((r: any) => { if (r.over && (!first || r.startDn < first.startDn)) first = r; });
  if (!first) { st.toast('No overallocated tasks.'); return; }
  st.setView('gantt');
  st.select([first.task.uid], first.task.uid);
  requestAnimationFrame(scrollToSelected);
  st.toast('Task ' + first.id + ' uses an overallocated resource');
}

function ColumnsMenu({ st }: { st: Store }) {
  const set = (k: string, on: boolean) => st.setUI({ cols: toggleCol(st.cols, k, on) });
  return (
    <div className="cols-list">
      {COL_GROUPS.map(([label, keys]) => (
        <div key={label}>
          <div className="label">{label}</div>
          <div className="col-grid">
            {keys.map(k => <label key={k} className="chk"><input type="checkbox" checked={st.cols.includes(k)} onChange={e => set(k, e.target.checked)} />{COLS[k].t}</label>)}
          </div>
        </div>
      ))}
      {st.p.customFields.length > 0 && <>
        <div className="label">Custom fields</div>
        <div className="col-grid">
          {st.p.customFields.map(f => <label key={f.id} className="chk"><input type="checkbox" checked={st.cols.includes('cf:' + f.id)} onChange={e => set('cf:' + f.id, e.target.checked)} />{f.name}</label>)}
        </div>
      </>}
      <hr />
      <MenuItem icon="undo" label="Reset to default columns" onClick={() => st.setUI({ cols: DEFAULT_COLS.slice() })} />
    </div>
  );
}

/* ---------- tabs ---------- */

function TaskTab({ st }: { st: Store }) {
  const noSel = !st.sel.length;
  const viewBtn = (v: ViewName, icon: string, label: ReactNode) => <Big icon={icon} label={label} on={st.view === v} onClick={() => st.setView(v)} />;
  return <>
    <Group label="View">{viewBtn('gantt', 'gantt', <>Gantt<br />Chart</>)}</Group>
    <Group label="Schedule">
      <Stack>
        <RowBox>{[0, 25, 50, 75, 100].map(v => <button key={v} className="rb pct" disabled={noSel} title={'Mark ' + v + '% complete'} onClick={() => ops.markPercent(v)}>{v}%</button>)}</RowBox>
        <RowBox>
          <Ico icon="outdent" title="Outdent Task (Alt+Shift+←)" disabled={noSel} onClick={inGantt(() => ops.indent(-1))} />
          <Ico icon="indent" title="Indent Task (Alt+Shift+→)" disabled={noSel} onClick={inGantt(() => ops.indent(1))} />
          <Ico icon="link" title="Link the Selected Tasks" disabled={st.sel.length < 2} onClick={ops.linkSelected} />
          <Ico icon="unlink" title="Unlink Tasks" disabled={noSel} onClick={ops.unlinkSelected} />
        </RowBox>
        <RowBox><Small icon="check" label="Mark on Track" onClick={ops.updateAsScheduled} /></RowBox>
      </Stack>
    </Group>
    <Group label="Tasks">
      <Stack>
        <Small icon="up" label="Move Up" disabled={noSel} onClick={inGantt(() => ops.move(-1))} />
        <Small icon="down" label="Move Down" disabled={noSel} onClick={inGantt(() => ops.move(1))} />
        <Small icon="trash" label="Delete" disabled={noSel} onClick={ops.deleteSelected} />
      </Stack>
    </Group>
    <Group label="Insert">
      <Big icon="plus" label="Task" accent onClick={() => ops.addTask(false)} />
      <Stack>
        <Small icon="diamond" label="Milestone" onClick={() => ops.addTask(true)} />
        <Small icon="repeat" label="Recurring Task…" onClick={() => st.openDialog('recurring')} />
        <Small icon="layers" label="Subproject…" onClick={() => runAction('insert')} />
      </Stack>
    </Group>
    <Group label="Properties">
      <Big icon="panel" label="Information" on={st.drawer} onClick={() => st.setUI({ drawer: !st.drawer })} />
      <Stack>
        <Small icon="users" label="Assign Resources" disabled={st.sel.length !== 1} onClick={assignResources} />
        <Small icon="target" label="Scroll to Task" onClick={inGantt(() => requestAnimationFrame(scrollToSelected))} />
      </Stack>
    </Group>
    <Group label="Editing">
      <Stack>
        <Small icon="undo" label="Undo" disabled={!st.undo.length} onClick={st.undoAct} />
        <Small icon="redo" label="Redo" disabled={!st.redo.length} onClick={st.redoAct} />
      </Stack>
    </Group>
  </>;
}

function ResourceTab({ st }: { st: Store }) {
  return <>
    <Group label="View">
      <Big icon="users" label={<>Resource<br />Sheet</>} on={st.view === 'resources'} onClick={() => st.setView('resources')} />
      <Stack>
        <Small icon="org" label="Team Chart" on={st.view === 'org'} onClick={() => st.setView('org')} />
        <Small icon="grid" label="Resource Usage" on={st.view === 'workload'} onClick={() => st.setView('workload')} />
      </Stack>
    </Group>
    <Group label="Assignments"><Big icon="users" label={<>Assign<br />Resources</>} disabled={st.sel.length !== 1} onClick={assignResources} /></Group>
    <Group label="Insert"><Big icon="plus" label={<>Add<br />Resources</>} accent onClick={ops.addResource} /></Group>
    <Group label="Level">
      <Big icon="balance" label={<>Level<br />All</>} onClick={ops.levelAll} />
      <Stack>
        <Small icon="x" label="Clear Leveling" onClick={ops.clearLeveling} />
        <Small icon="grid" label="Next Overallocation" onClick={nextOverallocation} />
      </Stack>
    </Group>
  </>;
}

function ReportTab({ st }: { st: Store }) {
  const rpt = (icon: string, label: ReactNode, id: string) => (
    <Big icon={icon} label={label} on={st.view === 'reports' && st.report === id} onClick={() => { st.setUI({ report: id }); st.setView('reports'); }} />
  );
  const more: [string, string][] = [['critical', 'Critical Tasks'], ['milestones', 'Milestones'], ['who', 'Who Does What'], ['variance', 'Baseline Variance'], ['tasks', 'Task List']];
  return <>
    <Group label="View Reports">
      {rpt('report', 'Dashboard', 'overview')}{rpt('users', 'Resources', 'resources')}{rpt('wallet', 'Costs', 'cost')}
      {rpt('clock', <>In<br />Progress</>, 'late')}{rpt('balance', <>Earned<br />Value</>, 'ev')}
      <DropBig id="rbMoreReports" icon="table" label={<>More<br />Reports</>} st={st}>
        {more.map(([id, label]) => <MenuItem key={id} icon="report" label={label} onClick={() => { st.setUI({ report: id }); st.setView('reports'); }} />)}
      </DropBig>
    </Group>
    <Group label="Budget"><Big icon="wallet" label={<>Cost &amp;<br />Budget</>} on={st.view === 'budget'} onClick={() => st.setView('budget')} /></Group>
    <Group label="Export">
      <Big icon="printer" label="Print" onClick={() => runAction('print')} />
      <Stack>
        <Small icon="image" label="Picture (PNG)" disabled={!hasImage(st)} onClick={() => runAction('png')} />
        <Small icon="table" label="Excel (.xlsx)" onClick={() => runAction('xlsx')} />
        <Small icon="table" label="CSV" onClick={() => runAction('csv')} />
        <Small icon="file" label="MS Project (.xml)" onClick={() => runAction('mspxml')} />
      </Stack>
    </Group>
  </>;
}

function ProjectTab({ st }: { st: Store }) {
  const hasBase = !!st.p.baseline;
  return <>
    <Group label="Insert"><Big icon="layers" label="Subproject" onClick={() => runAction('insert')} /></Group>
    <Group label="Properties">
      <Big icon="info" label={<>Project<br />Information</>} onClick={() => st.openDialog('settings')} />
      <Stack>
        <Small icon="columns" label="Custom Fields" onClick={() => st.openDialog('settings')} />
        <Small icon="clock" label="Change Working Time" onClick={() => st.openDialog('calendar')} />
        <Small icon="tree" label="WBS Chart" on={st.view === 'wbs'} onClick={() => st.setView('wbs')} />
        <Small icon="network" label="Network Diagram" on={st.view === 'network'} onClick={() => st.setView('network')} />
      </Stack>
    </Group>
    <Group label="Schedule">
      <DropBig id="rbBaseline" icon="layers" label={<>Set<br />Baseline</>} st={st}>
        <MenuItem icon="layers" label={hasBase ? 'Update Baseline' : 'Set Baseline'} onClick={ops.setBaseline} />
        <MenuItem icon="x" label="Clear Baseline" disabled={!hasBase} onClick={ops.clearBaseline} />
      </DropBig>
      <Stack>
        <Small icon="clock" label={'Status Date: ' + (st.p.statusDate ? U.fmt(U.parseDate(st.p.statusDate)) : 'NA')} onClick={() => st.openDialog('settings')} />
        <Small icon="check" label="Update Project" onClick={ops.updateAsScheduled} />
        <Small icon="balance" label="Level Resources" onClick={ops.levelAll} />
      </Stack>
    </Group>
    <Group label="Status">
      <div className="rinfo">
        <div><span>Start</span><b>{U.fmt(st.s.startDn)}</b></div>
        <div><span>Finish</span><b>{U.fmt(st.s.finishDn)}</b></div>
        <div><span>Cost</span><b>{U.money(st.s.totalCost, st.p.currency)}</b></div>
      </div>
    </Group>
  </>;
}

function ViewTab({ st }: { st: Store }) {
  const md = menuData(st);
  const vb = (v: ViewName, icon: string, label: ReactNode) => <Big icon={icon} label={label} on={st.view === v} onClick={() => st.setView(v)} />;
  const vs = (v: ViewName, icon: string, label: string) => <Small icon={icon} label={label} on={st.view === v} onClick={() => st.setView(v)} />;
  return <>
    <Group label="Task Views">{vb('gantt', 'gantt', <>Gantt<br />Chart</>)}{vb('board', 'columns', <>Task<br />Board</>)}{vb('network', 'network', <>Network<br />Diagram</>)}{vb('wbs', 'tree', <>WBS<br />Chart</>)}</Group>
    <Group label="Resource Views"><Stack>{vs('resources', 'users', 'Resource Sheet')}{vs('org', 'org', 'Team Chart')}{vs('workload', 'grid', 'Resource Usage')}</Stack></Group>
    <Group label="Data">
      <Stack>
        <SelectRow label="Sort" value={st.sort} map={md.sorts} onChange={v => st.setUI({ sort: v })} />
        <SelectRow label="Filter" value={md.filters[st.filter] ? st.filter : 'all'} map={md.filters} onChange={v => st.setUI({ filter: v })} />
        <SelectRow label="Group" value={md.groups[st.group] ? st.group : 'none'} map={md.groups} onChange={v => st.setUI({ group: v })} />
      </Stack>
      <DropBig id="colMenu" icon="columns" label="Tables" st={st}><ColumnsMenu st={st} /></DropBig>
    </Group>
    <Group label="Outline">
      <Stack>
        <Small icon="chevD" label="Expand All" title="Show all subtasks" onClick={inGantt(() => setAllCollapsed(false))} />
        <Small icon="chevR" label="Collapse All" title="Show only top-level tasks" onClick={inGantt(() => setAllCollapsed(true))} />
      </Stack>
    </Group>
    <Group label="Zoom">
      <Stack>
        <SelectRow label="Timescale" value={st.zoom} map={{ day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters' }} onChange={v => st.setUI({ zoom: v })} />
        <Small icon="target" label="Selected Tasks" onClick={inGantt(() => requestAnimationFrame(scrollToSelected))} />
      </Stack>
    </Group>
    <Group label="Split View">
      <Stack>
        <Check label="Timeline" checked={st.timeline} onChange={v => st.setUI({ timeline: v })} />
        <Check label="Details" checked={st.drawer} onChange={v => st.setUI({ drawer: v })} />
      </Stack>
    </Group>
    <Group label="Window"><Big icon={st.theme === 'dark' ? 'sun' : 'moon'} label={<>Dark<br />Mode</>} on={st.theme === 'dark'} onClick={() => st.setUI({ theme: st.theme === 'dark' ? 'light' : 'dark' })} /></Group>
  </>;
}

function FormatTab({ st }: { st: Store }) {
  const hasBase = !!st.p.baseline;
  return <>
    <Group label="Columns"><DropBig id="colMenu" icon="columns" label={<>Insert<br />Column</>} st={st}><ColumnsMenu st={st} /></DropBig></Group>
    <Group label="Bar Styles">
      <Stack>
        <Check label="Critical Tasks" checked={st.critical} onChange={v => st.setUI({ critical: v })} />
        <Check label="Baseline" checked={st.showBaseline && hasBase} disabled={!hasBase} title={hasBase ? '' : 'Set a baseline first (Project › Set Baseline)'} onChange={v => st.setUI({ showBaseline: v })} />
        <Check label="Timeline" checked={st.timeline} onChange={v => st.setUI({ timeline: v })} />
      </Stack>
    </Group>
    <Group label="Dates">
      <Stack>
        <Check label="Full Year (2026)" title="Show dates as 12 Jan 2026 instead of 12 Jan 26" checked={st.fullYear} onChange={v => st.setUI({ fullYear: v })} />
      </Stack>
    </Group>
    <Group label="Gantt Chart Style">
      <div className="swatches">
        {['teal', 'indigo', 'amber', 'slate'].map(c => (
          <button key={c} className={'swatch sw-' + c + (st.bars === c ? ' on' : '')} title={c + ' bars'} onClick={() => st.setUI({ bars: c })}><i /><i /></button>
        ))}
      </div>
    </Group>
    <Group label="Show/Hide">
      <Stack>
        <Check label="Outline Numbers" checked={st.cols.includes('wbs')} onChange={v => st.setUI({ cols: toggleCol(st.cols, 'wbs', v) })} />
      </Stack>
    </Group>
  </>;
}

export default function Ribbon() {
  const st = useStore();
  const tools = st.view === 'gantt';
  const tab = st.tab === 'format' && !tools ? 'task' : st.tab;
  const Body = { task: TaskTab, resource: ResourceTab, report: ReportTab, project: ProjectTab, view: ViewTab, format: FormatTab }[tab] || TaskTab;
  const [peek, setPeek] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!st.ribbonMin) setPeek(false); }, [st.ribbonMin]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'F1') { e.preventDefault(); S().setUI({ ribbonMin: !S().ribbonMin }); }
      else if (e.key === 'Escape') setPeek(false);
    };
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setPeek(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, []);
  const onTab = (k: string) => {
    if (st.ribbonMin) setPeek(!(peek && tab === k));
    st.setUI({ tab: k });
  };
  const onCommand = (e: React.MouseEvent) => {
    const b = (e.target as Element).closest('button');
    if (peek && b && !b.classList.contains('drop')) setPeek(false);
  };
  return <div className="ribbon-wrap" ref={wrap}>
    <nav className="ribbon-tabs" aria-label="Toolbar">
      <button className="rtab file" onClick={() => st.setUI({ backstage: true, bsPage: 'info', menu: null })}><Icon name="menu" />File</button>
      {TABS.filter(([k]) => k !== 'format' || tools).map(([k, label, icon]) => (
        <button key={k} aria-pressed={tab === k} className={'rtab' + (tab === k ? ' on' : '')}
          onClick={() => onTab(k)} onDoubleClick={() => st.setUI({ ribbonMin: !st.ribbonMin })}><Icon name={icon} />{label}</button>
      ))}
      <span className="rtab-fill" />
      <button className="rb-collapse" title={(st.ribbonMin ? 'Show' : 'Hide') + ' the toolbar (Ctrl+F1)'} onClick={() => st.setUI({ ribbonMin: !st.ribbonMin })}>
        <Icon name={st.ribbonMin ? 'chevD' : 'up'} />{st.ribbonMin ? 'Show toolbar' : 'Hide toolbar'}
      </button>
    </nav>
    <div className={'ribbon' + (st.ribbonMin ? ' min' : '') + (peek ? ' peek' : '')} onClick={onCommand}><Body st={st} /></div>
  </div>;
}
