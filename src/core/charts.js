import OP from './core.js';
/* SVG renderers: Gantt chart, network (AON) diagram, WBS chart, organisation chart, cost charts. */
OP.charts = (function () {
  var U = OP.util, esc = U.esc;
  var FONT = "'Segoe UI', Tahoma, Arial, sans-serif";

  var STYLE =
    'text{font-family:' + FONT + ';font-size:11.5px;fill:var(--text)}' +
    '.m{fill:var(--text-muted)}.b{font-weight:600}.sm{font-size:10.5px}.lg{font-size:13px}' +
    '.gl{stroke:var(--border);stroke-width:1}.gls{stroke:var(--border-strong);stroke-width:1}' +
    '.hdr{fill:var(--surface-2)}.wk{fill:var(--weekend)}.gsel{fill:var(--accent-soft)}' +
    '.bar{fill:var(--bar);stroke:var(--bar-edge);stroke-width:1}.bar.c{fill:var(--critical);stroke:var(--critical-edge)}.prog{fill:var(--bar-progress)}' +
    '.sum{fill:var(--summary)}.ms{fill:var(--milestone)}.ms.c{fill:var(--critical)}' +
    '.lnk{stroke:var(--link);fill:none;stroke-width:1.25}.lnk.c{stroke:var(--critical)}' +
    '.ah{fill:var(--link)}.ah.c{fill:var(--critical)}.today{stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3}' +
    '.node{fill:var(--surface);stroke:var(--border-strong);stroke-width:1.25}.node.c{stroke:var(--critical);stroke-width:2}' +
    '.nh{fill:var(--surface-2)}.nh.c{fill:var(--critical-soft)}.cap{fill:var(--accent)}' +
    '.wbs0{fill:var(--accent);stroke:none}.wbs0t{fill:#fff;font-weight:600}.wbs1{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.25}' +
    '.wbs2{fill:var(--surface);stroke:var(--border-strong);stroke-width:1}.wbs1.sel,.wbs2.sel{stroke:var(--accent)!important;stroke-width:2!important}.con{stroke:var(--border-strong);fill:none;stroke-width:1.25}' +
    '.lnk-drag{stroke:var(--accent);stroke-width:1.5;stroke-dasharray:6 4;fill:none;pointer-events:none}' +
    '.nnode.link-target rect{stroke:var(--accent);stroke-width:2.5}.nnode.link-bad rect{stroke:var(--critical);stroke-width:2.5}' +
    '.t-Manager{fill:var(--c1)}.t-Full-time{fill:var(--c2)}.t-Part-time{fill:var(--c3)}.t-Supporter{fill:var(--c4)}' +
    '.cbar{fill:var(--bar)}.cline{stroke:var(--bar);stroke-width:2;fill:none}.bud{stroke:var(--critical);stroke-width:1.5;stroke-dasharray:6 4}' +
    '.hit{fill:transparent}.hit:hover{fill:var(--accent);fill-opacity:.12}.grp{fill:var(--surface-3)}.bl{fill:var(--baseline)}.bar.late{fill:var(--warn)}' +
    '.gsplit{stroke:var(--bar);stroke-width:1.5;stroke-dasharray:2 3}.dl{fill:var(--good);stroke:var(--good);stroke-width:1.5}.dl.miss{fill:var(--critical);stroke:var(--critical)}' +
    '.gstat{stroke:var(--warn);stroke-width:1.5}.gstat-t{fill:var(--warn)}' +
    '.anno{cursor:move}.anno.group{cursor:default}.anno-box{fill:var(--surface);stroke:var(--border-strong);stroke-width:1}' +
    '.anno.group .anno-box{fill:none;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:6 4}' +
    '.anno.sel .anno-box{stroke:var(--accent);stroke-width:2}.anno-handle{fill:var(--accent);opacity:0;cursor:nwse-resize}' +
    '.anno:hover .anno-handle{opacity:.65}';

  function svgOpen(w, h, cls) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + (cls || '') + '" width="' + Math.ceil(w) + '" height="' + Math.ceil(h) +
      '" viewBox="0 0 ' + Math.ceil(w) + ' ' + Math.ceil(h) + '"><style>' + STYLE + '</style>';
  }

  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function wrap(s, max, lines) {
    var words = String(s || '').split(/\s+/), out = [''];
    words.forEach(function (w) {
      var cur = out[out.length - 1];
      if ((cur + ' ' + w).trim().length <= max) out[out.length - 1] = (cur + ' ' + w).trim();
      else out.push(w);
    });
    if (out.length > lines) { out = out.slice(0, lines); out[lines - 1] = trunc(out[lines - 1] + '…', max); }
    return out;
  }

  /* ---------- Box style rules (PRD M14) ---------- */

  var BS_NUM = { percentComplete: 1, level: 1, duration: 1 };

  // All conditions of a rule combine with AND.
  function bsMatch(conds, ctx) {
    if (!conds || !conds.length) return true;
    return conds.every(function (c) {
      var v = ctx[c.field], val = c.value;
      switch (c.op) {
        case 'isEmpty': return v == null || v === '' || (Array.isArray(v) && !v.length);
        case 'isNotEmpty': return !(v == null || v === '' || (Array.isArray(v) && !v.length));
      }
      if (c.field === 'resourceId') {
        var list = Array.isArray(v) ? v : [];
        switch (c.op) {
          case 'eq': return list.indexOf(val) >= 0;                       // is assigned to
          case 'neq': return list.indexOf(val) < 0;                        // is not assigned to
          case 'contains': return String(ctx.resNames).toLowerCase().indexOf(String(val == null ? '' : val).toLowerCase()) >= 0;
        }
        return false;
      }
      if (typeof v === 'boolean') {
        var bv = val === true || val === 'true' || val === 1 || val === '1';
        return c.op === 'eq' ? v === bv : c.op === 'neq' ? v !== bv : false;
      }
      if (typeof v === 'number' || BS_NUM[c.field]) {
        var a = +v, b = +val;
        if (!isFinite(b)) return false;
        switch (c.op) {
          case 'eq': return a === b; case 'neq': return a !== b;
          case 'gt': return a > b; case 'gte': return a >= b; case 'lt': return a < b; case 'lte': return a <= b;
        }
        return false;
      }
      var sv = String(v == null ? '' : v).toLowerCase(), tv = String(val == null ? '' : val).toLowerCase();
      switch (c.op) {
        case 'eq': return sv === tv; case 'neq': return sv !== tv;
        case 'contains': return sv.indexOf(tv) >= 0;
        case 'gt': return sv > tv; case 'gte': return sv >= tv; case 'lt': return sv < tv; case 'lte': return sv <= tv;
      }
      return false;
    });
  }

  // Merge the styles that apply to one row: matched partial rules fill their set
  // attributes (in priority order), then the first matched full rule overrides
  // wholesale. A per-task customStyle beats everything.
  function boxStyleFor(o, view, r) {
    var rules = (o.p && o.p.boxRules) || [];
    var cs = r.task && r.task.customStyle;
    if (!rules.length && !cs) return null;
    var crit = view === 'network' ? (o.critical && r.critical) : r.critical;
    var ctx = {
      isCritical: !!crit, percentComplete: r.percent, level: r.task.level, duration: r.duration,
      type: r.task.type, resourceId: (r.task.assignments || []).map(function (a) { return a.res; }),
      constraintType: r.task.constraint, hasDeadline: !!r.task.deadline, milestone: !!r.task.milestone,
      summary: !!r.summary, name: r.task.name, notes: r.task.notes || '', resNames: r.names || ''
    };
    var out = null, i, k;
    for (i = 0; i < rules.length; i++) {
      var ru = rules[i];
      if (!ru.enabled || ru.scope !== 'partial') continue;
      if (!ru.views || ru.views.indexOf(view) < 0) continue;
      if (!bsMatch(ru.conditions, ctx)) continue;
      if (!out) out = {};
      for (k in ru.style) if (ru.style[k] != null && ru.style[k] !== '') out[k] = ru.style[k];
    }
    for (i = 0; i < rules.length; i++) {
      var rf = rules[i];
      if (!rf.enabled || rf.scope !== 'full') continue;
      if (!rf.views || rf.views.indexOf(view) < 0) continue;
      if (!bsMatch(rf.conditions, ctx)) continue;
      out = {};
      for (k in rf.style) if (rf.style[k] != null && rf.style[k] !== '') out[k] = rf.style[k];
      break;
    }
    if (cs) {
      if (!out) out = {};
      for (k in cs) if (cs[k] != null && cs[k] !== '') out[k] = cs[k];
    }
    return out;
  }

  // Inline SVG attribute fragments for a merged style.
  function boxStyleParts(st) {
    if (!st) return null;
    var r = [], t = [];
    if (st.fillColor) r.push('fill:' + (st.fillColor === 'transparent' ? 'none' : st.fillColor));
    if (st.borderColor) r.push('stroke:' + st.borderColor);
    if (st.borderWidth != null) r.push('stroke-width:' + st.borderWidth);
    if (st.borderDash === 'dashed') r.push('stroke-dasharray:5 3');
    else if (st.borderDash === 'dotted') r.push('stroke-dasharray:2 3');
    if (st.textColor) t.push('fill:' + st.textColor);
    if (st.bold) t.push('font-weight:600');
    return { rect: r.length ? ' style="' + r.join(';') + '"' : '', text: t.length ? ' style="' + t.join(';') + '"' : '' };
  }

  // Classic offset shadow: a solid rect drawn behind the box.
  function shadowRect(st, x, y, w, h) {
    if (!st || !st.shadowColor) return '';
    var sx = st.shadowX || 0, sy = st.shadowY || 0;
    if (!sx && !sy) return '';
    return '<rect x="' + (x + sx) + '" y="' + (y + sy) + '" width="' + w + '" height="' + h + '" fill="' + st.shadowColor + '" stroke="none"/>';
  }

  // The built-in "critical" rule also drives the network header tint; when the user
  // disables it, the whole critical indication disappears.
  function builtinCriticalOn(p) {
    var rules = (p && p.boxRules) || [];
    for (var i = 0; i < rules.length; i++) if (rules[i].id === 'b-critical') return rules[i].enabled !== false;
    return true;
  }

  /* ---------- Free text box annotations (PRD M13) ---------- */

  var GPAD = 10; // padding between a group box and the nodes it wraps

  // Where one annotation renders. boxes: uid -> {x,y,w,h} of the node boxes.
  // Returns null when it cannot place (bound task missing, group empty, …).
  function annoPos(a, boxes) {
    if (a.mode === 'task') {
      var b = boxes ? boxes[a.taskUid] : null;
      if (!b) return null;
      return { x: b.x + (a.dx || 0), y: b.y + (a.dy || 0), w: a.w, h: a.h };
    }
    if (a.mode === 'group') {
      if (!boxes) return null;
      var bs = (a.uids || []).map(function (u) { return boxes[u]; }).filter(Boolean);
      if (!bs.length) return null;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      bs.forEach(function (q) {
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h);
      });
      var lab = a.text ? 16 : 0; // a label strip above the wrapped nodes
      return { x: x0 - GPAD, y: y0 - GPAD - lab, w: x1 - x0 + GPAD * 2, h: y1 - y0 + GPAD * 2 + lab };
    }
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }

  // Right/bottom extents of the annotations of one view, for growing the canvas.
  // boxes may be null (WBS pre-scan): group boxes then stay inside the node area.
  function annoExtent(o, view, boxes) {
    var list = (o.p && o.p.annotations) || [], x1 = 0, y1 = 0, any = false;
    list.forEach(function (a) {
      if (a.view !== view) return;
      var q = annoPos(a, boxes);
      if (!q) return;
      any = true;
      x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h);
    });
    return any ? { x: x1, y: y1 } : null;
  }

  // SVG markup for all annotations of one view. Drawn after the nodes; group
  // boxes use a transparent fill so nothing underneath is hidden.
  function annotationsSvg(o, view, boxes) {
    var list = (o.p && o.p.annotations) || [], out = [];
    list.forEach(function (a) {
      if (a.view !== view) return;
      var q = annoPos(a, boxes);
      if (!q) return;
      var g = '<g class="anno' + (a.mode === 'group' ? ' group' : '') + '" data-id="' + esc(a.id) + '">';
      g += '<rect class="anno-box" x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" rx="4"/>';
      if (a.mode === 'group') {
        if (a.text) g += '<text class="b sm" x="' + (q.x + 6) + '" y="' + (q.y + 12) + '">' + esc(trunc(a.text, 48)) + '</text>';
      } else {
        if (a.text) {
          var chars = Math.max(8, Math.floor((q.w - 14) / 6.2));
          var lines = wrap(a.text, chars, Math.max(1, Math.floor((q.h - 10) / 14)));
          lines.forEach(function (ln, k) {
            g += '<text x="' + (q.x + 8) + '" y="' + (q.y + 18 + k * 14) + '">' + esc(ln) + '</text>';
          });
        } else {
          g += '<text class="m sm" x="' + (q.x + 8) + '" y="' + (q.y + 18) + '">Double-click to edit</text>';
        }
        g += '<rect class="anno-handle" x="' + (q.x + q.w - 9) + '" y="' + (q.y + q.h - 9) + '" width="9" height="9"/>';
      }
      out.push(g + '</g>');
    });
    return out.join('');
  }


  /* ---------- Gantt ---------- */

  var ZOOM = { day: 30, week: 12, month: 4, quarter: 1.4 };
  var ROW = 24, HDR = 40;

  // opts: {p, s, rows, zoom, critical, selected:{uid:true}, table:bool, baseline:bool, flat:bool}
  // rows may contain group headers: {group:true, key, label, count, cost, startDn, finishDn}
  function gantt(o) {
    var s = o.s, ppd = ZOOM[o.zoom] || 12, rows = o.rows, cal = s.cal;
    var lo = s.startDn, hi = s.finishDn;
    rows.forEach(function (r) {
      if (r.group) return;
      if (r.base) { lo = Math.min(lo, r.base.startDn); hi = Math.max(hi, r.base.finishDn); }
      var dl = U.parseDate(r.task.deadline);
      if (dl != null) hi = Math.max(hi, dl);
    });
    var start = lo - 2, end = hi + 21;
    if (o.zoom === 'week') start -= U.weekday(start) === 0 ? 6 : U.weekday(start) - 1;
    if (o.zoom === 'month' || o.zoom === 'quarter') { var d0 = U.toDate(start); start -= d0.getUTCDate() - 1; end += o.zoom === 'quarter' ? 100 : 20; }
    var cols = o.table ? [['ID', 34], ['Task Name', 280], ['Duration', 66], ['Start', 78], ['Finish', 78]] : [];
    var tw = cols.reduce(function (a, c) { return a + c[1]; }, 0);
    var W = tw + (end - start) * ppd, H = HDR + Math.max(rows.length, 1) * ROW + 1;
    function X(dn) { return tw + (dn - start) * ppd; }
    function xs(wd) { return X(cal.date(wd)); }
    function xe(wd) { return X(cal.date(Math.max(Math.ceil(wd) - 1, 0))) + ppd; }
    var h = [svgOpen(W, H, 'gantt-svg')];
    h.push('<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0,0L8,4L0,8z"/></marker>' +
      '<marker id="ahc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="ah c" d="M0,0L8,4L0,8z"/></marker></defs>');

    // Non-working day shading and header
    h.push('<rect class="hdr" x="0" y="0" width="' + W + '" height="' + HDR + '"/>');
    for (var dn = start; dn < end; dn++) {
      if (ppd >= 10 && !cal.isWorking(dn)) h.push('<rect class="wk" x="' + X(dn) + '" y="' + HDR + '" width="' + ppd + '" height="' + (H - HDR) + '"/>');
    }
    var top = [], bot = [];
    for (dn = start; dn <= end; dn++) {
      var d = U.toDate(dn), wd = U.weekday(dn), day = d.getUTCDate(), mon = d.getUTCMonth(), yr = d.getUTCFullYear();
      if (o.zoom === 'day') {
        if (wd === 1 || dn === start) top.push([dn, 'Week of ' + U.fmt(dn)]);
        bot.push([dn, 'SMTWTFS'[wd] + ' ' + day]);
      } else if (o.zoom === 'week') {
        if (day === 1 || dn === start) top.push([dn, U.MONTHS[mon] + ' ' + yr]);
        if (wd === 1) bot.push([dn, day + ' ' + U.MONTHS[mon]]);
      } else if (o.zoom === 'month') {
        if ((day === 1 && mon === 0) || dn === start) top.push([dn, String(yr)]);
        if (day === 1) bot.push([dn, U.MONTHS[mon]]);
      } else {
        if ((day === 1 && mon === 0) || dn === start) top.push([dn, String(yr)]);
        if (day === 1 && mon % 3 === 0) bot.push([dn, 'Q' + (mon / 3 + 1)]);
      }
    }
    top.forEach(function (t, i) {
      var x = X(t[0]), nx = i + 1 < top.length ? X(top[i + 1][0]) : W;
      h.push('<line class="gls" x1="' + x + '" y1="0" x2="' + x + '" y2="' + HDR + '"/>');
      if (nx - x > t[1].length * 6.5 + 10) h.push('<text class="b sm" x="' + (x + 6) + '" y="14">' + esc(t[1]) + '</text>');
    });
    bot.forEach(function (b) {
      var x = X(b[0]);
      h.push('<line class="gl" x1="' + x + '" y1="20" x2="' + x + '" y2="' + H + '"/>');
      h.push('<text class="m sm" x="' + (x + 4) + '" y="34">' + esc(b[1]) + '</text>');
    });
    h.push('<line class="gls" x1="0" y1="20" x2="' + W + '" y2="20"/><line class="gls" x1="0" y1="' + HDR + '" x2="' + W + '" y2="' + HDR + '"/>');

    // Table (image export only)
    if (o.table) {
      h.push('<rect x="0" y="0" width="' + tw + '" height="' + H + '" fill="var(--surface)"/><rect class="hdr" x="0" y="0" width="' + tw + '" height="' + HDR + '"/>');
      var cx = 0;
      cols.forEach(function (c) {
        h.push('<text class="b sm" x="' + (cx + 6) + '" y="26">' + c[0] + '</text><line class="gls" x1="' + (cx + c[1]) + '" y1="0" x2="' + (cx + c[1]) + '" y2="' + H + '"/>');
        cx += c[1];
      });
      rows.forEach(function (r, k) {
        var y = HDR + k * ROW + 16;
        if (r.group) {
          h.push('<rect class="grp" x="0" y="' + (y - 16) + '" width="' + tw + '" height="' + ROW + '"/><text class="b" x="8" y="' + y + '">' + esc(trunc(r.label + ' (' + r.count + ')', 60)) + '</text>');
          return;
        }
        var cls = r.summary ? ' class="b"' : '', lvl = o.flat ? 1 : r.task.level;
        h.push('<text class="m" x="6" y="' + y + '">' + r.id + '</text>');
        h.push('<text' + cls + ' x="' + (40 + (lvl - 1) * 14) + '" y="' + y + '">' + esc(trunc(r.task.name, 38 - lvl * 2)) + '</text>');
        h.push('<text x="320" y="' + y + '">' + OP.model.fmtDuration(r.duration) + '</text>');
        h.push('<text x="386" y="' + y + '">' + U.fmt(r.startDn) + '</text>');
        h.push('<text x="464" y="' + y + '">' + U.fmt(r.finishDn) + '</text>');
      });
    }

    // Rows
    var pos = {};
    rows.forEach(function (r, k) {
      var y = HDR + k * ROW;
      if (r.group) {
        h.push('<rect class="grp" x="' + tw + '" y="' + y + '" width="' + (W - tw) + '" height="' + ROW + '"/>');
        if (r.startDn != null) {
          var gx1 = X(r.startDn), gx2 = X(r.finishDn) + ppd;
          h.push('<path class="sum" d="M' + gx1 + ',' + (y + 7) + 'H' + gx2 + 'v8l-5,-4H' + (gx1 + 5) + 'l-5,4z"/>');
        }
        return;
      }
      if (o.selected && o.selected[r.task.uid]) h.push('<rect class="gsel" x="' + tw + '" y="' + y + '" width="' + (W - tw) + '" height="' + ROW + '"/>');
      h.push('<line class="gl" x1="0" y1="' + (y + ROW) + '" x2="' + W + '" y2="' + (y + ROW) + '"/>');
      var crit = o.critical && r.critical ? ' c' : '';
      var x1 = X(r.startDn), x2 = X(r.finishDn) + ppd;
      var showBase = o.baseline && r.base;
      var by = showBase ? y + 3 : y + 6, bh = showBase ? 11 : 12;
      var tip = '<title>' + esc(r.id + '. ' + r.task.name + ' — ' + U.fmt(r.startDn) + ' to ' + U.fmt(r.finishDn) + ', ' + OP.model.fmtDuration(r.duration) +
        (r.slack > 0 ? ', slack ' + U.num(r.slack) + 'd' : '') + (r.percent ? ', ' + r.percent + '% complete' : '') +
        (r.base ? '\nBaseline: ' + U.fmt(r.base.startDn) + ' to ' + U.fmt(r.base.finishDn) : '') +
        (r.task.deadline ? '\nDeadline: ' + U.fmt(U.parseDate(r.task.deadline)) : '')) + '</title>';
      h.push('<g class="gbar" data-uid="' + esc(r.task.uid) + '" tabindex="0" role="button" aria-label="' + esc(r.id + '. ' + r.task.name) + '">' + tip);
      if (showBase) {
        var bx1 = X(r.base.startDn), bx2 = X(r.base.finishDn) + ppd;
        if (r.milestone || !r.base.duration) h.push('<path class="bl" d="M' + bx2 + ',' + (y + 15) + 'l4,4l-4,4l-4,-4z"/>');
        else h.push('<rect class="bl" x="' + bx1 + '" y="' + (y + 16) + '" width="' + Math.max(bx2 - bx1, 2) + '" height="4"/>');
      }
      if (r.milestone) {
        var mx = r.es > 0 ? X(r.startDn) + ppd : X(r.startDn), my = showBase ? y + 9 : y + ROW / 2;
        h.push('<path class="ms' + crit + '" d="M' + mx + ',' + (my - 6) + 'l6,6l-6,6l-6,-6z"/>');
        h.push('<text class="m sm" x="' + (mx + 10) + '" y="' + (my + 4) + '">' + U.fmt(r.startDn) + '</text>');
        pos[r.task.uid] = { s: mx - 6, e: mx + 6, y: my };
      } else if (r.summary) {
        h.push('<path class="sum" d="M' + x1 + ',' + (y + 7) + 'H' + x2 + 'v8l-5,-4H' + (x1 + 5) + 'l-5,4z"/>');
        if (r.percent > 0) h.push('<rect class="prog" x="' + x1 + '" y="' + (y + 9) + '" width="' + ((x2 - x1) * r.percent / 100) + '" height="3"/>');
        pos[r.task.uid] = { s: x1, e: x2, y: y + ROW / 2 };
      } else {
        var segs = r.segs || [[r.es, r.ef]], done = r.duration * Math.min(100, r.percent) / 100, lastEnd = x1;
        segs.forEach(function (sg, si) {
          var sx1 = xs(sg[0]), sx2 = Math.max(xe(sg[1]), sx1 + 2);
          if (si > 0) h.push('<line class="gsplit" x1="' + lastEnd + '" y1="' + (by + bh / 2) + '" x2="' + sx1 + '" y2="' + (by + bh / 2) + '"/>');
          h.push('<rect class="bar' + crit + (r.late && o.baseline ? ' late' : '') + '" x="' + sx1 + '" y="' + by + '" width="' + (sx2 - sx1) + '" height="' + bh + '"/>');
          var len = sg[1] - sg[0], fill = Math.max(0, Math.min(len, done));
          if (fill > 0 && len > 0) h.push('<rect class="prog" x="' + sx1 + '" y="' + (by + bh / 2 - 1.5) + '" width="' + ((sx2 - sx1) * fill / len) + '" height="3"/>');
          done -= len;
          lastEnd = sx2;
        });
        x2 = lastEnd;
        if (r.names) h.push('<text class="m sm" x="' + (x2 + 8) + '" y="' + (by + bh - 2) + '">' + esc(trunc(r.names, 60)) + '</text>');
        pos[r.task.uid] = { s: x1, e: x2, y: by + bh / 2 };
      }
      var dl = U.parseDate(r.task.deadline);
      if (dl != null) {
        var dx = X(dl) + ppd, dc = r.missedDeadline ? ' miss' : '';
        h.push('<path class="dl' + dc + '" d="M' + (dx - 4) + ',' + (y + 1) + 'h8l-4,6z"/><line class="dl' + dc + '" x1="' + dx + '" y1="' + (y + 6) + '" x2="' + dx + '" y2="' + (y + ROW - 2) + '"/>');
      }
      h.push('<rect class="hit" x="' + x1 + '" y="' + y + '" width="' + Math.max(x2 - x1, 16) + '" height="' + ROW + '"/></g>');
      pos[r.task.uid].row = k;
    });

    // Dependency arrows between visible rows
    var byUid = {};
    rows.forEach(function (r) { if (!r.group) byUid[r.task.uid] = r; });
    rows.forEach(function (r) {
      if (r.group) return;
      r.task.preds.forEach(function (l) {
        var a = pos[l.uid], b = pos[r.task.uid];
        if (!a || !b) return;
        var fromEnd = l.type === 'FS' || l.type === 'FF', toStart = l.type === 'FS' || l.type === 'SS';
        var xa = fromEnd ? a.e : a.s, xb = toStart ? b.s : b.e;
        var crit = o.critical && byUid[l.uid].critical && r.critical && Math.abs(byUid[l.uid].slack - r.slack) < 1e-9 ? ' c' : '';
        var d, dir = b.y > a.y ? 1 : -1, sx = xa + (fromEnd ? 6 : -6);
        if (toStart && xb - 6 >= sx) d = 'M' + xa + ',' + a.y + 'H' + sx + 'V' + b.y + 'H' + (xb - 1);
        else if (!toStart && xb + 6 <= sx) d = 'M' + xa + ',' + a.y + 'H' + sx + 'V' + b.y + 'H' + (xb + 1);
        else {
          var midY = b.y - dir * ROW / 2, ex = toStart ? xb - 10 : xb + 10;
          d = 'M' + xa + ',' + a.y + 'H' + sx + 'V' + midY + 'H' + ex + 'V' + b.y + 'H' + (toStart ? xb - 1 : xb + 1);
        }
        h.push('<path class="lnk' + crit + '" d="' + d + '" marker-end="url(#ah' + (crit ? 'c' : '') + ')"/>');
      });
    });

    var today = U.todayDn();
    if (today >= start && today <= end) h.push('<line class="today" x1="' + X(today) + '" y1="' + HDR + '" x2="' + X(today) + '" y2="' + H + '"/>');
    if (o.p.statusDate && s.statusDn >= start && s.statusDn <= end) {
      var sxl = X(s.statusDn) + ppd;
      h.push('<line class="gstat" x1="' + sxl + '" y1="' + HDR + '" x2="' + sxl + '" y2="' + H + '"/><text class="sm gstat-t" x="' + (sxl + 4) + '" y="' + (HDR + 11) + '">Status date</text>');
    }
    h.push('</svg>');
    return { svg: h.join(''), X: X, ppd: ppd, start: start, tableWidth: tw, pos: pos };
  }

  /* ---------- Network diagram (Activity on Node) ---------- */

  function network(o) {
    var s = o.s, rows = o.rows.filter(function (r) { return !r.summary; });
    var inSet = {};
    rows.forEach(function (r) { inSet[r.i] = r; });
    var edges = s.edges.filter(function (e) { return inSet[e.from] && inSet[e.to]; });
    var level = {}, succOf = {}, predOf = {}, indeg = {};
    rows.forEach(function (r) { level[r.i] = 1; succOf[r.i] = []; predOf[r.i] = []; indeg[r.i] = 0; });
    edges.forEach(function (e) { succOf[e.from].push(e.to); predOf[e.to].push(e.from); indeg[e.to]++; });
    // Longest-path layering in topological order; tasks on a dependency loop keep the level reached so far.
    var queue = rows.filter(function (r) { return !indeg[r.i]; }).map(function (r) { return r.i; });
    for (var qi = 0; qi < queue.length; qi++) {
      var v0 = queue[qi];
      succOf[v0].forEach(function (w) {
        if (level[w] < level[v0] + 1) level[w] = level[v0] + 1;
        if (--indeg[w] === 0) queue.push(w);
      });
    }
    var maxL = 1;
    rows.forEach(function (r) { maxL = Math.max(maxL, level[r.i]); });
    var hasIn = {}, hasOut = {};
    edges.forEach(function (e) { hasOut[e.from] = true; hasIn[e.to] = true; });

    var NW = 196, NH = 92, GX = 64, GY = 26, PAD = 30, SW = 64, LEG = 110;
    var colsArr = [];
    for (var c = 1; c <= maxL; c++) colsArr.push([]);
    var rowPos = {};
    rows.forEach(function (r) { colsArr[level[r.i] - 1].push(r); });
    colsArr.forEach(function (col) {
      col.forEach(function (r) {
        var ps = predOf[r.i].filter(function (f) { return rowPos[f] != null; }).map(function (f) { return rowPos[f]; });
        r._bary = ps.length ? ps.reduce(function (a, b) { return a + b; }, 0) / ps.length : r.i / 1000;
      });
      col.sort(function (a, b) { return a._bary - b._bary || a.i - b.i; });
      col.forEach(function (r, k) { rowPos[r.i] = k; });
    });
    var maxRows = Math.max.apply(null, colsArr.map(function (col) { return col.length; }).concat([1]));
    var W = PAD * 2 + SW * 2 + GX * 2 + maxL * NW + (maxL - 1) * GX;
    var H = PAD * 2 + LEG + maxRows * NH + (maxRows - 1) * GY;
    var at = {};
    colsArr.forEach(function (col, ci) {
      var colH = col.length * NH + (col.length - 1) * GY, oy = PAD + LEG + (maxRows * NH + (maxRows - 1) * GY - colH) / 2;
      col.forEach(function (r, k) { at[r.i] = { x: PAD + SW + GX + ci * (NW + GX), y: oy + k * (NH + GY) }; });
    });
    // Manual position overrides (dragged nodes) win over the computed layout.
    var np = (o.p && o.p.netPos && typeof o.p.netPos === 'object') ? o.p.netPos : {};
    rows.forEach(function (r) {
      var q = np[r.task.uid];
      if (q && typeof q === 'object' && isFinite(+q.x) && isFinite(+q.y)) at[r.i] = { x: +q.x, y: +q.y };
    });
    // Grow the canvas so dragged nodes stay inside the drawing area.
    rows.forEach(function (r) {
      if (!np[r.task.uid]) return;
      var q = at[r.i];
      W = Math.max(W, q.x + NW + PAD);
      H = Math.max(H, q.y + NH + PAD);
    });
    // Free text boxes (PRD M13): drawn after the nodes; the canvas grows to keep them visible.
    var nBoxes = {};
    rows.forEach(function (r) { nBoxes[r.task.uid] = { x: at[r.i].x, y: at[r.i].y, w: NW, h: NH }; });
    var nAnnoExt = annoExtent(o, 'network', nBoxes);
    if (nAnnoExt) { W = Math.max(W, nAnnoExt.x + 20); H = Math.max(H, nAnnoExt.y + 20); }
    var midY = PAD + LEG + (maxRows * NH + (maxRows - 1) * GY) / 2;
    var startN = { x: PAD, y: midY }, endN = { x: W - PAD - SW, y: midY };

    var h = [svgOpen(W, H, 'net-svg')];
    h.push('<defs><marker id="nah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0,0L8,4L0,8z"/></marker>' +
      '<marker id="nahc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="ah c" d="M0,0L8,4L0,8z"/></marker></defs>');

    // Legend
    var lx = PAD, ly = PAD;
    h.push('<text class="b lg" x="' + lx + '" y="' + (ly + 4) + '">' + esc(o.title || 'Activity network (AON)') + '</text>');
    h.push(nodeBox(lx, ly + 16, { es: 'ES', dur: 'Duration', ef: 'EF', id: 'ID', name: 'Task name', res: 'Resources', ls: 'LS', slack: 'Total slack', lf: 'LF', crit: false, legend: true }));
    h.push('<text class="m sm" x="' + (lx + NW + 16) + '" y="' + (ly + 40) + '">Values are in working days from project start (day 0).</text>');
    h.push('<text class="m sm" x="' + (lx + NW + 16) + '" y="' + (ly + 58) + '">Red border and arrows = critical path (zero total slack).</text>');
    h.push('<text class="m sm" x="' + (lx + NW + 16) + '" y="' + (ly + 76) + '">Slack = LS − ES. Project duration: ' + U.num(s.duration) + ' working days.</text>');

    function edgePath(a, b, crit) {
      var x1 = a.x2, y1 = a.y, x2 = b.x1, y2 = b.y, mx = (x1 + x2) / 2;
      return '<path class="lnk' + (crit ? ' c' : '') + '" d="M' + x1 + ',' + y1 + 'C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + (x2 - 1) + ',' + y2 + '" marker-end="url(#nah' + (crit ? 'c' : '') + ')"/>';
    }
    function port(i) { var p = at[i]; return { x1: p.x, x2: p.x + NW, y: p.y + NH / 2 }; }
    var sPort = { x1: startN.x, x2: startN.x + SW, y: startN.y }, ePort = { x1: endN.x, x2: endN.x + SW, y: endN.y };
    var byI = {};
    rows.forEach(function (r) { byI[r.i] = r; });
    edges.forEach(function (e) {
      var a = byI[e.from], b = byI[e.to];
      var from = e.type === 'FS' || e.type === 'FF' ? a.ef : a.es, to = e.type === 'FS' || e.type === 'SS' ? b.es : b.ef;
      var crit = o.critical && a.critical && b.critical && Math.abs(from + e.lag - to) < 1e-9;
      h.push(edgePath(port(e.from), port(e.to), crit));
    });
    rows.forEach(function (r) {
      var crit = o.critical && r.critical;
      if (!hasIn[r.i]) h.push(edgePath(sPort, port(r.i), crit && r.es === 0));
      if (!hasOut[r.i]) h.push(edgePath(port(r.i), ePort, crit && Math.abs(r.ef - s.duration) < 1e-9));
    });
    [[startN, 'Start', '0'], [endN, 'Finish', U.num(s.duration)]].forEach(function (n) {
      h.push('<rect class="node c" x="' + n[0].x + '" y="' + (n[0].y - 24) + '" width="' + SW + '" height="48"/>');
      h.push('<text class="b" text-anchor="middle" x="' + (n[0].x + SW / 2) + '" y="' + (n[0].y - 2) + '">' + n[1] + '</text>');
      h.push('<text class="m sm" text-anchor="middle" x="' + (n[0].x + SW / 2) + '" y="' + (n[0].y + 13) + '">day ' + n[2] + '</text>');
    });

    function v(n) { return o.dates ? n : U.num(n); }
    rows.forEach(function (r) {
      var p = at[r.i];
      var bs = boxStyleFor(o, 'network', r);
      h.push('<g class="nnode" data-uid="' + esc(r.task.uid) + '" tabindex="0" role="button" aria-label="' + esc(r.id + '. ' + r.task.name) + '">' + nodeBox(p.x, p.y, {
        es: o.dates ? U.fmt(r.startDn) : v(r.es), dur: OP.model.fmtDuration(r.duration), ef: o.dates ? U.fmt(r.finishDn) : v(r.ef),
        id: r.id, name: r.task.name, res: r.names, ls: o.dates ? U.fmt(s.cal.date(r.ls)) : v(r.ls),
        slack: U.num(r.slack) + 'd', lf: o.dates ? U.fmt(s.cal.date(Math.max(Math.ceil(r.lf) - 1, 0))) : v(r.lf), crit: o.critical && r.critical
      }, bs) + '</g>');
    });
    h.push(annotationsSvg(o, 'network', nBoxes));
    h.push('</svg>');
    return { svg: h.join(''), width: W, height: H };

    function nodeBox(x, y, n, bs) {
      var sp = boxStyleParts(bs), tx = sp ? sp.text : '';
      // The critical header tint follows the built-in critical rule's enable state.
      var c = n.crit && builtinCriticalOn(o.p) ? ' c' : '', cw = NW / 3, out = [];
      out.push(shadowRect(bs, x, y, NW, NH));
      out.push('<rect class="node' + c + '"' + (sp ? sp.rect : '') + ' x="' + x + '" y="' + y + '" width="' + NW + '" height="' + NH + '"/>');
      out.push('<rect class="nh' + c + '" x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + (NW - 2) + '" height="21"/>');
      out.push('<rect class="nh' + c + '" x="' + (x + 1) + '" y="' + (y + NH - 22) + '" width="' + (NW - 2) + '" height="21"/>');
      out.push('<line class="gls" x1="' + x + '" y1="' + (y + 22) + '" x2="' + (x + NW) + '" y2="' + (y + 22) + '"/>');
      out.push('<line class="gls" x1="' + x + '" y1="' + (y + NH - 22) + '" x2="' + (x + NW) + '" y2="' + (y + NH - 22) + '"/>');
      for (var k = 1; k < 3; k++) {
        out.push('<line class="gls" x1="' + (x + cw * k) + '" y1="' + y + '" x2="' + (x + cw * k) + '" y2="' + (y + 22) + '"/>');
        out.push('<line class="gls" x1="' + (x + cw * k) + '" y1="' + (y + NH - 22) + '" x2="' + (x + cw * k) + '" y2="' + (y + NH) + '"/>');
      }
      [[n.es, n.dur, n.ef, y + 15], [n.ls, n.slack, n.lf, y + NH - 7]].forEach(function (rowv) {
        for (var q = 0; q < 3; q++) out.push('<text class="sm' + (n.legend ? ' m' : ' b') + '"' + tx + ' text-anchor="middle" x="' + (x + cw * q + cw / 2) + '" y="' + rowv[3] + '">' + esc(rowv[q]) + '</text>');
      });
      var lines = wrap(n.name, 27, n.res ? 1 : 2);
      out.push('<text class="b"' + tx + ' x="' + (x + 8) + '" y="' + (y + 40) + '">' + esc((n.legend ? n.id : n.id + '.') + ' ' + lines[0]) + '</text>');
      if (lines[1]) out.push('<text class="b"' + tx + ' x="' + (x + 8) + '" y="' + (y + 55) + '">' + esc(lines[1]) + '</text>');
      else if (n.res) out.push('<text class="m sm"' + tx + ' x="' + (x + 8) + '" y="' + (y + 56) + '">' + esc(trunc(n.res, 32)) + '</text>');
      return out.join('');
    }
  }

  /* ---------- WBS chart ---------- */

  function wbs(o) {
    var p = o.p, s = o.s, depth = o.depth || 99;
    var show = {}; (o.box || ['wbs']).forEach(function (k) { show[k] = true; });
    var idx = OP.model.indexByUid(p);
    var tops = s.rows.filter(function (r) { return r.task.level === 1; });
    var CW = 196, GX = 22, PAD = 30, RH = 56, IND = 18, LH = 13;
    function desc(r) {
      var out = [];
      (function walk(x) {
        x.children.forEach(function (c) {
          var cr = s.rows[c];
          if (cr.task.level <= depth) { out.push(cr); walk(cr); }
        });
      })(r);
      return out;
    }
    // Extra info lines below the (always shown) name; notes only when present.
    function extrasOf(r) {
      var out = [];
      if (show.start) out.push('Start  ' + U.fmt(r.startDn));
      if (show.finish) out.push('Finish  ' + U.fmt(r.finishDn));
      if (show.duration) out.push('Duration  ' + OP.model.fmtDuration(r.duration));
      if (show.percent) out.push('Complete  ' + Math.round(r.percent) + '%');
      if (show.resources && r.names) out.push('Resources  ' + trunc(r.names, 42));
      if (show.preds) { var pt = OP.model.formatPreds(p, r.task, idx); if (pt) out.push('Predecessors  ' + pt); }
      if (show.notes && r.task.notes) out.push('Notes  ' + trunc(String(r.task.notes), 60));
      return out;
    }
    function boxH(r, w) {
      var maxc = Math.floor((w - 16) / 6.6);
      var n = (show.wbs ? 1 : 0) + wrap(r.task.name, maxc, 2).length + extrasOf(r).length;
      return Math.max(44, 18 + (n - 1) * LH); // 44 = the classic wbs + two name lines
    }
    var colH = tops.map(function (t) {
      return desc(t).reduce(function (a, d) { return a + boxH(d, CW - ((d.task.level - 2) * IND + 14)) + 10; }, 0);
    });
    var n = Math.max(tops.length, 1);
    var W = PAD * 2 + n * CW + (n - 1) * GX;
    var maxCol = Math.max.apply(null, colH.concat([0]));
    var H = PAD * 2 + RH + 22 + 22 + 44 + 10 + maxCol + 10;
    // Free text boxes (PRD M13): free/task boxes grow the canvas; group boxes wrap nodes
    // and stay inside the node area, so they need no pre-scan (boxes are not known yet).
    var wAnnoExt = annoExtent(o, 'wbs', null);
    if (wAnnoExt) { W = Math.max(W, wAnnoExt.x + 20); H = Math.max(H, wAnnoExt.y + 20); }
    var pos = {}; // uid -> rendered box, for task-bound and group annotations
    var h = [svgOpen(W, H, 'wbs-svg')];
    var rootW = Math.min(W - PAD * 2, 320), rx = (W - rootW) / 2, ry = PAD;
    h.push('<rect class="wbs0" x="' + rx + '" y="' + ry + '" width="' + rootW + '" height="' + RH + '"/>');
    h.push('<text class="wbs0t lg" text-anchor="middle" x="' + (W / 2) + '" y="' + (ry + 25) + '">' + esc(trunc(p.name, 40)) + '</text>');
    h.push('<text class="wbs0t sm" text-anchor="middle" x="' + (W / 2) + '" y="' + (ry + 42) + '">' + esc('0  ·  ' + U.fmt(s.startDn) + ' – ' + U.fmt(s.finishDn)) + '</text>');
    var busY = ry + RH + 22;
    if (tops.length) {
      h.push('<path class="con" d="M' + (W / 2) + ',' + (ry + RH) + 'V' + busY + '"/>');
      var firstX = PAD + CW / 2, lastX = PAD + (tops.length - 1) * (CW + GX) + CW / 2;
      h.push('<path class="con" d="M' + firstX + ',' + busY + 'H' + lastX + '"/>');
    }
    tops.forEach(function (t, k) {
      var x = PAD + k * (CW + GX), y = busY + 22;
      h.push('<path class="con" d="M' + (x + CW / 2) + ',' + busY + 'V' + y + '"/>');
      h.push(box(x, y, CW, t, 'wbs1', boxH(t, CW)));
      var list = desc(t), yy = y + boxH(t, CW) + 10;
      list.forEach(function (d) {
        var ind = (d.task.level - 2) * IND + 14, bx = x + ind, bw = CW - ind, nh = boxH(d, bw);
        var parentX = x + Math.max(ind - IND, 0) + 7;
        h.push('<path class="con" d="M' + parentX + ',' + (yy - 10) + 'V' + (yy + nh / 2) + 'H' + bx + '"/>');
        h.push(box(bx, yy, bw, d, 'wbs2', nh));
        yy += nh + 10;
      });
    });
    h.push(annotationsSvg(o, 'wbs', pos));
    h.push('</svg>');
    return { svg: h.join('') };

    function box(x, y, w, r, cls, nh) {
      pos[r.task.uid] = { x: x, y: y, w: w, h: nh };
      var bs = boxStyleFor(o, 'wbs', r), sp = boxStyleParts(bs), tx = sp ? sp.text : '';
      var maxc = Math.floor((w - 16) / 6.6), lines = wrap(r.task.name, maxc, 2), out = [];
      out.push('<g class="wnode" data-uid="' + esc(r.task.uid) + '" tabindex="0" role="button" aria-label="' + esc(r.wbs + ' ' + r.task.name) + '">' + shadowRect(bs, x, y, w, nh) + '<rect class="' + cls + (o.selected && o.selected[r.task.uid] ? ' sel' : '') + '"' + (sp ? sp.rect : '') + ' x="' + x + '" y="' + y + '" width="' + w + '" height="' + nh + '"/>');
      var ty = y + 15;
      if (show.wbs) { out.push('<text class="m sm"' + tx + ' x="' + (x + 8) + '" y="' + ty + '">' + esc(r.wbs) + (r.milestone ? '  ◆' : '') + '</text>'); ty += LH; }
      lines.forEach(function (ln) {
        out.push('<text class="' + (r.summary ? 'b ' : '') + 'sm"' + tx + ' x="' + (x + 8) + '" y="' + ty + '">' + esc(ln) + '</text>');
        ty += LH;
      });
      extrasOf(r).forEach(function (tx2) {
        out.push('<text class="m sm"' + tx + ' x="' + (x + 8) + '" y="' + ty + '">' + esc(tx2) + '</text>');
        ty += LH;
      });
      out.push('</g>');
      return out.join('');
    }
  }

  /* ---------- Organisation chart ---------- */

  function org(o) {
    var res = o.p.resources, byUid = {}, kids = {};
    res.forEach(function (r) { byUid[r.uid] = r; kids[r.uid] = []; });
    var roots = [];
    // People whose manager chain leads back to themselves are shown as top-level cards.
    function loops(r) {
      var seen = {};
      for (var q = byUid[r.reportsTo]; q && !seen[q.uid]; q = byUid[q.reportsTo]) {
        if (q === r) return true;
        seen[q.uid] = true;
      }
      return false;
    }
    res.forEach(function (r) {
      if (r.reportsTo != null && byUid[r.reportsTo] && r.reportsTo !== r.uid && !loops(r)) kids[r.reportsTo].push(r);
      else roots.push(r);
    });
    var NW = 188, NH = 66, GX = 22, GY = 48, PAD = 30;
    var placed = {}, width = {};
    function measure(r, guard) {
      if (guard[r.uid]) return 1;
      guard[r.uid] = true;
      var w = kids[r.uid].reduce(function (a, c) { return a + measure(c, guard); }, 0);
      width[r.uid] = Math.max(1, w);
      return width[r.uid];
    }
    var guard = {}, total = 0;
    roots.forEach(function (r) { total += measure(r, guard); });
    var depth = 0, h = [], nodes = [];
    function place(r, x0, d, seen) {
      if (seen[r.uid]) return;
      seen[r.uid] = true;
      depth = Math.max(depth, d);
      var w = width[r.uid] * (NW + GX), cx = x0 + w / 2;
      placed[r.uid] = { x: cx - NW / 2, y: PAD + d * (NH + GY) };
      var x = x0;
      kids[r.uid].forEach(function (c) {
        place(c, x, d + 1, seen);
        x += width[c.uid] * (NW + GX);
      });
      nodes.push(r);
    }
    var x = PAD, seen = {};
    roots.forEach(function (r) { place(r, x, 0, seen); x += width[r.uid] * (NW + GX); });
    var W = Math.max(PAD * 2 + total * (NW + GX) - GX, 300), H = PAD * 2 + (depth + 1) * (NH + GY) - GY + 40;
    h.push(svgOpen(W, H, 'org-svg'));
    nodes.forEach(function (r) {
      var a = placed[r.uid];
      var ch = kids[r.uid].filter(function (c) { return placed[c.uid]; });
      if (!ch.length) return;
      var busY = a.y + NH + GY / 2;
      h.push('<path class="con" d="M' + (a.x + NW / 2) + ',' + (a.y + NH) + 'V' + busY + '"/>');
      ch.forEach(function (c) {
        var b = placed[c.uid];
        h.push('<path class="con" d="M' + (a.x + NW / 2) + ',' + busY + 'H' + (b.x + NW / 2) + 'V' + b.y + '"/>');
      });
    });
    nodes.forEach(function (r) {
      var a = placed[r.uid];
      h.push('<g class="onode" data-uid="' + esc(r.uid) + '"><rect class="node" x="' + a.x + '" y="' + a.y + '" width="' + NW + '" height="' + NH + '"/>');
      h.push('<rect class="t-' + esc(r.type) + '" x="' + a.x + '" y="' + (a.y + 10) + '" width="4" height="' + (NH - 20) + '"/>');
      h.push('<text class="b" x="' + (a.x + 14) + '" y="' + (a.y + 22) + '">' + esc(trunc(r.name, 26)) + '</text>');
      h.push('<text class="m sm" x="' + (a.x + 14) + '" y="' + (a.y + 38) + '">' + esc(trunc(r.role, 30)) + '</text>');
      h.push('<text class="m sm" x="' + (a.x + 14) + '" y="' + (a.y + 54) + '">' + esc(r.type + ' · ' + r.maxUnits + '% · ' + U.money(r.rate, o.p.currency) + '/h') + '</text></g>');
    });
    // Legend: type is shown by the side stripe and repeated in text on every card.
    var lx = PAD, ly = H - 24;
    OP.model.RES_TYPES.forEach(function (t) {
      h.push('<rect class="t-' + t + '" x="' + lx + '" y="' + (ly - 9) + '" width="10" height="10"/><text class="m sm" x="' + (lx + 15) + '" y="' + ly + '">' + t + '</text>');
      lx += 100;
    });
    h.push('</svg>');
    return { svg: h.join('') };
  }

  /* ---------- Cost charts ---------- */

  function monthlyCost(p, s) {
    var byMonth = {};
    function add(d, v) {
      var dt = U.toDate(s.cal.date(d)), key = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
      byMonth[key] = (byMonth[key] || 0) + v;
    }
    for (var d in s.dayCost) add(+d, s.dayCost[d]);
    // Fixed costs on summary tasks are spread over the summary's span.
    s.rows.forEach(function (r) {
      var fc = +r.task.fixedCost || 0;
      if (!r.summary || !fc) return;
      var days = Math.max(Math.ceil(r.ef) - Math.floor(r.es), 1);
      for (var k = 0; k < days; k++) add(Math.floor(r.es) + k, fc / days);
    });
    var keys = Object.keys(byMonth).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return [];
    var out = [], cum = 0;
    for (var k = keys[0]; k <= keys[keys.length - 1]; k++) {
      cum += byMonth[k] || 0;
      out.push({ label: U.MONTHS[k % 12] + ' ' + String(Math.floor(k / 12)).slice(2), value: byMonth[k] || 0, cum: cum });
    }
    return out;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }
  function short(v) {
    if (v >= 1e6) return U.num(v / 1e6, 2) + 'M';
    if (v >= 1e3) return U.num(v / 1e3, 0) + 'k';
    return U.num(v, 0);
  }

  // kind: 'monthly' (bars) or 'cumulative' (line with budget reference)
  function costChart(o) {
    var data = o.data, W = o.width || 560, H = 240, L = 56, R = 16, T = 16, B = 30;
    var cur = o.p.currency;
    var raw = Math.max.apply(null, data.map(function (d) { return o.kind === 'monthly' ? d.value : d.cum; }).concat([o.kind === 'cumulative' ? +o.p.budget || 0 : 0, 1]));
    var tick = niceMax(raw / 4), ticks = Math.max(1, Math.ceil(raw / tick)), max = tick * ticks;
    var pw = W - L - R, ph = H - T - B, n = Math.max(data.length, 1), step = pw / n;
    function Y(v) { return T + ph - v / max * ph; }
    var h = [svgOpen(W, H, 'cost-svg')];
    for (var g = 0; g <= ticks; g++) {
      var gv = tick * g, gy = Y(gv);
      h.push('<line class="gl" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/>');
      h.push('<text class="m sm" text-anchor="end" x="' + (L - 8) + '" y="' + (gy + 4) + '">' + short(gv) + '</text>');
    }
    data.forEach(function (d, i) {
      var cx = L + step * i + step / 2;
      h.push('<text class="m sm" text-anchor="middle" x="' + cx + '" y="' + (H - 10) + '">' + d.label + '</text>');
    });
    if (o.kind === 'monthly') {
      data.forEach(function (d, i) {
        var bw = Math.min(step * 0.6, 48), x = L + step * i + (step - bw) / 2, y = Y(d.value), bh = T + ph - y;
        if (bh > 0) h.push('<path class="cbar" d="M' + x + ',' + (T + ph) + 'V' + y + 'H' + (x + bw) + 'V' + (T + ph) + 'z"/>');
        h.push('<rect class="hit" x="' + (L + step * i) + '" y="' + T + '" width="' + step + '" height="' + ph + '"><title>' + esc(d.label + ': ' + U.money(d.value, cur)) + '</title></rect>');
      });
    } else {
      var pts = data.map(function (d, i) { return (L + step * i + step / 2) + ',' + Y(d.cum); });
      if (pts.length) h.push('<polyline class="cline" points="' + pts.join(' ') + '"/>');
      data.forEach(function (d, i) {
        var cx = L + step * i + step / 2;
        h.push('<circle class="cbar" cx="' + cx + '" cy="' + Y(d.cum) + '" r="4" stroke="var(--surface)" stroke-width="2"/>');
        h.push('<rect class="hit" x="' + (L + step * i) + '" y="' + T + '" width="' + step + '" height="' + ph + '"><title>' + esc(d.label + ': ' + U.money(d.cum, cur) + ' cumulative') + '</title></rect>');
      });
      if (+o.p.budget > 0) {
        var by = Y(+o.p.budget);
        h.push('<line class="bud" x1="' + L + '" y1="' + by + '" x2="' + (W - R) + '" y2="' + by + '"/>');
        h.push('<text class="m sm" text-anchor="end" x="' + (W - R) + '" y="' + (by - 6) + '">Budget ' + short(+o.p.budget) + '</text>');
      }
    }
    h.push('<line class="gls" x1="' + L + '" y1="' + (T + ph) + '" x2="' + (W - R) + '" y2="' + (T + ph) + '"/></svg>');
    return h.join('');
  }

  return { gantt: gantt, network: network, wbs: wbs, org: org, monthlyCost: monthlyCost, costChart: costChart, ROW: ROW, HDR: HDR, ZOOM: ZOOM };
})();
