import type { ReactNode } from 'react';
import OP from '../core';
import { useApp } from '../store';
import { t } from '../i18n';
import Icon from '../components/Icon';
import type { Resource, Row } from '../types';

const U = OP.util, M = OP.model, C = OP.charts;

export function Kpi({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="card kpi"><div className="k">{t(k)}</div><div className="v">{v}</div><div className="s">{s}</div></div>;
}

function Health({ v }: { v: number | null }) {
  if (v == null) return null;
  if (v >= 1) return <span className="chip good"><Icon name="check" />{t('On or better')}</span>;
  return <span className={'chip ' + (v >= 0.9 ? 'warn' : 'bad')}><Icon name="alert" />{v >= 0.9 ? t('Slightly behind') : t('Behind')}</span>;
}
const ratio = (v: number | null) => (v == null ? '—' : v.toFixed(2));

export default function BudgetView() {
  const st = useApp(), p = st.p, s = st.s, cur = p.currency, ev = s.ev;
  const budget = +p.budget || 0, cost = s.totalCost, diff = budget - cost, pct = budget ? cost / budget * 100 : 0;
  const monthly = C.monthlyCost(p, s);
  const tops = s.rows.filter((r: Row) => r.task.level === 1);
  const maxTop = Math.max(1, ...tops.map((r: Row) => r.cost));
  const maxRes = Math.max(1, ...p.resources.map(r => s.resStats[r.uid].cost));
  const actual = s.rows.reduce((a: number, r: Row) => a + (r.summary ? 0 : r.actualCost), 0);
  const fixed = s.rows.reduce((a: number, r: Row) => a + (+r.task.fixedCost || 0), 0);
  const groups: { label: string; list: Resource[] }[] = [
    ...M.RES_TYPES.map((type: string) => ({ label: t(type), list: p.resources.filter(r => r.kind === 'Work' && r.type === type) })),
    { label: t('Materials'), list: p.resources.filter(r => r.kind === 'Material') },
    { label: t('Cost resources'), list: p.resources.filter(r => r.kind === 'Cost') }
  ].filter(g => g.list.length);

  return (
    <div className="view">
      <div className="view-head"><h1>{t('Cost & budget')}</h1><span className="sub">{t('Hours × rate (with rate changes), cost per use, materials, cost resources and fixed costs')}</span></div>
      <div className="toolbar"><button className="btn" onClick={() => st.openDialog('settings')}><Icon name="settings" />{t('Set budget & status date')}</button></div>
      <div className="scroll">
        <div className="kpis">
          <Kpi k="Budget" v={budget ? U.money(budget, cur) : t('Not set')} s={budget ? '' : <span className="muted">{t('Set it in Project information')}</span>} />
          <Kpi k="Planned cost" v={U.money(cost, cur)} s={budget ? <span className="muted">{t('{n}% of budget', { n: U.num(pct) })}</span> : ''} />
          {budget
            ? <Kpi k={diff >= 0 ? 'Remaining' : 'Over budget'} v={U.money(Math.abs(diff), cur)}
              s={diff >= 0 ? <span className="chip good"><Icon name="check" />{t('Within budget')}</span> : <span className="chip bad"><Icon name="alert" />{t('Over budget')}</span>} />
            : <Kpi k="Remaining" v="—" s={<span className="muted">{t('Budget not set')}</span>} />}
          <Kpi k="Duration" v={t('{n} days', { n: U.num(s.duration) })} s={<span className="muted">{U.fmt(s.startDn)} → {U.fmt(s.finishDn)}</span>} />
          <Kpi k="Actual cost to date" v={U.money(actual, cur)} s={<span className="muted">{t('from % complete')}</span>} />
        </div>

        {p.baseline ? <>
          <div className="section-h">{t('Earned value')} <span className="muted small">{t('at status date {date}', { date: U.fmt(s.statusDn) })}{p.statusDate ? '' : ' ' + t('(today — set a status date in Project information)')}</span></div>
          <div className="kpis">
            <Kpi k="Planned value (BCWS)" v={U.money(ev.bcws, cur)} s={<span className="muted">{t('BAC {amount}', { amount: U.money(ev.bac, cur) })}</span>} />
            <Kpi k="Earned value (BCWP)" v={U.money(ev.bcwp, cur)} />
            <Kpi k="Actual cost (ACWP)" v={U.money(ev.acwp, cur)} />
            <Kpi k="Schedule index (SPI)" v={ratio(ev.spi)} s={<><Health v={ev.spi} /> <span className="muted small">{t('SV {amount}', { amount: U.money(ev.sv) })}</span></>} />
            <Kpi k="Cost index (CPI)" v={ratio(ev.cpi)} s={<><Health v={ev.cpi} /> <span className="muted small">{t('CV {amount}', { amount: U.money(ev.cv) })}</span></>} />
            <Kpi k="Estimate at completion" v={U.money(ev.eac, cur)} s={<span className="muted">{t('VAC {amount}', { amount: U.money(ev.vac) })}</span>} />
          </div>
        </> : (
          <div className="card note-card"><Icon name="info" /><div><b>{t('Earned value')}</b> {t('(SPI, CPI, EAC) needs a baseline. Choose')} <b>{t('Project › Set Baseline')}</b>{t(', then record progress with % complete.')}</div></div>
        )}

        {monthly.length > 0 && (
          <div className="grid2">
            <div className="card"><h3>{t('Monthly cost')}</h3><div className="card-sub">{t('Planned spend per calendar month')}</div>
              <div className="chart" dangerouslySetInnerHTML={{ __html: C.costChart({ p, data: monthly, kind: 'monthly' }) }} /></div>
            <div className="card"><h3>{t('Cumulative cost vs budget')}</h3><div className="card-sub">{t('Dashed line = approved budget')}</div>
              <div className="chart" dangerouslySetInnerHTML={{ __html: C.costChart({ p, data: monthly, kind: 'cumulative' }) }} /></div>
          </div>
        )}

        <div className="grid2">
          <div className="card"><h3>{t('Cost by work package')}</h3><div className="card-sub">{t('Top-level WBS items')}</div>
            <div className="tbl"><table className="data">
              <thead><tr><th>{t('WBS')}</th><th>{t('Package')}</th><th className="num">{t('Work (h)')}</th><th className="num">{t('Cost')}</th>{p.baseline && <th className="num">{t('Baseline')}</th>}<th style={{ width: '28%' }} /></tr></thead>
              <tbody>{tops.map((r: Row) => (
                <tr key={r.task.uid}>
                  <td>{r.wbs}</td><td>{r.task.name}<div className="muted small">{U.fmt(r.startDn)} – {U.fmt(r.finishDn)}</div></td>
                  <td className="num">{U.num(r.work)}</td><td className="num">{U.money(r.cost)}</td>
                  {p.baseline && <td className="num">{r.base ? U.money(r.base.cost) : ''}</td>}
                  <td><div className="barcell"><div className="hbar-track"><div className="hbar" style={{ width: r.cost / maxTop * 100 + '%' }} /></div>
                    <span className="muted small">{cost ? Math.round(r.cost / cost * 100) : 0}%</span></div></td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={2}>{t('Total')}</td><td className="num">{U.num(s.totalWork)}</td><td className="num">{U.money(cost, cur)}</td>{p.baseline && <td className="num">{U.money(ev.bac)}</td>}<td /></tr></tfoot>
            </table></div>
          </div>
          <div className="card"><h3>{t('Cost by resource')}</h3><div className="card-sub">{t('Grouped by type')}</div>
            <div className="tbl"><table className="data">
              <thead><tr><th>{t('Name')}</th><th>{t('Kind')}</th><th className="num">{t('Rate')}</th><th className="num">{t('Hours / qty')}</th><th className="num">{t('Cost')}</th><th style={{ width: '24%' }} /></tr></thead>
              <tbody>
                {groups.map(g => {
                  const gc = g.list.reduce((a, r) => a + s.resStats[r.uid].cost, 0);
                  return [
                    ...g.list.map(r => {
                      const rs = s.resStats[r.uid];
                      return (
                        <tr key={r.uid}>
                          <td>{r.name}</td><td className="muted">{r.kind === 'Work' ? r.type : r.kind}</td><td className="num">{r.kind === 'Cost' ? '' : U.money(r.rate)}</td>
                          <td className="num">{r.kind === 'Work' ? U.num(rs.work) + 'h' : r.kind === 'Material' ? U.num(rs.qty) : ''}</td><td className="num">{U.money(rs.cost)}</td>
                          <td><div className="hbar-track"><div className="hbar" style={{ width: rs.cost / maxRes * 100 + '%' }} /></div></td>
                        </tr>
                      );
                    }),
                    <tr key={'g' + g.label}><td colSpan={4} className="muted small"><b>{t('{label} subtotal', { label: g.label })}</b></td><td className="num"><b>{U.money(gc)}</b></td><td /></tr>
                  ];
                })}
                {fixed > 0 && <tr><td colSpan={4} className="muted small"><b>{t('Fixed task costs')}</b></td><td className="num"><b>{U.money(fixed)}</b></td><td /></tr>}
              </tbody>
              <tfoot><tr><td colSpan={4}>{t('Total')}</td><td className="num">{U.money(cost, cur)}</td><td /></tr></tfoot>
            </table></div>
          </div>
        </div>
      </div>
    </div>
  );
}
