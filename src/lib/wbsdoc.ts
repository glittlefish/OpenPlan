// WBS dictionary export to Word (PRD 6.5). Dependency-free approach: a styled
// HTML document saved as .doc, which Word opens directly with live heading
// styles (so a real TOC can be generated there).
import OP from '../core';
import { t } from '../i18n';
import type { Project, Row } from '../types';

const U = OP.util;

export interface WbsDocOptions {
  template: 'compact' | 'full';
  scope: 'all' | 'leaves' | 'critical';
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toWbsDictionaryDoc(p: Project, opts: WbsDocOptions): string {
  const s = OP.schedule(p);
  const rows = s.rows.filter((r: Row) => {
    if (opts.scope === 'leaves') return !r.summary;
    if (opts.scope === 'critical') return r.critical;
    return true;
  });

  const css =
    'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;margin:2cm}' +
    'h1{font-size:22pt}h2{font-size:16pt}h3{font-size:13pt}h4{font-size:12pt}' +
    'table{border-collapse:collapse;width:100%;margin:6pt 0 12pt}' +
    'td,th{border:1px solid #999;padding:4pt 6pt;font-size:10pt;text-align:left;vertical-align:top}' +
    'th{background:#eee}' +
    '.cover{text-align:center;margin-top:5cm}h1{margin-bottom:4pt}' +
    '.meta{color:#555}p.notes{white-space:pre-wrap}';

  const cover =
    '<div class="cover"><h1>' + esc(p.name) + '</h1>' +
    '<p class="meta">' + t('WBS Dictionary') +
    (p.manager ? ' &mdash; ' + esc(p.manager) : '') +
    (p.organization ? ' &mdash; ' + esc(p.organization) : '') +
    '</p><p class="meta">' + t('Generated {date}', { date: new Date().toLocaleDateString() }) + '</p></div>';

  const toc = '<h2>' + t('Contents') + '</h2>' +
    rows.map((r: Row) => '<p style="margin:2pt 0 2pt ' + (r.task.level - 1) * 20 + 'pt">' + esc(r.wbs + ' ' + r.task.name) + '</p>').join('');

  const fieldRow = (label: string, v: string) => '<tr><th style="width:30%">' + label + '</th><td>' + esc(v) + '</td></tr>';
  const section = (r: Row) => {
    const heading = 'h' + Math.min(4, r.task.level + 1);
    let body = '';
    if (opts.template === 'full') {
      body = '<table>' +
        fieldRow(t('WBS'), r.wbs) +
        fieldRow(t('Duration'), t('{n} days', { n: r.duration })) +
        fieldRow(t('Start'), U.fmtLong(r.startDn)) +
        fieldRow(t('Finish'), U.fmtLong(r.finishDn)) +
        fieldRow(t('Resources'), r.names || '—') +
        fieldRow(t('% Complete'), r.percent + '%') +
        fieldRow(t('Cost'), U.money(r.cost, p.currency)) +
        fieldRow(t('Critical'), r.critical ? t('Yes') : t('No')) +
        '</table>';
    } else {
      body = '<table>' + fieldRow(t('WBS'), r.wbs) + fieldRow(t('Duration'), t('{n} days', { n: r.duration })) + '</table>';
    }
    if (r.task.notes) body += '<p class="notes">' + esc(r.task.notes) + '</p>';
    return '<' + heading + '>' + esc(r.wbs + ' ' + r.task.name) + '</' + heading + '>' + body;
  };

  const appendix =
    '<h2>' + t('Appendix: task list') + '</h2>' +
    '<table><tr><th>' + t('WBS') + '</th><th>' + t('Task') + '</th><th>' + t('Duration') + '</th><th>' + t('Start') + '</th><th>' + t('Finish') + '</th><th>' + t('Resources') + '</th></tr>' +
    s.rows.map((r: Row) =>
      '<tr><td>' + esc(r.wbs) + '</td><td style="padding-left:' + (r.task.level - 1) * 12 + 'pt">' + esc(r.task.name) +
      '</td><td>' + r.duration + 'd</td><td>' + U.fmt(r.startDn) + '</td><td>' + U.fmt(r.finishDn) + '</td><td>' + esc(r.names) + '</td></tr>'
    ).join('') + '</table>';

  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(p.name) + ' — ' + t('WBS Dictionary') + '</title><style>' + css + '</style></head><body>' +
    cover + toc + '<h2>' + t('Dictionary') + '</h2>' + rows.map(section).join('') + appendix + '</body></html>';
}
