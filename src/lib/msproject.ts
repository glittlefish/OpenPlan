// MS Project XML import / export (PRD 6.2). The XML dialect is the one written by
// Microsoft Project ("http://schemas.microsoft.com/project"); other tools that speak
// it (GanttProject, ProjectLibre) round-trip as well.
import OP from '../core';
import type { Project, Task, Resource, Row, Link } from '../types';

const U = OP.util;

// MS Project constraint codes (PRD 6.2.3).
const CONSTRAINT_TO_MS: Record<string, number> = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const CONSTRAINT_FROM_MS: Record<number, string> = { 0: 'ASAP', 1: 'ALAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };
// MS Project link types: 0=FF, 1=FS, 2=SF, 3=SS.
const LINK_TO_MS: Record<string, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_FROM_MS: Record<number, string> = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (el: Element | null) => (el?.textContent ? +el.textContent : 0);
const txt = (el: Element | null) => (el?.textContent || '').trim();

function isoDateTime(dateIso: string, time: string): string {
  return (dateIso || U.iso(U.todayDn())) + 'T' + time;
}

// Duration in working days -> ISO8601 period using the project's hours per day.
function durationPeriod(days: number, hoursPerDay: number): string {
  const minutes = Math.round(days * hoursPerDay * 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `PT${h}H${m}M0S`;
}

export function toMsProjectXml(p: Project): string {
  const s = OP.schedule(p);
  const rowBy = new Map<number, Row>(s.rows.map((r: Row) => [r.task.uid, r]));
  const uidOf = new Map<number, number>(); // task uid -> XML UID (1-based document order)
  p.tasks.forEach((t, i) => uidOf.set(t.uid, i + 1));
  const minutesPerDay = p.hoursPerDay * 60;
  const startDn = s.startDn, finishDn = s.finishDn;

  const tasksXml = p.tasks.map(t => {
    const r = rowBy.get(t.uid)!;
    const lines = [
      '    <Task>',
      '      <UID>' + uidOf.get(t.uid) + '</UID>',
      '      <ID>' + uidOf.get(t.uid) + '</ID>',
      '      <Name>' + esc(t.name) + '</Name>',
      '      <Type>0</Type>',
      '      <IsNull>0</IsNull>',
      '      <WBS>' + esc(r.wbs) + '</WBS>',
      '      <OutlineNumber>' + esc(r.wbs) + '</OutlineNumber>',
      '      <OutlineLevel>' + t.level + '</OutlineLevel>',
      '      <Priority>' + t.priority + '</Priority>',
      '      <Start>' + isoDateTime(U.iso(r.startDn), '08:00:00') + '</Start>',
      '      <Finish>' + isoDateTime(U.iso(r.finishDn), '17:00:00') + '</Finish>',
      '      <Duration>' + durationPeriod(r.duration, p.hoursPerDay) + '</Duration>',
      '      <DurationFormat>7</DurationFormat>',
      '      <Milestone>' + (t.milestone || r.milestone ? 1 : 0) + '</Milestone>',
      '      <Summary>' + (r.summary ? 1 : 0) + '</Summary>',
      '      <PercentComplete>' + Math.round(r.percent) + '</PercentComplete>',
      '      <Cost>' + r.cost.toFixed(2) + '</Cost>',
      '      <FixedCost>' + (t.fixedCost || 0).toFixed(2) + '</FixedCost>',
      '      <ConstraintType>' + (CONSTRAINT_TO_MS[t.constraint] ?? 0) + '</ConstraintType>',
    ];
    if (t.constraintDate) lines.push('      <ConstraintDate>' + isoDateTime(t.constraintDate, '08:00:00') + '</ConstraintDate>');
    if (t.deadline) lines.push('      <Deadline>' + isoDateTime(t.deadline, '17:00:00') + '</Deadline>');
    if (t.notes) lines.push('      <Notes>' + esc(t.notes) + '</Notes>');
    t.preds.forEach(l => {
      const predUid = uidOf.get(l.uid);
      if (!predUid) return;
      lines.push(
        '      <PredecessorLink>',
        '        <PredecessorUID>' + predUid + '</PredecessorUID>',
        '        <Type>' + (LINK_TO_MS[l.type] ?? 1) + '</Type>',
        '        <CrossProject>0</CrossProject>',
        '        <LinkLag>' + Math.round((l.lag || 0) * minutesPerDay * 10) + '</LinkLag>',
        '        <LagFormat>7</LagFormat>',
        '      </PredecessorLink>'
      );
    });
    lines.push('    </Task>');
    return lines.join('\n');
  }).join('\n');

  const resXml = p.resources.map((r, i) => {
    const type = r.kind === 'Material' ? 2 : r.kind === 'Cost' ? 3 : 1;
    return [
      '    <Resource>',
      '      <UID>' + (i + 1) + '</UID>',
      '      <ID>' + (i + 1) + '</ID>',
      '      <Name>' + esc(r.name) + '</Name>',
      '      <Type>' + type + '</Type>',
      '      <MaxUnits>' + (r.maxUnits || 1).toFixed(2) + '</MaxUnits>',
      '      <StandardRate>' + (r.rate || 0).toFixed(2) + '</StandardRate>',
      '    </Resource>',
    ].join('\n');
  }).join('\n');

  const resUidOf = new Map<number, number>(p.resources.map((r, i) => [r.uid, i + 1]));
  const asgXml = p.tasks.flatMap(t =>
    t.assignments.map(a => {
      const ru = resUidOf.get(a.res);
      if (!ru) return '';
      return [
        '    <Assignment>',
        '      <TaskUID>' + uidOf.get(t.uid) + '</TaskUID>',
        '      <ResourceUID>' + ru + '</ResourceUID>',
        '      <Units>' + (a.units || 1).toFixed(2) + '</Units>',
        '    </Assignment>',
      ].join('\n');
    }).filter(Boolean)
  ).join('\n');

  // Project calendar: one <CalendarDay> per weekday, plus dated exceptions.
  const cal = p.calendar || { workingDays: [1, 2, 3, 4, 5], workTimes: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], exceptions: [] };
  const dayXml = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const working = cal.workingDays.includes(d);
    const times = working ? cal.workTimes.map(w =>
      '          <WorkingTime><FromTime>' + w.start + ':00</FromTime><ToTime>' + w.end + ':00</ToTime></WorkingTime>').join('\n') : '';
    return [
      '      <CalendarDay>',
      '        <DayType>' + d + '</DayType>',
      '        <DayWorking>' + (working ? 1 : 0) + '</DayWorking>',
      working ? '        <WorkingTimes>\n' + times + '\n        </WorkingTimes>' : '',
      '      </CalendarDay>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  const excXml = (cal.exceptions || []).map(e => [
    '      <CalendarDay>',
    '        <DayType>0</DayType>', // 0 = dated exception
    '        <DayWorking>' + (e.working ? 1 : 0) + '</DayWorking>',
    '        <TimePeriod><FromDate>' + isoDateTime(e.date, '00:00:00') + '</FromDate><ToDate>' + isoDateTime(e.date, '23:59:00') + '</ToDate></TimePeriod>',
    '      </CalendarDay>',
  ].join('\n')).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    '  <SaveVersion>14</SaveVersion>',
    '  <Name>' + esc(p.name) + '</Name>',
    '  <Title>' + esc(p.name) + '</Title>',
    '  <Author>' + esc(p.manager) + '</Author>',
    '  <Company>' + esc(p.organization) + '</Company>',
    '  <ScheduleFromStart>1</ScheduleFromStart>',
    '  <StartDate>' + isoDateTime(p.start || U.iso(startDn), '08:00:00') + '</StartDate>',
    '  <FinishDate>' + isoDateTime(U.iso(finishDn), '17:00:00') + '</FinishDate>',
    '  <CurrencySymbol>' + esc(p.currency) + '</CurrencySymbol>',
    '  <MinutesPerDay>' + minutesPerDay + '</MinutesPerDay>',
    '  <MinutesPerWeek>' + minutesPerDay * 5 + '</MinutesPerWeek>',
    '  <DaysPerMonth>20</DaysPerMonth>',
    '  <Tasks>',
    tasksXml,
    '  </Tasks>',
    '  <Resources>',
    resXml,
    '  </Resources>',
    '  <Assignments>',
    asgXml,
    '  </Assignments>',
    '  <Calendars>',
    '   <Calendar>',
    '    <UID>1</UID>',
    '    <Name>Project calendar</Name>',
    '    <IsBaseCalendar>1</IsBaseCalendar>',
    '    <WeekDays>',
    dayXml,
    excXml,
    '    </WeekDays>',
    '   </Calendar>',
    '  </Calendars>',
    '</Project>',
    '',
  ].join('\n');
}

export interface MsProjectImport {
  project: Project;
  warnings: string[];
  counts: { tasks: number; links: number; resources: number; assignments: number };
}

// Namespace-tolerant child lookup: MSP files use the project namespace, some
// third-party writers use none, so match by local name.
function kids(el: Element, name: string): Element[] {
  return Array.from(el.children).filter(c => c.localName === name);
}
function child(el: Element | null, name: string): Element | null {
  return el ? kids(el, name)[0] ?? null : null;
}
function deep(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(e => e.localName === name);
}

export function fromMsProjectXml(text: string): MsProjectImport {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid XML.');
  const root = doc.documentElement;
  if (!root || root.localName !== 'Project') throw new Error('This XML file has no <Project> root element.');

  const warnings: string[] = [];
  const counts = { tasks: 0, links: 0, resources: 0, assignments: 0 };

  const minutesPerDay = Math.max(1, num(child(root, 'MinutesPerDay')) || 480);
  const hoursPerDay = minutesPerDay / 60;

  // --- Resources ---
  const resources: Resource[] = [];
  const xmlResUids: number[] = []; // XML UID per resources[] index
  const resUidByXml = new Map<number, number>(); // XML UID -> new internal uid
  deep(root, 'Resource').forEach((el, i) => {
    const xmlUid = num(child(el, 'UID')) || i + 1;
    const name = txt(child(el, 'Name'));
    if (!name) { warnings.push('Skipped a resource without a name.'); return; }
    const msType = num(child(el, 'Type'));
    const r: Resource = {
      uid: 0, name, initials: '', role: '', type: 'Work',
      kind: msType === 2 ? 'Material' : msType === 3 ? 'Cost' : 'Work',
      materialLabel: '', maxUnits: num(child(el, 'MaxUnits')) || 1,
      rate: num(child(el, 'StandardRate')), costPerUse: num(child(el, 'CostPerUse')),
      rates: [], workDays: [1, 2, 3, 4, 5], vacations: [], reportsTo: null,
    };
    resources.push(r);
    xmlResUids.push(xmlUid);
  });

  // --- Tasks: rebuild the outline from OutlineLevel using a last-seen-per-level stack. ---
  const taskEls = deep(root, 'Task').filter(el => !num(child(el, 'IsNull')));
  const tasks: Task[] = [];
  const uidByXml = new Map<number, number>(); // XML UID -> internal uid
  let nextUid = 1;
  taskEls.forEach((el, i) => {
    const name = txt(child(el, 'Name'));
    const level = Math.max(1, num(child(el, 'OutlineLevel')) || 1);
    if (!name) { warnings.push('Skipped task #' + (i + 1) + ' (no name).'); return; }
    const durEl = child(el, 'Duration');
    let duration = 0;
    const dm = durEl?.textContent ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(durEl.textContent) : null;
    if (dm) {
      const minutes = (+dm[1] || 0) * minutesPerDay + (+dm[2] || 0) * 60 + (+dm[3] || 0);
      duration = minutes / minutesPerDay;
    }
    const msConstraint = num(child(el, 'ConstraintType'));
    const t: Task = {
      uid: nextUid++, name, level,
      duration: Math.round(duration * 100) / 100,
      milestone: num(child(el, 'Milestone')) === 1 || duration === 0,
      percent: Math.max(0, Math.min(100, num(child(el, 'PercentComplete')))),
      notes: txt(child(el, 'Notes')),
      preds: [], assignments: [],
      constraint: CONSTRAINT_FROM_MS[msConstraint] || 'ASAP',
      constraintDate: (txt(child(el, 'ConstraintDate')) || '').slice(0, 10),
      deadline: (txt(child(el, 'Deadline')) || '').slice(0, 10),
      type: 'FixedUnits', effortDriven: false,
      fixedCost: num(child(el, 'FixedCost')),
      actualStart: (txt(child(el, 'ActualStart')) || '').slice(0, 10),
      actualFinish: (txt(child(el, 'ActualFinish')) || '').slice(0, 10),
      splits: [], levelDelay: 0,
      priority: Math.max(0, Math.min(1000, num(child(el, 'Priority')))),
      custom: {},
    };
    const xmlUid = num(child(el, 'UID')) || i + 1;
    uidByXml.set(xmlUid, t.uid);
    tasks.push(t);
  });
  counts.tasks = tasks.length;

  // --- Dependency links (second pass so predecessors can appear anywhere). ---
  taskEls.forEach(el => {
    const xmlUid = num(child(el, 'UID'));
    const toUid = uidByXml.get(xmlUid);
    if (!toUid) return;
    const to = tasks.find(t => t.uid === toUid)!;
    kids(el, 'PredecessorLink').forEach(l => {
      if (num(child(l, 'CrossProject')) === 1) { warnings.push('Ignored a cross-project link on "' + to.name + '".'); return; }
      const fromUid = uidByXml.get(num(child(l, 'PredecessorUID')));
      if (!fromUid || fromUid === toUid) { warnings.push('Ignored a link to a missing task on "' + to.name + '".'); return; }
      const lagMinutes = num(child(l, 'LinkLag')) / 10; // LinkLag is in tenths of a minute
      const type = (LINK_FROM_MS[num(child(l, 'Type'))] || 'FS') as Link['type'];
      if (to.preds.some(x => x.uid === fromUid && x.type === type)) return;
      to.preds.push({ uid: fromUid, type, lag: Math.round((lagMinutes / minutesPerDay) * 100) / 100 });
      counts.links++;
    });
  });

  // --- Assignments (resource uids are remapped after resources get their final uids) ---
  deep(root, 'Assignment').forEach(el => {
    const tUid = uidByXml.get(num(child(el, 'TaskUID')));
    const rXml = num(child(el, 'ResourceUID'));
    if (!tUid || !rXml) return;
    const t = tasks.find(x => x.uid === tUid);
    if (!t || t.assignments.some(a => a.res === rXml)) return;
    t.assignments.push({ res: rXml, units: num(child(el, 'Units')) || 1 });
    counts.assignments++;
  });

  // --- Calendar: weekday working flags + dated exceptions; fall back to defaults. ---
  let workingDays: number[] | null = null;
  let workTimes: { start: string; end: string }[] | null = null;
  const exceptions: { date: string; working: boolean; reason: string }[] = [];
  const calEl = deep(root, 'Calendar')[0];
  if (calEl) {
    const days = kids(child(calEl, 'WeekDays') ?? calEl, 'CalendarDay');
    const week = days.filter(d => num(child(d, 'DayType')) >= 1 && num(child(d, 'DayType')) <= 7);
    if (week.length) workingDays = week.filter(d => num(child(d, 'DayWorking')) === 1).map(d => num(child(d, 'DayType')));
    const firstWorking = week.find(d => num(child(d, 'DayWorking')) === 1);
    if (firstWorking) {
      workTimes = kids(child(firstWorking, 'WorkingTimes') ?? firstWorking, 'WorkingTime').map(w => ({
        start: txt(child(w, 'FromTime')).slice(0, 5), end: txt(child(w, 'ToTime')).slice(0, 5),
      })).filter(w => w.start && w.end);
    }
    days.filter(d => num(child(d, 'DayType')) === 0).forEach(d => {
      const from = txt(child(child(d, 'TimePeriod'), 'FromDate')).slice(0, 10);
      if (from) exceptions.push({ date: from, working: num(child(d, 'DayWorking')) === 1, reason: 'Imported from MS Project' });
    });
  } else {
    warnings.push('No calendar found; using the default Monday-Friday calendar.');
  }

  // --- Assemble the project on top of a blank one so every field has a value. ---
  const p: Project = OP.model.blank();
  p.name = txt(child(root, 'Name')) || txt(child(root, 'Title')) || 'Imported project';
  p.manager = txt(child(root, 'Author'));
  p.organization = txt(child(root, 'Company'));
  p.currency = txt(child(root, 'CurrencySymbol')) || p.currency;
  p.hoursPerDay = hoursPerDay;
  const startDate = (txt(child(root, 'StartDate')) || '').slice(0, 10);
  p.start = startDate || p.start;
  p.calendar = {
    workingDays: workingDays && workingDays.length ? workingDays : [1, 2, 3, 4, 5],
    workTimes: workTimes && workTimes.length ? workTimes : p.calendar!.workTimes,
    exceptions,
  };
  p.tasks = tasks;
  p.resources = resources.map((r, i) => { r.uid = nextUid++; resUidByXml.set(xmlResUids[i], r.uid); return r; });
  counts.resources = p.resources.length;
  // Re-point assignments at the final resource uids.
  p.tasks.forEach(t => { t.assignments = t.assignments.map(a => ({ ...a, res: resUidByXml.get(a.res) ?? a.res })); });
  p.nextUid = nextUid;
  const normalized = OP.model.normalize(p);
  // normalize() re-derives levels from the outline; a summary flag alone does not
  // restructure anything, so imported summaries stay as plain parents.
  return { project: normalized, warnings, counts };
}
