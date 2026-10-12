import { useEffect, useRef } from 'react';
import Icon from './Icon';

// One entry per menu item; { hr: true } renders a separator.
export type CtxItem = { label?: string; icon?: string; disabled?: boolean; hr?: boolean; onClick?: () => void };

// A fixed-position context menu with a click-away backdrop, shared by the
// Gantt task rows and the diagram canvases. Escape closes it.
export default function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: CtxItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const rows = items.filter(i => !i.hr).length;
  return <>
    <div className="ctx-backdrop" onPointerDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
    <div className="menu open ctx-menu" role="menu" ref={ref} tabIndex={-1}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 250)),
        top: Math.max(8, Math.min(y, window.innerHeight - 40 - rows * 32)),
      }}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      {items.map((it, k) => it.hr
        ? <hr key={k} />
        : <button key={k} role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onClick?.(); }}>
            {it.icon && <Icon name={it.icon} />}{it.label}
          </button>)}
    </div>
  </>;
}
