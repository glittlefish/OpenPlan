import OP from './core.js';
/* File formats: OpenPlan JSON, CSV, and SVG/PNG image export. */
OP.io = (function () {
  var U = OP.util, M = OP.model;

  function toJSON(p) { return JSON.stringify(p, null, 2); }

  function fromJSON(text) {
    var p = JSON.parse(text);
    if (!p || !Array.isArray(p.tasks) || !Array.isArray(p.resources)) throw new Error('Not an OpenPlan project file.');
    return M.normalize(p);
  }

  // Append another project as a summary task (subproject). Resources and custom fields are matched by name.
  // Returns the new summary task's uid and notes about data that could not be carried over.
  function insertProject(p, sub) {
    var resMap = {}, taskMap = {}, copies = [], cfMap = {}, warnings = [];
    sub.customFields.forEach(function (f) {
      var same = p.customFields.filter(function (x) { return x.name === f.name && x.type === f.type; })[0];
      if (!same) { same = { id: 'c' + Date.now().toString(36) + p.customFields.length, name: f.name, type: f.type }; p.customFields.push(same); }
      cfMap[f.id] = same.id;
    });
    // Carry the subproject's dated calendar exceptions over (holidays etc.); local entries win.
    var cal = p.calendar || (p.calendar = { workingDays: [1, 2, 3, 4, 5], workTimes: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }], exceptions: [] });
    var haveExc = {};
    (cal.exceptions || []).forEach(function (e) { haveExc[e.date] = true; });
    ((sub.calendar && sub.calendar.exceptions) || []).forEach(function (e) {
      if (e && e.date && !haveExc[e.date]) { haveExc[e.date] = true; (cal.exceptions = cal.exceptions || []).push({ date: e.date, working: !!e.working, reason: String(e.reason || '') }); }
    });
    if (sub.baseline) warnings.push('its baseline was not copied');
    sub.resources.forEach(function (r) {
      var same = p.resources.filter(function (x) { return x.name && x.name === r.name; })[0];
      if (same) { resMap[r.uid] = same.uid; return; }
      var copy = U.clone(r);
      copy.uid = p.nextUid++;
      resMap[r.uid] = copy.uid;
      copies.push(copy);
      p.resources.push(copy);
    });
    copies.forEach(function (c) { c.reportsTo = c.reportsTo != null && resMap[c.reportsTo] ? resMap[c.reportsTo] : null; });
    var head = M.newTask(p, { name: sub.name || 'Subproject', level: 1, notes: 'Inserted from ' + (sub.name || 'another project') });
    p.tasks.push(head);
    sub.tasks.forEach(function (t) { taskMap[t.uid] = p.nextUid++; });
    sub.tasks.forEach(function (t) {
      var c = U.clone(t);
      c.uid = taskMap[t.uid];
      c.level = t.level + 1;
      c.preds = t.preds.filter(function (l) { return taskMap[l.uid]; }).map(function (l) { return { uid: taskMap[l.uid], type: l.type, lag: l.lag }; });
      c.assignments = t.assignments.filter(function (a) { return resMap[a.res]; }).map(function (a) { return { res: resMap[a.res], units: a.units }; });
      c.custom = {};
      for (var k in t.custom) if (cfMap[k]) c.custom[cfMap[k]] = t.custom[k];
      p.tasks.push(c);
    });
    M.normalizeLevels(p);
    return { uid: head.uid, warnings: warnings };
  }

  /* ---------- CSV ---------- */

  // The task table shared by the CSV and Excel exports: a header row, then one row per task.
  function taskTable(p) {
    var s = OP.schedule(p), idx = M.indexByUid(p);
    var head = ['ID', 'WBS', 'Task Name', 'Level', 'Duration (days)', 'Start', 'Finish', 'Predecessors', 'Resources',
      'Work (h)', 'Cost', 'ES', 'EF', 'LS', 'LF', 'Total Slack', 'Critical', '% Complete'];
    var lines = [head];
    s.rows.forEach(function (r) {
      lines.push([r.id, r.wbs, r.task.name, r.task.level, r.duration, U.iso(r.startDn), U.iso(r.finishDn),
        M.formatPreds(p, r.task, idx), r.names, Math.round(r.work * 10) / 10, Math.round(r.cost),
        r.es, r.ef, r.ls, r.lf, r.slack, r.critical ? 'Yes' : 'No', r.task.percent || 0]);
    });
    return lines;
  }

  function toCSV(p) {
    return taskTable(p).map(function (row) {
      return row.map(function (raw) {
        var v = String(raw == null ? '' : raw);
        // Text starting with a formula character would run as a formula in Excel or Sheets.
        if (typeof raw === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  }

  /* ---------- images ---------- */

  // Resolve var(--token) references (always with the light theme, for documents) so the SVG renders outside the page.
  function standaloneSVG(svg) {
    var root = document.documentElement, prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    var cs = getComputedStyle(root), vars = {};
    var text = new XMLSerializer().serializeToString(svg);
    text.replace(/var\((--[\w-]+)\)/g, function (_, name) { vars[name] = cs.getPropertyValue(name).trim() || '#000'; });
    var bgColor = cs.getPropertyValue('--surface').trim() || '#fff';
    if (prevTheme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prevTheme);
    text = text.replace(/var\((--[\w-]+)\)/g, function (_, name) { return vars[name]; });
    if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text)) text = text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return text.replace(/(<style>[\s\S]*?<\/style>)/, '$1<rect width="100%" height="100%" fill="' + bgColor + '"/>');
  }

  function exportSVG(svg, name) {
    U.download(name + '.svg', standaloneSVG(svg), 'image/svg+xml');
  }

  function exportPNG(svg, name) {
    var w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    // Browsers cap canvas side length and total area (about 16 megapixels on Safari).
    var scale = Math.min(2, 16000 / Math.max(w, h), Math.sqrt(16e6 / (w * h)));
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      var ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function (b) {
        if (b) U.download(name + '.png', b);
        else OP.notify('The chart is too large for a PNG. Try the SVG export instead.');
      }, 'image/png');
    };
    img.onerror = function () { notify('Could not create the image. Try the SVG export instead.', true); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(standaloneSVG(svg));
  }

  function printSVG(svg, title) {
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    var w = f.contentWindow;
    w.onafterprint = function () { setTimeout(function () { f.remove(); }, 0); };
    // Some browsers (Safari) do not fire afterprint reliably.
    setTimeout(function () { f.remove(); }, 60000);
    w.document.write('<!doctype html><title>' + U.esc(title) + '</title><style>@page{size:landscape;margin:10mm}body{margin:0}svg{width:100%;height:auto}</style>' +
      standaloneSVG(svg));
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 300);
  }

  // Copy the chart to the clipboard as a high-resolution PNG (PRD M18-4); falls back
  // to a download when the clipboard API is unavailable.
  function copyPNG(svg, name, notify) {
    var w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    var scale = Math.min(2, 16000 / Math.max(w, h), Math.sqrt(16e6 / (w * h)));
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      var ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function (b) {
        if (!b) { notify('Could not create the picture. Try the SVG export instead.', true); return; }
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
            .then(function () { notify('Picture copied to the clipboard'); })
            .catch(function () { U.download(name + '.png', b); notify('Clipboard is unavailable; the PNG was downloaded instead.'); });
        } else { U.download(name + '.png', b); notify('Clipboard is unavailable; the PNG was downloaded instead.'); }
      }, 'image/png');
    };
    img.onerror = function () { OP.notify('Could not create the picture. Try the SVG export instead.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(standaloneSVG(svg));
  }

  return {
    toJSON: toJSON, fromJSON: fromJSON, taskTable: taskTable, toCSV: toCSV, insertProject: insertProject, exportSVG: exportSVG, exportPNG: exportPNG, printSVG: printSVG, copyPNG: copyPNG, standaloneSVG: standaloneSVG
  };
})();
