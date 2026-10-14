import OP from '../core';
import { ask, useApp } from '../store';
import { t } from '../i18n';
import { addResource, levelAll } from '../lib/taskOps';
import Field from '../components/Field';
import Icon from '../components/Icon';
import type { Resource } from '../types';

const U = OP.util, M = OP.model;

export function ResourcesView() {
  const st = useApp(), p = st.p, stats = st.s.resStats, cur = p.currency;
  const counts: Record<string, number> = {};
  p.resources.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
  const summary = M.RES_TYPES.filter((k: string) => counts[k]).map((k: string) => counts[k] + ' ' + t(k).toLowerCase()).join(' · ');

  const edit = (uid: number, fn: (r: Resource) => void) => st.commit(pp => { fn(pp.resources.find(x => x.uid === uid)!); });
  const remove = (r: Resource) => {
    const used = p.tasks.some(t => t.assignments.some(a => a.res === r.uid));
    const run = () => st.commit(pp => {
      pp.resources = pp.resources.filter(x => x.uid !== r.uid);
      pp.resources.forEach(x => { if (x.reportsTo === r.uid) x.reportsTo = null; });
      pp.tasks.forEach(t => { t.assignments = t.assignments.filter(a => a.res !== r.uid); });
    });
    if (used) ask(t('Remove {name} and all their task assignments?', { name: r.name || t('this resource') }), run, t('Remove'));
    else run();
  };
  // A person cannot report to someone who (directly or indirectly) reports to them.
  const reportsUnder = (uid: number, boss: number) => {
    const seen = new Set<number>();
    for (let q = p.resources.find(x => x.uid === boss); q && !seen.has(q.uid); q = p.resources.find(x => x.uid === q!.reportsTo)) {
      if (q.uid === uid) return true;
      seen.add(q.uid);
    }
    return false;
  };
  const setKind = (r: Resource, kind: Resource['kind']) => {
    const run = () => st.commit(pp => {
      pp.resources.find(x => x.uid === r.uid)!.kind = kind;
      pp.tasks.forEach(t => t.assignments.forEach(a => { if (a.res === r.uid) a.units = kind === 'Work' ? 100 : kind === 'Material' ? 1 : 0; }));
    });
    const n = p.tasks.filter(t => t.assignments.some(a => a.res === r.uid)).length;
    if (n) ask(n === 1
      ? t('Change {name} to a {kind} resource? Units on {n} assignment will be reset.', { name: r.name || t('this resource'), kind: kind.toLowerCase(), n })
      : t('Change {name} to a {kind} resource? Units on {n} assignments will be reset.', { name: r.name || t('this resource'), kind: kind.toLowerCase(), n }), run, t('Change'));
    else run();
  };

  return (
    <div className="view">
      <div className="view-head"><h1>{t('Resources')}</h1><span className="sub">{summary || t('Team members, materials and costs')}</span></div>
      <div className="toolbar">
        <button className="btn primary" onClick={addResource}><Icon name="plus" />{t('Add resource')}</button>
        <span className="spacer" />
        <span className="muted small">{t('Work = people (rate per hour) · Material = consumables (price per unit) · Cost = fixed amounts per task.')}</span>
      </div>
      <div className="scroll"><div className="card tbl">
        {!p.resources.length
          ? <div className="empty"><h3>{t('No resources yet')}</h3><div>{t('Add the people on your team, with their role, availability and hourly rate.')}</div></div>
          : (
            <table className="data">
              <thead><tr>
                <th style={{ minWidth: 170 }}>{t('Name')}</th><th style={{ width: 70 }}>{t('Initials')}</th><th style={{ minWidth: 140 }}>{t('Role')}</th><th style={{ width: 106 }}>{t('Kind')}</th><th style={{ width: 118 }}>{t('Type')}</th>
                <th className="num" style={{ width: 80 }}>{t('Max %')}</th><th className="num" style={{ width: 110 }}>{t('Rate ({currency})', { currency: cur })}</th><th style={{ minWidth: 140 }}>{t('Reports to')}</th>
                <th className="num">{t('Work')}</th><th className="num">{t('Cost')}</th><th className="num">{t('Peak')}</th><th>{t('Status')}</th><th />
              </tr></thead>
              <tbody>
                {p.resources.map(r => {
                  const s = stats[r.uid] || { work: 0, cost: 0, peak: 0, qty: 0 }, work = r.kind === 'Work';
                  const extra: string[] = [];
                  if (work && r.workDays.join() !== '1,2,3,4,5') extra.push(r.workDays.map(d => t(U.DAYS[d])).join(' '));
                  if (work && r.vacations.length) extra.push(r.vacations.length === 1 ? t('{n} day off', { n: r.vacations.length }) : t('{n} days off', { n: r.vacations.length }));
                  if (work && r.rates.length) extra.push(r.rates.length === 1 ? t('{n} rate change', { n: r.rates.length }) : t('{n} rate changes', { n: r.rates.length }));
                  return (
                    <tr key={r.uid}>
                      <td><Field className="inp" fk={'r' + r.uid + ':name'} value={r.name} placeholder={t('Name')}
                        onCommit={v => { edit(r.uid, x => { x.name = v; if (!x.initials) x.initials = M.initials(v); }); }} />
                        {extra.length > 0 && <div className="muted small sub-note">{extra.join(' · ')}</div>}</td>
                      <td><Field className="inp" value={r.initials} onCommit={v => { edit(r.uid, x => { x.initials = v; }); }} /></td>
                      <td><Field className="inp" value={r.role} placeholder={t('e.g. Developer')} onCommit={v => { edit(r.uid, x => { x.role = v; }); }} /></td>
                      <td><select className="sel" value={r.kind} onChange={e => setKind(r, e.target.value as Resource['kind'])}>{M.RES_KINDS.map((k: string) => <option key={k}>{k}</option>)}</select></td>
                      <td><select className="sel" value={r.type} disabled={!work} onChange={e => { const v = e.target.value; edit(r.uid, x => { x.type = v; }); }}>
                        {M.RES_TYPES.map((k: string) => <option key={k} value={k}>{t(k)}</option>)}</select></td>
                      <td>{work && <Field className="inp" type="number" min={1} max={1000} step={5} value={String(r.maxUnits)}
                        onCommit={v => { edit(r.uid, x => { x.maxUnits = Math.max(1, Math.round(+v || 100)); }); }} />}</td>
                      <td>{r.kind !== 'Cost' && <Field className="inp" type="number" min={0} step={100} value={String(r.rate)} title={work ? t('Per hour') : t('Per unit')}
                        onCommit={v => { edit(r.uid, x => { x.rate = Math.max(0, +v || 0); }); }} />}</td>
                      <td>{work && <select className="sel" value={r.reportsTo ?? ''} onChange={e => { const v = e.target.value; edit(r.uid, x => { x.reportsTo = v ? +v : null; }); }}>
                        <option value="">—</option>
                        {p.resources.filter(o => o.uid !== r.uid && o.kind === 'Work' && !reportsUnder(r.uid, o.uid)).map(o => <option key={o.uid} value={o.uid}>{o.name || t('(unnamed)')}</option>)}
                      </select>}</td>
                      <td className="num">{work ? U.num(s.work) + 'h' : r.kind === 'Material' ? U.num(s.qty) + ' ' + r.materialLabel : ''}</td>
                      <td className="num">{U.money(s.cost)}</td>
                      <td className="num">{work ? Math.round(s.peak) + '%' : ''}</td>
                      <td>{s.over ? <span className="chip bad"><Icon name="alert" />{t('Overallocated')}</span>
                        : (s.work || s.cost) ? <span className="chip good"><Icon name="check" />{t('OK')}</span> : <span className="chip">{t('Unassigned')}</span>}</td>
                      <td className="nowrap">
                        <button className="icon-btn" title={t('Calendar, rates and cost per use')} aria-label={t('Resource details')} onClick={() => st.openDialog('resource', { uid: r.uid })}><Icon name="settings" /></button>
                        <button className="icon-btn" title={t('Delete resource')} aria-label={t('Delete resource')} onClick={() => remove(r)}><Icon name="trash" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={8}>{t('Total')}</td><td className="num">{U.num(st.s.totalWork)}h</td><td className="num">{U.money(st.s.totalCost, cur)}</td><td colSpan={3} /></tr></tfoot>
            </table>
          )}
      </div></div>
    </div>
  );
}

export function WorkloadView() {
  const st = useApp(), p = st.p, s = st.s;
  const people = p.resources.filter(r => r.kind === 'Work');
  const weeks: { dn: number; days: number[] }[] = [];
  const wkIndex: Record<number, number> = {};
  for (let d = 0; d < Math.ceil(s.duration); d++) {
    const dn = s.cal.date(d), wk = dn - ((U.weekday(dn) + 6) % 7);
    if (wkIndex[wk] == null) { wkIndex[wk] = weeks.length; weeks.push({ dn: wk, days: [] }); }
    weeks[wkIndex[wk]].days.push(d);
  }
  return (
    <div className="view">
      <div className="view-head"><h1>{t('Workload')}</h1><span className="sub">{t('Peak daily allocation per week — red cells exceed availability (max units, working days, vacations)')}</span></div>
      <div className="toolbar">
        <div className="legend">
          <span><i className="l1" />{t('Light')}</span><span><i className="l3" />{t('Heavy')}</span>
          <span><i className="over" />{t('Overallocated')}</span><span><i className="hatch" />{t('Not available')}</span>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={levelAll}><Icon name="balance" />{t('Level All')}</button>
      </div>
      <div className="scroll">
        {!people.length || !s.duration
          ? <div className="card"><div className="empty"><h3>{t('No workload yet')}</h3><div>{t('Assign people to tasks to see how busy each person is.')}</div></div></div>
          : (
            <div className="card tbl" style={{ padding: 8 }}>
              <table className="heat">
                <thead><tr><th className="rh">{t('Resource')}</th><th>{t('Max')}</th>{weeks.map(w => <th key={w.dn}>{U.fmt(w.dn).replace(/ \d+$/, '')}</th>)}</tr></thead>
                <tbody>
                  {people.map(r => {
                    const L = s.load[r.uid] || {}, stt = s.resStats[r.uid];
                    return (
                      <tr key={r.uid}>
                        <td className="rh"><b>{r.name || t('(unnamed)')}</b> <span className="muted small">{r.role || r.type}</span></td>
                        <td className="muted small">{r.maxUnits}%</td>
                        {weeks.map(w => {
                          let peak = 0, over = false, avail = 0;
                          const tasks = new Set<string>();
                          w.days.forEach(dd => {
                            const cap = stt.capOn(dd), l = L[dd] || 0;
                            if (cap > 0) avail++;
                            if (l > peak) peak = l;
                            if (l > cap + 1e-9) over = true;
                            (s.contrib[r.uid][dd] || []).forEach((i: number) => { const row = s.rows[i]; tasks.add(row.id + '. ' + row.task.name); });
                          });
                          const lvl = over ? 'over' : !peak ? (avail ? 'l0' : 'off') : peak <= 34 ? 'l1' : peak <= 67 ? 'l2' : 'l3';
                          const title = t('{date}: peak {peak}% (max {max}%, {avail} available days)', { date: U.fmt(w.dn), peak: Math.round(peak), max: r.maxUnits, avail }) + (tasks.size ? '\n' + [...tasks].join('\n') : '');
                          return <td key={w.dn} className={lvl} title={title}>{peak ? Math.round(peak) + '%' + (over ? ' !' : '') : lvl === 'off' ? t('off') : '–'}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
