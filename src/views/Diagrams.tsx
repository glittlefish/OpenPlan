import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import OP from '../core';
import { useApp, useStore, S } from '../store';
import { runAction, viewSvgString } from '../lib/actions';
import { addLink, addTaskNear, copyTasks, hasClip, moveSubtreeTo, pasteTasks } from '../lib/taskOps';
import Icon from '../components/Icon';
import ContextMenu, { type CtxItem } from '../components/ContextMenu';

// Zoomable SVG canvas. Ctrl+wheel zooms, a plain wheel scrolls natively.
// Dragging empty canvas pans (scroll), with a grab / grabbing cursor.
// openMode 'drawer' (Org): click selects and opens the side panel.
// openMode 'dialog' (Network/WBS): click only selects; double-click opens a details dialog.
// dragMove (WBS): pointer-drag a node onto another node to move that task's subtree.
// dragLink (Network): pointer-drag a node onto another node to create a dependency.
// onNodeContextMenu: right-click on a node (uid) or on empty canvas (null) at the cursor position.
function Canvas({ svg, nodeClass, openMode = 'drawer', onNodeContextMenu, dragMove, dragLink }: {
  svg: string; nodeClass?: string; openMode?: 'drawer' | 'dialog';
  onNodeContextMenu?: (uid: number | null, x: number, y: number) => void;
  dragMove?: (uid: number, targetUid: number) => boolean;
  dragLink?: (fromUid: number, toUid: number) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useStore(s => s.netZoom);
  // Swallow the click/dblclick that follows a node drag, so a drag never reads as
  // a select or opens the details dialog. Time-based: a genuine click after it works.
  const suppressUntil = useRef(0);
  const suppressed = () => Date.now() < suppressUntil.current;
  const dragMoveRef = useRef(dragMove);
  dragMoveRef.current = dragMove;
  const dragLinkRef = useRef(dragLink);
  dragLinkRef.current = dragLink;
  const dragEnabled = !!dragMove && !!nodeClass;
  const linkEnabled = !!dragLink && !!nodeClass;
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
  // Pan: hold the left button on empty canvas and drag to scroll it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let panning = false, px = 0, py = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest('g[data-uid]')) return; // nodes: click / drag, not pan
      panning = true; px = e.clientX; py = e.clientY;
      el.classList.add('panning');
      el.style.userSelect = 'none';
    };
    const onMove = (e: PointerEvent) => {
      if (!panning) return;
      el.scrollLeft -= e.clientX - px;
      el.scrollTop -= e.clientY - py;
      px = e.clientX; py = e.clientY;
      e.preventDefault();
    };
    const onUp = () => {
      if (!panning) return;
      panning = false;
      el.classList.remove('panning');
      el.style.userSelect = '';
    };
    const noDrag = (e: Event) => e.preventDefault(); // the SVG must not be natively dragged
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('dragstart', noDrag);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('dragstart', noDrag);
    };
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
        el.classList.add('node-dragging');
        el.style.userSelect = 'none';
        const p = S().p, a = OP.model.indexByUid(p)[uid];
        sub = new Set();
        if (a != null) for (let k = a; k < OP.model.subtreeEnd(p, a); k++) sub.add(p.tasks[k].uid);
      }
      e.preventDefault();
      // elementFromPoint works in screen coordinates, so this stays correct at any zoom.
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(cls) || null;
      const ok = !!hit && hit !== src && !sub!.has(+(hit as SVGElement).dataset.uid!);
      const next = ok ? hit : null;
      if (target !== next) { clearHi(); if (next) { next.classList.add('drop-target'); target = next; } }
    };
    const onUp = () => {
      if (!active) return;
      if (dragging) {
        src?.classList.remove('dragging');
        el.classList.remove('node-dragging');
        el.style.userSelect = '';
        suppressUntil.current = Date.now() + 400; // swallow the click that follows this drag
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
  // Drag-to-link (Network): drag from one node to another to create an FS dependency.
  // A dashed preview line follows the cursor; valid targets highlight, loop targets turn red.
  useEffect(() => {
    const el = ref.current;
    if (!el || !linkEnabled) return;
    const cls = '.' + nodeClass!;
    const svgEl = () => el.querySelector('svg') as SVGSVGElement | null;
    let active = false, dragging = false, src: Element | null = null, target: Element | null = null;
    let sx = 0, sy = 0, uid = 0, bad = new Set<number>(), line: SVGPathElement | null = null;
    // client -> SVG user-space coordinates (the svg width attribute is scaled by zoom, the viewBox is not).
    const toSvg = (x: number, y: number) => {
      const s = svgEl();
      if (!s) return { x, y };
      const r = s.getBoundingClientRect(), w = +s.dataset.w! || 1, k = r.width / w;
      return { x: (x - r.left) / k, y: (y - r.top) / k };
    };
    const clearHi = () => {
      if (target) { target.classList.remove('link-target', 'link-bad'); target = null; }
      if (line) { line.remove(); line = null; }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const g = (e.target as Element).closest(cls);
      if (!g) return;
      active = true; dragging = false; src = g; target = null;
      sx = e.clientX; sy = e.clientY; uid = +(g as SVGElement).dataset.uid!;
      // Everything upstream of the source: linking back into it would loop.
      const p = S().p, idx = OP.model.indexByUid(p);
      bad = new Set<number>([uid]);
      const stack = (p.tasks[idx[uid]]?.preds || []).map((l: any) => l.uid);
      while (stack.length) {
        const u = stack.pop()!;
        if (bad.has(u)) continue;
        bad.add(u);
        (p.tasks[idx[u]]?.preds || []).forEach((l: any) => stack.push(l.uid));
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!active || !src) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return; // still a click
        dragging = true;
        el.style.userSelect = 'none';
        const s = svgEl();
        if (s) {
          line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          line.setAttribute('class', 'lnk-drag');
          line.setAttribute('marker-end', 'url(#nah)');
          s.appendChild(line);
        }
      }
      e.preventDefault();
      if (line) {
        const r = src.getBoundingClientRect(), a = toSvg(r.right, r.top + r.height / 2), b = toSvg(e.clientX, e.clientY);
        const mx = (a.x + b.x) / 2;
        line.setAttribute('d', 'M' + a.x + ',' + a.y + 'C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + b.x + ',' + b.y);
      }
      const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(cls) || null;
      const tUid = hit ? +(hit as SVGElement).dataset.uid! : 0;
      const ok = !!hit && hit !== src && !bad.has(tUid);
      const next = hit && hit !== src ? hit : null;
      if (target !== next) {
        if (target) target.classList.remove('link-target', 'link-bad');
        target = next;
        if (target) target.classList.add(ok ? 'link-target' : 'link-bad');
      } else if (target) {
        target.classList.toggle('link-target', ok);
        target.classList.toggle('link-bad', !ok);
      }
    };
    const onUp = () => {
      if (!active) return;
      if (dragging) {
        el.style.userSelect = '';
        suppressUntil.current = Date.now() + 400; // swallow the click that follows this drag
        const drop = target as SVGElement | null; // clearHi() nulls target, so capture first
        const dropUid = drop ? +drop.dataset.uid! : 0;
        clearHi();
        if (drop && dragLinkRef.current && dragLinkRef.current(uid, dropUid)) S().select([uid], uid);
      }
      active = false; dragging = false; src = null; bad = new Set();
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      clearHi();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [linkEnabled, nodeClass, svg]);
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
        if (suppressed()) return;
        const uid = uidOf(e.target);
        if (uid == null) return;
        S().select([uid], uid);
        if (openMode === 'drawer') openDetails(uid);
      }}
      onDoubleClick={e => {
        if (suppressed()) return;
        const uid = uidOf(e.target);
        if (uid == null) return;
        S().select([uid], uid);
        if (openMode === 'dialog') openDetails(uid);
      }}
      onContextMenu={e => {
        if (!onNodeContextMenu) return;
        e.preventDefault();
        const uid = uidOf(e.target);
        // Keep a multi-selection when right-clicking one of its members.
        if (uid != null && !S().sel.includes(uid)) S().select([uid], uid);
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
      {svg ? <Canvas svg={svg} nodeClass="nnode" openMode="dialog" dragLink={(from, to) => addLink(from, to)} /> : <Empty title="Nothing to show" text="Add tasks in the Gantt view first." />}
    </div>
  );
}

export function WbsView() {
  const st = useApp();
  const svg = useMemo(() => viewSvgString(st, { selected: true }), [st.p, st.s, st.wbsDepth, st.wbsBox, st.view, st.sel]);
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
  // Paste after the right-clicked node; widen the shown depth if the pasted subtree is deeper.
  const pasteAt = (refUid: number) => {
    const tops = pasteTasks(refUid);
    if (!tops.length) return;
    const p = S().p, idx = OP.model.indexByUid(p);
    let deep = st.wbsDepth;
    tops.forEach(u => {
      const i = idx[u];
      if (i == null) return;
      for (let k = i; k < OP.model.subtreeEnd(p, i); k++) deep = Math.max(deep, p.tasks[k].level);
    });
    if (deep > st.wbsDepth) st.setUI({ wbsDepth: deep });
  };
  const ctxItems = (uid: number): CtxItem[] => [
    { label: 'Insert task before', icon: 'plus', onClick: () => addTaskNear(uid, 'before') },
    { label: 'Insert task after', icon: 'plus', onClick: () => addTaskNear(uid, 'after') },
    { label: 'Add subtask', icon: 'indent', onClick: () => addChild(uid) },
    { hr: true },
    // Copy the whole selection when the right-clicked node is part of it, else just that node.
    { label: 'Copy', icon: 'copy', onClick: () => copyTasks(st.sel.includes(uid) ? st.sel : [uid]) },
    { label: 'Paste', icon: 'paste', disabled: !hasClip(), onClick: () => pasteAt(uid) },
  ];
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
        <button className="btn" onClick={() => st.openDialog('wbsbox')}><Icon name="layers" />Box content</button>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="wnode" openMode="dialog"
        onNodeContextMenu={(uid, x, y) => setCtx(uid == null ? null : { uid, x, y })}
        dragMove={(uid, target) => moveSubtreeTo(uid, target)} />
        : <Empty title="No work items yet" text="Build your task outline in the Gantt view; indented tasks become WBS levels." />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.uid)} onClose={() => setCtx(null)} />}
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
