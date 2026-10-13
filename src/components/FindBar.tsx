import { useEffect, useMemo, useRef, useState } from 'react';
import OP from '../core';
import { useApp, S, type Store } from '../store';
import Icon from './Icon';
import type { Project, Task } from '../types';

const U = OP.util;

type Scope = 'name' | 'namenotes' | 'all';

// Text fields searched per scope. Each entry maps a task field key to a getter.
function fieldsOf(p: Project, t: Task, scope: Scope): [string, string][] {
  const out: [string, string][] = [['name', t.name || '']];
  if (scope !== 'name') out.push(['notes', t.notes || '']);
  if (scope === 'all') {
    t.assignments.forEach(a => {
      const r = p.resources.find(x => x.uid === a.res);
      if (r) out.push(['res:' + r.uid, r.name]);
    });
    Object.keys(t.custom || {}).forEach(k => out.push(['cf:' + k, String((t.custom as Record<string, unknown>)[k] ?? '')]));
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcherFor(q: string, useRe: boolean): RegExp | null {
  if (!q) return null;
  try { return new RegExp(useRe ? q : escapeRe(q), 'gi'); } catch { return null; }
}

function replaceTask(p: Project, t: Task, re: RegExp, repl: string, scope: Scope): boolean {
  let changed = false;
  fieldsOf(p, t, scope).forEach(([k, v]) => {
    if (!v) return;
    const nv = v.replace(re, repl);
    if (nv === v) return;
    changed = true;
    if (k === 'name') t.name = nv;
    else if (k === 'notes') t.notes = nv;
    else if (k.startsWith('res:')) { const r = p.resources.find(x => x.uid === +k.slice(4)); if (r) r.name = nv; }
    else if (k.startsWith('cf:')) (t.custom as Record<string, unknown>)[k.slice(3)] = nv;
  });
  return changed;
}

// Select the task, expand its ancestors and scroll it into view in the current view.
function reveal(st: Store, uid: number) {
  st.select([uid], uid);
  const r = st.s.rows.find((x) => x.task.uid === uid);
  if (r) {
    const collapsed = { ...st.collapsed };
    let parent = r.parent;
    let touched = false;
    while (parent >= 0) {
      const pu = st.p.tasks[parent].uid;
      if (collapsed[pu]) { delete collapsed[pu]; touched = true; }
      parent = st.s.rows[parent].parent;
    }
    if (touched) st.setUI({ collapsed });
  }
  requestAnimationFrame(() => {
    const sel = st.view === 'wbs' ? '.wnode' : st.view === 'network' ? '.nnode' : null;
    const el = sel
      ? document.querySelector(sel + '[data-uid="' + uid + '"]')
      : document.querySelector('[data-fk="' + uid + ':name"]');
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}

export default function FindBar() {
  const st = useApp();
  const [q, setQ] = useState('');
  const [repl, setRepl] = useState('');
  const [scope, setScope] = useState<Scope>('namenotes');
  const [useRe, setUseRe] = useState(false);
  const [idx, setIdx] = useState(0);
  const [showRepl, setShowRepl] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const re = useMemo(() => matcherFor(q, useRe), [q, useRe]);
  const matches = useMemo(() => {
    if (!re) return [] as { uid: number; name: string }[];
    return st.p.tasks
      .filter(t => fieldsOf(st.p, t, scope).some(([, v]) => { re.lastIndex = 0; return !!v && re.test(v); }))
      .map(t => ({ uid: t.uid, name: t.name }));
  }, [st.p, re, scope]);
  const cur = Math.min(idx, Math.max(0, matches.length - 1));

  const close = () => S().setUI({ findOpen: false });
  const goto = (i: number) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setIdx(n);
    reveal(st, matches[n].uid);
  };

  const replaceCurrent = () => {
    if (!re || !matches.length) return;
    const uid = matches[cur].uid;
    const done = st.commit(p => {
      const t = p.tasks.find(x => x.uid === uid)!;
      if (!replaceTask(p, t, re, repl, scope)) return false;
    });
    if (done) st.toast('Replaced in “' + (S().p.tasks.find(x => x.uid === uid)?.name || '') + '”');
  };

  const replaceAll = () => {
    if (!re || !matches.length) return;
    let n = 0;
    st.commit(p => {
      matches.forEach(m => {
        const t = p.tasks.find(x => x.uid === m.uid)!;
        if (replaceTask(p, t, re, repl, scope)) n++;
      });
      if (!n) return false;
    });
    if (n) st.toast('Replaced in ' + n + ' task' + (n > 1 ? 's' : ''));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); goto(e.shiftKey ? cur - 1 : cur + (matches.length ? 1 : 0)); }
  };

  return (
    <div className="findbar" role="search">
      <Icon name="search" />
      <input ref={inputRef} className="cell" value={q} placeholder="Find tasks…" spellCheck={false}
        aria-label="Find" onKeyDown={onKey} onChange={e => { setQ(e.target.value); setIdx(0); }} />
      <select className="cell" value={scope} aria-label="Search scope"
        onChange={e => { setScope(e.target.value as Scope); setIdx(0); }}>
        <option value="name">Task name</option>
        <option value="namenotes">Name + notes</option>
        <option value="all">All text fields</option>
      </select>
      <label className="find-opt" title="Treat the query as a regular expression">
        <input type="checkbox" checked={useRe} onChange={e => { setUseRe(e.target.checked); setIdx(0); }} />Regex
      </label>
      <span className="find-count">{matches.length ? (cur + 1) + ' / ' + matches.length : (q ? '0 / 0' : '')}</span>
      <button className="btn" title="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => goto(cur - 1)}><Icon name="chevU" /></button>
      <button className="btn" title="Next match (Enter)" disabled={!matches.length} onClick={() => goto(cur + 1)}><Icon name="chevD" /></button>
      <button className="btn" onClick={() => setShowRepl(v => !v)}>{showRepl ? 'Hide replace' : 'Replace…'}</button>
      {showRepl && <>
        <input className="cell" value={repl} placeholder="Replace with…" spellCheck={false}
          aria-label="Replace with" onKeyDown={onKey} onChange={e => setRepl(e.target.value)} />
        <button className="btn" disabled={!matches.length} onClick={replaceCurrent}>Replace</button>
        <button className="btn" disabled={!matches.length} onClick={replaceAll}>Replace all</button>
      </>}
      <button className="btn" title="Close (Esc)" onClick={close}><Icon name="x" /></button>
    </div>
  );
}
