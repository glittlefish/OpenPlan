import { useEffect } from 'react';
import { useStore, S, viewName } from './store';
import { runAction } from './lib/actions';
import * as ops from './lib/taskOps';
import { TitleBar, StatusBar, Backstage } from './components/Chrome';
import Ribbon from './components/Ribbon';
import Drawer from './components/Drawer';
import Guide from './components/Guide';
import FindBar from './components/FindBar';
import GanttView from './views/GanttView';
import BoardView from './views/BoardView';
import { NetworkView, WbsView, OrgView } from './views/Diagrams';
import { ResourcesView, WorkloadView } from './views/Sheets';
import BudgetView from './views/BudgetView';
import ReportsView from './views/ReportsView';

const VIEWS = {
  gantt: GanttView, board: BoardView, network: NetworkView, wbs: WbsView, resources: ResourcesView,
  org: OrgView, workload: WorkloadView, budget: BudgetView, reports: ReportsView
};

function onKeyDown(e: KeyboardEvent) {
  const st = S(), tag = (e.target as HTMLElement).tagName.toLowerCase();
  const editing = tag === 'input' || tag === 'textarea' || tag === 'select';
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (st.dialog) return;
  if (mod && key === 'f') { e.preventDefault(); st.setUI({ findOpen: !st.findOpen }); return; }
  if (mod && key === 's') { e.preventDefault(); runAction('save'); return; }
  if (mod && key === 'p') { e.preventDefault(); runAction('print'); return; }
  if (mod && !editing && key === 'z') { e.preventDefault(); if (e.shiftKey) st.redoAct(); else st.undoAct(); return; }
  if (mod && !editing && key === 'y') { e.preventDefault(); st.redoAct(); return; }
  if (e.key === 'Escape' && st.menu) { st.setUI({ menu: null }); return; }
  if (st.view !== 'gantt') return;
  if (mod && key === 'd') { e.preventDefault(); ops.fillDown(); return; }
  if (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    const fk = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    ops.indent(e.key === 'ArrowRight' ? 1 : -1);
    if (fk) requestAnimationFrame(() => (document.querySelector('[data-fk="' + fk + '"]') as HTMLElement | null)?.focus());
    return;
  }
  if (editing) return;
  if (e.key === 'Delete') { e.preventDefault(); ops.deleteSelected(); }
  else if (e.key === 'Insert') { e.preventDefault(); ops.addTask(false); }
}

export default function App() {
  const view = useStore(s => s.view);
  const bars = useStore(s => s.bars);
  const findOpen = useStore(s => s.findOpen);
  const lang = useStore(s => s.lang); // re-render on language switch so viewbar text updates

  useEffect(() => { document.documentElement.setAttribute('data-bars', bars); }, [bars]);
  useEffect(() => {
    // Close an open ribbon menu when clicking anywhere outside it.
    const onDown = (e: MouseEvent) => {
      if (S().menu && !(e.target as Element).closest('.menu-wrap')) S().setUI({ menu: null });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('mousedown', onDown); };
  }, []);

  const View = VIEWS[view] || GanttView;
  return <>
    <TitleBar />
    <Ribbon />
    <div className="layout">
      <div className="viewbar" aria-hidden="true"><span>{viewName(view)}</span></div>
      {findOpen && <FindBar />}
      <main><View /></main>
      <Drawer />
    </div>
    <StatusBar />
    <Guide />
    <Backstage />
  </>;
}
