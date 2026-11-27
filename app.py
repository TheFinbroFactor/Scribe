import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import time
from functools import wraps

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_auth_requests
except ImportError:  # pragma: no cover - dependency error is surfaced at runtime
    google_id_token = None
    google_auth_requests = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _env(name, default=''):
    # Scribe settings are SCRIBE_*. Older installs used STUDENTOS_*, which still work.
    return os.environ.get('SCRIBE_' + name, os.environ.get('STUDENTOS_' + name, default))

DATA_DIR = _env('DATA_DIR', os.path.join(ROOT, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'scribe.db')
LEGACY_DB_PATH = os.path.join(DATA_DIR, 'studentos.db')
SESSION_DAYS = 30
COLLECTIONS = {
    'assignments', 'events', 'weeklyNotes', 'notifications',
    'courses', 'studySessions', 'effortReports', 'results'
}

GOOGLE_CLIENT_ID = _env('GOOGLE_CLIENT_ID', '').strip()
GLOBAL_ADMIN_EMAILS = {
    x.strip().lower() for x in _env('GLOBAL_ADMIN_EMAILS', '').split(',') if x.strip()
}
DEFAULT_SCHOOL_NAME = _env('DEFAULT_SCHOOL_NAME', '').strip()
DEFAULT_SCHOOL_SLUG = _env('DEFAULT_SCHOOL_SLUG', '').strip()
DEFAULT_SCHOOL_DOMAINS = [
    x.strip().lower().lstrip('@')
    for x in _env('DEFAULT_SCHOOL_DOMAINS', '').split(',')
    if x.strip()
]
DEFAULT_SCHOOL_ADMIN_EMAILS = [
    x.strip().lower()
    for x in _env('DEFAULT_SCHOOL_ADMIN_EMAILS', '').split(',')
    if x.strip()
]

DEFAULT_SIDEBAR_FEATURES = [
    'assignments', 'calendar', 'weekly', 'effort', 'planner', 'pathways', 'results', 'integrations'
]

app = Flask(__name__, static_folder=None)
app.secret_key = _env(
    'SECRET_KEY',
    'change-this-secret-before-public-deployment'
)


def db():
    os.makedirs(DATA_DIR, exist_ok=True)
    # Keep existing school data when upgrading from the StudentOS name.
    if not os.path.exists(DB_PATH) and os.path.exists(LEGACY_DB_PATH):
        shutil.copy2(LEGACY_DB_PATH, DB_PATH)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys = ON')
    return c


def slugify(value):
    value = str(value or '').strip().lower()
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')
    return value[:80]


def normalise_domain(value):
    value = str(value or '').strip().lower()
    if '@' in value:
        value = value.rsplit('@', 1)[1]
    value = value.strip().lstrip('@').rstrip('.')
    return value


def list_from_json(raw):
    try:
        value = json.loads(raw or '[]')
        return value if isinstance(value, list) else []
    except Exception:
        return []


def dict_from_json(raw):
    try:
        value = json.loads(raw or '{}')
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def init_db():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS schools (
            id TEXT PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            logo_url TEXT NOT NULL DEFAULT '',
            domains_json TEXT NOT NULL DEFAULT '[]',
            calendar_json TEXT NOT NULL DEFAULT '[]',
            admin_emails_json TEXT NOT NULL DEFAULT '[]',
            settings_json TEXT NOT NULL DEFAULT '{}',
            allow_personal_accounts INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            school_id TEXT,
            email TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT,
            display_name TEXT NOT NULL DEFAULT 'Student',
            photo_url TEXT NOT NULL DEFAULT '',
            google_sub TEXT,
            role TEXT NOT NULL DEFAULT 'student',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(school_id) REFERENCES schools(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS documents (
            user_id TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            document_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(user_id, collection_name, document_id),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_state (
            user_id TEXT PRIMARY KEY,
            settings_json TEXT NOT NULL DEFAULT '{}',
            integrations_json TEXT NOT NULL DEFAULT '{}',
            profile_json TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_documents_user_collection ON documents(user_id, collection_name);
        CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
        ''' )

        # Safe migrations for databases created by earlier Scribe builds.
        columns = {row['name'] for row in c.execute('PRAGMA table_info(users)').fetchall()}
        migrations = [
            ('school_id', 'TEXT'),
            ('google_sub', 'TEXT'),
            ('role', "TEXT NOT NULL DEFAULT 'student'"),
        ]
        for name, declaration in migrations:
            if name not in columns:
                c.execute(f'ALTER TABLE users ADD COLUMN {name} {declaration}')

        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL')
        ensure_default_school(c)


def ensure_default_school(c):
    if not DEFAULT_SCHOOL_NAME:
        return None
    slug = DEFAULT_SCHOOL_SLUG or slugify(DEFAULT_SCHOOL_NAME)
    now_ts = int(time.time())
    row = c.execute('SELECT * FROM schools WHERE slug=?', (slug,)).fetchone()
    if row:
        return row
    c.execute('''
        INSERT INTO schools(
            id, slug, name, domains_json, calendar_json, admin_emails_json,
            settings_json, allow_personal_accounts, active, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ''', (
        secrets.token_hex(12), slug, DEFAULT_SCHOOL_NAME,
        json.dumps(DEFAULT_SCHOOL_DOMAINS), json.dumps([]),
        json.dumps(DEFAULT_SCHOOL_ADMIN_EMAILS),
        json.dumps({'defaultSidebarFeatures': DEFAULT_SIDEBAR_FEATURES}),
        0, 1, now_ts, now_ts
    ))
    return c.execute('SELECT * FROM schools WHERE slug=?', (slug,)).fetchone()


def school_json(row, public=False):
    if not row:
        return None
    settings = dict_from_json(row['settings_json'])
    default_sidebar = settings.get('defaultSidebarFeatures')
    if not isinstance(default_sidebar, list):
        default_sidebar = DEFAULT_SIDEBAR_FEATURES
    calendars = list_from_json(row['calendar_json'])
    normalised_calendars = []
    for item in calendars:
        if isinstance(item, str):
            normalised_calendars.append({
                'id': 'school-calendar-' + secrets.token_hex(3),
                'name': 'School Calendar',
                'url': item,
                'builtin': True,
            })
        elif isinstance(item, dict) and item.get('url'):
            normalised_calendars.append({
                'id': item.get('id') or 'school-calendar-' + secrets.token_hex(3),
                'name': item.get('name') or 'School Calendar',
                'url': item['url'],
                'builtin': True,
            })
    payload = {
        'id': row['id'],
        'slug': row['slug'],
        'name': row['name'],
        'logoUrl': row['logo_url'],
        'domains': list_from_json(row['domains_json']),
        'allowPersonalAccounts': bool(row['allow_personal_accounts']),
        'calendarSubscriptions': normalised_calendars,
        'defaultSidebarFeatures': default_sidebar,
        'enableClassroom': bool(settings.get('enableClassroom', True)),
        'enableGmail': bool(settings.get('enableGmail', True)),
    }
    if not public:
        payload['adminEmails'] = list_from_json(row['admin_emails_json'])
    return payload


def all_active_schools(c):
    return c.execute('SELECT * FROM schools WHERE active=1 ORDER BY name COLLATE NOCASE').fetchall()


def find_school_by_slug(c, slug):
    if not slug:
        return None
    return c.execute('SELECT * FROM schools WHERE slug=? AND active=1', (slug,)).fetchone()


def find_schools_for_email(c, email):
    domain = normalise_domain(email)
    matches = []
    for row in all_active_schools(c):
        domains = {normalise_domain(x) for x in list_from_json(row['domains_json'])}
        if domain and domain in domains:
            matches.append(row)
    return matches


def school_allows_email(school, email):
    if not school:
        return False
    if bool(school['allow_personal_accounts']):
        return True
    domain = normalise_domain(email)
    domains = {normalise_domain(x) for x in list_from_json(school['domains_json'])}
    return bool(domain and domain in domains)


def user_from_token():
    token = request.cookies.get('scribe_session')
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now_ts = int(time.time())
    with db() as c:
        row = c.execute('''
            SELECT u.*, s.slug AS school_slug, s.name AS school_name,
                   s.logo_url AS school_logo_url, s.domains_json AS school_domains_json,
                   s.admin_emails_json AS school_admin_emails_json
            FROM sessions sess
            JOIN users u ON u.id=sess.user_id
            LEFT JOIN schools s ON s.id=u.school_id
            WHERE sess.token_hash=? AND sess.expires_at>?
        ''', (token_hash, now_ts)).fetchone()
        if not row:
            c.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash,))
            return None
        result = dict(row)
        email = str(result.get('email') or '').lower()
        if email in GLOBAL_ADMIN_EMAILS:
            result['role'] = 'global_admin'
        elif result.get('school_admin_emails_json'):
            admins = {str(x).strip().lower() for x in list_from_json(result['school_admin_emails_json'])}
            result['role'] = 'school_admin' if email in admins else 'student'
        else:
            result['role'] = 'student'
        return result


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = user_from_token()
        if not user:
            return jsonify(error='Not signed in', code='NOT_SIGNED_IN'), 401
        request.user = user
        return fn(*args, **kwargs)
    return wrapper


def role_is_admin(user):
    return user and user.get('role') in {'global_admin', 'school_admin'}


def global_admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if request.user.get('role') != 'global_admin':
            return jsonify(error='Administrator access required.', code='ADMIN_REQUIRED'), 403
        return fn(*args, **kwargs)
    return wrapper


def school_admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if not role_is_admin(request.user):
            return jsonify(error='School administrator access required.', code='ADMIN_REQUIRED'), 403
        return fn(*args, **kwargs)
    return wrapper


def issue_session(user_id):
    token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now_ts = int(time.time())
    expires = now_ts + SESSION_DAYS * 86400
    with db() as c:
        c.execute(
            'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',
            (token_hash, user_id, expires, now_ts)
        )
    return token


def user_json(row):
    school = None
    if row.get('school_id') and row.get('school_name'):
        school = {
            'id': row['school_id'],
            'slug': row.get('school_slug') or '',
            'name': row['school_name'],
            'logoUrl': row.get('school_logo_url') or '',
        }
    return {
        'uid': row['id'],
        'email': row['email'],
        'displayName': row['display_name'],
        'photoURL': row['photo_url'],
        'role': row.get('role') or 'student',
        'school': school,
    }


def response_with_login(user):
    token = issue_session(user['id'])
    with db() as c:
        fresh = c.execute('''
            SELECT u.*, s.slug AS school_slug, s.name AS school_name,
                   s.logo_url AS school_logo_url, s.admin_emails_json AS school_admin_emails_json
            FROM users u LEFT JOIN schools s ON s.id=u.school_id WHERE u.id=?
        ''', (user['id'],)).fetchone()
    resp = jsonify(user=user_json(dict(fresh)))
    resp.set_cookie(
        'scribe_session', token,
        httponly=True,
        secure=request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https',
        samesite='Lax',
        max_age=SESSION_DAYS * 86400,
        path='/'
    )
    return resp


def school_public_from_request():
    hint = str(request.args.get('school', '')).strip().lower()
    with db() as c:
        row = find_school_by_slug(c, hint) if hint else None
        if not row:
            schools = all_active_schools(c)
            if len(schools) == 1:
                row = schools[0]
        return school_json(row, public=True), [
            {'slug': r['slug'], 'name': r['name'], 'logoUrl': r['logo_url']}
            for r in all_active_schools(c)
        ]


@app.get('/api/health')
def health():
    with db() as c:
        schools = c.execute('SELECT COUNT(*) AS n FROM schools WHERE active=1').fetchone()['n']
    return jsonify(ok=True, database=os.path.basename(DB_PATH), schools=schools)


@app.get('/api/public/config')
def public_config():
    school, schools = school_public_from_request()
    return jsonify(
        productName='Scribe',
        googleConfigured=bool(GOOGLE_CLIENT_ID),
        school=school,
        schools=schools,
    )


@app.get('/api/auth/google-config')
def google_config():
    school, schools = school_public_from_request()
    return jsonify(
        clientId=GOOGLE_CLIENT_ID,
        configured=bool(GOOGLE_CLIENT_ID),
        school=school,
        schools=schools,
    )


@app.post('/api/auth/google')
def signin_google():
    body = request.get_json(silent=True) or {}
    credential = str(body.get('credential', '')).strip()
    requested_slug = str(body.get('schoolSlug', '')).strip().lower()

    if not credential:
        return jsonify(error='Google did not return a sign-in credential.', code='GOOGLE_CREDENTIAL_MISSING'), 400
    if not GOOGLE_CLIENT_ID:
        return jsonify(
            error='Google sign-in is not configured on this Scribe site yet.',
            code='GOOGLE_NOT_CONFIGURED'
        ), 503
    if google_id_token is None or google_auth_requests is None:
        return jsonify(
            error='Google sign-in support is not installed on this Scribe server.',
            code='GOOGLE_SUPPORT_MISSING'
        ), 503

    try:
        info = google_id_token.verify_oauth2_token(
            credential, google_auth_requests.Request(), GOOGLE_CLIENT_ID
        )
    except Exception:
        return jsonify(
            error='Google sign-in could not be verified. Please try again.',
            code='GOOGLE_VERIFICATION_FAILED'
        ), 401

    google_sub = str(info.get('sub', '')).strip()
    email = str(info.get('email', '')).strip().lower()
    if not google_sub or not email or not bool(info.get('email_verified')):
        return jsonify(
            error='Google did not provide a verified email address.',
            code='GOOGLE_EMAIL_NOT_VERIFIED'
        ), 401

    with db() as c:
        school = find_school_by_slug(c, requested_slug) if requested_slug else None
        matching = find_schools_for_email(c, email)

        if school:
            if not school_allows_email(school, email):
                return jsonify(
                    error='That Google account is not associated with this school.',
                    code='SCHOOL_EMAIL_NOT_ALLOWED',
                    school=school_json(school, public=True)
                ), 403
        elif len(matching) == 1:
            school = matching[0]
        elif len(matching) > 1:
            return jsonify(
                error='Please choose which school you attend.',
                code='SCHOOL_SELECTION_REQUIRED',
                schools=[school_json(x, public=True) for x in matching]
            ), 409
        else:
            personal_schools = [x for x in all_active_schools(c) if bool(x['allow_personal_accounts'])]
            if len(personal_schools) == 1:
                school = personal_schools[0]
            elif len(personal_schools) > 1:
                return jsonify(
                    error='Please choose your school to continue.',
                    code='SCHOOL_SELECTION_REQUIRED',
                    schools=[school_json(x, public=True) for x in personal_schools]
                ), 409
            elif email in GLOBAL_ADMIN_EMAILS:
                # A global administrator may sign in before the first school
                # exists so they can create/configure schools from the UI.
                school = None
            else:
                return jsonify(
                    error='Your school has not been connected to Scribe yet.',
                    code='SCHOOL_NOT_CONFIGURED'
                ), 403

        display_name = str(info.get('name') or email.split('@')[0] or 'Student').strip()[:120]
        photo_url = str(info.get('picture') or '').strip()[:1000]
        now_ts = int(time.time())

        if school:
            user = c.execute(
                'SELECT * FROM users WHERE school_id=? AND google_sub=?',
                (school['id'], google_sub)
            ).fetchone()
            if not user:
                user = c.execute(
                    'SELECT * FROM users WHERE school_id=? AND email=?',
                    (school['id'], email)
                ).fetchone()
        elif email in GLOBAL_ADMIN_EMAILS:
            user = c.execute(
                'SELECT * FROM users WHERE google_sub=? OR email=? LIMIT 1',
                (google_sub, email)
            ).fetchone()
        else:
            user = None
        if not user:
            # Keep school memberships isolated. An email/google account already
            # belonging to another school must never be silently moved.
            existing_elsewhere = c.execute(
                'SELECT * FROM users WHERE email=? OR google_sub=? LIMIT 1',
                (email, google_sub)
            ).fetchone()
            if school and existing_elsewhere:
                if existing_elsewhere['school_id'] is None:
                    user = existing_elsewhere
                    c.execute('UPDATE users SET school_id=?,updated_at=? WHERE id=?', (school['id'], int(time.time()), user['id']))
                elif existing_elsewhere['school_id'] != school['id']:
                    return jsonify(
                        error='This Google account is already associated with another Scribe school. Please contact your Scribe administrator.',
                        code='GOOGLE_ACCOUNT_ALREADY_LINKED',
                        school=school_json(school, public=True)
                    ), 409

        role = 'global_admin' if email in GLOBAL_ADMIN_EMAILS else (
            'school_admin' if school and email in {x.lower() for x in list_from_json(school['admin_emails_json'])} else 'student'
        )

        if user:
            c.execute('''
                UPDATE users SET school_id=?, google_sub=?, display_name=?, photo_url=?, role=?, updated_at=?
                WHERE id=?
            ''', (school['id'] if school else user['school_id'], google_sub, display_name or user['display_name'], photo_url or user['photo_url'], role, now_ts, user['id']))
            uid = user['id']
        else:
            uid = 'g-' + secrets.token_hex(16)
            c.execute('''
                INSERT INTO users(
                    id,school_id,email,password_hash,display_name,photo_url,google_sub,role,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
            ''', (
                uid, school['id'] if school else None, email, None, display_name, photo_url,
                google_sub, role, now_ts, now_ts
            ))
            c.execute('INSERT INTO user_state(user_id,updated_at) VALUES(?,?)', (uid, now_ts))

        user = c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()

    return response_with_login(user)


@app.post('/api/auth/signup')
def signup():
    body = request.get_json(silent=True) or {}
    email = str(body.get('email', '')).strip().lower()
    password = str(body.get('password', ''))
    name = str(body.get('name', '')).strip() or 'Student'
    school_slug = str(body.get('schoolSlug', '')).strip().lower()
    if '@' not in email or len(email) < 5:
        return jsonify(error='Please enter a valid email.'), 400
    if len(password) < 6:
        return jsonify(error='Passwords must be at least 6 characters.'), 400
    if len(name) > 120:
        return jsonify(error='Name is too long.'), 400

    now_ts = int(time.time())
    uid = secrets.token_hex(16)
    try:
        with db() as c:
            schools = all_active_schools(c)
            school = find_school_by_slug(c, school_slug) if school_slug else (schools[0] if len(schools) == 1 else None)
            if school and not school_allows_email(school, email):
                return jsonify(error='That email is not associated with this school.'), 403
            c.execute('''
                INSERT INTO users(id,school_id,email,password_hash,display_name,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?)
            ''', (
                uid, school['id'] if school else None, email,
                generate_password_hash(password), name, now_ts, now_ts
            ))
            c.execute('INSERT INTO user_state(user_id,updated_at) VALUES(?,?)', (uid, now_ts))
            user = c.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
    except sqlite3.IntegrityError:
        return jsonify(error='That email is already registered. Sign in instead.'), 409
    return response_with_login(user)


@app.post('/api/auth/signin')
def signin():
    body = request.get_json(silent=True) or {}
    email = str(body.get('email', '')).strip().lower()
    password = str(body.get('password', ''))
    requested_slug = str(body.get('schoolSlug', '')).strip().lower()
    with db() as c:
        school = find_school_by_slug(c, requested_slug) if requested_slug else None
        if school:
            user = c.execute('SELECT * FROM users WHERE school_id=? AND email=?', (school['id'], email)).fetchone()
        else:
            matches = c.execute('SELECT * FROM users WHERE email=? ORDER BY created_at', (email,)).fetchall()
            user = matches[0] if len(matches) == 1 else None
        # Legacy account: attach it to the only configured school when safe.
        if user and user['school_id'] is None:
            schools = all_active_schools(c)
            if len(schools) == 1 and school_allows_email(schools[0], email):
                c.execute('UPDATE users SET school_id=?,updated_at=? WHERE id=?', (schools[0]['id'], int(time.time()), user['id']))
                user = c.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
    if not user or not user['password_hash'] or not check_password_hash(user['password_hash'], password):
        return jsonify(error='Incorrect email or password.'), 401
    return response_with_login(user)


@app.get('/api/auth/me')
def me():
    user = user_from_token()
    if not user:
        return jsonify(user=None), 200
    return jsonify(user=user_json(user))


@app.post('/api/auth/signout')
def signout():
    token = request.cookies.get('scribe_session')
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with db() as c:
            c.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash,))
    resp = jsonify(ok=True)
    resp.delete_cookie('scribe_session', path='/')
    return resp


def current_school_row(c):
    school_id = request.user.get('school_id')
    return c.execute('SELECT * FROM schools WHERE id=? AND active=1', (school_id,)).fetchone() if school_id else None


@app.get('/api/data')
@login_required
def get_data():
    uid = request.user['id']
    data = {k: [] for k in COLLECTIONS}
    data.update(integrations={}, settings={}, profile={})
    with db() as c:
        rows = c.execute(
            'SELECT collection_name,document_id,data_json FROM documents WHERE user_id=?',
            (uid,)
        ).fetchall()
        for r in rows:
            try:
                data[r['collection_name']].append(json.loads(r['data_json']))
            except Exception:
                pass
        state = c.execute('SELECT * FROM user_state WHERE user_id=?', (uid,)).fetchone()
        if state:
            for key, col in [
                ('settings', 'settings_json'),
                ('integrations', 'integrations_json'),
                ('profile', 'profile_json')
            ]:
                data[key] = dict_from_json(state[col])
        school = current_school_row(c)
        data['school'] = school_json(school, public=True) if school else None
    return jsonify(data=data)


@app.put('/api/data/<collection>/<document_id>')
@login_required
def put_data(collection, document_id):
    if collection not in COLLECTIONS:
        return jsonify(error='Unknown collection'), 400
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error='Document must be an object'), 400
    if len(document_id) > 200:
        return jsonify(error='Document ID is too long'), 400
    uid = request.user['id']
    now_ts = int(time.time())
    payload = json.dumps(body, separators=(',', ':'))
    with db() as c:
        old = c.execute('''
            SELECT created_at FROM documents
            WHERE user_id=? AND collection_name=? AND document_id=?
        ''', (uid, collection, document_id)).fetchone()
        created = old['created_at'] if old else now_ts
        c.execute('''
            INSERT INTO documents(user_id,collection_name,document_id,data_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(user_id,collection_name,document_id)
            DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at
        ''', (uid, collection, document_id, payload, created, now_ts))
    return jsonify(ok=True, data=body)


@app.delete('/api/data/<collection>/<document_id>')
@login_required
def delete_data(collection, document_id):
    if collection not in COLLECTIONS:
        return jsonify(error='Unknown collection'), 400
    with db() as c:
        c.execute('''
            DELETE FROM documents
            WHERE user_id=? AND collection_name=? AND document_id=?
        ''', (request.user['id'], collection, document_id))
    return jsonify(ok=True)


@app.delete('/api/data')
@login_required
def delete_all_data():
    with db() as c:
        c.execute('DELETE FROM documents WHERE user_id=?', (request.user['id'],))
        c.execute('''
            UPDATE user_state
            SET integrations_json=?,updated_at=?
            WHERE user_id=?
        ''', ('{}', int(time.time()), request.user['id']))
    return jsonify(ok=True)


@app.put('/api/user')
@login_required
def save_user_state():
    body = request.get_json(silent=True) or {}
    now_ts = int(time.time())
    with db() as c:
        c.execute('''
            INSERT INTO user_state(user_id,settings_json,integrations_json,profile_json,updated_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET
                settings_json=excluded.settings_json,
                integrations_json=excluded.integrations_json,
                profile_json=excluded.profile_json,
                updated_at=excluded.updated_at
        ''', (
            request.user['id'],
            json.dumps(body.get('settings', {})),
            json.dumps(body.get('integrations', {})),
            json.dumps(body.get('profile', {})),
            now_ts
        ))
    return jsonify(ok=True)


def school_from_body(body, existing=None):
    name = str(body.get('name', existing['name'] if existing else '')).strip()
    slug = slugify(body.get('slug', existing['slug'] if existing else name))
    if not name or not slug:
        raise ValueError('School name and slug are required.')
    domains = []
    raw_domains = body.get('domains', body.get('domainsCsv', []))
    if isinstance(raw_domains, str):
        raw_domains = raw_domains.replace('\n', ',').split(',')
    if isinstance(raw_domains, list):
        for item in raw_domains:
            d = normalise_domain(item)
            if d and d not in domains:
                domains.append(d)
    calendars = body.get('calendarSubscriptions', body.get('calendarUrls', []))
    if isinstance(calendars, str):
        calendars = [x.strip() for x in calendars.replace('\r', '').split('\n') if x.strip()]
    normalised_calendars = []
    if isinstance(calendars, list):
        for item in calendars:
            if isinstance(item, str):
                url = item.strip()
                label = 'School Calendar'
            elif isinstance(item, dict):
                url = str(item.get('url', '')).strip()
                label = str(item.get('name', 'School Calendar')).strip() or 'School Calendar'
            else:
                continue
            if url.startswith(('http://', 'https://')):
                normalised_calendars.append({
                    'id': 'school-calendar-' + secrets.token_hex(4),
                    'name': label,
                    'url': url,
                    'builtin': True,
                })
    admins = body.get('adminEmails', body.get('adminEmailsCsv', []))
    if isinstance(admins, str):
        admins = admins.replace('\n', ',').split(',')
    admin_emails = []
    if isinstance(admins, list):
        for item in admins:
            e = str(item).strip().lower()
            if e and '@' in e and e not in admin_emails:
                admin_emails.append(e)
    default_sidebar = body.get('defaultSidebarFeatures', DEFAULT_SIDEBAR_FEATURES)
    if not isinstance(default_sidebar, list):
        default_sidebar = list(DEFAULT_SIDEBAR_FEATURES)
    known_features = set(DEFAULT_SIDEBAR_FEATURES)
    default_sidebar = [x for x in default_sidebar if x in known_features]
    settings = {
        'defaultSidebarFeatures': default_sidebar or list(DEFAULT_SIDEBAR_FEATURES),
        'enableClassroom': bool(body.get('enableClassroom', True)),
        'enableGmail': bool(body.get('enableGmail', True)),
    }
    logo_url = str(body.get('logoUrl', existing['logo_url'] if existing else '')).strip()[:1000]
    allow_personal = bool(body.get('allowPersonalAccounts', bool(existing['allow_personal_accounts']) if existing else False))
    return {
        'name': name,
        'slug': slug,
        'domains': domains,
        'calendars': normalised_calendars,
        'admin_emails': admin_emails,
        'settings': settings,
        'logo_url': logo_url,
        'allow_personal': allow_personal,
    }


@app.get('/api/admin/schools')
@school_admin_required
def admin_schools():
    with db() as c:
        if request.user.get('role') == 'global_admin':
            rows = c.execute('SELECT * FROM schools ORDER BY name COLLATE NOCASE').fetchall()
        else:
            row = current_school_row(c)
            rows = [row] if row else []
        schools = [school_json(r, public=False) for r in rows if r]
    return jsonify(schools=schools)


@app.post('/api/admin/schools')
@global_admin_required
def admin_create_school():
    body = request.get_json(silent=True) or {}
    try:
        payload = school_from_body(body)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    now_ts = int(time.time())
    school_id = secrets.token_hex(12)
    try:
        with db() as c:
            c.execute('''
                INSERT INTO schools(
                    id,slug,name,logo_url,domains_json,calendar_json,admin_emails_json,
                    settings_json,allow_personal_accounts,active,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                school_id, payload['slug'], payload['name'], payload['logo_url'],
                json.dumps(payload['domains']), json.dumps(payload['calendars']),
                json.dumps(payload['admin_emails']), json.dumps(payload['settings']),
                int(payload['allow_personal']), 1, now_ts, now_ts
            ))
            row = c.execute('SELECT * FROM schools WHERE id=?', (school_id,)).fetchone()
    except sqlite3.IntegrityError:
        return jsonify(error='That school slug is already in use.'), 409
    return jsonify(school=school_json(row, public=False))


@app.put('/api/admin/schools/<school_id>')
@school_admin_required
def admin_update_school(school_id):
    with db() as c:
        row = c.execute('SELECT * FROM schools WHERE id=?', (school_id,)).fetchone()
        if not row:
            return jsonify(error='School not found.'), 404
        if request.user.get('role') != 'global_admin' and request.user.get('school_id') != school_id:
            return jsonify(error='You cannot edit another school.'), 403
        body = request.get_json(silent=True) or {}
        try:
            payload = school_from_body(body, existing=row)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        now_ts = int(time.time())
        try:
            c.execute('''
                UPDATE schools SET slug=?,name=?,logo_url=?,domains_json=?,calendar_json=?,
                    admin_emails_json=?,settings_json=?,allow_personal_accounts=?,updated_at=?
                WHERE id=?
            ''', (
                payload['slug'], payload['name'], payload['logo_url'],
                json.dumps(payload['domains']), json.dumps(payload['calendars']),
                json.dumps(payload['admin_emails']), json.dumps(payload['settings']),
                int(payload['allow_personal']), now_ts, school_id
            ))
        except sqlite3.IntegrityError:
            return jsonify(error='That school slug is already in use.'), 409
        row = c.execute('SELECT * FROM schools WHERE id=?', (school_id,)).fetchone()
    return jsonify(school=school_json(row, public=False))


@app.get('/api/admin/school')
@school_admin_required
def admin_current_school():
    with db() as c:
        row = current_school_row(c)
    if not row:
        return jsonify(school=None)
    return jsonify(school=school_json(row, public=False))


@app.post('/api/admin/schools/<school_id>/deactivate')
@global_admin_required
def admin_deactivate_school(school_id):
    with db() as c:
        c.execute('UPDATE schools SET active=0,updated_at=? WHERE id=?', (int(time.time()), school_id))
    return jsonify(ok=True)


# Static frontend: keep this app self-contained so Nginx Proxy Manager only needs one upstream.
@app.route('/', defaults={'path': 'index.html'})
@app.route('/<path:path>')
def static(path):
    frontend = ROOT
    if path.startswith('api/'):
        return jsonify(error='Not found'), 404
    return send_from_directory(frontend, path)


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=80)
else:
    init_db()
