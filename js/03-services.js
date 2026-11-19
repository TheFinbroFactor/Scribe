/* ── Config & Firebase ────────────────────────────────────── */
function loadConfig(){
  let stored = null;
  try { const raw = localStorage.getItem(LS_CONFIG); if (raw) stored = JSON.parse(raw); } catch {}
  return { firebase: (stored && stored.firebase) || DEFAULT_CONFIG.firebase };
}
function isFirebaseConfigured(cfg){ return !!(cfg?.firebase?.apiKey && cfg?.firebase?.projectId && cfg?.firebase?.appId); }

const FB = { ready:false, app:null, auth:null, db:null, mod:{}, user:null };
async function initFirebase(cfg){
  const v = '10.12.2';
  const base = `https://www.gstatic.com/firebasejs/${v}`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`)
  ]);
  FB.mod = { ...appMod, ...authMod, ...fsMod };
  FB.app = appMod.initializeApp(cfg.firebase);
  FB.auth = authMod.getAuth(FB.app);
  try { await authMod.setPersistence(FB.auth, authMod.browserLocalPersistence); } catch (e){ console.warn('Persistence set failed', e); }
  FB.db = fsMod.getFirestore(FB.app);
  FB.mod.fs = fsMod;
  FB.ready = true;
  return FB;
}

/* ── Google token manager ────────────────────────────────── */
const GoogleServices = {
  accessToken: null, expiresAt: 0, scopes: [],
  _KEY: 'studentos.gtoken.v2',
  setToken(token, expiresIn, scopes){
    this.accessToken = token;
    this.expiresAt = now() + (Number(expiresIn || 3600) * 1000) - 30_000;
    this.scopes = scopes || [];
    try { localStorage.setItem(this._KEY, JSON.stringify({ t: token, e: this.expiresAt, s: this.scopes })); } catch {}
  },
  restore(){
    try {
      const raw = localStorage.getItem(this._KEY);
      if (!raw) return false;
      const { t, e, s } = JSON.parse(raw);
      if (e > now() + 5000){
        this.accessToken = t; this.expiresAt = e; this.scopes = s || [];
        return true;
      }
      localStorage.removeItem(this._KEY);
    } catch {}
    return false;
  },
  clear(){
    this.accessToken = null; this.expiresAt = 0; this.scopes = [];
    try { localStorage.removeItem(this._KEY); } catch {}
  },
  has(scopes){
    if (!this.accessToken) return false;
    if (this.expiresAt <= now() + 5000) return false;
    if (!scopes || !scopes.length) return true;
    const have = new Set(this.scopes);
    return scopes.every(s => have.has(s));
  },
  hasScope(scope){ return this.scopes.includes(scope); },
  timeLeft(){ return this.accessToken ? Math.max(0, this.expiresAt - now()) : 0; }
};

async function gfetchJson(url, token){
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error('TOKEN_EXPIRED');
  if (r.status === 403){
    const txt = await r.text().catch(() => '');
    if (/insufficient|scope|permission/i.test(txt)) throw new Error('INSUFFICIENT_SCOPE');
    if (/disabled|blocked|denied|not.?enabled|forbidden/i.test(txt)) throw new Error('ACCESS_BLOCKED');
    throw new Error(`Google API 403: ${txt.slice(0, 140)}`);
  }
  if (r.status === 429) throw new Error('RATE_LIMITED');
  if (!r.ok){
    const txt = await r.text().catch(() => '');
    throw new Error(`Google API ${r.status}: ${txt.slice(0, 140)}`);
  }
  return r.json();
}

async function ensureGoogleToken(){
  if (GoogleServices.has()) return true;
  if (!FB.auth?.currentUser) return false;
  try {
    const provider = new FB.mod.GoogleAuthProvider();
    for (const scope of GOOGLE_SCOPES) provider.addScope(scope);
    const result = await FB.mod.reauthenticateWithPopup(FB.auth.currentUser, provider);
    const credential = FB.mod.GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken){
      GoogleServices.setToken(credential.accessToken, 3600, GOOGLE_SCOPES);
      return true;
    }
  } catch (e){
    console.warn('Silent Google reauth failed:', e?.code || e?.message || e);
  }
  return false;
}

/* ── Store ────────────────────────────────────────────────── */
const Store = {
  uid: null, mode: 'local', cache: null, _saveTimer: null,
  _deletedIds: new Set(),

  async init(user){
    this.uid = user.uid;
    this.mode = FB.ready && user.real ? 'firebase' : 'local';
    if (this.mode === 'local'){
      const raw = localStorage.getItem(LS_DATA(this.uid));
      this.cache = raw ? JSON.parse(raw) : emptyData();
      if (!raw && user.uid === 'demo-user') this.cache = seedDemoData();
      this.persistNow();
    } else {
      this.cache = emptyData();
    }
    this.ensureShape();
    this._deletedIds = new Set(this.cache.deletedIds || []);
    return this.cache;
  },

  ensureShape(){
    const d = this.cache;
    for (const k of ['assignments','events','notifications','courses','studySessions','effortReports']){
      if (!Array.isArray(d[k])) d[k] = [];
    }
    if (!d.integrations || typeof d.integrations !== 'object') d.integrations = {};
    if (!d.settings) d.settings = { ...DEFAULT_SETTINGS };
    d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
    let lb = Number(d.settings.emailLookbackDays);
    if (!Number.isFinite(lb) || lb <= 0) lb = 30;
    d.settings.emailLookbackDays = Math.min(365, Math.max(1, Math.round(lb)));
    if (!Array.isArray(d.settings.trustedDomains)) d.settings.trustedDomains = [];
    if (!Array.isArray(d.settings.trustedSenders)) d.settings.trustedSenders = [];
    if (!Array.isArray(d.settings.calendarSubscriptions)) d.settings.calendarSubscriptions = [];
    if (!Array.isArray(d.deletedIds)) d.deletedIds = [];
    if (!d.profile) d.profile = {};
  },

  isDeleted(id){ return this._deletedIds.has(id); },

  async markDeleted(id){
    if (!id) return;
    this._deletedIds.add(id);
    this.cache.deletedIds = [...this._deletedIds].slice(-500);
    this.persistNow();
  },

  persistNow(){
    this.cache.deletedIds = [...this._deletedIds].slice(-500);
    if (this.mode === 'local' && this.uid){
      try { localStorage.setItem(LS_DATA(this.uid), JSON.stringify(this.cache)); } catch(e){ console.warn(e); }
    }
  },
  persist(){ clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => this.persistNow(), 220); },
  all(c){ return this.cache[c] || []; },
  get(c, id){ return this.all(c).find(x => x.id === id) || null; },

  async put(collection, doc){
    if (this._deletedIds.has(doc.id)) return null;
    const arr = this.cache[collection];
    const idx = arr.findIndex(x => x.id === doc.id);
    const record = { ...doc, updatedAt: now() };
    if (idx >= 0) arr[idx] = { ...arr[idx], ...record };
    else arr.push({ createdAt: now(), ...record });
    this.persist();
    if (this.mode === 'firebase' && FB.db){
      try {
        const { doc: fdoc, setDoc, serverTimestamp } = FB.mod.fs;
        await setDoc(fdoc(FB.db, 'users', this.uid, collection, doc.id), { ...record, updatedAt: serverTimestamp() }, { merge: true });
      } catch(e){ console.warn('Firestore write failed', e); }
    }
    return record;
  },

  async remove(collection, id){
    this.cache[collection] = this.all(collection).filter(x => x.id !== id);
    await this.markDeleted(id);
    this.persistNow();
    if (this.mode === 'firebase' && FB.db){
      try {
        const { doc: fdoc, deleteDoc } = FB.mod.fs;
        await deleteDoc(fdoc(FB.db, 'users', this.uid, collection, id));
      } catch (e){ console.warn(`Firestore delete failed:`, e); }
      await this._saveTombstones();
    }
  },

  async _saveTombstones(){
    if (this.mode !== 'firebase' || !FB.db) return;
    try {
      const { doc: fdoc, setDoc } = FB.mod.fs;
      await setDoc(fdoc(FB.db, 'users', this.uid), {
        deletedIds: [...this._deletedIds].slice(-500)
      }, { merge: true });
    } catch (e){ console.warn('Tombstone save failed:', e); }
  },

  async removeAll(){
    const cols = ['assignments','events','notifications','courses','studySessions','effortReports'];
    for (const k of cols){
      for (const item of this.all(k)) this._deletedIds.add(item.id);
      this.cache[k] = [];
    }
    this.cache.integrations = {};
    this.persistNow();
    if (this.mode === 'firebase' && FB.db){
      const { collection, getDocs, doc: fdoc, deleteDoc } = FB.mod.fs;
      for (const k of cols){
        try {
          const snap = await getDocs(collection(FB.db, 'users', this.uid, k));
          for (const d of snap.docs){
            try { await deleteDoc(fdoc(FB.db, 'users', this.uid, k, d.id)); } catch {}
          }
        } catch {}
      }
      await this._saveTombstones();
    }
  },

  async loadFromFirestore(){
    if (this.mode !== 'firebase' || !FB.db) return this.cache;
    const { collection, getDocs, query, limit } = FB.mod.fs;
    try {
      const { doc: fdoc, getDoc } = FB.mod.fs;
      const s = await getDoc(fdoc(FB.db, 'users', this.uid));
      if (s.exists()){
        const v = s.data();
        if (Array.isArray(v.deletedIds)) this._deletedIds = new Set(v.deletedIds);
        if (v.settings) this.cache.settings = { ...DEFAULT_SETTINGS, ...v.settings };
        if (v.integrations) this.cache.integrations = v.integrations;
        if (v.profile) this.cache.profile = v.profile;
      }
    } catch(e){ console.warn('Failed to read user doc', e); }

    const cols = ['assignments','events','notifications','courses','studySessions','effortReports'];
    for (const c of cols){
      try {
        const snap = await getDocs(query(collection(FB.db,'users',this.uid,c), limit(500)));
        this.cache[c] = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(item => !this._deletedIds.has(item.id));
      } catch(e){ console.warn(`Read ${c} failed`, e); }
    }
    this.ensureShape();
    this.persistNow();
    return this.cache;
  },

  async saveUserDoc(){
    if (this.mode !== 'firebase' || !FB.db) return;
    try {
      const { doc: fdoc, setDoc } = FB.mod.fs;
      await setDoc(fdoc(FB.db, 'users', this.uid), {
        settings: this.cache.settings,
        integrations: this.cache.integrations,
        profile: this.cache.profile,
        deletedIds: [...this._deletedIds].slice(-500),
        updatedAt: now()
      }, { merge: true });
    } catch(e){}
  }
};

function emptyData(){
  return {
    assignments: [], events: [], notifications: [],
    courses: [], studySessions: [], effortReports: [],
    integrations: {}, settings: { ...DEFAULT_SETTINGS }, profile: {},
    deletedIds: []
  };
}

/* ── Calendar sync ────────────────────────────────────────── */
async function fetchCalendarUrl(url){
  const attempts = [
    { name: 'direct',     fn: () => fetch(url, { redirect: 'follow' }) },
    { name: 'allorigins', fn: () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { redirect: 'follow' }) },
    { name: 'corsproxy',  fn: () => fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { redirect: 'follow' }) },
    { name: 'codetabs',   fn: () => fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, { redirect: 'follow' }) },
    { name: 'jina',       fn: () => fetch(`https://r.jina.ai/${url}`, { redirect: 'follow' }) },
  ];
  const errors = [];
  for (const { name, fn } of attempts){
    try {
      const r = await fn();
      if (r.ok) return r;
      errors.push(`${name}: HTTP ${r.status}`);
    } catch (e){
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`Tried ${attempts.length} routes — ${errors.join(' · ')}`);
}

function parseICS(text){
  if (!text) return [];
  const events = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks){
    const ev = {};
    for (const line of block.split(/\r?\n/)){
      const m = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === 'SUMMARY') ev.title = value;
      else if (key === 'DESCRIPTION') ev.description = value;
      else if (key === 'DTSTART') ev.start = parseICSDate(value);
      else if (key === 'DTEND') ev.end = parseICSDate(value);
      else if (key === 'URL') ev.url = value;
      else if (key === 'UID') ev.uid = value;
      else if (key === 'LOCATION') ev.location = value;
    }
    if (ev.title && ev.start) events.push(ev);
  }
  return events;
}

function parseICSDate(v){
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h='00', mi='00', s='00', z] = m;
  return (z ? new Date(Date.UTC(+y, +mo-1, +d, +h, +mi, +s)) : new Date(+y, +mo-1, +d, +h, +mi, +s)).getTime();
}

function eventExists(title, start, excludeId = null){
  if (!start) return false;
  const dayKey = startOfDay(new Date(start));
  const norm = normalizeTitle(title);
  return Store.all('events').some(e => e.id !== excludeId && e.start && startOfDay(new Date(e.start)) === dayKey && normalizeTitle(e.title) === norm);
}

async function syncCalendarSubscriptions(){
  const subs = Store.cache.settings.calendarSubscriptions || [];
  if (!subs.length) return { added: 0, subs: 0, errors: [] };
  let totalAdded = 0;
  const errors = [];
  for (const sub of subs){
    try {
      const r = await fetchCalendarUrl(sub.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const events = parseICS(text);
      let added = 0;
      for (const ev of events){
        if (ev.start < now() - 90*86400000) continue;
        const existing = Store.all('events').find(e => e.icsUid === ev.uid && e.icsSource === sub.url);
        if (!existing && eventExists(ev.title, ev.start)) continue;
        const record = {
          id: existing ? existing.id : `ics-${uid()}`,
          title: sanitiseText(ev.title, 200),
          description: sanitiseText(ev.description || '', 2000),
          start: ev.start, end: ev.end || null,
          location: sanitiseText(ev.location || '', 200),
          source: sub.name || 'Calendar', url: ev.url || '',
          icsUid: ev.uid, icsSource: sub.url, manual: false,
          createdAt: existing ? existing.createdAt : now()
        };
        await Store.put('events', record);
        if (!existing) added++;
      }
      totalAdded += added;
      sub.lastSync = now(); sub.count = events.length; sub.error = null;
    } catch (e){ sub.error = e.message; errors.push(`${sub.name || sub.url}: ${e.message}`); }
  }
  await Store.saveUserDoc();
  return { added: totalAdded, subs: subs.length, errors };
}

/* ── Classroom sync ───────────────────────────────────────── */
async function syncClassroom(){
  if (!GoogleServices.has()) throw new Error('NOT_SIGNED_IN');
  const token = GoogleServices.accessToken;
  const coursesResp = await gfetchJson('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100', token);
  const courses = coursesResp.courses || [];
  Store.cache.courses = courses.map(c => ({
    id: c.id, name: c.name, section: c.section || '',
    room: c.room || '', ownerId: c.ownerId || '', updatedAt: now()
  }));

  const raw = [];
  for (const c of courses){
    try {
      let pageToken = '';
      let pages = 0;
      do {
        const url = `https://classroom.googleapis.com/v1/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const cw = await gfetchJson(url, token);
        for (const w of (cw.courseWork || [])){
          const localId = `gc-${w.id}`;
          if (Store.isDeleted(localId)) continue;
          const due = w.dueDate
            ? new Date(w.dueDate.year, (w.dueDate.month || 1) - 1, w.dueDate.day || 1,
                w.dueTime?.hours ?? 23, w.dueTime?.minutes ?? 59).getTime()
            : null;
          raw.push({
            id: localId,
            title: w.title || 'Coursework',
            description: w.description || '',
            dueDate: due,
            subject: normalizeSubject(c.name),
            typeHint: mapWorkType(w.workType),
            url: w.alternateLink || '',
            source: 'Google Classroom'
          });
        }
        pageToken = cw.nextPageToken || '';
        pages++;
      } while (pageToken && pages < 5);
    } catch (e){ console.warn(`Failed to read course ${c.name}:`, e.message); }
  }
  const r = await importItems(raw, 'Google Classroom');
  Store.cache.integrations.classroom = {
    id: 'classroom', connected: true, lastSync: now(), method: 'api',
    imported: Store.all('assignments').filter(a => (a.sources||[]).some(s => s.source === 'Google Classroom')).length,
    courses: courses.length
  };
  await Store.saveUserDoc();
  return { added: r.added, merged: r.merged, courses: courses.length };
}

function mapWorkType(w){
  switch (w){
    case 'ASSIGNMENT': return 'Assignment';
    case 'SHORT_ANSWER_QUESTION':
    case 'MULTIPLE_CHOICE_QUESTION': return 'Homework';
    default: return null;
  }
}

/* ── Gmail sync ───────────────────────────────────────────── */
function getLookbackDays(){
  let n = Number(Store.cache.settings.emailLookbackDays);
  if (!Number.isFinite(n) || n <= 0) n = 30;
  return Math.min(365, Math.max(1, Math.round(n)));
}

function buildGmailQuery(){
  const s = Store.cache.settings;
  const days = getLookbackDays();
  const parts = [];

  const domainList = (s.trustedDomains || []).map(d => String(d).trim()).filter(Boolean);
  const senderList = (s.trustedSenders || []).map(d => String(d).trim()).filter(Boolean);

  if (domainList.length) parts.push('(' + domainList.map(d => `from:${d}`).join(' OR ') + ')');
  if (senderList.length) parts.push('(' + senderList.map(d => `from:${d}`).join(' OR ') + ')');

  if (s.emailKeywords && s.emailKeywords.trim()){
    const kw = s.emailKeywords.split(/[,\s]+/).map(k => k.trim()).filter(Boolean);
    if (kw.length) parts.push('(' + kw.join(' OR ') + ')');
  } else if (!parts.length){
    parts.push('(homework OR assignment OR test OR exam OR quiz OR project OR due OR deadline OR submit OR hand-in OR assessment OR notice OR reminder OR important OR newsletter OR NCEA OR term OR class OR teacher)');
  }

  parts.push('-from:classroom.google.com');
  parts.push('-from:no-reply@classroom.google.com');

  parts.push(`newer_than:${days}d`);
  return parts.join(' ');
}

function parseGmailMessage(msg){
  const headers = msg.payload?.headers || [];
  const get = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
  const subject = sanitiseText(get('Subject'), 220);
  const from = sanitiseText(get('From'), 200);
  const date = Number(msg.internalDate) || now();
  let body = '';
  const walk = part => {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data){ body += base64UrlDecode(part.body.data) + '\n'; }
    else if (part.parts){ part.parts.forEach(walk); }
  };
  walk(msg.payload);
  if (!body && msg.payload?.body?.data) body = base64UrlDecode(msg.payload.body.data);
  if (!body && msg.snippet) body = msg.snippet;
  return { subject, from, date, body: sanitiseText(body, 3000) };
}

function base64UrlDecode(data){
  try {
    const s = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}

async function syncGmail(){
  if (!GoogleServices.has()) throw new Error('NOT_SIGNED_IN');
  if (!GoogleServices.hasScope('https://www.googleapis.com/auth/gmail.readonly')){
    throw new Error('GMAIL_SCOPE_MISSING');
  }
  const token = GoogleServices.accessToken;
  const q = buildGmailQuery();
  console.log('[StudentOS] Gmail query:', q);

  const list = await gfetchJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`, token);
  const ids = (list.messages || []).map(m => m.id);
  console.log(`[StudentOS] Gmail found ${ids.length} matching messages`);

  const rawAssignments = [];
  let skippedClassroom = 0;
  for (const id of ids){
    try {
      const localId = `gm-${id}`;
      if (Store.isDeleted(localId)) continue;
      const msg = await gfetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, token);
      const parsed = parseGmailMessage(msg);
      if (!parsed) continue;

      const fromLower = (parsed.from || '').toLowerCase();
      const bodyLower = (parsed.body || '').toLowerCase();
      const looksLikeClassroomNotification =
        fromLower.includes('classroom.google.com') ||
        fromLower.includes('classroom-noreply@') ||
        (/\bnew (assignment|material|announcement|question)\b/i.test(parsed.subject) &&
         bodyLower.includes('classroom.google.com'));
      if (looksLikeClassroomNotification){
        console.log(`[StudentOS] Skipping Classroom notification: "${parsed.subject}"`);
        skippedClassroom++;
        continue;
      }

      const haystack = `${parsed.subject} ${parsed.body}`;
      const type = detectType(haystack);
      const hasDeadline = /\b(due|deadline|by \w+day|hand in|submit|exam|test|assessment|reminder)\b/i.test(haystack);
      const isSchoolRelated = /\b(homework|assignment|test|exam|quiz|project|notice|reminder|term|class|teacher|school|assessment|ncea|submit|deadline|due)\b/i.test(haystack);
      const acceptableType = ['Assignment','Homework','Test','Exam','Project','Reminder','Event','School Notice','Announcement'].includes(type);
      if (!hasDeadline && !isSchoolRelated && !acceptableType) {
        console.log(`[StudentOS] Skipping "${parsed.subject}" — type=${type}`);
        continue;
      }
      rawAssignments.push({
        id: localId,
        title: parsed.subject || 'Email',
        description: (parsed.from ? `From ${parsed.from}\n\n` : '') + parsed.body.slice(0, 1500),
        dueDate: parseDate(haystack, new Date(parsed.date)),
        url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
        typeHint: type === 'Reminder' ? null : type,
        subject: detectSubject(haystack),
        source: 'Email'
      });
    } catch (e){ console.warn(`Failed to read message ${id}:`, e.message); }
  }
  console.log(`[StudentOS] Gmail passing filter: ${rawAssignments.length} (skipped ${skippedClassroom} Classroom notifications)`);
  const r = await importItems(rawAssignments, 'Email');
  Store.cache.integrations.email = {
    id: 'email', connected: true, lastSync: now(),
    imported: Store.all('assignments').filter(x => (x.sources||[]).some(s => s.source === 'Email')).length,
    scanned: ids.length,
    accepted: rawAssignments.length,
    skippedClassroom,
    query: q
  };
  await Store.saveUserDoc();
  return { added: r.added, merged: r.merged, scanned: ids.length, accepted: rawAssignments.length, skippedClassroom };
}

/* ── Dedupe & import ──────────────────────────────────────── */
function tokenSet(s){
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}
function jaccard(a, b){
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
function findDuplicate(incoming, pool){
  const tIn = tokenSet(incoming.title);
  for (const existing of pool){
    if (existing.manual) continue;
    const tEx = tokenSet(existing.title);
    if (jaccard(tIn, tEx) < 0.5) continue;
    const subjMatch = !incoming.subject || !existing.subject || incoming.subject.toLowerCase() === existing.subject.toLowerCase();
    if (!subjMatch) continue;
    if (incoming.dueDate && existing.dueDate){
      const diffDays = Math.abs(incoming.dueDate - existing.dueDate) / 86400000;
      if (diffDays > 3) continue;
    }
    return existing;
  }
  return null;
}
function mergeInto(existing, incoming){
  const sources = existing.sources || [];
  if (!sources.some(s => s.source === incoming.source && s.url === incoming.url)){
    sources.push({ source: incoming.source, url: incoming.url || '', addedAt: now() });
  }
  return {
    ...existing, sources,
    dueDate: existing.manual && existing.dueDate ? existing.dueDate : (existing.dueDate || incoming.dueDate),
    description: (existing.description && existing.description.length > (incoming.description||'').length) ? existing.description : (incoming.description || existing.description),
    subject: existing.subject || incoming.subject,
    type: existing.type !== 'Other' ? existing.type : incoming.type,
    priority: computePriority({ ...existing, dueDate: existing.dueDate || incoming.dueDate }),
    mergedCount: (existing.mergedCount || 1) + 1
  };
}

async function importItems(rawItems, sourceLabel){
  let added = 0, merged = 0;
  for (const raw of rawItems){
    if (Store.isDeleted(raw.id)) continue;
    const cleanTitle = sanitiseText(raw.title, 220) || 'Untitled item';
    const cleanDesc  = sanitiseText(raw.description, 4000);
    const haystack = `${cleanTitle} ${cleanDesc}`;
    const type = raw.typeHint || raw.type || detectType(haystack);
    const subject = normalizeSubject(raw.subject || detectSubject(haystack));
    const dueDate = raw.dueDate || parseDate(haystack);

    const candidate = {
      id: raw.id || uid(),
      title: cleanTitle, description: cleanDesc, type, subject,
      dueDate: dueDate || null,
      source: sourceLabel, url: raw.url || '',
      sources: raw.sources || [{ source: sourceLabel, url: raw.url || '', addedAt: now() }],
      completed: false, manual: false, priority: 'low',
      createdAt: now()
    };
    candidate.priority = computePriority(candidate);

    if (dueDate){
      const dayKey = startOfDay(new Date(dueDate));
      const normalized = normalizeTitle(cleanTitle);
      const exactDup = Store.all('assignments').find(a => {
        if (!a.dueDate) return false;
        if (startOfDay(new Date(a.dueDate)) !== dayKey) return false;
        return normalizeTitle(a.title) === normalized;
      });
      if (exactDup){
        const mergedRecord = mergeInto(exactDup, candidate);
        const idx = Store.cache.assignments.findIndex(x => x.id === exactDup.id);
        if (idx >= 0) Store.cache.assignments.splice(idx, 1);
        await Store.put('assignments', mergedRecord);
        merged++; continue;
      }
    }
    const dup = findDuplicate(candidate, Store.all('assignments'));
    if (dup){ await Store.put('assignments', mergeInto(dup, candidate)); merged++; }
    else {
      await Store.put('assignments', candidate);
      if (candidate.dueDate || candidate.type === 'Test' || candidate.type === 'Exam') await maybeNotify(candidate);
      added++;
    }
  }
  return { added, merged };
}

/* ── Notifications ────────────────────────────────────────── */
async function pushNotification({ kind, title, body='', link='', dedupeKey='' }){
  if (dedupeKey){
    const dupe = Store.all('notifications').find(n => n.dedupeKey === dedupeKey && (now() - n.createdAt) < 7*86400000);
    if (dupe) return null;
  }
  const n = { id: uid(), kind, title: sanitiseText(title, 200), body: sanitiseText(body, 400), link, read: false, dedupeKey, createdAt: now() };
  await Store.put('notifications', n);
  renderNotifDot();
  if ($('#notif-panel') && !$('#notif-panel').hidden) renderNotifPanel();
  return n;
}

async function maybeNotify(item){
  const s = Store.cache.settings;
  if (item.type === 'Test' || item.type === 'Exam'){
    if (s.notifyNewTest){
      await pushNotification({ kind:'test', title:`New ${item.type.toLowerCase()}: ${item.title}`,
        body: item.dueDate ? `On ${fmtDateLong(item.dueDate)}${item.subject ? ' · ' + item.subject : ''}` : '',
        link:'#/assignments', dedupeKey:`test:${item.title}:${item.dueDate || ''}` });
    }
    return;
  }
  if (s.notifyNewAssignment){
    await pushNotification({ kind:'assignment', title:`New ${item.type.toLowerCase()}: ${item.title}`,
      body: item.dueDate ? `Due ${fmtDateLong(item.dueDate)}${item.subject ? ' · ' + item.subject : ''}` : '',
      link:'#/assignments', dedupeKey:`new:${item.title}:${item.dueDate || ''}` });
  }
}

async function checkDueSoon(){
  if (!Store.cache.settings.notifyDueSoon) return;
  for (const a of Store.all('assignments')){
    if (a.completed || !a.dueDate) continue;
    const d = daysUntil(a.dueDate);
    if (d === 0 || d === 1){
      await pushNotification({ kind:'due', title:`${a.title} is due ${d === 0 ? 'today' : 'tomorrow'}`,
        body: a.subject ? `${a.subject} · ${a.type}` : a.type,
        link:'#/assignments', dedupeKey:`due:${a.id}:${startOfDay(new Date(a.dueDate))}` });
    }
  }
}

/* ── Master sync ──────────────────────────────────────────── */
let syncing = false;
async function syncAll({ silent = false } = {}){
  if (syncing) return;
  syncing = true;
  setSyncUI('busy', 'Syncing…');
  const results = [], errors = [];

  try {
    const r = await syncCalendarSubscriptions();
    if (r.added) results.push(`Calendar: ${r.added} new`);
    for (const e of r.errors) errors.push(e);
  } catch (e){ errors.push(`Calendar: ${e.message}`); }

  if (GoogleServices.has()){
    try {
      const r = await syncClassroom();
      if (r.added || r.merged) results.push(`Classroom: ${r.added} new${r.merged ? `, ${r.merged} merged` : ''}`);
    } catch (e){
      if (e.message === 'TOKEN_EXPIRED' || e.message === 'NOT_SIGNED_IN'){
        errors.push('Google session expired — click Sync to reconnect.');
      } else if (e.message === 'ACCESS_BLOCKED'){
        errors.push('Classroom access blocked by your school admin.');
      } else {
        errors.push(`Classroom: ${e.message}`);
      }
    }

    try {
      const r = await syncGmail();
      if (r.added || r.merged) results.push(`Email: ${r.added} new (${r.accepted}/${r.scanned} matched)`);
      else if (r.scanned === 0) results.push('Email: no messages matched');
      else results.push(`Email: scanned ${r.scanned}, 0 new`);
    } catch (e){
      if (e.message === 'GMAIL_SCOPE_MISSING'){
        errors.push('Gmail permission missing — click Sync to reconnect.');
      } else if (e.message === 'TOKEN_EXPIRED'){
        errors.push('Google session expired — click Sync to reconnect.');
      } else if (e.message === 'ACCESS_BLOCKED'){
        errors.push('Gmail access blocked by your school admin.');
      } else {
        errors.push(`Email: ${e.message}`);
      }
    }
  } else {
    if (!silent) errors.push('Not connected to Google — click Sync to reconnect.');
  }

  await dedupeExistingAssignments();
  await checkDueSoon();
  syncing = false;

  for (const err of errors) toast(err, 'error', 'Sync problem');

  if (!errors.length){
    setSyncUI('ok', `Synced ${relativeTime(now())}`);
    if (!silent && results.length) toast(results.join(' · '), 'success', 'Sync complete');
    else if (!silent) toast('Everything up to date', 'success');
  } else {
    setSyncUI('err', GoogleServices.has() ? 'Sync issue' : 'Reconnect Google');
  }
  render();
  return { results, errors };
}

async function dedupeExistingAssignments(){
  const items = Store.all('assignments');
  const seen = new Map();
  const toRemove = [];
  for (const item of items){
    if (!item.dueDate) continue;
    const dayKey = startOfDay(new Date(item.dueDate));
    const normalized = normalizeTitle(item.title);
    const key = `${normalized}|${dayKey}`;
    if (seen.has(key)){
      const existing = seen.get(key);
      const existingScore = (existing.manual ? 100 : 0) + (existing.sources?.length || 0) * 5 + (existing.description?.length || 0);
      const newScore = (item.manual ? 100 : 0) + (item.sources?.length || 0) * 5 + (item.description?.length || 0);
      if (newScore > existingScore){ toRemove.push(existing.id); seen.set(key, item); }
      else { toRemove.push(item.id); }
    } else { seen.set(key, item); }
  }
  for (const id of toRemove) await Store.remove('assignments', id);
  return toRemove.length;
}

function setSyncUI(state, text){
  const chip = $('#sync-status');
  const txt = $('#sync-status .sync-text');
  if (txt) txt.textContent = text;
  if (chip){ chip.classList.remove('ok','busy','err'); if (state) chip.classList.add(state); }
}

/* ── App state ────────────────────────────────────────────── */
const App = {
  user: null, route: '#/dashboard',
  filters: { assignments: 'all', search: '', subject: 'all', sort: 'due' },
  calMonth: new Date().getMonth(), calYear: new Date().getFullYear(),
  hiddenSeries: new Set()
};

function render(){
  const route = (location.hash || '#/dashboard').split('?')[0];
  App.route = route;
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === route));
  const view = $('#view');
  if (!view) return;
  switch(route){
    case '#/assignments': view.innerHTML = viewAssignments(); break;
    case '#/calendar': view.innerHTML = viewCalendar(); break;
    case '#/effort': view.innerHTML = viewEffort(); break;
    case '#/planner': view.innerHTML = viewPlanner(); break;
    case '#/settings': view.innerHTML = viewSettings(); break;
    default: view.innerHTML = viewDashboard();
  }
  bindViewEvents();
  updateBadges();
}

function updateBadges(){
  const open = Store.all('assignments').filter(a => !a.completed && a.dueDate && daysUntil(a.dueDate) >= 0).length;
  const badge = $('#badge-assignments');
  if (badge){ badge.textContent = open; badge.hidden = open === 0; }
  const unread = Store.all('notifications').filter(n => !n.read).length;
  const dot = $('#notif-dot');
  if (dot) dot.hidden = unread === 0;
}
