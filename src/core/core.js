/*
 * OpenPlan core: utilities, working-day calendar, project model and scheduler.
 * Scheduling uses the critical path method: a forward pass for early dates,
 * a backward pass for late dates, then total/free slack and the critical path.
 */
const OP = {};

/* ---------- utilities ---------- */

OP.util = (function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var fullYear = false;
  function setFullYear(on) { fullYear = !!on; }

  // Dates are handled as whole day numbers (days since 1970-01-01, UTC) to avoid timezone drift.
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    if (!m) return null;
    var dn = Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
    return iso(dn) === m[1] + '-' + m[2] + '-' + m[3] ? dn : null;
  }
  function toDate(dn) { return new Date(dn * 864e5); }
  function iso(dn) { return toDate(dn).toISOString().slice(0, 10); }
  function weekday(dn) { return ((dn + 4) % 7 + 7) % 7; }
  function fmt(dn) {
    if (dn == null) return '';
    var d = toDate(dn);
    var y = String(d.getUTCFullYear());
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + (fullYear ? y : y.slice(2));
  }
  function fmtLong(dn) {
    if (dn == null) return '';
    var d = toDate(dn);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function todayDn() {
    var n = new Date();
    return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 864e5);
  }
  function money(v, cur) {
    return (cur ? cur + ' ' : '') + Math.round(v || 0).toLocaleString();
  }
  function num(v, dp) {
    return (+v || 0).toLocaleString(undefined, { maximumFractionDigits: dp == null ? 1 : dp });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function download(name, content, type) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slug(s) { return (s || 'project').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'; }

  return {
    MONTHS: MONTHS, DAYS: DAYS, parseDate: parseDate, toDate: toDate, iso: iso, weekday: weekday,
    fmt: fmt, fmtLong: fmtLong, setFullYear: setFullYear, todayDn: todayDn, money: money, num: num, esc: esc, clone: clone,
    download: download, slug: slug
  };
})();

/* ---------- working-day calendar (project working days, plus dated exceptions) ---------- */

// cal: { workingDays: [0..6], exceptions: [{ date: 'YYYY-MM-DD', working: bool }] }
// An exception wins over the weekly rule; without one, a day works when its weekday is listed.
OP.Calendar = function (startDn, cal) {
  var days = (cal && Array.isArray(cal.workingDays)) ? cal.workingDays : [1, 2, 3, 4, 5];
  var week = {};
  days.forEach(function (d) { if (d >= 0 && d <= 6) week[d] = true; });
  var exc = {};
  (cal && cal.exceptions || []).forEach(function (e) {
    var d = OP.util.parseDate(e && e.date);
    if (d != null) exc[d] = !!e.working;
  });
  this.isWorking = function (dn) {
    if (dn in exc) return exc[dn];
    return !!week[OP.util.weekday(dn)];
  };
  var first = startDn;
  var guard = 0;
  while (!this.isWorking(first) && guard++ < 3660) first++;
  this.first = first;
  this.days = [first];
};
OP.Calendar.prototype.date = function (n) {
  n = Math.max(0, Math.floor(n));
  while (this.days.length <= n) {
    var d = this.days[this.days.length - 1] + 1;
    while (!this.isWorking(d)) d++;
    this.days.push(d);
  }
  return this.days[n];
};
// Index of the first working day on or after the given date.
OP.Calendar.prototype.indexOf = function (dn) {
  if (dn <= this.first) return 0;
  var hi = 1;
  while (this.date(hi) < dn) hi *= 2;
  var lo = 0;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (this.days[mid] < dn) lo = mid + 1; else hi = mid;
  }
  return lo;
};

// Early-finish index for a finish date: number of working days up to and including it.
OP.Calendar.prototype.finishIndex = function (dn) { return this.indexOf(dn + 1); };

/* ---------- project model ---------- */

OP.model = (function () {
  var LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];
  var RES_TYPES = ['Manager', 'Full-time', 'Part-time', 'Supporter'];
  var RES_KINDS = ['Work', 'Material', 'Cost'];
  var CONSTRAINTS = {
    ASAP: 'As soon as possible', ALAP: 'As late as possible', SNET: 'Start no earlier than', SNLT: 'Start no later than',
    FNET: 'Finish no earlier than', FNLT: 'Finish no later than', MSO: 'Must start on', MFO: 'Must finish on'
  };
  var TASK_TYPES = { FixedUnits: 'Fixed units', FixedWork: 'Fixed work', FixedDuration: 'Fixed duration' };

  function blank() {
    var t = OP.util.todayDn();
    return {
      version: 2,
      name: 'Untitled project',
      organization: '',
      manager: '',
      status: 'Draft',
      issueDate: OP.util.iso(t),
      start: OP.util.iso(t),
      statusDate: '',
      budget: 0,
      currency: 'Rs.',
      hoursPerDay: 8,
      holidays: [],
      calendar: { workingDays: [1, 2, 3, 4, 5], workTimes: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], exceptions: [] },
      customFields: [],
      baseline: null,
      nextUid: 1,
      tasks: [],
      resources: [],
      annotations: [],
      boxRules: builtinBoxRules()
    };
  }

  // Box style rules (PRD M14): two built-ins reproduce the classic look —
  // critical tasks get the red border in the network diagram, everything else stays default.
  // They are partial (border only) and scoped to the network chart so the WBS default look is unchanged.
  function builtinBoxRules() {
    return [
      { id: 'b-critical', name: 'Critical tasks', enabled: true, builtin: true, scope: 'partial', views: ['network'],
        conditions: [{ field: 'isCritical', op: 'eq', value: true }],
        style: { borderColor: 'var(--critical)', borderWidth: 2 } },
      { id: 'b-normal', name: 'Non-critical tasks', enabled: true, builtin: true, scope: 'partial', views: ['network'],
        conditions: [{ field: 'isCritical', op: 'eq', value: false }], style: {} }
    ];
  }

  var TASK_DEFAULTS = {
    name: '', level: 1, duration: 1, milestone: false, percent: 0, notes: '', preds: [], assignments: [],
    constraint: 'ASAP', constraintDate: '', deadline: '', type: 'FixedUnits', effortDriven: true, fixedCost: 0,
    actualStart: '', actualFinish: '', splits: [], levelDelay: 0, priority: 500, custom: {}
  };
  var RES_DEFAULTS = {
    name: '', initials: '', role: '', type: 'Full-time', kind: 'Work', materialLabel: '', maxUnits: 100, rate: 0,
    costPerUse: 0, rates: [], workDays: [1, 2, 3, 4, 5], vacations: [], reportsTo: null
  };

  function fill(o, defs) {
    for (var k in defs) if (o[k] == null) o[k] = JSON.parse(JSON.stringify(defs[k]));
    return o;
  }

  function newTask(p, fields) {
    var t = fill({ uid: p.nextUid++ }, TASK_DEFAULTS);
    for (var k in fields) t[k] = fields[k];
    return t;
  }

  function newResource(p, fields) {
    var r = fill({ uid: p.nextUid++ }, RES_DEFAULTS);
    for (var k in fields) r[k] = fields[k];
    return r;
  }

  // Working-time calendar (PRD M8): sanitize the project calendar and migrate legacy
  // holiday lists (pre-calendar files) into dated exceptions on first load.
  function normalizeCalendar(cal, legacyHolidays) {
    var fresh = cal == null || typeof cal !== 'object';
    var c = fresh ? { workingDays: [1, 2, 3, 4, 5], workTimes: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], exceptions: [] } : cal;
    var days = arr(c.workingDays).map(function (d) { return Math.floor(num(d, -1)); })
      .filter(function (d) { return d >= 0 && d <= 6; });
    days = days.filter(function (d, i) { return days.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    c.workingDays = days.length ? days : [1, 2, 3, 4, 5];
    var okTime = function (s) { return /^\d{1,2}:\d{2}$/.test(String(s)) && s.split(':').length === 2 && +s.split(':')[0] < 24 && +s.split(':')[1] < 60; };
    c.workTimes = arr(c.workTimes).filter(isObj).map(function (w) { return { start: str(w.start), end: str(w.end) }; })
      .filter(function (w) { return okTime(w.start) && okTime(w.end) && w.end > w.start; });
    if (!c.workTimes.length) c.workTimes = [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }];
    var seen = {};
    c.exceptions = arr(c.exceptions).filter(isObj).map(function (e) {
      return { date: str(e.date), working: !!e.working, reason: str(e.reason) };
    }).filter(function (e) { return OP.util.parseDate(e.date) != null && !seen[e.date] && (seen[e.date] = true); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (fresh) {
      // One-time migration: legacy holidays become non-working exceptions.
      var have = {};
      c.exceptions.forEach(function (e) { have[e.date] = true; });
      (legacyHolidays || []).forEach(function (h) {
        var d = str(h);
        if (OP.util.parseDate(d) != null && !have[d]) { have[d] = true; c.exceptions.push({ date: d, working: false, reason: 'Holiday' }); }
      });
      c.exceptions.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    }
    return c;
  }

  // Bring files from older versions up to date, fill missing fields and coerce every value to its expected type.
  function normalize(p) {
    var base = blank();
    for (var k in base) if (p[k] == null) p[k] = base[k];
    ['name', 'organization', 'manager', 'status', 'issueDate', 'start', 'statusDate', 'currency'].forEach(function (k) { p[k] = str(p[k]); });
    p.budget = Math.max(0, num(p.budget, 0));
    p.hoursPerDay = Math.max(1, Math.min(24, num(p.hoursPerDay, 8)));
    p.holidays = arr(p.holidays).map(str);
    p.calendar = normalizeCalendar(p.calendar, p.holidays);
    p.customFields = arr(p.customFields).filter(isObj).map(function (f) {
      return { id: str(f.id), name: str(f.name), type: f.type === 'number' ? 'number' : 'text' };
    });
    p.tasks = arr(p.tasks).filter(isObj);
    p.resources = arr(p.resources).filter(isObj);
    var maxUid = 0;
    p.tasks.concat(p.resources).forEach(function (o) { maxUid = Math.max(maxUid, uidOf(o)); });
    p.nextUid = Math.max(Math.floor(num(p.nextUid, 1)), maxUid + 1);
    [p.tasks, p.resources].forEach(function (list) {
      var seen = {};
      list.forEach(function (o) {
        var u = uidOf(o);
        if (!u || seen[u]) u = p.nextUid++;
        seen[u] = true;
        o.uid = u;
      });
    });
    p.tasks.forEach(function (t) {
      if (t.snet && !t.constraintDate) { t.constraint = 'SNET'; t.constraintDate = t.snet; }
      delete t.snet;
      fill(t, TASK_DEFAULTS);
      ['name', 'notes', 'constraintDate', 'deadline', 'actualStart', 'actualFinish'].forEach(function (k) { t[k] = str(t[k]); });
      t.level = Math.max(1, Math.floor(num(t.level, 1)));
      t.duration = Math.max(0, num(t.duration, 1));
      t.milestone = !!t.milestone;
      t.percent = Math.max(0, Math.min(100, num(t.percent, 0)));
      t.effortDriven = !!t.effortDriven;
      t.fixedCost = num(t.fixedCost, 0);
      t.levelDelay = Math.max(0, num(t.levelDelay, 0));
      t.priority = Math.max(0, Math.min(1000, num(t.priority, 500)));
      if (!CONSTRAINTS[t.constraint]) t.constraint = 'ASAP';
      if (!TASK_TYPES[t.type]) t.type = 'FixedUnits';
      t.preds = arr(t.preds).filter(isObj).map(function (l) {
        return { uid: uidOf(l), type: LINK_TYPES.indexOf(l.type) >= 0 ? l.type : 'FS', lag: num(l.lag, 0) };
      }).filter(function (l) { return l.uid; });
      t.assignments = arr(t.assignments).filter(isObj).map(function (a) {
        return { res: uidOf({ uid: a.res }), units: Math.max(0, num(a.units, 0)) };
      }).filter(function (a) { return a.res; });
      t.splits = arr(t.splits).filter(isObj).map(function (x) { return { at: num(x.at, 0), gap: Math.max(0, num(x.gap, 0)) }; });
      var custom = {};
      if (isObj(t.custom)) for (var c in t.custom) {
        var v = t.custom[c];
        if (typeof v === 'string' || (typeof v === 'number' && isFinite(v))) custom[c] = v;
      }
      t.custom = custom;
      t.customStyle = isObj(t.customStyle) ? sanitizeBoxStyle(t.customStyle) : null;
    });
    p.resources.forEach(function (r) {
      fill(r, RES_DEFAULTS);
      ['name', 'initials', 'role', 'materialLabel'].forEach(function (k) { r[k] = str(r[k]); });
      if (RES_TYPES.indexOf(r.type) < 0) r.type = 'Full-time';
      if (RES_KINDS.indexOf(r.kind) < 0) r.kind = 'Work';
      r.maxUnits = Math.max(1, num(r.maxUnits, 100));
      r.rate = Math.max(0, num(r.rate, 0));
      r.costPerUse = Math.max(0, num(r.costPerUse, 0));
      r.rates = arr(r.rates).filter(isObj).map(function (e) { return { from: str(e.from), rate: Math.max(0, num(e.rate, 0)) }; });
      r.workDays = arr(r.workDays).map(Number).filter(function (d) { return d >= 0 && d <= 6 && d === Math.floor(d); });
      r.vacations = arr(r.vacations).map(str);
      r.reportsTo = uidOf({ uid: r.reportsTo }) || null;
    });
    if (!isObj(p.baseline) || !isObj(p.baseline.tasks)) p.baseline = null;
    else p.baseline.savedAt = str(p.baseline.savedAt);
    // Network diagram: manual node positions — keep only valid entries for existing tasks.
    var np = isObj(p.netPos) ? p.netPos : {};
    var good = {};
    p.tasks.forEach(function (t) {
      var q = np[t.uid];
      if (isObj(q) && isFinite(+q.x) && isFinite(+q.y)) good[t.uid] = { x: +q.x, y: +q.y };
    });
    p.netPos = good;
    // Free text boxes (PRD M13): sanitize and keep only entries that can still render.
    p.annotations = arr(p.annotations).filter(isObj).slice(0, 200).map(function (a) {
      return {
        id: str(a.id) || 'a' + Math.random().toString(36).slice(2, 8),
        view: a.view === 'network' ? 'network' : 'wbs',
        mode: a.mode === 'task' || a.mode === 'group' ? a.mode : 'free',
        text: str(a.text),
        x: Math.max(0, num(a.x, 0)), y: Math.max(0, num(a.y, 0)),
        w: Math.max(40, num(a.w, 160)), h: Math.max(24, num(a.h, 60)),
        dx: num(a.dx, 0), dy: num(a.dy, 0),
        taskUid: uidOf({ uid: a.taskUid }) || null,
        uids: arr(a.uids).map(Number).filter(function (u) { return u > 0 && u === Math.floor(u); })
      };
    });
    // Box style rules (PRD M14): sanitize, cap at 50, keep the built-ins present for older files.
    p.boxRules = arr(p.boxRules).filter(isObj).slice(0, 50).map(sanitizeBoxRule);
    var haveB = {};
    p.boxRules.forEach(function (r) { if (r.builtin) haveB[r.id] = true; });
    builtinBoxRules().forEach(function (b) { if (!haveB[b.id]) p.boxRules.unshift(b); });
    p.version = 2;
    normalizeLevels(p);
    return p;
  }

  var BS_FIELDS = ['isCritical', 'percentComplete', 'level', 'duration', 'type', 'resourceId', 'constraintType', 'hasDeadline', 'milestone', 'summary', 'name', 'notes'];
  var BS_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'isEmpty', 'isNotEmpty'];

  function sanitizeBoxStyle(style) {
    var s = {};
    ['borderColor', 'fillColor', 'textColor', 'shadowColor'].forEach(function (k) {
      if (typeof style[k] === 'string' && style[k]) s[k] = style[k];
    });
    if (style.borderWidth === 1 || style.borderWidth === 2 || style.borderWidth === 3) s.borderWidth = style.borderWidth;
    if (style.borderDash === 'solid' || style.borderDash === 'dashed' || style.borderDash === 'dotted') s.borderDash = style.borderDash;
    if (style.bold) s.bold = true;
    ['shadowX', 'shadowY'].forEach(function (k) {
      if (isFinite(+style[k])) s[k] = Math.max(-4, Math.min(4, Math.round(+style[k])));
    });
    return s;
  }

  function sanitizeBoxRule(r) {
    var views = arr(r.views).filter(function (v) { return v === 'wbs' || v === 'network'; });
    return {
      id: str(r.id) || 'r' + Math.random().toString(36).slice(2, 8),
      name: str(r.name) || 'Rule',
      enabled: r.enabled == null ? true : !!r.enabled,
      builtin: !!r.builtin,
      scope: r.scope === 'full' ? 'full' : 'partial',
      views: views.length ? views : ['wbs', 'network'],
      conditions: arr(r.conditions).filter(isObj).slice(0, 10).map(function (c) {
        return { field: str(c.field), op: str(c.op), value: c.value };
      }).filter(function (c) { return BS_FIELDS.indexOf(c.field) >= 0 && BS_OPS.indexOf(c.op) >= 0; }),
      style: sanitizeBoxStyle(isObj(r.style) ? r.style : {})
    };
  }

  function isObj(o) { return o != null && typeof o === 'object' && !Array.isArray(o); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  function uidOf(o) { var u = +o.uid; return u > 0 && u === Math.floor(u) ? u : 0; }

  function isSummary(p, i) {
    return i + 1 < p.tasks.length && p.tasks[i + 1].level > p.tasks[i].level;
  }

  // Index one past the last descendant of task i.
  function subtreeEnd(p, i) {
    var lv = p.tasks[i].level, j = i + 1;
    while (j < p.tasks.length && p.tasks[j].level > lv) j++;
    return j;
  }

  function indexByUid(p) {
    var m = {};
    p.tasks.forEach(function (t, i) { m[t.uid] = i; });
    return m;
  }

  // "3, 5SS+2d, 7FF-1" -> [{uid, type, lag}] using row IDs (1-based) like MS Project.
  function parsePreds(p, text, selfUid) {
    var out = [], errors = [];
    String(text || '').split(/[,;]/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*d?)?$/i.exec(part);
      if (!m) { errors.push(part); return; }
      var t = p.tasks[+m[1] - 1];
      if (!t || t.uid === selfUid) { errors.push(part); return; }
      var lag = m[3] ? (m[3] === '-' ? -1 : 1) * +m[4] : 0;
      out.push({ uid: t.uid, type: (m[2] || 'FS').toUpperCase(), lag: lag });
    });
    return { preds: out, errors: errors };
  }

  function formatPreds(p, t, idx) {
    idx = idx || indexByUid(p);
    return t.preds.filter(function (l) { return idx[l.uid] != null; }).map(function (l) {
      var s = String(idx[l.uid] + 1);
      if (l.type !== 'FS' || l.lag) s += l.type;
      if (l.lag) s += (l.lag > 0 ? '+' : '') + l.lag + 'd';
      return s;
    }).join(', ');
  }

  // "5", "5d", "2w", "16h" -> working days
  function parseDuration(text, hpd) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|h|hr|hrs|hours?)?\s*$/i.exec(String(text));
    if (!m) return null;
    var v = +m[1], u = (m[2] || 'd').toLowerCase();
    if (u[0] === 'w') v *= 5;
    else if (u[0] === 'h') v /= (hpd || 8);
    return Math.round(v * 100) / 100;
  }

  function fmtDuration(d) { return OP.util.num(d, 2) + 'd'; }

  function removeTasks(p, uids) {
    var set = {};
    uids.forEach(function (u) { set[u] = true; });
    p.tasks = p.tasks.filter(function (t) { return !set[t.uid]; });
    p.tasks.forEach(function (t) { t.preds = t.preds.filter(function (l) { return !set[l.uid]; }); });
    normalizeLevels(p);
  }

  // Keep outline valid: first task level 1, no task more than one level deeper than its predecessor.
  function normalizeLevels(p) {
    var prev = 0;
    p.tasks.forEach(function (t) {
      t.level = Math.max(1, Math.min(t.level, prev + 1));
      prev = t.level;
    });
  }

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 3).toUpperCase();
  }

  // Standard hourly rate in force on a given day (rate table entries override the base rate from their date).
  function rateOn(res, dn) {
    var rate = +res.rate || 0;
    (res.rates || []).forEach(function (e) {
      var from = OP.util.parseDate(e.from);
      if (from != null && from <= dn) rate = +e.rate || 0;
    });
    return rate;
  }

  // Sum of work-resource units on a task, as a fraction (1 = one full-time person).
  function workUnits(p, t) {
    var byUid = {};
    p.resources.forEach(function (r) { byUid[r.uid] = r; });
    return t.assignments.reduce(function (a, x) {
      var r = byUid[x.res];
      return a + (r && r.kind === 'Work' ? x.units / 100 : 0);
    }, 0);
  }

  return {
    LINK_TYPES: LINK_TYPES, RES_TYPES: RES_TYPES, RES_KINDS: RES_KINDS, CONSTRAINTS: CONSTRAINTS, TASK_TYPES: TASK_TYPES,
    blank: blank, newTask: newTask, newResource: newResource, normalize: normalize,
    isSummary: isSummary, subtreeEnd: subtreeEnd, indexByUid: indexByUid, parsePreds: parsePreds,
    formatPreds: formatPreds, parseDuration: parseDuration, fmtDuration: fmtDuration,
    removeTasks: removeTasks, normalizeLevels: normalizeLevels, initials: initials, rateOn: rateOn, workUnits: workUnits
  };
})();

/* ---------- scheduler (critical path method) ---------- */

OP.schedule = function (p, opts) {
  var U = OP.util, M = OP.model;
  var tasks = p.tasks, n = tasks.length;
  var cal = new OP.Calendar(U.parseDate(p.start) || U.todayDn(), p.calendar);
  var hpd = +p.hoursPerDay || 8;
  var idx = M.indexByUid(p);
  var resByUid = {};
  p.resources.forEach(function (r) { resByUid[r.uid] = r; });
  function startIdx(iso) { var d = U.parseDate(iso); return d == null ? null : cal.indexOf(d); }
  function finishIdx(iso) { var d = U.parseDate(iso); return d == null ? null : cal.finishIndex(d); }

  // Outline structure
  var rows = tasks.map(function (t, i) {
    return { task: t, i: i, id: i + 1, summary: M.isSummary(p, i), parent: -1, children: [], wbs: '', leaves: [] };
  });
  var stack = [], counters = [];
  rows.forEach(function (r) {
    var lv = r.task.level;
    while (stack.length && tasks[stack[stack.length - 1]].level >= lv) stack.pop();
    r.parent = stack.length ? stack[stack.length - 1] : -1;
    if (r.parent >= 0) rows[r.parent].children.push(r.i);
    counters.length = lv;
    counters[lv - 1] = (counters[lv - 1] || 0) + 1;
    r.wbs = counters.slice(0, lv).join('.');
    stack.push(r.i);
  });
  for (var i = n - 1; i >= 0; i--) {
    var r0 = rows[i];
    if (!r0.summary) r0.leaves = [i];
    else r0.children.forEach(function (c) { r0.leaves = r0.leaves.concat(rows[c].leaves); });
  }
  function isAncestor(a, b) {
    for (var q = rows[b].parent; q >= 0; q = rows[q].parent) if (q === a) return true;
    return false;
  }
  function dur(i) { return tasks[i].milestone ? 0 : Math.max(0, +tasks[i].duration || 0); }
  function gaps(i) {
    var d = dur(i);
    return (tasks[i].splits || []).reduce(function (a, s) { return a + (s.at > 0 && s.at < d ? Math.max(0, +s.gap || 0) : 0); }, 0);
  }
  function span(i) { return dur(i) + gaps(i); }

  // Expand links on summary tasks into leaf-to-leaf edges.
  var edges = [], seen = {};
  rows.forEach(function (r) {
    r.task.preds.forEach(function (l) {
      var pi = idx[l.uid];
      if (pi == null || pi === r.i || isAncestor(pi, r.i) || isAncestor(r.i, pi)) return;
      rows[pi].leaves.forEach(function (a) {
        r.leaves.forEach(function (b) {
          var key = a + '>' + b + l.type + l.lag;
          if (a === b || seen[key]) return;
          seen[key] = true;
          edges.push({ from: a, to: b, type: l.type, lag: +l.lag || 0 });
        });
      });
    });
  });

  var leaves = rows.filter(function (r) { return !r.summary; }).map(function (r) { return r.i; });
  var preds = {}, succs = {}, indeg = {};
  leaves.forEach(function (i) { preds[i] = []; succs[i] = []; indeg[i] = 0; });
  edges.forEach(function (e) { preds[e.to].push(e); succs[e.from].push(e); indeg[e.to]++; });

  // Topological order (Kahn); anything left over is part of, or downstream of, a dependency loop.
  var order = [], queue = leaves.filter(function (i) { return indeg[i] === 0; });
  while (queue.length) {
    var v = queue.shift();
    order.push(v);
    succs[v].forEach(function (e) { if (--indeg[e.to] === 0) queue.push(e.to); });
  }
  var stuck = leaves.filter(function (i) { return indeg[i] > 0; });
  var cyclic = {};
  stuck.forEach(function (i) { cyclic[i] = true; order.push(i); });
  // Prune tasks that are merely downstream of a loop so only the loop itself is reported.
  var pruned = true, onLoop = {};
  stuck.forEach(function (i) { onLoop[i] = true; });
  while (pruned) {
    pruned = false;
    stuck.forEach(function (i) {
      if (onLoop[i] && !succs[i].some(function (e) { return onLoop[e.to]; })) { onLoop[i] = false; pruned = true; }
    });
  }
  var cycle = stuck.filter(function (i) { return onLoop[i]; });
  if (opts && opts.cycleOnly) return { cycle: cycle.map(function (i) { return i + 1; }) };

  // Earliest start allowed by one link, given the predecessor's dates.
  function linkStart(e, sp) {
    if (e.type === 'FS') return EF[e.from] + e.lag;
    if (e.type === 'SS') return ES[e.from] + e.lag;
    if (e.type === 'FF') return EF[e.from] + e.lag - sp;
    return ES[e.from] + e.lag - sp;
  }

  // Forward pass: early start / early finish in working-day units from project start.
  var ES = {}, EF = {}, conflict = {};
  order.forEach(function (i) {
    var t = tasks[i], sp = span(i), es = 0, cd;
    preds[i].forEach(function (e) {
      if (cyclic[i] && cyclic[e.from]) return;
      if (ES[e.from] == null) return;
      es = Math.max(es, linkStart(e, sp));
    });
    var fromLinks = es;
    if (t.constraintDate) {
      if (t.constraint === 'SNET' && (cd = startIdx(t.constraintDate)) != null) es = Math.max(es, cd);
      if (t.constraint === 'FNET' && (cd = finishIdx(t.constraintDate)) != null) es = Math.max(es, cd - sp);
      if (t.constraint === 'MSO' && (cd = startIdx(t.constraintDate)) != null) es = cd;
      if (t.constraint === 'MFO' && (cd = finishIdx(t.constraintDate)) != null) es = cd - sp;
    }
    if (es < fromLinks - 1e-9) conflict[i] = 'The ' + M.CONSTRAINTS[t.constraint] + ' date is earlier than its predecessors allow';
    es = Math.max(0, es) + (t.constraint === 'ALAP' ? 0 : +t.levelDelay || 0);
    if (t.actualStart && (cd = startIdx(t.actualStart)) != null) es = cd;
    ES[i] = es;
    EF[i] = es + sp;
    if (t.actualFinish && (cd = finishIdx(t.actualFinish)) != null) EF[i] = Math.max(es + (sp ? 1 : 0), cd);
  });

  var projEF = 0;
  leaves.forEach(function (i) { if (EF[i] > projEF) projEF = EF[i]; });

  // Backward pass: late start / late finish (constraints and deadlines can only pull late dates earlier).
  var LS = {}, LF = {};
  for (var k = order.length - 1; k >= 0; k--) {
    var li = order[k], t2 = tasks[li], sp2 = EF[li] - ES[li], lf = projEF, cd2;
    succs[li].forEach(function (e) {
      if (LS[e.to] == null) return;
      var c;
      if (e.type === 'FS') c = LS[e.to] - e.lag;
      else if (e.type === 'SS') c = LS[e.to] - e.lag + sp2;
      else if (e.type === 'FF') c = LF[e.to] - e.lag;
      else c = LF[e.to] - e.lag + sp2;
      if (c < lf) lf = c;
    });
    if (t2.constraintDate) {
      if ((t2.constraint === 'SNLT' || t2.constraint === 'MSO') && (cd2 = startIdx(t2.constraintDate)) != null) lf = Math.min(lf, cd2 + sp2);
      if ((t2.constraint === 'FNLT' || t2.constraint === 'MFO') && (cd2 = finishIdx(t2.constraintDate)) != null) lf = Math.min(lf, cd2);
    }
    if (t2.deadline && (cd2 = finishIdx(t2.deadline)) != null) lf = Math.min(lf, cd2);
    LF[li] = lf;
    LS[li] = lf - sp2;
  }

  // As-late-as-possible tasks move right as far as their successors' early dates allow
  // (a leveling delay on an ALAP task pulls it back earlier instead).
  var ES0 = {};
  leaves.forEach(function (i) { ES0[i] = ES[i]; });
  for (var a = order.length - 1; a >= 0; a--) {
    var ai = order[a];
    if (tasks[ai].constraint !== 'ALAP' || tasks[ai].actualStart || cyclic[ai]) continue;
    var asp = EF[ai] - ES[ai], limit = projEF;
    succs[ai].forEach(function (e) {
      var c;
      if (e.type === 'FS') c = ES[e.to] - e.lag;
      else if (e.type === 'SS') c = ES[e.to] - e.lag + asp;
      else if (e.type === 'FF') c = EF[e.to] - e.lag;
      else c = EF[e.to] - e.lag + asp;
      limit = Math.min(limit, c);
    });
    limit -= +tasks[ai].levelDelay || 0;
    if (limit > EF[ai]) { EF[ai] = limit; ES[ai] = limit - asp; }
  }

  // Free slack: how far a task can slip without delaying any successor.
  var FS = {};
  leaves.forEach(function (i) {
    var fs = projEF - EF[i];
    succs[i].forEach(function (e) {
      var c;
      if (e.type === 'FS') c = ES[e.to] - e.lag - EF[i];
      else if (e.type === 'SS') c = ES[e.to] - e.lag - ES[i];
      else if (e.type === 'FF') c = EF[e.to] - e.lag - EF[i];
      else c = EF[e.to] - e.lag - ES[i];
      fs = Math.min(fs, c);
    });
    FS[i] = Math.max(0, fs);
  });

  // Working-day segments actually worked (split tasks have gaps).
  function segments(i) {
    var d = dur(i), es = ES[i];
    if (tasks[i].actualFinish || !d) return [[es, es + Math.max(EF[i] - es, 0)]];
    var out = [], o = 0, t = es;
    (tasks[i].splits || []).filter(function (s) { return s.at > 0 && s.at < d; })
      .sort(function (x, y) { return x.at - y.at; })
      .forEach(function (s) {
        out.push([t, t + (s.at - o)]);
        t += (s.at - o) + (+s.gap || 0);
        o = s.at;
      });
    out.push([t, t + d - o]);
    return out;
  }

  // Resource loading and cost.
  var status = U.parseDate(p.statusDate) || U.todayDn();
  var statusIdx = cal.finishIndex(status);
  var load = {}, contrib = {}, agg = {}, dayCost = {};
  p.resources.forEach(function (res) { load[res.uid] = {}; contrib[res.uid] = {}; agg[res.uid] = { work: 0, cost: 0, qty: 0 }; });
  function addDayCost(day, v) { dayCost[day] = (dayCost[day] || 0) + v; }
  var base = p.baseline && p.baseline.tasks || null;
  rows.forEach(function (r) {
    var t = r.task;
    r.es = ES[r.i]; r.ef = EF[r.i]; r.ls = LS[r.i]; r.lf = LF[r.i]; r.freeSlack = FS[r.i]; r.esEarly = ES0[r.i];
    r.cost = 0; r.work = 0; r.cyclic = !!cyclic[r.i]; r.conflict = conflict[r.i] || '';
    r.material = {};
    if (r.summary) return;
    r.segs = segments(r.i);
    var d = dur(r.i), flat = +t.fixedCost || 0;
    t.assignments.forEach(function (as) {
      var res = resByUid[as.res], ag = agg[as.res];
      if (!res) return;
      if (res.kind === 'Cost') { flat += +as.units || 0; ag.cost += +as.units || 0; return; }
      var once = +res.costPerUse || 0;
      if (res.kind === 'Material') {
        once += (+as.units || 0) * (+res.rate || 0);
        ag.qty += +as.units || 0;
        r.material[res.uid] = (r.material[res.uid] || 0) + (+as.units || 0);
      }
      flat += once;
      ag.cost += once;
      if (res.kind === 'Material') return;
      var perDay = as.units / 100 * hpd;
      r.work += perDay * d;
      ag.work += perDay * d;
      r.segs.forEach(function (sg) {
        for (var day = Math.floor(sg[0]); day < Math.ceil(sg[1]); day++) {
          var frac = Math.min(sg[1], day + 1) - Math.max(sg[0], day);
          if (frac <= 0) continue;
          load[res.uid][day] = (load[res.uid][day] || 0) + as.units;
          (contrib[res.uid][day] = contrib[res.uid][day] || []).push(r.i);
          var c = perDay * frac * M.rateOn(res, cal.date(day));
          r.cost += c;
          ag.cost += c;
          addDayCost(day, c);
        }
      });
    });
    r.cost += flat;
    // Fixed, per-use, material and cost-resource amounts are spread over the days actually worked.
    var worked = r.segs.reduce(function (a, sg) { return a + Math.max(0, sg[1] - sg[0]); }, 0);
    if (flat && !worked) addDayCost(Math.floor(r.es), flat);
    else if (flat) r.segs.forEach(function (sg) {
      for (var day = Math.floor(sg[0]); day < Math.ceil(sg[1]); day++) {
        var frac = Math.min(sg[1], day + 1) - Math.max(sg[0], day);
        if (frac > 0) addDayCost(day, flat * frac / worked);
      }
    });
    // Tracking: actual cost follows % complete; earned value needs a baseline.
    var pct = Math.max(0, Math.min(100, +t.percent || 0)) / 100;
    r.actualCost = r.cost * pct;
    r.actualWork = r.work * pct;
    var sp = r.ef - r.es;
    var expected = sp > 0 ? Math.max(0, Math.min(1, (statusIdx - r.es) / sp)) : (statusIdx >= r.es ? 1 : 0);
    r.late = !!(p.statusDate || base) && pct < expected - 1e-9;
    var b = base && base[t.uid];
    if (b) {
      var bes = startIdx(b.start), bef = b.duration ? finishIdx(b.finish) : bes, bsp = bef - bes;
      r.bcws = b.cost * (bsp > 0 ? Math.max(0, Math.min(1, (statusIdx - bes) / bsp)) : (statusIdx >= bes ? 1 : 0));
      r.bcwp = b.cost * pct;
    } else { r.bcws = 0; r.bcwp = 0; }
    r.acwp = r.actualCost;
  });

  // Roll up summaries (children come after parents, so walk backwards).
  for (var s = n - 1; s >= 0; s--) {
    var sr = rows[s];
    if (!sr.summary) continue;
    sr.es = Infinity; sr.ef = -Infinity; sr.ls = Infinity; sr.lf = -Infinity;
    sr.actualCost = 0; sr.actualWork = 0; sr.bcws = 0; sr.bcwp = 0; sr.acwp = 0; sr.late = false;
    sr.cost = +sr.task.fixedCost || 0;
    sr.children.forEach(function (c) {
      var cr = rows[c];
      sr.es = Math.min(sr.es, cr.es); sr.ef = Math.max(sr.ef, cr.ef);
      sr.ls = Math.min(sr.ls, cr.ls); sr.lf = Math.max(sr.lf, cr.lf);
      sr.cost += cr.cost; sr.work += cr.work; sr.actualCost += cr.actualCost; sr.actualWork += cr.actualWork;
      sr.bcws += cr.bcws; sr.bcwp += cr.bcwp; sr.acwp += cr.acwp;
      sr.late = sr.late || cr.late;
    });
    sr.freeSlack = 0;
  }

  var totalCost = 0, totalWork = 0;
  rows.forEach(function (r) {
    var t = r.task;
    r.duration = r.summary ? r.ef - r.es : dur(r.i);
    r.slack = r.summary ? Math.min.apply(null, r.leaves.map(function (l) { return LS[l] - ES[l]; })) : r.ls - r.es;
    r.critical = r.slack <= 1e-9;
    r.milestone = !r.summary && r.duration === 0;
    r.startDn = r.milestone && r.es > 0 ? cal.date(Math.ceil(r.es) - 1) : cal.date(r.es);
    r.finishDn = r.ef - r.es > 0 ? cal.date(Math.ceil(r.ef) - 1) : r.startDn;
    r.percent = r.summary ? summaryPercent(r) : +t.percent || 0;
    if (!r.summary) { totalCost += r.cost; totalWork += r.work; } else totalCost += +t.fixedCost || 0;
    var dl = U.parseDate(t.deadline);
    r.missedDeadline = dl != null && r.finishDn > dl;
    var b = base && base[t.uid];
    r.base = b ? { startDn: U.parseDate(b.start), finishDn: U.parseDate(b.finish), duration: b.duration, cost: b.cost, work: b.work } : null;
    if (r.base) {
      r.startVar = cal.indexOf(r.startDn) - cal.indexOf(r.base.startDn);
      r.finishVar = cal.indexOf(r.finishDn) - cal.indexOf(r.base.finishDn);
      r.costVar = r.cost - r.base.cost;
      r.slipped = r.finishVar > 0;
    }
    r.names = t.assignments.map(function (a) {
      var res = resByUid[a.res];
      if (!res) return '';
      var label = res.initials || res.name;
      if (res.kind === 'Material') return label + ' [' + U.num(a.units) + (res.materialLabel ? ' ' + res.materialLabel : '') + ']';
      if (res.kind === 'Cost') return label;
      return label + (a.units !== 100 ? ' [' + a.units + '%]' : '');
    }).filter(Boolean).join(', ');
  });
  function summaryPercent(r) {
    var tot = 0, done = 0;
    r.leaves.forEach(function (l) { var d = dur(l) || 0; tot += d; done += d * (+tasks[l].percent || 0) / 100; });
    return tot ? Math.round(done / tot * 100) : 0;
  }

  // Resource summary: peak allocation, availability (working days, vacations) and overallocation.
  var resStats = {};
  p.resources.forEach(function (res) {
    var vac = {};
    (res.vacations || []).forEach(function (v) { var d = U.parseDate(v); if (d != null) vac[d] = true; });
    var wd = res.workDays || [1, 2, 3, 4, 5];
    var capOn = function (day) {
      var dn = cal.date(day);
      return vac[dn] || wd.indexOf(U.weekday(dn)) < 0 ? 0 : res.maxUnits;
    };
    var peak = 0, overDays = [], L = load[res.uid], ag = agg[res.uid];
    for (var dd in L) {
      if (L[dd] > peak) peak = L[dd];
      if (L[dd] > capOn(+dd) + 1e-9) overDays.push(+dd);
    }
    resStats[res.uid] = { peak: peak, overDays: overDays.sort(function (x, y) { return x - y; }), over: overDays.length > 0, work: ag.work, cost: ag.cost, qty: ag.qty, capOn: capOn };
  });
  rows.forEach(function (r) {
    r.over = !r.summary && r.task.assignments.some(function (a) {
      var st = resStats[a.res];
      return st && st.over && r.segs.some(function (sg) {
        return st.overDays.some(function (d) { return d >= Math.floor(sg[0]) && d < Math.ceil(sg[1]); });
      });
    });
  });

  // Project-level earned value.
  var ev = { bac: 0, bcws: 0, bcwp: 0, acwp: 0 };
  rows.forEach(function (r) {
    if (r.summary) return;
    ev.bcws += r.bcws; ev.bcwp += r.bcwp; ev.acwp += r.acwp;
    if (r.base) ev.bac += r.base.cost;
  });
  ev.sv = ev.bcwp - ev.bcws; ev.cv = ev.bcwp - ev.acwp;
  ev.spi = ev.bcws ? ev.bcwp / ev.bcws : null;
  ev.cpi = ev.acwp ? ev.bcwp / ev.acwp : null;
  ev.eac = ev.cpi ? ev.bac / ev.cpi : totalCost;
  ev.vac = ev.bac - ev.eac;

  var hasTasks = leaves.length > 0;
  return {
    rows: rows, edges: edges, cal: cal, load: load, contrib: contrib, resStats: resStats, ev: ev, dayCost: dayCost,
    cycle: cycle.map(function (i) { return i + 1; }),
    duration: projEF,
    statusDn: status,
    startDn: cal.date(0),
    finishDn: hasTasks ? (projEF > 0 ? cal.date(Math.ceil(projEF) - 1) : cal.date(0)) : cal.date(0),
    totalCost: totalCost, totalWork: totalWork
  };
};

/* ---------- baseline and resource leveling ---------- */

OP.setBaseline = function (p) {
  var s = OP.schedule(p), U = OP.util, tasks = {};
  s.rows.forEach(function (r) {
    tasks[r.task.uid] = { start: U.iso(r.startDn), finish: U.iso(r.finishDn), duration: r.duration, cost: r.cost, work: r.work };
  });
  p.baseline = { savedAt: new Date().toISOString(), tasks: tasks };
};

// Serial resource leveling: place tasks one at a time (earliest start, then priority, then least slack)
// and delay each until every assigned person has capacity on all of its working days.
// Repeats the pass a few times because as-late-as-possible tasks can slide back into a conflict.
OP.level = function (p) {
  p.tasks.forEach(function (t) { t.levelDelay = 0; });
  var moved = {}, left = [], s2 = null;
  for (var pass = 0; pass < 4; pass++) {
    levelPass(p, moved, s2);
    s2 = OP.schedule(p);
    left = p.resources.filter(function (res) { return s2.resStats[res.uid].over; }).map(function (res) { return res.name || '(unnamed)'; });
    if (!left.length) break;
  }
  return { moved: Object.keys(moved).length, unresolved: left };
};

function levelPass(p, movedSet, s) {
  var resByUid = {}, usage = {}, placed = {}, n = 0;
  p.resources.forEach(function (r) { resByUid[r.uid] = r; usage[r.uid] = {}; });
  s = s || OP.schedule(p);
  var leaves = s.rows.filter(function (r) { return !r.summary; });
  var predsOf = {};
  s.edges.forEach(function (e) { (predsOf[e.to] = predsOf[e.to] || []).push(e.from); });
  while (n++ < leaves.length) {
    var ready = s.rows.filter(function (r) {
      return !r.summary && !placed[r.i] && (predsOf[r.i] || []).every(function (q) { return placed[q]; });
    });
    if (!ready.length) ready = s.rows.filter(function (r) { return !r.summary && !placed[r.i]; });
    if (!ready.length) break;
    ready.sort(function (a, b) {
      var la = a.task.constraint === 'ALAP' ? 1 : 0, lb = b.task.constraint === 'ALAP' ? 1 : 0;
      return (la - lb) || (a.es - b.es) || (b.task.priority - a.task.priority) || (a.slack - b.slack) || (a.id - b.id);
    });
    var r = ready[0], t = r.task;
    var work = t.assignments.filter(function (a) {
      var res = resByUid[a.res];
      return res && res.kind === 'Work' && a.units <= res.maxUnits;
    });
    var fixed = t.actualStart || t.constraint === 'MSO' || t.constraint === 'MFO' || t.percent > 0;
    var rel = r.segs.map(function (sg) { return [sg[0] - r.es, sg[1] - r.es]; });
    var alap = t.constraint === 'ALAP', dir = alap ? -1 : 1, maxK = alap ? Math.floor(r.es - (r.esEarly || 0)) : 520;
    var fits = function (k) {
      return work.every(function (a) {
        var st = s.resStats[a.res], U = usage[a.res];
        return rel.every(function (sg) {
          for (var d = Math.floor(r.es + dir * k + sg[0]); d < Math.ceil(r.es + dir * k + sg[1]); d++) {
            if ((U[d] || 0) + a.units > st.capOn(d) + 1e-9) return false;
          }
          return true;
        });
      });
    };
    var k = 0;
    if (!fixed && work.length) while (k <= maxK && !fits(k)) k++;
    if (k > maxK) k = 0;
    if (k) { t.levelDelay = (+t.levelDelay || 0) + k; movedSet[t.uid] = true; }
    work.forEach(function (a) {
      rel.forEach(function (sg) {
        for (var d = Math.floor(r.es + dir * k + sg[0]); d < Math.ceil(r.es + dir * k + sg[1]); d++) usage[a.res][d] = (usage[a.res][d] || 0) + a.units;
      });
    });
    placed[r.i] = true;
    if (k) s = OP.schedule(p);
  }
}

export default OP;
