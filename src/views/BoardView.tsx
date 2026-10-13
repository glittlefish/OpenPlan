import { useState, type DragEvent } from 'react';
import OP from '../core';
import { useApp } from '../store';
import { t } from '../i18n';
import * as ops from '../lib/taskOps';
import Icon from '../components/Icon';
import type { Row } from '../types';

const U = OP.util;

// Columns follow % complete: moving a card sets it to 0, 50 or 100%.
const COLUMNS: { key: string; label: string; has: (r: Row) => boolean; percent: number }[] = [
  { key: 'todo', label: 'Not started', has: r => r.percent <= 0, percent: 0 },
  { key: 'doing', label: 'In progress', has: r => r.percent > 0 && r.percent < 100, percent: 50 },
  { key: 'done', label: 'Done', has: r => r.percent >= 100, percent: 100 }
];

export default function BoardView() {
  const st = useApp();
  const [over, setOver] = useState<string | null>(null);
  const tasks = st.s.rows.filter((r: Row) => !r.summary);
  const moveTo = (r: Row, col: number) => {
    if (!COLUMNS[col].has(r)) ops.setPercent(r.task.uid, COLUMNS[col].percent);
  };
  const drop = (e: DragEvent, col: number) => {
    e.preventDefault();
    setOver(null);
    const r = tasks.find((x: Row) => x.task.uid === +e.dataTransfer.getData('text/plain'));
    if (r) moveTo(r, col);
  };
  const open = (r: Row) => { st.select([r.task.uid], r.task.uid); st.setUI({ drawer: true }); };

  if (!tasks.length) return <div className="view"><div className="empty"><h3>{t('No tasks yet')}</h3><div>{t('Add tasks in the Gantt view, then track them here.')}</div></div></div>;
  return (
    <div className="view">
      <div className="board">
        {COLUMNS.map((c, ci) => {
          const cards = tasks.filter(c.has);
          return (
            <section key={c.key} className={'board-col' + (over === c.key ? ' over' : '')} aria-label={t(c.label)}
              onDragOver={e => { e.preventDefault(); setOver(c.key); }} onDragLeave={() => setOver(null)} onDrop={e => drop(e, ci)}>
              <h2>{t(c.label)} <span className="muted">{cards.length}</span></h2>
              <div className="board-cards">
                {cards.map((r: Row) => (
                  <article key={r.task.uid} className={'board-card' + (st.sel.includes(r.task.uid) ? ' sel' : '') + (r.critical && st.critical ? ' crit' : '')}
                    draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(r.task.uid))}>
                    <button className="board-open" onClick={() => open(r)}>
                      {r.parent >= 0 && <span className="board-parent">{st.s.rows[r.parent].task.name}</span>}
                      <b>{r.id}. {r.task.name}</b>
                      <span className="muted">{r.milestone ? U.fmt(r.startDn) : U.fmt(r.startDn) + ' – ' + U.fmt(r.finishDn)}{r.names ? ' · ' + r.names : ''}</span>
                      {r.percent > 0 && r.percent < 100 && <span className="board-prog"><i style={{ width: r.percent + '%' }} /></span>}
                    </button>
                    <div className="board-move">
                      {ci > 0 && <button className="icon-btn flip" title={t('Move to {label}', { label: t(COLUMNS[ci - 1].label) })} aria-label={t('Move {name} to {label}', { name: r.task.name, label: t(COLUMNS[ci - 1].label) })} onClick={() => moveTo(r, ci - 1)}><Icon name="chevR" /></button>}
                      {ci < COLUMNS.length - 1 && <button className="icon-btn" title={t('Move to {label}', { label: t(COLUMNS[ci + 1].label) })} aria-label={t('Move {name} to {label}', { name: r.task.name, label: t(COLUMNS[ci + 1].label) })} onClick={() => moveTo(r, ci + 1)}><Icon name="chevR" /></button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
