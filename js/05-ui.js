/* ── Event binding ───────────────────────────────────────── */
function bindViewEvents(){
  const view = $('#view');
  if (!view) return;

  view.onclick = async (e) => {
    // Legend toggle (effort chart)
    const legendBtn = e.target.closest('.effort-legend button[data-series]');
    if (legendBtn){
      const name = legendBtn.dataset.series;
      if (App.hiddenSeries.has(name)) App.hiddenSeries.delete(name);
      else App.hiddenSeries.add(name);
      render();
      return;
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    const index = el.dataset.index;

    switch (action){
      case 'complete': {
        const item = Store.get('assignments', id);
        if (!item) return;
        item.completed = !item.completed;
        await Store.put('assignments', item);
        render();
        toast(item.completed ? 'Marked as done' : 'Reopened', 'success');
        break;
      }
      case 'new-assignment': openAssignmentModal(); break;
      case 'edit-assignment': openAssignmentModal(Store.get('assignments', id)); break;
      case 'delete-assignment': {
        const item = Store.get('assignments', id);
        if (!item) return;
        if (await confirmDialog('Delete assignment?', `“${item.title}” will be removed.`, 'Delete', true)){
          await Store.remove('assignments', id);
          render();
          toast('Deleted', 'success');
        }
        break;
      }
      case 'cal-prev': {
        App.calMonth--;
        if (App.calMonth < 0){ App.calMonth = 11; App.calYear--; }
        render(); break;
      }
      case 'cal-next': {
        App.calMonth++;
        if (App.calMonth > 11){ App.calMonth = 0; App.calYear++; }
        render(); break;
      }
      case 'cal-today': {
        App.calMonth = new Date().getMonth();
        App.calYear = new Date().getFullYear();
        render(); break;
      }
      case 'upload-effort': openEffortUpload(); break;
      case 'add-effort-manual': openManualEffortModal(); break;
      case 'delete-effort': {
        if (await confirmDialog('Delete report?', 'This effort report will be removed.', 'Delete', true)){
          await Store.remove('effortReports', id);
          render();
          toast('Report deleted', 'success');
        }
        break;
      }
      case 'open-diagnostics': openDiagnostics(); break;
      case 'force-sync': {
        if (!GoogleServices.has()) await ensureGoogleToken();
        await syncAll({ silent: false });
        break;
      }
      case 'reconnect-google': {
        const ok = await ensureGoogleToken();
        if (ok){ toast('Google reconnected', 'success'); await syncAll({ silent: false }); }
        else toast('Could not reconnect. Sign out and back in.', 'error');
        break;
      }
      case 'toggle-theme': {
        Store.cache.settings.theme = Store.cache.settings.theme === 'dark' ? 'light' : 'dark';
        applyTheme();
        await Store.saveUserDoc();
        render();
        break;
      }
      case 'add-calendar': openAddCalendarModal(); break;
      case 'add-sacred-heart': {
        const existing = (Store.cache.settings.calendarSubscriptions || [])
          .some(s => s.url === SACRED_HEART_CALENDAR.url);
        if (existing){ toast('Already added', 'warn'); break; }
        Store.cache.settings.calendarSubscriptions.push({
          name: SACRED_HEART_CALENDAR.name,
          url: SACRED_HEART_CALENDAR.url,
          addedAt: now()
        });
        await Store.saveUserDoc();
        toast('Calendar added — syncing…', 'success');
        await syncAll({ silent: false });
        render();
        break;
      }
      case 'remove-calendar': {
        const subs = Store.cache.settings.calendarSubscriptions || [];
        const i = Number(index);
        if (Number.isInteger(i) && subs[i]){
          subs.splice(i, 1);
          await Store.saveUserDoc();
          render();
          toast('Feed removed', 'success');
        }
        break;
      }
      case 'clear-all': {
        if (await confirmDialog('Clear all data?',
          'Every assignment, event, notification and report will be deleted. This cannot be undone.',
          'Clear everything', true)){
          await Store.removeAll();
          render();
          toast('All data cleared', 'success');
        }
        break;
      }
      case 'signout': signOut(); break;
    }
  };

  view.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.filter;
      App.filters[key] = el.value;
      render();
    });
  });
  view.querySelectorAll('[data-filter="assignments"]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.filters.assignments = btn.dataset.value;
      render();
    });
  });

  view.querySelectorAll('[data-setting]').forEach(el => {
    el.addEventListener('change', async () => {
      const key = el.dataset.setting;
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') {
        let n = Number(el.value);
        if (!Number.isFinite(n) || n <= 0) n = 30;
        n = Math.min(365, Math.max(1, Math.round(n)));
        val = n;
        el.value = String(n);
      }
      else val = el.value;
      Store.cache.settings[key] = val;
      await Store.saveUserDoc();
      if (key === 'emailLookbackDays') toast('Lookback updated — resync to apply', 'success');
    });
  });

  view.querySelectorAll('[data-setting-list]').forEach(el => {
    el.addEventListener('change', async () => {
      const key = el.dataset.settingList;
      const list = el.value.split(',').map(s => s.trim()).filter(Boolean);
      Store.cache.settings[key] = list;
      await Store.saveUserDoc();
      toast('Saved — resync to apply', 'success');
    });
  });
}

/* ── Modals ──────────────────────────────────────────────── */
function openAssignmentModal(existing = null){
  const isEdit = !!existing;
  const item = existing || {
    title: '', description: '', type: 'Assignment',
    subject: '', dueDate: null, url: '', priority: 'low'
  };
  const dueStr = item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '';

  const subjects = [...new Set([...Object.values(SUBJECT_ALIASES), ...Store.all('assignments').map(a => a.subject).filter(Boolean)])].sort();

  openModal({
    title: isEdit ? 'Edit assignment' : 'New assignment',
    body: `
      <div class="stack">
        <div class="field"><label class="label">Title</label>
          <input class="input" id="m-title" value="${escapeHtml(item.title)}" placeholder="e.g. Chapter 5 questions"></div>
        <div class="row" style="gap:12px">
          <div class="field" style="flex:1"><label class="label">Type</label>
            <select class="select" id="m-type">
              ${['Assignment','Homework','Test','Exam','Project','Reminder','Event'].map(t =>
                `<option ${item.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="field" style="flex:1"><label class="label">Subject</label>
            <input class="input" id="m-subject" list="subject-list" value="${escapeHtml(item.subject)}" placeholder="e.g. Mathematics">
            <datalist id="subject-list">${subjects.map(s => `<option value="${escapeHtml(s)}">`).join('')}</datalist></div>
        </div>
        <div class="field"><label class="label">Due date</label>
          <input class="input" type="date" id="m-due" value="${dueStr}"></div>
        <div class="field"><label class="label">Link (optional)</label>
          <input class="input" id="m-url" value="${escapeHtml(item.url || '')}" placeholder="https://…"></div>
        <div class="field"><label class="label">Notes</label>
          <textarea class="textarea" id="m-desc" placeholder="Any details you want to remember">${escapeHtml(item.description || '')}</textarea></div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="m-save">${isEdit ? 'Save changes' : 'Add assignment'}</button>`,
    onMount(el, close){
      el.querySelector('#m-save').addEventListener('click', async () => {
        const title = el.querySelector('#m-title').value.trim();
        if (!title){ toast('Title is required', 'error'); return; }
        const dueVal = el.querySelector('#m-due').value;
        const dueTs = dueVal ? new Date(dueVal + 'T23:59').getTime() : null;
        const record = {
          id: item.id || uid(),
          title: sanitiseText(title, 220),
          description: sanitiseText(el.querySelector('#m-desc').value, 4000),
          type: el.querySelector('#m-type').value,
          subject: normalizeSubject(el.querySelector('#m-subject').value.trim()),
          dueDate: dueTs,
          url: el.querySelector('#m-url').value.trim(),
          completed: item.completed || false,
          manual: true,
          sources: item.sources || [{ source: 'Manual', url: '', addedAt: now() }],
          createdAt: item.createdAt || now()
        };
        record.priority = computePriority(record);
        await Store.put('assignments', record);
        close();
        render();
        toast(isEdit ? 'Assignment updated' : 'Assignment added', 'success');
      });
    }
  });
}

function openAddCalendarModal(){
  openModal({
    title: 'Add calendar feed',
    subtitle: 'Paste an ICS / iCal URL from your school',
    body: `
      <div class="stack">
        <div class="field"><label class="label">Name</label>
          <input class="input" id="c-name" placeholder="e.g. School calendar"></div>
        <div class="field"><label class="label">ICS URL</label>
          <input class="input" id="c-url" placeholder="https://…/school.ics"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button>
             <button class="btn btn-primary" id="c-add">Add feed</button>`,
    onMount(el, close){
      el.querySelector('#c-add').addEventListener('click', async () => {
        const name = el.querySelector('#c-name').value.trim() || 'Calendar';
        const url = el.querySelector('#c-url').value.trim();
        if (!url){ toast('URL is required', 'error'); return; }
        Store.cache.settings.calendarSubscriptions.push({ name, url, addedAt: now() });
        await Store.saveUserDoc();
        close();
        toast('Feed added — syncing…', 'success');
        await syncAll({ silent: false });
        render();
      });
    }
  });
}

function openManualEffortModal(){
  const subjectPool = [...new Set([
    ...Object.values(SUBJECT_ALIASES),
    ...Store.all('effortReports').flatMap(r => (r.ratings || []).map(x => x.subject))
  ])].sort();

  openModal({
    title: 'Add effort report',
    subtitle: 'Enter your subject ratings manually',
    body: `
      <div class="stack">
        <div class="field"><label class="label">Date</label>
          <input class="input" type="date" id="me-date" value="${new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="field">
          <label class="label">Ratings</label>
          <div id="me-ratings"></div>
          <button class="btn btn-ghost btn-sm" id="me-add-row" style="margin-top:8px">+ Add subject</button>
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button>
             <button class="btn btn-primary" id="me-save">Save report</button>`,
    onMount(el, close){
      const container = el.querySelector('#me-ratings');
      const dl = document.createElement('datalist');
      dl.id = 'me-subject-list';
      dl.innerHTML = subjectPool.map(s => `<option value="${escapeHtml(s)}">`).join('');
      el.querySelector('.modal-body').appendChild(dl);

      function addRow(subject = '', rating = 3){
        const row = document.createElement('div');
        row.className = 'row me-row';
        row.style.marginBottom = '8px';
        row.style.gap = '8px';
        row.innerHTML = `
          <input class="input me-subj" list="me-subject-list" value="${escapeHtml(subject)}" placeholder="Subject" style="flex:2;min-width:0">
          <select class="select me-rating" style="flex:none;width:80px">
            ${[1,2,3,4,5].map(n => `<option ${n === rating ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <button class="icon-btn" style="width:34px;height:34px" data-remove aria-label="Remove">${ICON.trash}</button>
        `;
        row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
        container.appendChild(row);
      }
      addRow();

      el.querySelector('#me-add-row').addEventListener('click', () => addRow());
      el.querySelector('#me-save').addEventListener('click', async () => {
        const dateVal = el.querySelector('#me-date').value;
        const rows = container.querySelectorAll('.me-row');
        const ratings = [];
        rows.forEach(r => {
          const s = r.querySelector('.me-subj').value.trim();
          const v = Number(r.querySelector('.me-rating').value);
          if (s && v >= 1 && v <= 5) ratings.push({ subject: normalizeSubject(s), rating: v });
        });
        if (!ratings.length){ toast('Add at least one subject', 'error'); return; }
        const report = {
          id: uid(),
          date: dateVal ? new Date(dateVal + 'T12:00').getTime() : now(),
          filename: 'Manual entry',
          ratings,
          createdAt: now()
        };
        await Store.put('effortReports', report);
        close();
        render();
        toast(`Saved ${ratings.length} ratings`, 'success', 'Report added');
      });
    }
  });
}

function openEffortUpload(){
  openModal({
    title: 'Upload effort report',
    subtitle: 'PDF exported from your school portal',
    body: `
      <div class="drop-zone" id="effort-drop">
        <div class="drop-zone-ico">${ICON.fileText}</div>
        <div class="drop-zone-title">Drop PDF here or click to browse</div>
        <div class="drop-zone-sub">StudentOS reads subject names and effort ratings from the PDF.</div>
        <input type="file" id="effort-file" accept="application/pdf" hidden>
      </div>
      <div id="effort-status" class="small muted" style="margin-top:12px"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button>`,
    onMount(el, close){
      const zone = el.querySelector('#effort-drop');
      const file = el.querySelector('#effort-file');
      const status = el.querySelector('#effort-status');

      zone.addEventListener('click', () => file.click());
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drag');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
      file.addEventListener('change', () => { if (file.files[0]) handleFile(file.files[0]); });

      async function handleFile(f){
        if (f.type !== 'application/pdf'){ toast('Please upload a PDF', 'error'); return; }
        status.textContent = 'Reading PDF…';
        try {
          const ratings = await extractEffortFromPdf(f);
          if (!ratings.length){
            status.textContent = 'No subject ratings detected.';
            toast('Could not find any ratings in that PDF', 'warn');
            return;
          }
          const report = {
            id: uid(),
            date: now(),
            filename: f.name,
            ratings,
            createdAt: now()
          };
          await Store.put('effortReports', report);
          close();
          render();
          toast(`Saved ${ratings.length} ratings`, 'success', 'Report uploaded');
        } catch (e){
          console.error(e);
          status.textContent = `Failed: ${e.message}`;
          toast(`PDF read failed: ${e.message}`, 'error');
        }
      }
    }
  });
}

/* ── PDF parsing ─────────────────────────────────────────── */
let pdfjsLoaded = null;
async function loadPdfJs(){
  if (window.pdfjsLib) return window.pdfjsLib;
  if (pdfjsLoaded) return pdfjsLoaded;
  pdfjsLoaded = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => {
      if (window.pdfjsLib){
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      } else reject(new Error('pdf.js failed to load'));
    };
    s.onerror = () => reject(new Error('pdf.js failed to load'));
    document.head.appendChild(s);
  });
  return pdfjsLoaded;
}

async function extractEffortFromPdf(file){
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items){
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    }
    const sorted = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of sorted){
      items.sort((a, b) => a.transform[4] - b.transform[4]);
      const text = items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }

  const ratings = [];
  for (let i = 0; i < lines.length; i++){
    const line = lines[i];
    let m = line.match(/^([A-Za-z][A-Za-z &/'.]{2,40}?)\s+([1-5])\b/);
    if (m && !/effort|report|student|school|teacher|class/i.test(m[1])){
      ratings.push({ subject: normalizeSubject(m[1].trim()), rating: Number(m[2]) });
      continue;
    }
    m = line.match(/^([A-Za-z][A-Za-z &/'.]{2,40})$/);
    if (m && !/effort|report|student|school|teacher|class|name|year|term/i.test(m[1])){
      const next = lines[i + 1];
      const n = next && next.match(/^([1-5])(?:\s|$)/);
      if (n){
        ratings.push({ subject: normalizeSubject(m[1].trim()), rating: Number(n[1]) });
      }
    }
  }

  const seen = new Map();
  for (const r of ratings){
    if (!seen.has(r.subject)) seen.set(r.subject, r);
  }
  return [...seen.values()];
}

/* ── Diagnostics ─────────────────────────────────────────── */
async function openDiagnostics(){
  const { el } = openModal({
    title: 'Sync diagnostics',
    subtitle: 'What StudentOS can see right now',
    xl: false,
    body: `<div id="diag-body"><div class="row"><span class="spinner"></span> <span class="muted small">Checking…</span></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Close</button>
             <button class="btn btn-primary" id="diag-resync">Resync now</button>`,
    onMount(el, closeFn){
      el.querySelector('#diag-resync').addEventListener('click', async () => {
        closeFn();
        if (!GoogleServices.has()) await ensureGoogleToken();
        await syncAll({ silent: false });
        openDiagnostics();
      });
    }
  });

  const body = el.querySelector('#diag-body');
  const results = [];

  if (!GoogleServices.accessToken){
    results.push({ ok: false, label: 'Google sign-in', detail: 'No access token in this session. Click Sync or Reconnect Google to refresh.' });
  } else if (GoogleServices.expiresAt <= now()){
    results.push({ ok: false, label: 'Google token', detail: 'Token expired. Click Sync — we will try to refresh silently.' });
  } else {
    const mins = Math.round(GoogleServices.timeLeft() / 60000);
    results.push({ ok: true, label: 'Google token', detail: `Valid for ~${mins} more minute${mins === 1 ? '' : 's'}.` });
  }

  if (GoogleServices.accessToken){
    if (GoogleServices.hasScope('https://www.googleapis.com/auth/gmail.readonly')){
      results.push({ ok: true, label: 'Gmail scope', detail: 'gmail.readonly granted.' });
    } else {
      results.push({ ok: false, label: 'Gmail scope', detail: 'Gmail read permission was NOT granted. Sign out and back in and accept the Gmail prompt.' });
    }
  }

  const days = getLookbackDays();
  results.push({ ok: true, label: 'Lookback window', detail: `${days} day${days === 1 ? '' : 's'}.` });

  if (GoogleServices.has()){
    const q = buildGmailQuery();
    results.push({ ok: true, label: 'Gmail query', detail: `<code>${escapeHtml(q)}</code>` });
    try {
      const list = await gfetchJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`,
        GoogleServices.accessToken
      );
      const n = (list.messages || []).length;
      results.push({
        ok: n > 0,
        label: 'Messages matched',
        detail: n > 0
          ? `${n} message${n === 1 ? '' : 's'} matched your query.`
          : 'No messages matched. See the wide probe below to tell whether this is your filter or your inbox.'
      });
    } catch (e){
      results.push({ ok: false, label: 'Gmail API call', detail: e.message });
    }

    try {
      const wide = await gfetchJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent(`newer_than:${days}d`)}`,
        GoogleServices.accessToken
      );
      const estimate = wide.resultSizeEstimate ?? (wide.messages || []).length;
      results.push({
        ok: estimate > 0,
        label: 'Wide probe (time window only)',
        detail: estimate > 0
          ? `~${estimate} message(s) in the last ${days} days. The inbox itself is fine — any zero result above is your keyword or sender filter.`
          : `0 messages in the last ${days} days. Your lookback window or the account you signed in with is the problem.`
      });
    } catch (e){
      results.push({ ok: false, label: 'Wide probe', detail: e.message });
    }
  }

  if (GoogleServices.has()){
    try {
      const courses = await gfetchJson(
        'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100',
        GoogleServices.accessToken
      );
      const n = (courses.courses || []).length;
      results.push({ ok: true, label: 'Classroom courses', detail: `${n} active course${n === 1 ? '' : 's'}.` });
    } catch (e){
      results.push({ ok: false, label: 'Classroom API', detail: e.message });
    }
  }

  results.push({
    ok: true,
    label: 'Local data',
    detail: `${Store.all('assignments').length} assignments · ${Store.all('events').length} events · ${Store.all('effortReports').length} effort reports.`
  });

  const emailInt = Store.cache.integrations?.email;
  if (emailInt){
    results.push({
      ok: true,
      label: 'Last email sync',
      detail: `Scanned ${emailInt.scanned ?? '?'}, accepted ${emailInt.accepted ?? '?'}, skipped ${emailInt.skippedClassroom ?? 0} Classroom notification(s).`
    });
  }

  const ints = Object.values(Store.cache.integrations || {});
  const lastSync = ints.map(i => i.lastSync).filter(Boolean).sort((a, b) => b - a)[0];
  results.push({
    ok: !!lastSync,
    label: 'Last successful sync',
    detail: lastSync ? relativeTime(lastSync) : 'Never — try Force sync.'
  });

  body.innerHTML = results.map(r => `
    <div class="diag-row">
      <div class="diag-ico ${r.ok ? '' : 'bad'}">${r.ok ? ICON.check : ICON.alert}</div>
      <div class="diag-body">
        <strong>${escapeHtml(r.label)}</strong>
        <div>${r.detail}</div>
      </div>
    </div>
  `).join('');
}

/* ── Theme ───────────────────────────────────────────────── */
function applyTheme(){
  const theme = Store.cache?.settings?.theme || DEFAULT_SETTINGS.theme;
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1020' : '#4f46e5');
}

/* ── Notifications UI ────────────────────────────────────── */
function renderNotifDot(){
  const unread = Store.all('notifications').filter(n => !n.read).length;
  const dot = $('#notif-dot');
  if (dot) dot.hidden = unread === 0;
}

function renderNotifPanel(){
  const panel = $('#notif-panel');
  if (!panel) return;
  const list = Store.all('notifications').sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  const icons = { test: ICON.target, assignment: ICON.file, due: ICON.bell, event: ICON.calendar };
  panel.innerHTML = `
    <div class="notif-head">
      <div class="strong" style="font-size:14px">Notifications</div>
      ${list.some(n => !n.read) ? `<button class="btn btn-sm btn-ghost" id="mark-all-read">Mark all read</button>` : ''}
    </div>
    <div class="notif-list">
      ${list.length ? list.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-link="${escapeHtml(n.link || '')}">
          <div class="notif-ico">${icons[n.kind] || ICON.bell}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="small muted">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-meta">${relativeTime(n.createdAt)}</div>
          </div>
        </div>
      `).join('') : `<div class="notif-empty">You're all caught up</div>`}
    </div>`;
  panel.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      const n = Store.get('notifications', item.dataset.id);
      if (n && !n.read){ n.read = true; await Store.put('notifications', n); }
      renderNotifDot();
      const link = item.dataset.link;
      if (link) location.hash = link;
      panel.hidden = true;
    });
  });
  const markAll = panel.querySelector('#mark-all-read');
  if (markAll) markAll.addEventListener('click', async (e) => {
    e.stopPropagation();
    for (const n of Store.all('notifications')){
      if (!n.read){ n.read = true; await Store.put('notifications', n); }
    }
    renderNotifDot();
    renderNotifPanel();
  });
}

/* ── Global search ───────────────────────────────────────── */
function bindGlobalSearch(){
  const input = $('#global-search');
  const results = $('#search-results');
  if (!input || !results) return;

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 120);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) runSearch(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar-search')) results.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'){
      e.preventDefault(); input.focus();
    }
    if (e.key === 'Escape'){ results.hidden = true; input.blur(); }
  });

  function runSearch(){
    const q = input.value.trim().toLowerCase();
    if (!q){ results.hidden = true; return; }
    const items = Store.all('assignments').filter(a =>
      `${a.title} ${a.description} ${a.subject}`.toLowerCase().includes(q)
    ).slice(0, 12);
    if (!items.length){
      results.innerHTML = `<div class="search-empty">No matches for “${escapeHtml(q)}”</div>`;
    } else {
      results.innerHTML = items.map(a => {
        const due = dueLabel(a.dueDate);
        return `<div class="search-item" data-id="${a.id}">
          <span class="chip chip-gray">${escapeHtml(a.type)}</span>
          <div style="flex:1;min-width:0">
            <div class="t truncate">${escapeHtml(a.title)}</div>
            <div class="tiny muted truncate">${escapeHtml(a.subject || '')} · ${escapeHtml(due.text)}</div>
          </div>
        </div>`;
      }).join('');
      results.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', () => {
          App.filters.search = input.value.trim();
          location.hash = '#/assignments';
          results.hidden = true;
        });
      });
    }
    results.hidden = false;
  }
}

/* ── Auth flow ───────────────────────────────────────────── */
function showAuthScreen(){
  $('#auth-screen').hidden = false;
  $('#app').hidden = true;
}
function showAppScreen(){
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
}

async function signInWithGoogle(){
  const errBox = $('#google-error');
  errBox.hidden = true;
  const btn = $('#enter-btn');
  btn.disabled = true;

  try {
    const provider = new FB.mod.GoogleAuthProvider();
    for (const scope of GOOGLE_SCOPES) provider.addScope(scope);
    provider.setCustomParameters({ prompt: 'consent select_account' });

    const result = await FB.mod.signInWithPopup(FB.auth, provider);
    let tokenCaptured = false;
    try {
      const credential = FB.mod.GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken){
        GoogleServices.setToken(credential.accessToken, 3600, GOOGLE_SCOPES);
        tokenCaptured = true;
      }
    } catch (e){
      console.warn('Token capture failed:', e);
    }
    if (!tokenCaptured){
      errBox.textContent = 'Signed in, but no Google access token was returned. Try again — and make sure you accept every permission on the consent screen.';
      errBox.hidden = false;
    }
  } catch (e){
    console.error(e);
    let msg = e.message || 'Sign-in failed.';
    if (e.code === 'auth/popup-blocked') msg = 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    else if (e.code === 'auth/popup-closed-by-user') msg = 'Sign-in window was closed before finishing.';
    else if (e.code === 'auth/access-blocked-by-admin') msg = 'Your school admin has blocked this app. Ask your IT team to allow it.';
    errBox.textContent = msg;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function signOut(){
  try { await FB.mod.signOut(FB.auth); } catch {}
  GoogleServices.clear();
  Store.uid = null;
  Store.cache = null;
  App.user = null;
  App.hiddenSeries.clear();
  localStorage.removeItem(LS_SESSION);
  showAuthScreen();
}

async function onUserSignedIn(user){
  App.user = user;
  Store.uid = user.uid;
  App.hiddenSeries.clear();

  await Store.init(user);
  applyTheme();

  if (Store.mode === 'firebase'){
    await Store.loadFromFirestore();
    applyTheme();
  }

  $('#account-name').textContent = user.displayName || 'Student';
  $('#account-email').textContent = user.email || '';
  const av = user.photoURL || `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='16' fill='%234f46e5'/><text x='16' y='22' font-family='sans-serif' font-size='14' font-weight='700' fill='white' text-anchor='middle'>${(user.displayName||'S')[0].toUpperCase()}</text></svg>`;
  $('#avatar').src = av;
  $('#avatar-lg').src = av;

  showAppScreen();
  render();

  if (GoogleServices.has()){
    setSyncUI('busy', 'Syncing…');
    setTimeout(() => syncAll({ silent: true }), 500);
  } else {
    setSyncUI('', 'Tap Sync to connect');
  }
}

function seedDemoData(){
  const t = now();
  const day = 86400000;
  return {
    assignments: [
      { id: 'demo-1', title: 'Quadratic equations worksheet', type: 'Homework', subject: 'Mathematics',
        dueDate: t + day, completed: false, priority: 'urgent', manual: false,
        description: 'Complete questions 1–20 from the chapter 5 booklet.',
        sources: [{ source: 'Demo', url: '', addedAt: t }], createdAt: t - day },
      { id: 'demo-2', title: 'Cell biology internal', type: 'Test', subject: 'Biology',
        dueDate: t + day * 4, completed: false, priority: 'high', manual: false,
        description: 'Covers mitosis, meiosis, and cell transport.',
        sources: [{ source: 'Demo', url: '', addedAt: t }], createdAt: t - day * 2 },
      { id: 'demo-3', title: 'Essay: Macbeth ambition', type: 'Assignment', subject: 'English',
        dueDate: t + day * 6, completed: false, priority: 'medium', manual: false,
        description: '1500 words on the theme of ambition.',
        sources: [{ source: 'Demo', url: '', addedAt: t }], createdAt: t - day },
      { id: 'demo-4', title: 'Physics lab report', type: 'Assignment', subject: 'Physics',
        dueDate: t - day, completed: false, priority: 'urgent', manual: false,
        description: 'Write-up of the pendulum practical.',
        sources: [{ source: 'Demo', url: '', addedAt: t }], createdAt: t - day * 3 },
      { id: 'demo-5', title: 'Read chapter 7', type: 'Homework', subject: 'History',
        dueDate: t - day * 2, completed: true, priority: 'low', manual: false,
        description: '', sources: [{ source: 'Demo', url: '', addedAt: t }], createdAt: t - day * 4 }
    ],
    events: [
      { id: 'demo-e1', title: 'School athletics day', start: t + day * 3, source: 'Demo', description: '', manual: false }
    ],
    notifications: [],
    courses: [],
    studySessions: [],
    effortReports: [
      { id: 'demo-effort-1', date: t - day * 19, filename: 'week-3.pdf',
        ratings: [
          { subject: 'Mathematics', rating: 3 }, { subject: 'English', rating: 3 },
          { subject: 'Biology', rating: 4 }, { subject: 'Physics', rating: 3 }, { subject: 'History', rating: 4 }
        ], createdAt: t - day * 19 },
      { id: 'demo-effort-2', date: t - day * 12, filename: 'week-4.pdf',
        ratings: [
          { subject: 'Mathematics', rating: 4 }, { subject: 'English', rating: 3 },
          { subject: 'Biology', rating: 4 }, { subject: 'Physics', rating: 3 }, { subject: 'History', rating: 4 }
        ], createdAt: t - day * 12 },
      { id: 'demo-effort-3', date: t - day * 5, filename: 'week-5.pdf',
        ratings: [
          { subject: 'Mathematics', rating: 4 }, { subject: 'English', rating: 3 },
          { subject: 'Biology', rating: 5 }, { subject: 'Physics', rating: 3 }, { subject: 'History', rating: 4 }
        ], createdAt: t - day * 5 }
    ],
    integrations: {}, settings: { ...DEFAULT_SETTINGS }, profile: {}, deletedIds: []
  };
}
