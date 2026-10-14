import { useEffect, useState, type ReactNode } from 'react';
import OP from '../core';
import { useApp, type Store } from '../store';
import { t } from '../i18n';
import { runAction } from '../lib/actions';
import Icon from '../components/Icon';
import { Kpi } from './BudgetView';
import type { Row } from '../types';

const U = OP.util, M = OP.model;

export const REPORTS: [string, string][] = [
  ['overview', 'Project overview'], ['critical', 'Critical tasks'], ['milestones', 'Milestones'], ['late', 'Late & slipping tasks'],
  ['cost', 'Cost overview'], ['resources', 'Resource overview'], ['who', 'Who does what'], ['ev', 'Earned value'],
  ['variance', 'Baseline variance'], ['tasks', 'Task list']
];

type Head = [string, boolean?];

function Table({ head, rows, foot }: { head: Head[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  if (!rows.length) return <p className="muted">{t('Nothing to report.')}</p>;
  const cls = (i: number) => (head[i][1] ? 'num' : undefined);
  return (
    <table className="data rpt">
      <thead><tr>{head.map((h, i) => <th key={i} className={cls(i)}>{t(h[0])}</th>)}</tr></thead>
      <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} className={cls(i)}>{c}</td>)}</tr>)}</tbody>
      {foot && <tfoot><tr>{foot.map((c, i) => <td key={i} className={cls(i)}>{c}</td>)}</tr></tfoot>}
    </table>
  );
}

const d = (dn: number | null) => (dn == null ? '' : U.fmt(dn));
const sd = (v: number | null) => (v == null ? '' : (v > 0 ? '+' : '') + U.num(v) + 'd');
const NeedBaseline = () => <div className="card note-card"><Icon name="info" /><div>{t('This report compares against a')} <b>{t('baseline')}</b>{t('. Choose')} <b>{t('Project › Set Baseline')}</b> {t('first.')}</div></div>;

const build: Record<string, (st: Store) => ReactNode> = {
  overview: st => {
    const s = st.s, p = st.p, ls = s.rows.filter((r: Row) => !r.summary);
    let tot = 0, dn = 0;
    ls.forEach((r: Row) => { tot += r.duration; dn += r.duration * r.percent / 100; });
    const money = (v: number) => U.money(v, p.currency);
    return <>
      <div className="kpis">
        <Kpi k="Start" v={d(s.startDn)} />
        <Kpi k="Finish" v={d(s.finishDn)} s={t('{n} working days', { n: U.num(s.duration) })} />
        <Kpi k="% complete" v={(tot ? Math.round(dn / tot * 100) : 0) + '%'} />
        <Kpi k="Cost" v={money(s.totalCost)} s={p.budget ? t('Budget {amount}', { amount: money(p.budget) }) : ''} />
        <Kpi k="Tasks" v={ls.filter((r: Row) => !r.milestone).length} s={t('{n} critical', { n: ls.filter((r: Row) => r.critical && !r.milestone).length })} />
        <Kpi k="Issues" v={ls.filter((r: Row) => r.late || r.missedDeadline || r.conflict).length + s.rows.filter((r: Row) => r.over).length} s={t('late, deadline, conflict or overallocated')} />
      </div>
      <h3>{t('Project information')}</h3>
      <Table head={[['Field'], ['Value']]} rows={[
        [t('Organisation'), p.organization], [t('Project manager'), p.manager], [t('Status'), p.status], [t('Date of issue'), d(U.parseDate(p.issueDate))],
        [t('Status date'), p.statusDate ? d(U.parseDate(p.statusDate)) : t('Not set (today is used)')],
        [t('Baseline'), p.baseline ? t('Saved {date}', { date: U.fmt(U.parseDate(p.baseline.savedAt.slice(0, 10))) }) : t('Not set')]
      ]} />
      <h3>{t('Work packages')}</h3>
      <Table head={[['WBS'], ['Name'], ['Start'], ['Finish'], ['% done', true], ['Cost', true]]}
        rows={s.rows.filter((r: Row) => r.task.level === 1).map((r: Row) => [r.wbs, r.task.name, d(r.startDn), d(r.finishDn), r.percent + '%', U.money(r.cost)])} />
      <h3>{t('Upcoming milestones')}</h3>
      <Table head={[['ID'], ['Milestone'], ['Date'], ['Deadline']]}
        rows={ls.filter((r: Row) => r.milestone && r.percent < 100).slice(0, 8).map((r: Row) => [r.id, r.task.name, d(r.startDn),
          r.task.deadline ? <>{d(U.parseDate(r.task.deadline))} {r.missedDeadline && <span className="chip bad">{t('missed')}</span>}</> : ''])} />
    </>;
  },
  critical: st => <>
    <p className="muted">{t('Tasks with zero (or negative) total slack: any delay moves the project finish date.')}</p>
    <Table head={[['ID'], ['Task'], ['Start'], ['Finish'], ['Duration', true], ['Slack', true], ['Resources'], ['Predecessors']]}
      rows={st.s.rows.filter((r: Row) => !r.summary && r.critical).map((r: Row) => [r.id, r.task.name, d(r.startDn), d(r.finishDn), M.fmtDuration(r.duration), U.num(r.slack) + 'd', r.names, M.formatPreds(st.p, r.task)])} />
  </>,
  milestones: st => (
    <Table head={[['ID'], ['WBS'], ['Milestone'], ['Date'], ['Baseline'], ['Variance', true], ['Deadline'], ['Status']]}
      rows={st.s.rows.filter((r: Row) => !r.summary && r.milestone).map((r: Row) => [r.id, r.wbs, r.task.name, d(r.startDn), r.base ? d(r.base.finishDn) : '', r.base ? sd(r.finishVar) : '',
        r.task.deadline ? d(U.parseDate(r.task.deadline)) : '',
        r.percent >= 100 ? <span className="chip good">{t('Done')}</span> : r.missedDeadline ? <span className="chip bad">{t('Deadline missed')}</span> : r.late ? <span className="chip warn">{t('Late')}</span> : ''])} />
  ),
  late: st => <>
    <p className="muted">{t('Status date: {date}. “Behind” means less work is complete than the plan says by the status date.', { date: d(st.s.statusDn) })}</p>
    <Table head={[['ID'], ['Task'], ['Finish'], ['% done', true], ['Finish var.', true], ['Problem']]}
      rows={st.s.rows.filter((r: Row) => !r.summary && (r.late || r.slipped || r.missedDeadline || r.conflict)).map((r: Row) => {
        const why: string[] = [];
        if (r.late) why.push(t('Behind schedule'));
        if (r.slipped) why.push(t('Slipped {v} vs baseline', { v: sd(r.finishVar) }));
        if (r.missedDeadline) why.push(t('Misses deadline'));
        if (r.conflict) why.push(t('Constraint conflict'));
        return [r.id, r.task.name, d(r.finishDn), r.percent + '%', r.base ? sd(r.finishVar) : '', why.join('; ')];
      })} />
  </>,
  cost: st => (
    <Table head={[['WBS'], ['Task'], ['Fixed cost', true], ['Total cost', true], ['Baseline', true], ['Variance', true], ['Actual', true], ['Remaining', true]]}
      rows={st.s.rows.filter((r: Row) => r.task.level <= 2).map((r: Row) => [r.wbs, r.task.level > 1 ? <span style={{ paddingLeft: 18 }}>{r.task.name}</span> : <b>{r.task.name}</b>,
        U.money(r.task.fixedCost || 0), U.money(r.cost), r.base ? U.money(r.base.cost) : '', r.base ? U.money(r.costVar) : '', U.money(r.actualCost), U.money(r.cost - r.actualCost)])}
      foot={['', t('Total'), '', U.money(st.s.totalCost, st.p.currency), st.p.baseline ? U.money(st.s.ev.bac, st.p.currency) : '', '', '', '']} />
  ),
  resources: st => (
    <Table head={[['Resource'], ['Kind'], ['Max'], ['Work / qty', true], ['Cost', true], ['Peak', true], ['Status']]}
      rows={st.p.resources.map(r => {
        const x = st.s.resStats[r.uid];
        return [<>{r.name}<div className="muted small">{r.role}</div></>, r.kind === 'Work' ? r.type : r.kind, r.kind === 'Work' ? r.maxUnits + '%' : '',
          r.kind === 'Work' ? U.num(x.work) + 'h' : r.kind === 'Material' ? U.num(x.qty) + ' ' + r.materialLabel : '', U.money(x.cost), r.kind === 'Work' ? Math.round(x.peak) + '%' : '',
          x.over ? <span className="chip bad">{t('Overallocated ({n} days)', { n: x.overDays.length })}</span> : x.work || x.cost ? <span className="chip good">{t('OK')}</span> : <span className="chip">{t('Unassigned')}</span>];
      })}
      foot={[t('Total'), '', '', U.num(st.s.totalWork) + 'h', U.money(st.s.totalCost, st.p.currency), '', '']} />
  ),
  who: st => st.p.resources.length ? <>{st.p.resources.map(r => {
    const list = st.s.rows.filter((row: Row) => !row.summary && row.task.assignments.some((a: any) => a.res === r.uid));
    return <div key={r.uid}>
      <h3>{r.name || t('(unnamed)')} <span className="muted small">{r.role || r.kind}</span></h3>
      <Table head={[['ID'], ['Task'], ['Start'], ['Finish'], ['Units', true], ['Work', true]]} rows={list.map((row: Row) => {
        const a = row.task.assignments.find(x => x.res === r.uid)!;
        return [row.id, row.task.name, d(row.startDn), d(row.finishDn), r.kind === 'Work' ? a.units + '%' : U.num(a.units),
          r.kind === 'Work' ? U.num(a.units / 100 * st.p.hoursPerDay * row.duration) + 'h' : ''];
      })} />
    </div>;
  })}</> : <p className="muted">{t('No resources.')}</p>,
  ev: st => {
    if (!st.p.baseline) return <NeedBaseline />;
    const s = st.s, ev = s.ev, money = (v: number) => U.money(v, st.p.currency), rt = (v: number | null) => (v == null ? '—' : v.toFixed(2));
    return <>
      <div className="kpis">
        <Kpi k="BAC" v={money(ev.bac)} /><Kpi k="SPI" v={rt(ev.spi)} s={t('SV {amount}', { amount: U.money(ev.sv) })} />
        <Kpi k="CPI" v={rt(ev.cpi)} s={t('CV {amount}', { amount: U.money(ev.cv) })} /><Kpi k="EAC" v={money(ev.eac)} s={t('VAC {amount}', { amount: U.money(ev.vac) })} />
      </div>
      <p className="muted">{t('Status date {date}. BCWS = planned value, BCWP = earned value (baseline cost × % complete), ACWP = actual cost, estimated as planned cost × % complete (OpenPlan does not record actual spending), so CPI mainly reflects cost changes since the baseline. SPI/CPI below 1.00 means behind schedule / over cost.', { date: d(s.statusDn) })}</p>
      <Table head={[['WBS'], ['Package'], ['BCWS', true], ['BCWP', true], ['ACWP', true], ['SV', true], ['CV', true], ['SPI', true], ['CPI', true]]}
        rows={s.rows.filter((r: Row) => r.task.level === 1).map((r: Row) => [r.wbs, r.task.name, U.money(r.bcws), U.money(r.bcwp), U.money(r.acwp), U.money(r.bcwp - r.bcws), U.money(r.bcwp - r.acwp),
          r.bcws ? (r.bcwp / r.bcws).toFixed(2) : '—', r.acwp ? (r.bcwp / r.acwp).toFixed(2) : '—'])}
        foot={['', t('Project'), U.money(ev.bcws), U.money(ev.bcwp), U.money(ev.acwp), U.money(ev.sv), U.money(ev.cv), rt(ev.spi), rt(ev.cpi)]} />
    </>;
  },
  variance: st => {
    if (!st.p.baseline) return <NeedBaseline />;
    return <Table head={[['ID'], ['Task'], ['Start'], ['Baseline start'], ['Start var.', true], ['Finish'], ['Baseline finish'], ['Finish var.', true], ['Cost var.', true]]}
      rows={st.s.rows.filter((r: Row) => r.base).map((r: Row) => [r.id, r.summary ? <b>{r.task.name}</b> : r.task.name, d(r.startDn), d(r.base!.startDn), sd(r.startVar),
        d(r.finishDn), d(r.base!.finishDn), sd(r.finishVar), U.money(r.costVar)])} />;
  },
  tasks: st => (
    <Table head={[['ID'], ['WBS'], ['Task'], ['Duration', true], ['Start'], ['Finish'], ['Predecessors'], ['Resources'], ['Cost', true]]}
      rows={st.s.rows.map((r: Row) => [r.id, r.wbs, <span style={{ paddingLeft: (r.task.level - 1) * 18 }}>{r.summary ? <b>{r.task.name}</b> : r.task.name}</span>,
        M.fmtDuration(r.duration), d(r.startDn), d(r.finishDn), M.formatPreds(st.p, r.task), r.names, U.money(r.cost)])}
      foot={['', '', t('Total'), M.fmtDuration(st.s.duration), d(st.s.startDn), d(st.s.finishDn), '', '', U.money(st.s.totalCost, st.p.currency)]} />
  )
};

export default function ReportsView() {
  const st = useApp();
  const [printAll, setPrintAll] = useState(false);
  useEffect(() => {
    if (!printAll) return;
    window.print();
    setPrintAll(false);
  }, [printAll]);
  const id = build[st.report] ? st.report : 'overview';
  const page = ([k, title]: [string, string]) => (
    <article className="paper" key={k} id={printAll ? undefined : 'report'}>
      <header className="rpt-head">
        <div><div className="muted small">{st.p.name}{st.p.organization ? ' · ' + st.p.organization : ''}</div><h2>{t(title)}</h2></div>
        <div className="muted small">{t('Generated {date}', { date: U.fmtLong(U.todayDn()) })}</div>
      </header>
      {build[k](st)}
    </article>
  );
  return (
    <div className="view"><div className="reports">
      <nav className="rpt-nav" aria-label={t('Reports')}>
        {REPORTS.map(([k, label]) => <button key={k} className={k === id ? 'active' : ''} onClick={() => st.setUI({ report: k })}>{t(label)}</button>)}
      </nav>
      <div className="rpt-body">
        <div className="toolbar rpt-tools"><span className="spacer" />
          <button className="btn" onClick={() => setPrintAll(true)}><Icon name="report" />{t('Print all reports')}</button>
          <button className="btn" onClick={() => runAction('print')}><Icon name="printer" />{t('Print / Save as PDF')}</button>
        </div>
        {printAll ? <div className="rpt-all">{REPORTS.map(page)}</div> : page(REPORTS.find(r => r[0] === id)!)}
      </div>
    </div></div>
  );
}
