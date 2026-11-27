# Scribe

Scribe is a self-hosted student dashboard designed to work across **multiple schools**. Students use a simple Google sign-in; Scribe keeps the student data in the local SQLite database and uses the selected school's settings to control branding, calendars, features and integrations.

## Architecture

```text
Student → Google sign-in → Scribe (Flask) → SQLite
                              │
                              ├─ School A settings
                              ├─ School B settings
                              └─ School C settings
```

- `index.html` — page markup
- `css/style.css` — styles
- `js/app.js` — frontend application logic
- `backend/app.py` — authentication, school management, API and database access
- `data/scribe.db` — persistent SQLite database (created at runtime)
- `docker-compose.yml` — local/CasaOS deployment

Firebase/Firestore is **not required**.

## Student sign-in

Students normally only see **Continue with Google**. They do not enter a Google Client ID, configure OAuth, or create a Scribe password.

Scribe verifies the Google account on the server and then chooses the school automatically:

1. If the Google email domain matches exactly one school's configured domain, that school is selected automatically.
2. If an administrator has supplied a school-specific URL such as `https://scribe.example.com/?school=school-slug`, the URL is used as a hint and the email is still checked against that school.
3. If a school allows personal Google accounts, Scribe can use that school when no domain match exists. If more than one school allows personal accounts, the student is shown a simple school chooser.
4. If the account does not belong to a configured school, the student is told that their school has not been connected yet.

The same Scribe installation can therefore serve many schools without changing the frontend code.

## Google setup for the Scribe operator

Google Identity Services is used for the **single Scribe website**, not one OAuth app per school. Configure the public Google Web Client ID once on the Scribe server:

```yaml
SCRIBE_GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID"
```

The exact Scribe site origin must be authorised for that Google OAuth client. Google Classroom and Gmail API access are separate from sign-in and are requested only when a student connects those features.

Students never see or edit the Client ID.

## First school

The first school can be created automatically from Docker environment variables:

```yaml
SCRIBE_DEFAULT_SCHOOL_NAME: "Your School"
SCRIBE_DEFAULT_SCHOOL_SLUG: "your-school"
SCRIBE_DEFAULT_SCHOOL_DOMAINS: "school.nz,students.school.nz"
SCRIBE_DEFAULT_SCHOOL_ADMIN_EMAILS: "admin@school.nz"
```

A global Scribe administrator is configured with:

```yaml
SCRIBE_GLOBAL_ADMIN_EMAILS: "owner@example.com"
```

A global admin can sign in even when there are no schools configured yet, then use **School Admin** to add schools. School administrators listed for a school can edit their own school's settings.

## Per-school settings

Each school can have its own:

- name and logo
- Google Workspace domains
- public ICS school calendars
- school administrator emails
- default sidebar features
- Classroom and Gmail integration switches
- optional allowance of personal Google accounts

Students can also override their own sidebar feature choices in **Settings**. Dashboard and Settings remain available.

## Google integrations

Google sign-in and Google data access are deliberately separate.

- **Google sign-in** verifies the student's identity.
- **Google Classroom** is requested only when Classroom is connected/synchronised.
- **Gmail** is requested only when Email is connected/synchronised.
- **School calendars** use the calendar feeds configured for that student's school.

This uses incremental Google permissions rather than asking every student for every permission just to sign in.

## Run locally

```bash
docker compose up -d --build
```

Open `http://localhost:8090`.

Before making the service public, change `SCRIBE_SECRET_KEY` to a long random value and put the site behind HTTPS using Nginx Proxy Manager.

## Notes for future expansion

The current local SQLite model keeps each user attached to a school and prevents a Google account from being silently moved from one school to another. Different schools can be added without changing student-facing code.

The authentication layer is intentionally kept separate from school data so additional sign-in providers, such as Microsoft, can be added later without changing the student data model again.
