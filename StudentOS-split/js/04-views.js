/* ================================================================
   CHART ENGINE — line graphs
   ================================================================ */

const SERIES_COLORS = [
  '#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#0ea5e9',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#eab308',
  '#06b6d4','#a855f7','#22c55e','#f43f5e'
];

function colorForIndex(i){ return SERIES_COLORS[i % SERIES_COLORS.length]; }

/**
 * Render a line chart as inline SVG.
 * @param {Object} opts
 * @param {Array}  opts.series   [{ name, color, points: [{ x:number, y:number, meta?:string }] }]
 * @param {Array}  opts.xLabels  X-axis tick labels (index-aligned with x values)
 * @param {number} opts.yMin     Y-axis minimum (default 1)
 * @param {number} opts.yMax     Y-axis maximum (default 5)
 * @param {number} opts.height   viewBox height (default 260)
 * @param {string} opts.aria     aria-label
 * @param {boolean} opts.showDots (default true)
 */
function renderLineChart({ series, xLabels, yMin = 1, yMax = 5, height = 260, aria = 'Line chart', showDots = true }){
  const W = 800;
  const H = height;
  const PAD = { top: 20, right: 24, bottom: 48, left: 34 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = Math.max(1, xLabels.length);
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const xFor = i => PAD.left + (n > 1 ? i * xStep : innerW / 2);
  const yFor = v => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  // Y grid (integers only between 1-5 when range is standard)
  const yTicks = [];
  for (let v = yMin; v <= yMax; v++) yTicks.push(v);
  const yGrid = yTicks.map(v => `
    <line x1="${PAD.left}" y1="${yFor(v).toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y2="${yFor(v).toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="${v === yMin || v === yMax ? '0' : '3 4'}"/>
    <text x="${PAD.left - 8}" y="${(yFor(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--text-3)" text-anchor="end">${v}</text>
  `).join('');

  // X labels — thin out when many
  const maxLabels = 8;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const xAxis = xLabels.map((lbl, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    return `<text x="${xFor(i).toFixed(1)}" y="${H - 16}" font-size="10" fill="var(--text-3)" text-anchor="middle">${escapeHtml(lbl)}</text>`;
  }).join('');

  // Series polylines + dots
  const seriesSvg = series.map(s => {
    if (!s.points.length) return '';
    const pts = s.points;
    const polyline = pts.length > 1
      ? `<polyline points="${pts.map(p => `${xFor(p.x).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(' ')}"
                    fill="none" stroke="${s.color}" stroke-width="2.25"
                    stroke-linejoin="round" stroke-linecap="round"/>`
      : '';
    const dots = showDots ? pts.map(p => {
      const title = `${s.name}: ${p.y}${p.meta ? ' — ' + p.meta : ''}`;
      return `<circle class="dot" cx="${xFor(p.x).toFixed(1)}" cy="${yFor(p.y).toFixed(1)}" r="4"
                      fill="${s.color}" stroke="var(--surface)" stroke-width="2"
                      style="cursor:pointer">
                <title>${escapeHtml(title)}</title>
              </circle>`;
    }).join('') : '';
    return polyline + dots;
  }).join('');

  return `
    <svg class="effort-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(aria)}">
      ${yGrid}
      ${xAxis}
      ${seriesSvg}
    </svg>`;
}

/* Small legend with clickable toggles */
function renderChartLegend(series){
  return `
    <div class="effort-legend">
      ${series.map(s => `
        <button type="button" data-series="${escapeHtml(s.name)}" class="${App.hiddenSeries.has(s.name) ? 'off' : ''}">
          <i style="background:${s.color}"></i>${escapeHtml(s.name)}
        </button>
      `).join('')}
    </div>`;
}

/* Build series for "ratings over time" — one line per subject */
function buildTimeSeries(reports){
  const valid = reports.filter(r => r.ratings?.length).sort((a, b) => a.date - b.date);
  if (!valid.length) return { series: [], xLabels: [] };
  const subjects = [...new Set(valid.flatMap(r => r.ratings.map(x => x.subject)))].sort();
  const xLabels = valid.map(r => fmtDate(r.date));

  const series = subjects.map((subj, si) => {
    if (App.hiddenSeries.has(subj)) return { name: subj, color: colorForIndex(si), points: [] };
    const points = [];
    valid.forEach((r, i) => {
      const rating = r.ratings.find(x => x.subject === subj);
      if (rating) points.push({ x: i, y: rating.rating, meta: fmtDateLong(r.date) });
    });
    return { name: subj, color: colorForIndex(si), points };
  });
  return { series, xLabels };
}

/* Build series for a single report — line across subjects */
function buildReportSeries(report){
  if (!report?.ratings?.length) return { series: [], xLabels: [] };
  const ratings = [...report.ratings].sort((a, b) => a.subject.localeCompare(b.subject));
  const xLabels = ratings.map(r => r.subject);
  const points = ratings.map((r, i) => ({ x: i, y: r.rating }));
  return {
    series: [{ name: fmtDateLong(report.date), color: '#4f46e5', points }],
    xLabels
  };
}

/* Build series for subject averages — line across subjects */
function buildAveragesSeries(reports){
  const allRatings = reports.flatMap(r => r.ratings || []);
  if (!allRatings.length) return { series: [], xLabels: [] };
  const bySubj = {};
  for (const r of allRatings){
    if (!bySubj[r.subject]) bySubj[r.subject] = [];
    bySubj[r.subject].push(r.rating);
  }
  const subjects = Object.keys(bySubj).sort();
  const xLabels = subjects;
  const points = subjects.map((s, i) => ({
    x: i,
    y: +(bySubj[s].reduce((a, b) => a + b, 0) / bySubj[s].length).toFixed(2),
    meta: `${bySubj[s].length} report${bySubj[s].length === 1 ? '' : 's'}`
  }));
  return {
    series: [{ name: 'Average', color: '#8b5cf6', points }],
    xLabels
  };
}

/* ================================================================
   VIEWS
   ================================================================ */

function viewDashboard(){
  const assignments = Store.all('assignments');
  const open = assignments.filter(a => !a.completed);
  const overdue = open.filter(a => a.dueDate && daysUntil(a.dueDate) < 0);
  const dueToday = open.filter(a => a.dueDate && daysUntil(a.dueDate) === 0);
  const dueWeek = open.filter(a => a.dueDate && daysUntil(a.dueDate) >= 0 && daysUntil(a.dueDate) <= 7);
  const tests = open.filter(a => a.type === 'Test' || a.type === 'Exam');
  const name = (App.user?.displayName || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const isEmpty = !assignments.length;

  const efforts = Store.all('effortReports').sort((a,b) => b.date - a.date);
  const latestEffort = efforts[0];
  const effortCard = latestEffort ? `
    <section class="card">
      <div class="card-head">
        <div class="card-title">${ICON.trend} Latest effort report</div>
        <a class="btn btn-sm btn-ghost" href="#/effort">All</a>
      </div>
      <div class="card-body">${renderEffortSummaryMini(latestEffort)}</div>
    </section>` : `
    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.trend} Effort reports</div></div>
      <div class="card-body">
        <p class="small muted" style="margin-bottom:14px">Upload your weekly PDF or enter ratings manually.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-action="upload-effort">${ICON.upload} Upload PDF</button>
          <button class="btn btn-ghost btn-sm" data-action="add-effort-manual">${ICON.edit} Enter manually</button>
        </div>
      </div>
    </section>`;

  return `
  <div class="page-head">
    <h1 class="page-title">${greet}, ${escapeHtml(name)}</h1>
    <p class="page-sub">${new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${open.length} open item${open.length===1?'':'s'}</p>
  </div>

  ${isEmpty ? `
  <div class="card card-pad" style="text-align:center;padding:52px 24px">
    <div class="empty-ico" style="margin-bottom:18px">${ICON.target}</div>
    <h2 style="font-size:22px;margin-bottom:10px">Syncing your school life…</h2>
    <p class="muted" style="max-width:480px;margin:0 auto 20px;font-size:14.5px;line-height:1.65">
      We're pulling your Classroom assignments, school emails, and calendar. If nothing appears after a few seconds, open Settings → Sync diagnostics.
    </p>
    <button class="btn btn-primary" data-action="open-diagnostics">${ICON.search} Open diagnostics</button>
  </div>` : `
  <div class="stat-grid">
    <div class="stat ${overdue.length ? 'warn' : ''}">
      <div class="stat-label">Overdue</div><div class="stat-value">${overdue.length}</div>
      <div class="stat-sub">${overdue.length ? 'Needs attention first' : 'All clear'}</div>
    </div>
    <div class="stat"><div class="stat-label">Due today</div><div class="stat-value">${dueToday.length}</div>
      <div class="stat-sub">${dueToday.length ? 'Finish these today' : 'Nothing due today'}</div></div>
    <div class="stat"><div class="stat-label">Next 7 days</div><div class="stat-value">${dueWeek.length}</div>
      <div class="stat-sub">Assignments &amp; tasks</div></div>
    <div class="stat ${tests.length ? 'warn' : 'good'}">
      <div class="stat-label">Tests &amp; exams</div><div class="stat-value">${tests.length}</div>
      <div class="stat-sub">${tests.length ? 'Start revising early' : 'None scheduled'}</div></div>
  </div>`}

  <div class="cols cols-main">
    <div class="stack">
      <section class="card">
        <div class="card-head"><div class="card-title">${ICON.target} What should I do next?</div>
          <a class="btn btn-sm btn-ghost" href="#/planner">Planner</a></div>
        <div class="card-body" style="padding-top:6px;padding-bottom:10px">${renderNextActions()}</div>
      </section>
      <section class="card">
        <div class="card-head"><div class="card-title">${ICON.pin} Today</div>
          <span class="chip chip-gray">${dueToday.length + overdue.length} item${(dueToday.length+overdue.length)===1?'':'s'}</span></div>
        ${renderTodaySection([...dueToday, ...overdue])}
      </section>
    </div>
    <div class="stack">${effortCard}</div>
  </div>`;
}

function renderEffortSummaryMini(report){
  if (!report || !report.ratings?.length) return '<div class="muted small">No ratings recorded.</div>';
  const avg = report.ratings.reduce((s, r) => s + r.rating, 0) / report.ratings.length;
  const ratings = [...report.ratings].sort((a, b) => a.subject.localeCompare(b.subject));
  const xLabels = ratings.map(r => r.subject);
  const series = [{ name: fmtDateLong(report.date), color: '#4f46e5', points: ratings.map((r, i) => ({ x: i, y: r.rating })) }];

  return `
    <div class="row-between" style="margin-bottom:12px">
      <div>
        <div class="small muted">${fmtDateLong(report.date)}</div>
        <div class="strong" style="font-size:15px;margin-top:2px">${report.ratings.length} subjects rated</div>
      </div>
      <div class="effort-avg"><b>${avg.toFixed(1)}</b>/ 5</div>
    </div>
    <div class="effort-chart-wrap">
      ${renderLineChart({ series, xLabels, height: 190, aria: 'Latest effort ratings by subject' })}
    </div>`;
}

function renderNextActions(){
  const items = Store.all('assignments').filter(a => !a.completed);
  if (!items.length){
    return `<div class="empty" style="padding:32px 12px">
      <div class="empty-ico">${ICON.check}</div>
      <div class="empty-title">Nothing on your plate</div>
      <div class="empty-sub">New work will appear here as it comes in.</div>
    </div>`;
  }
  const scored = items.map(i => ({ i, score: plannerScore(i) })).sort((a,b) => b.score - a.score).slice(0, 5);
  return scored.map(({ i }, idx) => {
    const due = dueLabel(i.dueDate);
    const cls = i.priority === 'urgent' ? 'urgent' : i.priority === 'high' ? 'high' : i.priority === 'low' ? 'low' : '';
    return `
    <div class="next-item ${cls}">
      <div class="next-rank">${idx + 1}</div>
      <div style="flex:1;min-width:0">
        <div class="item-title" style="margin-bottom:3px">${escapeHtml(i.title)}</div>
        <div class="item-meta">
          ${i.subject ? `<span class="chip chip-indigo">${escapeHtml(i.subject)}</span>` : ''}
          <span class="chip chip-gray">${escapeHtml(i.type)}</span>
          <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" data-action="complete" data-id="${i.id}">Done</button>
    </div>`;
  }).join('');
}

function plannerScore(i){
  const d = daysUntil(i.dueDate);
  let s = 0;
  if (d !== null && d < 0) s += 1000;
  if (d !== null && d >= 0) s += Math.max(0, 300 - d * 30);
  if (i.type === 'Test') s += 150;
  if (i.type === 'Exam') s += 220;
  s += estimateMinutes(i) * 0.35;
  if (i.priority === 'high') s += 25;
  if (i.priority === 'medium') s += 10;
  return s;
}

function renderTodaySection(items){
  if (!items.length){
    return `<div class="empty" style="padding:34px 20px">
      <div class="empty-ico">${ICON.check}</div><div class="empty-title">Nothing due today</div>
      <div class="empty-sub">A good moment to get ahead on something from this week.</div></div>`;
  }
  return items.map(a => {
    const due = dueLabel(a.dueDate);
    return `<div class="item ${a.completed ? 'done' : ''}">
      <div class="item-check ${a.completed ? 'on' : ''}" data-action="complete" data-id="${a.id}">${a.completed ? ICON.check : ''}</div>
      <div class="item-main"><div class="item-title">${escapeHtml(a.title)}</div>
        ${a.description ? `<div class="item-desc">${escapeHtml(a.description)}</div>` : ''}
        <div class="item-meta">
          ${a.subject ? `<span class="chip chip-indigo">${escapeHtml(a.subject)}</span>` : ''}
          <span class="chip chip-gray">${escapeHtml(a.type)}</span></div></div>
      <div class="item-side"><span class="due ${due.cls}">${escapeHtml(due.text)}</span></div></div>`;
  }).join('');
}

function viewAssignments(){
  const f = App.filters;
  let items = Store.all('assignments');
  if (f.assignments === 'open') items = items.filter(a => !a.completed);
  else if (f.assignments === 'overdue') items = items.filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) < 0);
  else if (f.assignments === 'week') items = items.filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) >= 0 && daysUntil(a.dueDate) <= 7);
  else if (f.assignments === 'tests') items = items.filter(a => a.type === 'Test' || a.type === 'Exam');
  else if (f.assignments === 'done') items = items.filter(a => a.completed);
  if (f.subject !== 'all') items = items.filter(a => a.subject === f.subject);
  if (f.search){ const q = f.search.toLowerCase(); items = items.filter(a => `${a.title} ${a.description} ${a.subject}`.toLowerCase().includes(q)); }
  if (f.sort === 'due') items.sort((a,b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
  else if (f.sort === 'priority'){ const rank = { urgent:0, high:1, medium:2, low:3 }; items.sort((a,b) => (rank[a.priority]??3) - (rank[b.priority]??3)); }
  else items.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  const subjects = [...new Set(Store.all('assignments').map(a => a.subject).filter(Boolean))].sort();
  const open = Store.all('assignments').filter(a => !a.completed).length;
  const seg = (val, label) => `<button class="${f.assignments === val ? 'on' : ''}" data-filter="assignments" data-value="${val}">${label}</button>`;

  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Assignments</h1><p class="page-sub">${open} open · ${Store.all('assignments').length} total</p></div>
    <button class="btn btn-ghost" data-action="new-assignment">+ New</button>
  </div>
  <div class="filters">
    <div class="seg">${seg('all','All')}${seg('open','Open')}${seg('overdue','Overdue')}${seg('week','This week')}${seg('tests','Tests')}${seg('done','Done')}</div>
    <select class="select" data-filter="subject"><option value="all">All subjects</option>${subjects.map(s => `<option value="${escapeHtml(s)}" ${f.subject === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
    <select class="select" data-filter="sort">
      <option value="due" ${f.sort === 'due' ? 'selected' : ''}>Sort: Due date</option>
      <option value="priority" ${f.sort === 'priority' ? 'selected' : ''}>Sort: Priority</option>
      <option value="created" ${f.sort === 'created' ? 'selected' : ''}>Sort: Recently added</option>
    </select>
  </div>
  <div class="card">
    ${items.length ? items.map(renderAssignmentItem).join('') : `
      <div class="empty"><div class="empty-ico">${ICON.file}</div>
        <div class="empty-title">No assignments match</div>
        <div class="empty-sub">Try a different filter, or wait for the next sync.</div>
      </div>`}
  </div>`;
}

function renderAssignmentItem(a){
  const due = dueLabel(a.dueDate);
  const prio = { urgent:['chip-red','Urgent'], high:['chip-amber','High'], medium:['chip-sky','Medium'], low:['chip-gray','Low'] }[a.priority] || ['chip-gray','Low'];
  return `
  <div class="item ${a.completed ? 'done' : ''} ${!a.completed && a.dueDate && daysUntil(a.dueDate) < 0 ? 'overdue' : ''}">
    <div class="item-check ${a.completed ? 'on' : ''}" data-action="complete" data-id="${a.id}">${a.completed ? ICON.check : ''}</div>
    <div class="item-main">
      <div class="item-title">${escapeHtml(a.title)}</div>
      ${a.description ? `<div class="item-desc">${escapeHtml(a.description)}</div>` : ''}
      <div class="item-meta">
        ${a.subject ? `<span class="chip chip-indigo">${escapeHtml(a.subject)}</span>` : ''}
        <span class="chip chip-gray">${escapeHtml(a.type)}</span>
        <span class="chip ${prio[0]}">${prio[1]}</span>
        ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="chip chip-gray" style="text-decoration:none">Open ↗</a>` : ''}
      </div>
    </div>
    <div class="item-side">
      <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
      <div class="row" style="gap:4px">
        <button class="icon-btn" style="width:30px;height:30px" data-action="edit-assignment" data-id="${a.id}" aria-label="Edit">${ICON.edit}</button>
        <button class="icon-btn" style="width:30px;height:30px" data-action="delete-assignment" data-id="${a.id}" aria-label="Delete">${ICON.trash}</button>
      </div>
    </div>
  </div>`;
}

function viewCalendar(){
  const y = App.calYear, m = App.calMonth;
  const cells = monthMatrix(y, m);
  const monthName = new Date(y, m, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' });
  const allEvents = [];
  for (const a of Store.all('assignments')){
    if (a.dueDate) allEvents.push({ date: a.dueDate, title: a.title, kind: (a.type === 'Test' || a.type === 'Exam') ? 'test' : 'work', id: a.id });
  }
  for (const e of Store.all('events')){
    if (e.start) allEvents.push({ date: e.start, title: e.title, kind: 'event', id: e.id, source: e.source });
  }
  const todayTs = startOfDay();
  const upcoming = allEvents.filter(e => startOfDay(new Date(e.date)) >= todayTs).sort((a,b) => a.date - b.date).slice(0, 14);

  return `
  <div class="page-head row-between wrap">
    <div><h1 class="page-title">Calendar</h1><p class="page-sub">Deadlines, tests and school events</p></div>
    <div class="row">
      <button class="btn btn-ghost btn-sm" data-action="cal-prev" aria-label="Previous month">←</button>
      <div class="strong" style="min-width:170px;text-align:center">${monthName}</div>
      <button class="btn btn-ghost btn-sm" data-action="cal-next" aria-label="Next month">→</button>
      <button class="btn btn-subtle btn-sm" data-action="cal-today">Today</button>
    </div>
  </div>
  <div class="cols cols-main">
    <div class="card card-pad">
      <div class="cal-head">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">
        ${cells.map(d => {
          const ts = startOfDay(d);
          const dayEvents = allEvents.filter(e => startOfDay(new Date(e.date)) === ts);
          const isToday = ts === todayTs;
          const out = d.getMonth() !== m;
          return `<div class="cal-day ${out ? 'out' : ''} ${isToday ? 'today' : ''}">
            <div class="cal-num">${d.getDate()}</div>
            ${dayEvents.slice(0, 3).map(e =>
              `<div class="cal-ev ${e.kind === 'test' ? 'test' : ''}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</div>`
            ).join('')}
            ${dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3} more</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">${ICON.calendar} Upcoming</div>
        <span class="chip chip-gray">${upcoming.length}</span>
      </div>
      ${upcoming.length ? upcoming.map(e => {
        const due = dueLabel(e.date);
        return `<div class="item">
          <div class="item-main">
            <div class="item-title">${escapeHtml(e.title)}</div>
            <div class="item-meta">
              <span class="chip ${e.kind === 'test' ? 'chip-red' : e.kind === 'event' ? 'chip-violet' : 'chip-indigo'}">
                ${e.kind === 'test' ? 'Test / Exam' : e.kind === 'event' ? 'Event' : 'Work'}
              </span>
              ${e.source ? `<span class="chip chip-gray">${escapeHtml(e.source)}</span>` : ''}
            </div>
          </div>
          <div class="item-side"><span class="due ${due.cls}">${escapeHtml(due.text)}</span></div>
        </div>`;
      }).join('') : `<div class="empty" style="padding:34px 20px">
        <div class="empty-ico">${ICON.calendar}</div>
        <div class="empty-title">Nothing coming up</div>
        <div class="empty-sub">New deadlines and events will show here.</div>
      </div>`}
    </div>
  </div>`;
}

function viewEffort(){
  const reports = Store.all('effortReports').sort((a, b) => b.date - a.date);
  const latest = reports[0];
  const allRatings = reports.flatMap(r => r.ratings || []);
  const avg = allRatings.length ? allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length : 0;
  const subjects = [...new Set(allRatings.map(r => r.subject))].sort();

  const latestAvg = latest?.ratings?.length
    ? (latest.ratings.reduce((s, r) => s + r.rating, 0) / latest.ratings.length)
    : 0;

  // Charts
  const timeData = buildTimeSeries(reports);
  const latestData = buildReportSeries(latest);
  const avgData = buildAveragesSeries(reports);

  const hasMultiReport = reports.filter(r => r.ratings?.length).length >= 2;
  const hasLatest = !!latest?.ratings?.length;
  const hasAvg = Object.keys(allRatings).length > 0;

  return `
  <div class="page-head row-between wrap">
    <div>
      <h1 class="page-title">Effort Reports</h1>
      <p class="page-sub">${reports.length} report${reports.length === 1 ? '' : 's'} · ratings out of 5</p>
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" data-action="add-effort-manual">${ICON.edit} Enter manually</button>
      <button class="btn btn-primary" data-action="upload-effort">${ICON.upload} Upload PDF</button>
    </div>
  </div>

  ${reports.length ? `
  <div class="stat-grid">
    <div class="stat"><div class="stat-label">Overall average</div>
      <div class="stat-value">${avg.toFixed(1)}</div>
      <div class="stat-sub">out of 5</div></div>
    <div class="stat"><div class="stat-label">Subjects tracked</div>
      <div class="stat-value">${subjects.length}</div>
      <div class="stat-sub">across all reports</div></div>
    <div class="stat"><div class="stat-label">Latest report</div>
      <div class="stat-value" style="font-size:17px">${fmtDate(latest.date)}</div>
      <div class="stat-sub">${latest.ratings?.length || 0} ratings</div></div>
  </div>` : ''}

  ${hasMultiReport ? `
  <section class="card" style="margin-bottom:20px">
    <div class="card-head">
      <div class="card-title">${ICON.trend} Progress over time</div>
      <span class="chip chip-gray">one line per subject</span>
    </div>
    <div class="card-body">
      <div class="effort-chart-wrap">
        ${renderLineChart({
          series: timeData.series,
          xLabels: timeData.xLabels,
          height: 300,
          aria: 'Effort ratings over time, one line per subject'
        })}
      </div>
      ${renderChartLegend(timeData.series)}
    </div>
  </section>` : ''}

  ${hasLatest ? `
  <section class="card" style="margin-bottom:20px">
    <div class="card-head">
      <div class="card-title">${ICON.chart} Latest report — ${fmtDateLong(latest.date)}</div>
      <span class="effort-avg"><b>${latestAvg.toFixed(1)}</b>/ 5</span>
    </div>
    <div class="card-body">
      <div class="effort-chart-wrap">
        ${renderLineChart({
          series: latestData.series,
          xLabels: latestData.xLabels,
          height: 260,
          aria: 'Latest report — effort rating per subject'
        })}
      </div>
    </div>
  </section>` : ''}

  ${hasAvg ? `
  <section class="card" style="margin-bottom:20px">
    <div class="card-head">
      <div class="card-title">${ICON.trend} Subject averages</div>
      <span class="chip chip-gray">across all reports</span>
    </div>
    <div class="card-body">
      <div class="effort-chart-wrap">
        ${renderLineChart({
          series: avgData.series,
          xLabels: avgData.xLabels,
          height: 260,
          aria: 'Average effort rating per subject'
        })}
      </div>
    </div>
  </section>` : ''}

  ${reports.length > 1 ? `
  <section class="card">
    <div class="card-head"><div class="card-title">${ICON.folder} History</div></div>
    ${reports.slice(0, 15).map(r => {
      const a = r.ratings?.length ? r.ratings.reduce((s, x) => s + x.rating, 0) / r.ratings.length : 0;
      const isManual = (r.filename || '').toLowerCase().includes('manual');
      return `<div class="item">
        <div class="item-main">
          <div class="item-title">${fmtDateLong(r.date)}</div>
          <div class="item-meta">
            <span class="chip chip-gray">${r.ratings?.length || 0} ratings</span>
            <span class="chip chip-indigo">Avg ${a.toFixed(1)}</span>
            ${isManual ? `<span class="chip chip-violet">Manual</span>` : ''}
          </div>
        </div>
        <div class="item-side">
          <button class="icon-btn" style="width:30px;height:30px" data-action="delete-effort" data-id="${r.id}" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>`;
    }).join('')}
  </section>` : ''}

  ${!reports.length ? `
  <div class="card card-pad" style="text-align:center;padding:52px 24px">
    <div class="empty-ico" style="margin-bottom:18px">${ICON.fileText}</div>
    <h2 style="font-size:20px;margin-bottom:10px">No effort reports yet</h2>
    <p class="muted" style="max-width:460px;margin:0 auto 20px;font-size:14px;line-height:1.65">
      Upload the weekly PDF from your school, or enter ratings manually.
    </p>
    <div class="row" style="gap:10px;flex-wrap:wrap;justify-content:center">
      <button class="btn btn-primary" data-action="upload-effort">${ICON.upload} Upload PDF</button>
      <button class="btn btn-ghost" data-action="add-effort-manual">${ICON.edit} Enter manually</button>
    </div>
  </div>` : ''}
  `;
}

function viewPlanner(){
  const items = Store.all('assignments').filter(a => !a.completed);
  const today = startOfDay();

  if (!items.length){
    return `
    <div class="page-head">
      <h1 class="page-title">Study Planner</h1>
      <p class="page-sub">A smart order for everything you have to do</p>
    </div>
    <div class="card card-pad" style="text-align:center;padding:52px 24px">
      <div class="empty-ico" style="margin-bottom:18px">${ICON.target}</div>
      <h2 style="font-size:20px;margin-bottom:10px">Nothing to plan</h2>
      <p class="muted" style="max-width:460px;margin:0 auto 20px;font-size:14px;line-height:1.65">
        Once assignments and tests land in StudentOS, your study plan shows up here.
      </p>
    </div>`;
  }

  const scored = items.map(i => ({ i, score: plannerScore(i) })).sort((a, b) => b.score - a.score);

  const plan = [];
  for (let offset = 0; offset < 7; offset++){
    const dayTs = today + offset * 86400000;
    const dueSoon = scored.filter(({ i }) => {
      if (!i.dueDate) return false;
      const d = daysUntil(i.dueDate);
      return d !== null && d >= offset && d <= offset + 1;
    });
    plan.push({ dayTs, items: dueSoon.slice(0, 4) });
  }

  const totalMinutes = scored.reduce((s, { i }) => s + estimateMinutes(i), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  return `
  <div class="page-head">
    <h1 class="page-title">Study Planner</h1>
    <p class="page-sub">${items.length} open · about ${totalHours}h of work at current estimates</p>
  </div>

  <div class="cols cols-main">
    <div class="stack">
      <section class="card">
        <div class="card-head">
          <div class="card-title">${ICON.zap} Recommended order</div>
          <span class="chip chip-gray">${scored.length} items</span>
        </div>
        <div class="card-body" style="padding-top:6px;padding-bottom:10px">
          ${scored.slice(0, 8).map(({ i }, idx) => {
            const due = dueLabel(i.dueDate);
            const mins = estimateMinutes(i);
            const cls = i.priority === 'urgent' ? 'urgent' : i.priority === 'high' ? 'high' : i.priority === 'low' ? 'low' : '';
            return `
            <div class="next-item ${cls}">
              <div class="next-rank">${idx + 1}</div>
              <div style="flex:1;min-width:0">
                <div class="item-title" style="margin-bottom:3px">${escapeHtml(i.title)}</div>
                <div class="item-meta">
                  ${i.subject ? `<span class="chip chip-indigo">${escapeHtml(i.subject)}</span>` : ''}
                  <span class="chip chip-gray">${escapeHtml(i.type)}</span>
                  <span class="chip chip-violet">~${mins}m</span>
                  <span class="due ${due.cls}">${escapeHtml(due.text)}</span>
                </div>
              </div>
              <button class="btn btn-sm btn-ghost" data-action="complete" data-id="${i.id}">Done</button>
            </div>`;
          }).join('')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">${ICON.calendar} This week</div></div>
        <div class="card-body">
          ${plan.map(({ dayTs, items: dayItems }, idx) => {
            const d = new Date(dayTs);
            const isToday = idx === 0;
            const totalM = dayItems.reduce((s, { i }) => s + estimateMinutes(i), 0);
            return `
            <div style="padding:12px 0;border-bottom:1px solid var(--border)">
              <div class="row-between" style="margin-bottom:8px">
                <div class="strong" style="font-size:13.5px">
                  ${isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                </div>
                ${totalM ? `<span class="chip chip-violet">~${Math.round(totalM / 60 * 10) / 10}h</span>` : ''}
              </div>
              ${dayItems.length ? dayItems.map(({ i }) => `
                <div class="row" style="padding:5px 0;gap:8px">
                  <span class="chip chip-gray">${escapeHtml(i.type)}</span>
                  <span class="small truncate" style="flex:1">${escapeHtml(i.title)}</span>
                </div>
              `).join('') : `<div class="small muted">Nothing scheduled</div>`}
            </div>`;
          }).join('')}
        </div>
      </section>
    </div>

    <div class="stack">
      <section class="card">
        <div class="card-head"><div class="card-title">${ICON.book} By subject</div></div>
        <div class="card-body">
          ${(() => {
            const bySubj = {};
            for (const i of items){
              const s = i.subject || 'Unsorted';
              if (!bySubj[s]) bySubj[s] = { count: 0, mins: 0 };
              bySubj[s].count++;
              bySubj[s].mins += estimateMinutes(i);
            }
            return Object.entries(bySubj).sort((a, b) => b[1].mins - a[1].mins).map(([s, v]) => `
              <div class="effort-bar-row">
                <div class="effort-bar-subject truncate">${escapeHtml(s)}</div>
                <div class="effort-bar-track"><div class="effort-bar-fill r4" style="width:${Math.min(100, v.mins / 3)}%"></div></div>
                <div class="effort-bar-val">${v.count}</div>
              </div>
            `).join('');
          })()}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">${ICON.bulb} Tips</div></div>
        <div class="card-body small muted" style="line-height:1.7">
          • Start with the highest-ranked item — it's the one most likely to bite you.<br>
          • Tests and exams get bumped up automatically, because they need spaced revision.<br>
          • Estimates are rough: Exam 3h, Test 1.5h, Project 2.5h, Assignment 1h, Homework 40m.
        </div>
      </section>
    </div>
  </div>`;
}

function viewSettings(){
  const s = Store.cache.settings;
  const subs = s.calendarSubscriptions || [];
  const isDark = s.theme === 'dark';
  const days = getLookbackDays();

  return `
  <div class="page-head">
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Sync, notifications, and account</p>
  </div>

  <div class="cols cols-2">

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.user} Account</div></div>
      <div class="card-body">
        <div class="row" style="gap:14px">
          <img class="avatar avatar-lg" src="${escapeHtml(App.user?.photoURL || '')}" alt="" referrerpolicy="no-referrer">
          <div style="min-width:0">
            <div class="strong truncate">${escapeHtml(App.user?.displayName || 'Student')}</div>
            <div class="small muted truncate">${escapeHtml(App.user?.email || '')}</div>
            <div class="tiny muted" style="margin-top:4px">
              ${Store.mode === 'firebase' ? 'Synced to Firestore' : 'Local mode — data stays on this device'}
            </div>
          </div>
        </div>
        <div class="row" style="margin-top:16px;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-action="force-sync">${ICON.refresh} Force sync now</button>
          <button class="btn btn-ghost btn-sm" data-action="reconnect-google">${ICON.link} Reconnect Google</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.palette} Appearance</div></div>
      <div class="card-body">
        <div class="set-row">
          <div class="set-info">
            <div class="set-name">Dark mode</div>
            <div class="set-desc">Switch between light and dark themes.</div>
          </div>
          <div class="set-control">
            <button class="btn ${isDark ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="toggle-theme">
              ${isDark ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.bell} Notifications</div></div>
      <div class="card-body">
        <div class="set-row">
          <div class="set-info"><div class="set-name">New assignments</div>
            <div class="set-desc">When a new assignment appears.</div></div>
          <div class="set-control">
            <label class="checkbox"><input type="checkbox" data-setting="notifyNewAssignment" ${s.notifyNewAssignment ? 'checked' : ''}></label>
          </div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Due soon</div>
            <div class="set-desc">When something is due today or tomorrow.</div></div>
          <div class="set-control">
            <label class="checkbox"><input type="checkbox" data-setting="notifyDueSoon" ${s.notifyDueSoon ? 'checked' : ''}></label>
          </div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">New tests & exams</div>
            <div class="set-desc">When a test or exam is detected.</div></div>
          <div class="set-control">
            <label class="checkbox"><input type="checkbox" data-setting="notifyNewTest" ${s.notifyNewTest ? 'checked' : ''}></label>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.mail} Email sync</div></div>
      <div class="card-body">

        <div class="set-row stacked">
          <div class="set-info">
            <div class="set-name">Lookback window</div>
            <div class="set-desc">Only scan emails from the last N days (1–365).</div>
          </div>
          <div class="set-control">
            <input class="input" type="number" min="1" max="365"
                   data-setting="emailLookbackDays" value="${days}">
          </div>
        </div>

        <div class="set-row stacked">
          <div class="set-info">
            <div class="set-name">Trusted domains</div>
            <div class="set-desc">Only pull emails from these sender domains. Comma-separated. Leave blank for the broad keyword search.</div>
          </div>
          <div class="set-control">
            <input class="input" data-setting-list="trustedDomains"
                   placeholder="school.kiwi, kamar.school.nz"
                   value="${escapeHtml((s.trustedDomains || []).join(', '))}">
          </div>
        </div>

        <div class="set-row stacked">
          <div class="set-info">
            <div class="set-name">Trusted senders</div>
            <div class="set-desc">Specific sender addresses. Comma-separated.</div>
          </div>
          <div class="set-control">
            <input class="input" data-setting-list="trustedSenders"
                   placeholder="teacher@school.kiwi"
                   value="${escapeHtml((s.trustedSenders || []).join(', '))}">
          </div>
        </div>

        <div class="set-row stacked">
          <div class="set-info">
            <div class="set-name">Custom keywords</div>
            <div class="set-desc">Override the default keyword search. Leave blank for the broad default.</div>
          </div>
          <div class="set-control">
            <input class="input" data-setting="emailKeywords"
                   placeholder="e.g. homework, NCEA, assessment"
                   value="${escapeHtml(s.emailKeywords || '')}">
          </div>
        </div>

        <div class="set-row">
          <div class="set-info">
            <div class="set-name">Test email access</div>
            <div class="set-desc">Run a quick diagnostic against the Gmail API.</div>
          </div>
          <div class="set-control">
            <button class="btn btn-ghost btn-sm" data-action="open-diagnostics">${ICON.search} Run diagnostics</button>
          </div>
        </div>

      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.calendar} Calendar feeds</div></div>
      <div class="card-body">
        ${subs.length ? subs.map((sub, i) => `
          <div class="set-row">
            <div class="set-info">
              <div class="set-name">${escapeHtml(sub.name || 'Calendar')}</div>
              <div class="set-desc truncate">${escapeHtml(sub.url)}</div>
              ${sub.error ? `<div class="tiny" style="color:var(--red-600);margin-top:4px">${escapeHtml(sub.error)}</div>` : ''}
              ${sub.lastSync ? `<div class="tiny muted" style="margin-top:4px">Last sync ${relativeTime(sub.lastSync)} · ${sub.count || 0} events</div>` : ''}
            </div>
            <div class="set-control">
              <button class="icon-btn" style="width:30px;height:30px"
                      data-action="remove-calendar" data-index="${i}" aria-label="Remove feed">${ICON.trash}</button>
            </div>
          </div>
        `).join('') : `<p class="small muted" style="margin-bottom:12px">No calendar feeds yet.</p>`}
        <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-action="add-calendar">+ Add feed</button>
          <button class="btn btn-ghost btn-sm" data-action="add-sacred-heart">+ Add Sacred Heart calendar</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><div class="card-title">${ICON.alert} Danger zone</div></div>
      <div class="card-body">
        <div class="set-row">
          <div class="set-info"><div class="set-name">Clear all synced data</div>
            <div class="set-desc">Removes every assignment, event and notification. Cannot be undone.</div></div>
          <div class="set-control">
            <button class="btn btn-danger-soft btn-sm" data-action="clear-all">Clear data</button>
          </div>
        </div>
        <div class="set-row">
          <div class="set-info"><div class="set-name">Sign out</div>
            <div class="set-desc">End this session. Your data stays in the cloud.</div></div>
          <div class="set-control">
            <button class="btn btn-danger-soft btn-sm" data-action="signout">Sign out</button>
          </div>
        </div>
      </div>
    </section>

  </div>`;
}
