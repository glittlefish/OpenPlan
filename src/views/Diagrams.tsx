import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp, useStore, S } from '../store';
import { runAction, viewSvgString } from '../lib/actions';
import Icon from '../components/Icon';

// Zoomable SVG canvas. Ctrl+wheel zooms, a plain wheel scrolls natively.
// openMode 'drawer' (WBS/Org): click selects and opens the side panel.
// openMode 'dialog' (Network): click only selects; double-click opens a details dialog.
function Canvas({ svg, nodeClass, openMode = 'drawer' }: { svg: string; nodeClass?: string; openMode?: 'drawer' | 'dialog' }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useStore(s => s.netZoom);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector('svg');
    if (!el) return;
    if (!el.dataset.w) { el.dataset.w = el.getAttribute('width')!; el.dataset.h = el.getAttribute('height')!; }
    el.setAttribute('width', String(Math.round(+el.dataset.w * zoom)));
    el.setAttribute('height', String(Math.round(+el.dataset.h! * zoom)));
  }, [svg, zoom]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel: keep native scrolling
      e.preventDefault();
      const st = S();
      st.setUI({ netZoom: Math.max(0.2, Math.min(2.5, st.netZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const uidOf = (target: EventTarget): number | null => {
    if (!nodeClass) return null;
    const g = (target as Element).closest('.' + nodeClass) as SVGGElement | null;
    return g ? +g.dataset.uid! : null;
  };
  const openDetails = (uid: number) => {
    if (openMode === 'dialog') S().openDialog('task', { uid });
    else S().setUI({ drawer: true });
  };
  return (
    <div className="canvas" id="canvas" ref={ref} dangerouslySetInnerHTML={{ __html: svg }}
      onClick={e => { const uid = uidOf(e.target); if (uid == null) return; S().select([uid], uid); if (openMode === 'drawer') openDetails(uid); }}
      onDoubleClick={e => { const uid = uidOf(e.target); if (uid == null) return; S().select([uid], uid); if (openMode === 'dialog') openDetails(uid); }}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const uid = uidOf(e.target);
        if (uid == null) return;
        e.preventDefault();
        S().select([uid], uid);
        openDetails(uid);
      }} />
  );
}

function zoomBy(kind: 'in' | 'out' | 'fit') {
  const st = S();
  if (kind === 'fit') {
    const box = document.getElementById('canvas'), el = box?.querySelector('svg');
    if (!box || !el) return;
    st.setUI({ netZoom: Math.min(1.5, Math.max(0.2, Math.min((box.clientWidth - 4) / +el.dataset.w!, (box.clientHeight - 4) / +el.dataset.h!))) });
  } else st.setUI({ netZoom: Math.max(0.2, Math.min(2.5, st.netZoom * (kind === 'in' ? 1.2 : 1 / 1.2))) });
}

function ZoomTools() {
  return <>
    <button className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy('out')}><Icon name="zout" /></button>
    <button className="icon-btn" title="Fit to window" aria-label="Fit to window" onClick={() => zoomBy('fit')}><Icon name="fit" /></button>
    <button className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy('in')}><Icon name="zin" /></button>
    <button className="btn" onClick={() => runAction('png')}><Icon name="image" />PNG</button>
  </>;
}

const Empty = ({ title, text }: { title: string; text: string }) => (
  <div className="canvas"><div className="empty"><h3>{title}</h3><div>{text}</div></div></div>
);

export function NetworkView() {
  const st = useApp();
  const svg = useMemo(() => viewSvgString(st), [st.p, st.s, st.netScope, st.netDates, st.critical, st.view]);
  const tops = st.s.rows.filter((r: any) => r.summary && r.task.level === 1);
  return (
    <div className="view">
      <div className="view-head"><h1>Network diagram</h1><span className="sub">Activity-on-node with ES, EF, LS, LF and total slack</span></div>
      <div className="toolbar">
        <select className="sel" aria-label="Scope" value={st.netScope} onChange={e => st.setUI({ netScope: e.target.value, netZoom: 1 })}>
          <option value="all">All tasks</option>
          {tops.map((r: any) => <option key={r.task.uid} value={String(r.task.uid)}>{r.wbs} {r.task.name}</option>)}
        </select>
        <div className="seg">
          <button className={!st.netDates ? 'on' : ''} onClick={() => st.setUI({ netDates: false })}>Day numbers</button>
          <button className={st.netDates ? 'on' : ''} onClick={() => st.setUI({ netDates: true })}>Dates</button>
        </div>
        <label className="toggle"><input type="checkbox" checked={st.critical} onChange={e => st.setUI({ critical: e.target.checked })} />Critical path</label>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="nnode" openMode="dialog" /> : <Empty title="Nothing to show" text="Add tasks in the Gantt view first." />}
    </div>
  );
}

export function WbsView() {
  const st = useApp();
  const svg = useMemo(() => viewSvgString(st), [st.p, st.s, st.wbsDepth, st.view]);
  const maxLv = st.s.rows.reduce((a: number, r: any) => Math.max(a, r.task.level), 1);
  const levels: number[] = [];
  for (let l = 2; l <= Math.max(2, maxLv); l++) levels.push(l);
  return (
    <div className="view">
      <div className="view-head"><h1>Work breakdown structure</h1>
        <span className="sub">{st.s.rows.length} work items · {st.s.rows.filter((r: any) => r.task.level === 1).length} top-level packages</span></div>
      <div className="toolbar">
        <span className="muted">Show levels</span>
        <div className="seg">{levels.map(l => <button key={l} className={Math.min(st.wbsDepth, maxLv) === l ? 'on' : ''} onClick={() => st.setUI({ wbsDepth: l })}>{l}</button>)}</div>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="wnode" openMode="dialog" /> : <Empty title="No work items yet" text="Build your task outline in the Gantt view; indented tasks become WBS levels." />}
    </div>
  );
}

export function OrgView() {
  const st = useApp();
  const svg = useMemo(() => viewSvgString(st), [st.p, st.view]);
  return (
    <div className="view">
      <div className="view-head"><h1>Team structure</h1><span className="sub">Built from each person’s “Reports to” field</span></div>
      <div className="toolbar">
        <button className="btn" onClick={() => st.setView('resources')}><Icon name="users" />Edit team</button>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} /> : <Empty title="No team members yet" text="Add resources and set who each person reports to." />}
    </div>
  );
}
