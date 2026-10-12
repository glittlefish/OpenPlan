import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import OP from '../core';
import { useApp, useStore, S } from '../store';
import { runAction, viewSvgString } from '../lib/actions';
import { addTaskNear, moveSubtreeTo } from '../lib/taskOps';
import Icon from '../components/Icon';

// Zoomable SVG canvas. Ctrl+wheel zooms, a plain wheel scrolls natively.
// openMode 'drawer' (Org): click selects and opens the side panel.
// openMode 'dialog' (Network/WBS): click only selects; double-click opens a details dialog.
// dragMove (WBS): pointer-drag a node onto another node to move that task's subtree.
// onNodeContextMenu: right-click on a node (uid) or on empty canvas (null) at the cursor position.
function Canvas({ svg, nodeClass, openMode = 'drawer', onNodeContextMenu, dragMove }: {
  svg: string; nodeClass?: string; openMode?: 'drawer' | 'dialog';
  onNodeContextMenu?: (uid: number | null, x: number, y: number) => void;
  dragMove?: (uid: number, targetUid: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useStore(s => s.netZoom);
  const suppressClick = useRef(false);
  const dragMoveRef = useRef(dragMove);
  dragMoveRef.current = dragMove;
  const dragEnabled = !!dragMove && !!nodeClass;
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
  // Native pointer events: the SVG is injected via dangerouslySetInnerHTML, so drag is delegated.
  useEffect(() => {
    const el = ref.current;
    if (!el || !dragEnabled) return;
    const cls = '.' + nodeClass!;
    let active = false, dragging = false, src: Element | null = null, target: Element | null = null;
    let sub: Set<number> | null = null, sx = 0, sy = 0, uid = 0;
    const clearHi = () => { if (target) { target.classList.remove('drop-target'); target = null; } };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const g = (e.target as Element).closest(cls);
      if (!g) return;
      active = true; dragging = false; src = g; target = null; sub = null;
      sx = e.clientX; sy = e.clientY; uid = +(g as SVGElement).dataset.uid!;
    };
    const onMove = (e: PointerEvent) => {
      if (!active || !src) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return; // still a click
        dragging = true;
        src.classList.add('dragging');
        el.style.userSelect = 'none';
        const p = S().p, a = OP.model.indexByUid(p)[uid];
        sub = new Set();
        if (a != null) for (let k = a; k < OP.model.subtreeEnd(p, a); k++) sub.add(p.tasks[k].uid);
      }
      e.preventDefault();
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(cls) || null;
      const ok = !!hit && hit !== src && !sub!.has(+(hit as SVGElement).dataset.uid!);
      const next = ok ? hit : null;
      if (target !== next) { clearHi(); if (next) { next.classList.add('drop-target'); target = next; } }
    };
    const onUp = () => {
      if (!active) return;
      if (dragging) {
        src?.classList.remove('dragging');
        el.style.userSelect = '';
        suppressClick.current = true; // the pointerup is followed by a click; swallow it
        const drop = target as SVGElement | null; // clearHi() nulls target, so capture first
        clearHi();
        if (drop && dragMoveRef.current && dragMoveRef.current(uid, +drop.dataset.uid!)) S().select([uid], uid);
      }
      active = false; dragging = false; src = null; sub = null;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragEnabled, nodeClass, svg]);
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
      onClick={e => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        const uid = uidOf(e.target);
        if (uid == null) return;
        S().select([uid], uid);
        if (openMode === 'drawer') openDetails(uid);
      }}
      onDoubleClick={e => { const uid = uidOf(e.target); if (uid == null) return; S().select([uid], uid); if (openMode === 'dialog') openDetails(uid); }}
      onContextMenu={e => {
        if (!onNodeContextMenu) return;
        e.preventDefault();
        const uid = uidOf(e.target);
        if (uid != null) S().select([uid], uid);
        onNodeContextMenu(uid, e.clientX, e.clientY);
      }}
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
  const svg = useMemo(() => viewSvgString(st, { selected: true }), [st.p, st.s, st.wbsDepth, st.view, st.sel]);
  const maxLv = st.s.rows.reduce((a: number, r: any) => Math.max(a, r.task.level), 1);
  const levels: number[] = [];
  for (let l = 2; l <= Math.max(2, maxLv); l++) levels.push(l);
  const [addMenu, setAddMenu] = useState(false);
  const [ctx, setCtx] = useState<{ uid: number; x: number; y: number } | null>(null);
  const addWrap = useRef<HTMLDivElement>(null);
  const selUid = st.sel.length ? st.sel[st.sel.length - 1] : null;
  useEffect(() => {
    if (!addMenu) return;
    const close = (e: PointerEvent) => { if (!addWrap.current?.contains(e.target as Node)) setAddMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [addMenu]);
  // Adding a subtask one level deeper than shown would hide it, so widen the depth first.
  const addChild = (refUid: number) => {
    const r = st.s.rows.find((x: any) => x.task.uid === refUid);
    if (r && r.task.level + 1 > st.wbsDepth) st.setUI({ wbsDepth: r.task.level + 1 });
    addTaskNear(refUid, 'child');
  };
  return (
    <div className="view">
      <div className="view-head"><h1>Work breakdown structure</h1>
        <span className="sub">{st.s.rows.length} work items · {st.s.rows.filter((r: any) => r.task.level === 1).length} top-level packages</span></div>
      <div className="toolbar">
        <div className="menu-wrap" ref={addWrap}>
          <button className="btn" aria-haspopup="menu" aria-expanded={addMenu} onClick={() => setAddMenu(o => !o)}><Icon name="plus" />New task ▾</button>
          {addMenu && <div className="menu open" role="menu">
            <button role="menuitem" onClick={() => { setAddMenu(false); addTaskNear(selUid, 'after'); }}><Icon name="plus" />New task (same level)</button>
            <button role="menuitem" disabled={!selUid} onClick={() => { setAddMenu(false); if (selUid) addChild(selUid); }}><Icon name="indent" />New subtask</button>
          </div>}
        </div>
        <span className="muted">Show levels</span>
        <div className="seg">{levels.map(l => <button key={l} className={Math.min(st.wbsDepth, maxLv) === l ? 'on' : ''} onClick={() => st.setUI({ wbsDepth: l })}>{l}</button>)}</div>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="wnode" openMode="dialog"
        onNodeContextMenu={(uid, x, y) => setCtx(uid == null ? null : { uid, x, y })}
        dragMove={(uid, target) => moveSubtreeTo(uid, target)} />
        : <Empty title="No work items yet" text="Build your task outline in the Gantt view; indented tasks become WBS levels." />}
      {ctx && <>
        <div className="ctx-backdrop" onPointerDown={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null); }} />
        <div className="menu open ctx-menu" role="menu" style={{ left: Math.max(8, Math.min(ctx.x, window.innerWidth - 240)), top: Math.max(8, Math.min(ctx.y, window.innerHeight - 150)) }}>
          <button role="menuitem" onClick={() => { const u = ctx.uid; setCtx(null); addTaskNear(u, 'before'); }}><Icon name="plus" />Insert task before</button>
          <button role="menuitem" onClick={() => { const u = ctx.uid; setCtx(null); addTaskNear(u, 'after'); }}><Icon name="plus" />Insert task after</button>
          <hr />
          <button role="menuitem" onClick={() => { const u = ctx.uid; setCtx(null); addChild(u); }}><Icon name="indent" />Add subtask</button>
        </div>
      </>}
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
