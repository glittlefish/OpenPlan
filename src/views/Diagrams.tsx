import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import OP from '../core';
import { useApp, useStore, S } from '../store';
import { runAction, viewSvgString } from '../lib/actions';
import { addAnnotation, addLink, addTaskNear, copyTasks, hasClip, moveSubtreeTo, pasteTasks, removeAnnotation, removeNetPos, resetNetLayout, setCustomStyle, setNetPos, updateAnnotation } from '../lib/taskOps';
import Icon from '../components/Icon';
import ContextMenu, { type CtxItem } from '../components/ContextMenu';

// Zoomable SVG canvas. Ctrl+wheel zooms, a plain wheel scrolls natively.
// Dragging empty canvas pans (scroll), with a grab / grabbing cursor.
// openMode 'drawer' (Org): click selects and opens the side panel.
// openMode 'dialog' (Network/WBS): click only selects; double-click opens a details dialog.
// dragMove (WBS): pointer-drag a node onto another node to move that task's subtree.
// dragLink (Network): pointer-drag a node onto another node to create a dependency.
// dragPos (Network): dropping a dragged node on empty canvas moves it there (netPos override).
// annoView ('wbs'|'network'): enables free text box annotations — drag to move, corner to
// resize, double-click to edit inline, Delete to remove, right-click for a context menu.
// onNodeContextMenu: right-click on a node (uid) or on empty canvas (null) at the cursor position.
function Canvas({ svg, nodeClass, openMode = 'drawer', onNodeContextMenu, onAnnoContextMenu, dragMove, dragLink, dragPos, annoView }: {
  svg: string; nodeClass?: string; openMode?: 'drawer' | 'dialog';
  onNodeContextMenu?: (uid: number | null, x: number, y: number) => void;
  onAnnoContextMenu?: (id: string, x: number, y: number) => void;
  dragMove?: (uid: number, targetUid: number) => boolean;
  dragLink?: (fromUid: number, toUid: number) => boolean;
  dragPos?: (uid: number, x: number, y: number) => boolean;
  annoView?: 'wbs' | 'network';
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
  const dragPosRef = useRef(dragPos);
  dragPosRef.current = dragPos;
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
      if ((e.target as Element).closest('g[data-uid], .anno')) return; // nodes and text boxes: click / drag, not pan
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
  // With dragPos, dropping on empty canvas moves the node there instead (netPos override):
  // the node follows the cursor via a live transform preview, committed on release.
  useEffect(() => {
    const el = ref.current;
    if (!el || !linkEnabled) return;
    const cls = '.' + nodeClass!;
    const svgEl = () => el.querySelector('svg') as SVGSVGElement | null;
    let active = false, dragging = false, src: Element | null = null, target: Element | null = null;
    let sx = 0, sy = 0, uid = 0, bad = new Set<number>(), line: SVGPathElement | null = null;
    let base = { x: 0, y: 0 }, dx = 0, dy = 0;
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
      dx = 0; dy = 0;
      const rect0 = g.querySelector('rect');
      base = rect0 ? { x: +rect0.getAttribute('x')!, y: +rect0.getAttribute('y')! } : { x: 0, y: 0 };
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
        // pointer-events:none keeps elementFromPoint on the node under the cursor,
        // so hovering another node still reads as a link target while moving.
        src.classList.add('dragging');
        const s = svgEl();
        if (s) {
          line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          line.setAttribute('class', 'lnk-drag');
          line.setAttribute('marker-end', 'url(#nah)');
          s.appendChild(line);
        }
      }
      e.preventDefault();
      if (dragPosRef.current) {
        const s = svgEl();
        const k = s ? s.getBoundingClientRect().width / (+s.dataset.w! || 1) : 1;
        dx = (e.clientX - sx) / k; dy = (e.clientY - sy) / k;
        src.setAttribute('transform', 'translate(' + dx + ',' + dy + ')');
      }
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
        src?.classList.remove('dragging');
        src?.removeAttribute('transform');
        if (drop && dragLinkRef.current && dragLinkRef.current(uid, dropUid)) S().select([uid], uid);
        else if (!drop && dragPosRef.current) dragPosRef.current(uid, base.x + dx, base.y + dy);
      }
      active = false; dragging = false; src = null; bad = new Set(); dx = 0; dy = 0;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      clearHi();
      if (src) { src.classList.remove('dragging'); src.removeAttribute('transform'); }
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [linkEnabled, nodeClass, svg]);
  // ---- Free text box annotations (PRD M13) ----
  const annoSel = useStore(s => s.annoSel);
  const annoEdit = useStore(s => s.annoEdit);
  // Selection highlight: the SVG markup does not know the selection, so toggle a class.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll('.anno').forEach(g => g.classList.toggle('sel', (g as SVGElement).dataset.id === annoSel));
  }, [annoSel, svg]);
  // Drag the body to move, drag the corner handle to resize. Live DOM preview,
  // committed to the store on release (one undoable commit per drag).
  useEffect(() => {
    const el = ref.current;
    if (!el || !annoView) return;
    let g: SVGElement | null = null, box: SVGRectElement | null = null, handle: SVGRectElement | null = null;
    let id = '', mode: '' | 'move' | 'resize' = '', sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0, moved = false, ldx = 0, ldy = 0;
    const kOf = () => {
      const s = el.querySelector('svg');
      if (!s) return 1;
      return s.getBoundingClientRect().width / (+s.dataset.w! || 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element;
      const h = t.closest('.anno-handle');
      const a = (h ? h.closest('.anno') : t.closest('.anno')) as SVGElement | null;
      if (!a) return;
      const ann = S().p.annotations?.find(x => x.id === a.dataset.id);
      if (!ann) return;
      if (ann.mode === 'group' && !h) return; // group boxes auto-fit their tasks; no move
      g = a; id = ann.id; mode = h ? 'resize' : 'move';
      box = a.querySelector('.anno-box'); handle = a.querySelector('.anno-handle');
      sx = e.clientX; sy = e.clientY;
      ox = +box!.getAttribute('x')!; oy = +box!.getAttribute('y')!;
      ow = +box!.getAttribute('width')!; oh = +box!.getAttribute('height')!;
      moved = false; ldx = 0; ldy = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!mode || !g) return;
      if (!moved) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return; // still a click
        moved = true;
        el.style.userSelect = 'none';
      }
      e.preventDefault();
      const k = kOf();
      ldx = (e.clientX - sx) / k; ldy = (e.clientY - sy) / k;
      if (mode === 'move') g.setAttribute('transform', 'translate(' + ldx + ',' + ldy + ')');
      else {
        const w = Math.max(40, ow + ldx), h = Math.max(24, oh + ldy);
        box!.setAttribute('width', String(w)); box!.setAttribute('height', String(h));
        handle?.setAttribute('x', String(ox + w - 9));
        handle?.setAttribute('y', String(oy + h - 9));
      }
    };
    const onUp = () => {
      if (!mode || !g) return;
      if (moved) {
        suppressUntil.current = Date.now() + 400; // swallow the click that follows this drag
        const ann = S().p.annotations?.find(x => x.id === id);
        if (ann && mode === 'move') {
          g.removeAttribute('transform');
          if (ann.mode === 'task') updateAnnotation(id, { dx: (ann.dx || 0) + ldx, dy: (ann.dy || 0) + ldy });
          else updateAnnotation(id, { x: Math.max(0, Math.round(ox + ldx)), y: Math.max(0, Math.round(oy + ldy)) });
        } else if (ann && mode === 'resize') {
          updateAnnotation(id, { w: Math.max(40, Math.round(ow + ldx)), h: Math.max(24, Math.round(oh + ldy)) });
        }
        S().setUI({ annoSel: id });
      }
      mode = ''; g = null; box = null; handle = null; moved = false;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [annoView, svg]);
  // Double-click (or creation) opens a textarea over the box; Enter commits, Escape cancels.
  useEffect(() => {
    if (!annoEdit || !annoView) return;
    const el = ref.current;
    const svgEl = el?.querySelector('svg') as SVGSVGElement | null;
    const g = el?.querySelector('.anno[data-id="' + annoEdit + '"]');
    const a = S().p.annotations?.find(x => x.id === annoEdit);
    if (!el || !svgEl || !g || !a) { S().setUI({ annoEdit: null }); return; }
    const r = svgEl.getBoundingClientRect(), k = r.width / (+svgEl.dataset.w! || 1);
    const box = (g as Element).querySelector('.anno-box') as SVGRectElement;
    const ax = +box.getAttribute('x')!, ay = +box.getAttribute('y')!, aw = +box.getAttribute('width')!, ah = +box.getAttribute('height')!;
    const ta = document.createElement('textarea');
    ta.className = 'anno-editor';
    ta.value = a.text;
    ta.style.left = (r.left + ax * k) + 'px';
    ta.style.top = (r.top + ay * k) + 'px';
    ta.style.width = Math.max(120, aw * k) + 'px';
    ta.style.height = Math.max(40, ah * k) + 'px';
    let done = false;
    const close = (save: boolean) => {
      if (done) return;
      done = true;
      ta.remove();
      if (save) updateAnnotation(annoEdit, { text: ta.value });
      S().setUI({ annoEdit: null });
    };
    ta.addEventListener('blur', () => close(true));
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation(); // keep global shortcuts away while typing
      if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
      else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); close(true); }
    });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    return () => ta.remove();
  }, [annoEdit, annoView]);
  // Delete removes the selected text box (unless typing in a field).
  useEffect(() => {
    if (!annoView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const st = S();
      if (!st.annoSel) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      removeAnnotation(st.annoSel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annoView]);
  const uidOf = (target: EventTarget): number | null => {
    if (!nodeClass) return null;
    const g = (target as Element).closest('.' + nodeClass) as SVGGElement | null;
    return g ? +g.dataset.uid! : null;
  };
  const openDetails = (uid: number) => {
    if (openMode === 'dialog') S().openDialog('task', { uid });
    else S().setUI({ drawer: true });
  };
  const annoOf = (target: EventTarget): SVGElement | null => {
    if (!annoView) return null;
    return (target as Element).closest('.anno') as SVGElement | null;
  };
  return (
    <div className="canvas" id="canvas" ref={ref} dangerouslySetInnerHTML={{ __html: svg }}
      onClick={e => {
        if (suppressed()) return;
        const anno = annoOf(e.target);
        if (anno) { S().setUI({ annoSel: anno.dataset.id! }); return; }
        const uid = uidOf(e.target);
        if (uid == null) {
          if (annoView && S().annoSel) S().setUI({ annoSel: null });
          return;
        }
        // Ctrl/Cmd+click toggles membership in the selection (for grouping, batch ops).
        if (e.ctrlKey || e.metaKey) {
          const st = S();
          st.select(st.sel.includes(uid) ? st.sel.filter(u => u !== uid) : st.sel.concat([uid]), uid);
          return;
        }
        S().select([uid], uid);
        if (openMode === 'drawer') openDetails(uid);
      }}
      onDoubleClick={e => {
        if (suppressed()) return;
        const anno = annoOf(e.target);
        if (anno) { S().setUI({ annoSel: anno.dataset.id!, annoEdit: anno.dataset.id! }); return; }
        const uid = uidOf(e.target);
        if (uid == null) return;
        S().select([uid], uid);
        if (openMode === 'dialog') openDetails(uid);
      }}
      onContextMenu={e => {
        const anno = annoOf(e.target);
        if (anno) {
          if (!onAnnoContextMenu) return;
          e.preventDefault();
          S().setUI({ annoSel: anno.dataset.id! });
          onAnnoContextMenu(anno.dataset.id!, e.clientX, e.clientY);
          return;
        }
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

// Manual box coloring applies to the whole selection when the right-clicked node is part of it.
function styleTargets(st: { sel: number[] }, uid: number): number[] {
  return st.sel.includes(uid) ? st.sel : [uid];
}

// ---- Free text box annotations (PRD M13): view-layer helpers ----

// Insert a text box: at the given screen point, or centered in the visible canvas.
function addTextBoxAt(view: 'wbs' | 'network', clientX?: number, clientY?: number) {
  const box = document.getElementById('canvas');
  const svgEl = box?.querySelector('svg') as SVGSVGElement | null;
  if (!box || !svgEl) return;
  const r = svgEl.getBoundingClientRect(), k = r.width / (+svgEl.dataset.w! || 1);
  const x = clientX != null ? (clientX - r.left) / k : (box.scrollLeft + box.clientWidth / 2) / k;
  const y = clientY != null ? (clientY - r.top) / k : (box.scrollTop + box.clientHeight / 2) / k;
  addAnnotation(view, Math.max(10, x - 80), Math.max(10, y - 30));
}

// Rendered SVG position of an annotation / a node, read from the live DOM.
function annoDomPos(id: string) {
  const box = document.querySelector('#canvas .anno[data-id="' + id + '"] .anno-box') as SVGRectElement | null;
  return box ? { x: +box.getAttribute('x')!, y: +box.getAttribute('y')! } : null;
}
function nodeDomPos(uid: number) {
  const g = document.querySelector('#canvas g[data-uid="' + uid + '"]');
  const box = (g?.querySelector('rect.node, rect.wbs1, rect.wbs2') || g?.querySelector('rect')) as SVGRectElement | null;
  return box ? { x: +box.getAttribute('x')!, y: +box.getAttribute('y')! } : null;
}

// Bind a text box to a task: it keeps its current on-screen offset and follows the task.
function bindAnnoTask(id: string, uid: number) {
  const a = annoDomPos(id), b = nodeDomPos(uid);
  if (!a || !b) return;
  updateAnnotation(id, { mode: 'task', taskUid: uid, dx: a.x - b.x, dy: a.y - b.y });
}

// Release a binding: the box stays exactly where it is now, as a free box.
function freeAnno(id: string) {
  const a = annoDomPos(id);
  if (a) updateAnnotation(id, { mode: 'free', x: Math.round(a.x), y: Math.round(a.y) });
}

// Context menu for a text box, shared by the WBS and Network views.
function annoCtxItems(st: { sel: number[]; p: { annotations?: any[] } }, id: string): CtxItem[] {
  const a = st.p.annotations?.find(x => x.id === id);
  if (!a) return [];
  return [
    { label: 'Edit text', icon: 'note', onClick: () => S().setUI({ annoSel: id, annoEdit: id }) },
    { hr: true },
    { label: 'Bind to selected task', icon: 'link', disabled: st.sel.length !== 1, onClick: () => bindAnnoTask(id, st.sel[0]) },
    { label: 'Group selected tasks', icon: 'grid', disabled: !st.sel.length, onClick: () => updateAnnotation(id, { mode: 'group' as const, uids: [...st.sel] }) },
    { label: 'Free position', icon: 'pin', disabled: a.mode === 'free', onClick: () => freeAnno(id) },
    { hr: true },
    { label: 'Delete text box', icon: 'trash', onClick: () => removeAnnotation(id) },
  ];
}

function zoomBy(kind: 'in' | 'out' | 'fit') {  const st = S();
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
  const [addMenu, setAddMenu] = useState(false);
  const [ctx, setCtx] = useState<{ uid: number | null; x: number; y: number } | null>(null);
  const [actx, setActx] = useState<{ id: string; x: number; y: number } | null>(null);
  const addWrap = useRef<HTMLDivElement>(null);
  const selUid = st.sel.length ? st.sel[st.sel.length - 1] : null;
  useEffect(() => {
    if (!addMenu) return;
    const close = (e: PointerEvent) => { if (!addWrap.current?.contains(e.target as Node)) setAddMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [addMenu]);
  const ctxItems = (uid: number | null): CtxItem[] => uid == null ? [
    { label: 'Add text box', icon: 'note', onClick: () => addTextBoxAt('network', ctx?.x, ctx?.y) },
    { label: 'Reset layout', icon: 'fit', onClick: () => resetNetLayout() },
  ] : [
    { label: 'Insert task after', icon: 'plus', onClick: () => addTaskNear(uid, 'after') },
    { label: 'Insert task before', icon: 'plus', onClick: () => addTaskNear(uid, 'before') },
    { label: 'Add subtask', icon: 'indent', onClick: () => addTaskNear(uid, 'child') },
    { hr: true },
    // Copy the whole selection when the right-clicked node is part of it, else just that node.
    { label: 'Copy', icon: 'copy', onClick: () => copyTasks(st.sel.includes(uid) ? st.sel : [uid]) },
    { label: 'Paste', icon: 'paste', disabled: !hasClip(), onClick: () => pasteTasks(uid) },
    { hr: true },
    { label: 'Reset node position', icon: 'fit', disabled: !(uid in (st.p.netPos || {})), onClick: () => removeNetPos(uid) },
    { label: 'Reset layout', icon: 'fit', onClick: () => resetNetLayout() },
    { hr: true },
    { label: 'Custom box color…', icon: 'sparkle', onClick: () => st.openDialog('boxcolor', { uids: st.sel.includes(uid) ? st.sel : [uid] }) },
    { label: 'Clear custom style', icon: 'x', disabled: !styleTargets(st, uid).some(u => st.p.tasks.find(t => t.uid === u)?.customStyle), onClick: () => setCustomStyle(styleTargets(st, uid), null) },
    ...(st.sel.length > 1 ? [{ label: `Batch edit ${st.sel.length} tasks…`, icon: 'settings', onClick: () => st.openDialog('batchedit', { uids: st.sel }) }] : []),
  ];
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
        <div className="menu-wrap" ref={addWrap}>
          <button className="btn" aria-haspopup="menu" aria-expanded={addMenu} onClick={() => setAddMenu(o => !o)}><Icon name="plus" />New task ▾</button>
          {addMenu && <div className="menu open" role="menu">
            <button role="menuitem" onClick={() => { setAddMenu(false); addTaskNear(selUid, 'after'); }}><Icon name="plus" />New task (after selection)</button>
            <button role="menuitem" disabled={!selUid} onClick={() => { setAddMenu(false); if (selUid) addTaskNear(selUid, 'before'); }}><Icon name="plus" />New predecessor (before selection)</button>
          </div>}
        </div>
        <button className="btn" title="Clear manual node positions and restore the automatic layout" onClick={() => resetNetLayout()}><Icon name="fit" />Reset layout</button>
        <button className="btn" onClick={() => st.openDialog('boxstyles')}><Icon name="sparkle" />Box styles</button>
        <button className="btn" title="Insert a text box" onClick={() => addTextBoxAt('network')}><Icon name="note" />Text box</button>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="nnode" openMode="dialog"
        dragLink={(from, to) => addLink(from, to)}
        dragPos={(uid, x, y) => setNetPos(uid, x, y)}
        annoView="network"
        onNodeContextMenu={(uid, x, y) => setCtx({ uid, x, y })}
        onAnnoContextMenu={(id, x, y) => setActx({ id, x, y })} />
        : <Empty title="Nothing to show" text="Add tasks in the Gantt view first." />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.uid)} onClose={() => setCtx(null)} />}
      {actx && <ContextMenu x={actx.x} y={actx.y} items={annoCtxItems(st, actx.id)} onClose={() => setActx(null)} />}
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
  const [ctx, setCtx] = useState<{ uid: number | null; x: number; y: number } | null>(null);
  const [actx, setActx] = useState<{ id: string; x: number; y: number } | null>(null);
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
  const ctxItems = (uid: number | null): CtxItem[] => uid == null ? [
    { label: 'Add text box', icon: 'note', onClick: () => addTextBoxAt('wbs', ctx?.x, ctx?.y) },
  ] : [
    { label: 'Insert task before', icon: 'plus', onClick: () => addTaskNear(uid, 'before') },
    { label: 'Insert task after', icon: 'plus', onClick: () => addTaskNear(uid, 'after') },
    { label: 'Add subtask', icon: 'indent', onClick: () => addChild(uid) },
    { hr: true },
    // Copy the whole selection when the right-clicked node is part of it, else just that node.
    { label: 'Copy', icon: 'copy', onClick: () => copyTasks(st.sel.includes(uid) ? st.sel : [uid]) },
    { label: 'Paste', icon: 'paste', disabled: !hasClip(), onClick: () => pasteAt(uid) },
    { hr: true },
    { label: 'Custom box color…', icon: 'sparkle', onClick: () => st.openDialog('boxcolor', { uids: styleTargets(st, uid) }) },
    { label: 'Clear custom style', icon: 'x', disabled: !styleTargets(st, uid).some(u => st.p.tasks.find(t => t.uid === u)?.customStyle), onClick: () => setCustomStyle(styleTargets(st, uid), null) },
    ...(st.sel.length > 1 ? [{ label: `Batch edit ${st.sel.length} tasks…`, icon: 'settings', onClick: () => st.openDialog('batchedit', { uids: st.sel }) }] : []),
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
        <button className="btn" onClick={() => st.openDialog('boxstyles')}><Icon name="sparkle" />Box styles</button>
        <button className="btn" title="Insert a text box" onClick={() => addTextBoxAt('wbs')}><Icon name="note" />Text box</button>
        <span className="spacer" /><ZoomTools />
      </div>
      {svg ? <Canvas svg={svg} nodeClass="wnode" openMode="dialog"
        onNodeContextMenu={(uid, x, y) => setCtx({ uid, x, y })}
        onAnnoContextMenu={(id, x, y) => setActx({ id, x, y })}
        annoView="wbs"
        dragMove={(uid, target) => moveSubtreeTo(uid, target)} />
        : <Empty title="No work items yet" text="Build your task outline in the Gantt view; indented tasks become WBS levels." />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.uid)} onClose={() => setCtx(null)} />}
      {actx && <ContextMenu x={actx.x} y={actx.y} items={annoCtxItems(st, actx.id)} onClose={() => setActx(null)} />}
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
