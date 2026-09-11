# SiteMonitor AI — Construction Site Safety Management System

An AI-powered construction site safety monitoring platform that detects unsafe acts/conditions via CCTV, manages UAUC (Unsafe Act / Unsafe Condition) workflows, and provides real-time safety analytics.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite 5, Tailwind CSS 3 |
| **Backend** | Python 3, FastAPI, SQLAlchemy ORM |
| **Database** | Azure SQL Server (ODBC Driver 18) with SQLite fallback |
| **AI/ML** | YOLOv8 (pose, phone, helmet, vest detection), Azure OpenAI GPT-4o |
| **Notifications** | SMTP (Gmail) |
| **Charts** | Recharts |
| **Icons** | Lucide React |
| **Auth** | PS Number + Mail ID lookup (no JWT) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Port 5001)              │
│  React + Vite + Tailwind + Recharts + Lucide Icons  │
│           ┌─────────────────────────────┐           │
│           │   Vite Proxy (/api → :3001) │           │
│           └──────────┬──────────────────┘           │
└──────────────────────┼──────────────────────────────┘
                       │ HTTP
┌──────────────────────┼──────────────────────────────┐
│           Backend (Port 3001) — FastAPI             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ │
│  │Auth  │ │UAUCs │ │Safety│ │Stream│ │Analytics │ │
│  │Routes│ │Routes│ │Model │ │Routes│ │Routes    │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘ │
│  ┌────────────┐ ┌──────────────┐ ┌───────────────┐ │
│  │ SQLAlchemy │ │  YOLOv8 AI   │ │ Azure OpenAI  │ │
│  │   ORM      │ │  Detection   │ │  GPT-4o       │ │
│  └─────┬──────┘ └──────────────┘ └───────────────┘ │
└────────┼────────────────────────────────────────────┘
         │
┌────────┼────────────────────────────────────────────┐
│  Azure SQL Server (CDP_PROD_Quality)                │
│  or SQLite fallback (local_dev.db)                  │
└─────────────────────────────────────────────────────┘
```

## Project Structure

```
backend/
├── main.py                 # FastAPI app, CORS, seed data, router registration
├── models.py               # SQLAlchemy ORM models (9 tables)
├── schemas.py              # Pydantic request/response schemas
├── database.py             # DB engine (SQL Server + SQLite fallback)
├── email_alert.py          # SMTP email notification system
├── audit.py                # YOLO detection + Azure OpenAI analysis pipeline
├── requirements.txt        # Python dependencies
├── .env                    # Environment configuration
├── routes/
│   ├── auth.py             # Login, user CRUD, admin stats
│   ├── uaucs.py            # UAUC lifecycle (list, submit, review, evidence)
│   ├── safety_model.py     # Safety incident CRUD and stats
│   ├── incidents.py        # Incident image retrieval
│   ├── activity_logs.py    # Activity timeline and idle time
│   ├── analytics.py        # Dashboard KPIs and trends
│   ├── stream.py           # RTSP camera streaming
│   ├── cameras.py          # Camera CRUD
│   ├── upload.py           # File upload and AI analysis
│   ├── activity_insights.py# Activity summaries and durations
│   ├── segments.py         # Casting segment analysis
│   └── onedrive.py         # Microsoft OneDrive OAuth
└── uploads/                # Uploaded media

frontend/
├── src/
│   ├── App.tsx             # Main application (all pages, routing, state)
│   ├── main.tsx            # React entry point
│   ├── index.css           # Global styles + Tailwind
│   ├── lib/utils.ts        # Utility functions
│   ├── services/
│   │   ├── apiCache.ts     # Client-side fetch cache
│   │   └── geminiService.ts# AI API stubs
│   └── components/charts/  # Recharts chart components
├── vite.config.ts          # Vite config (port 3002, proxy to :3001)
├── package.json
└── tailwind.config.js
```

## Installation

### Prerequisites

- Python 3.9+
- Node.js 18+
- ODBC Driver 18 for SQL Server (Windows) — only required for SQL Server mode
- YOLO model files: `best.pt`, `yolov8n.pt`, `yolov8m-pose.pt`, `vest_model.pt`

### Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

Configure `.env` (see Configuration section below), then start:

```bash
python main.py
```

The backend starts on **http://localhost:3001**. The checked-in local configuration uses SQLite (`backend/local_dev.db`) and does not contact SQL Server. SQL Server mode is still available by changing `DB_BACKEND` to `sqlserver`.

### Frontend Setup

```bash
cd frontend
npm install
```

Start dev server:

```bash
npm run dev
```

The frontend starts on **http://localhost:5001** and proxies `/api` requests to the backend.

Production build:

```bash
npm run build
```

## Configuration

### Backend `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_BACKEND` | `sqlite` | Database backend: `sqlite` for local development or `sqlserver` for Azure SQL |
| `SQLITE_DB_PATH` | `local_dev.db` | SQLite file path, relative to `backend` unless absolute |
| `DB_DRIVER` | `ODBC Driver 18 for SQL Server` | ODBC driver name |
| `DB_SERVER` | `ltc-cdp-prod-sql.database.windows.net` | SQL Server host |
| `DB_DATABASE` | ` CDP_PROD_Quality` | Database name (note leading space) |
| `DB_USERNAME` | — | DB username |
| `DB_PASSWORD` | — | DB password |
| `DB_PORT` | `1433` | DB port |
| `USE_SQLITE_FALLBACK` | `1` | In SQL Server mode, fall back to SQLite if the SQL Server connection fails |
| `SENDER_EMAIL` | — | Gmail address for SMTP notifications |
| `SENDER_APP_PASSWORD` | — | Gmail app password |
| `ONEDRIVE_CLIENT_ID` | — | Azure app client ID |
| `ONEDRIVE_TENANT_ID` | `common` | Microsoft tenant |
| `ONEDRIVE_REDIRECT_URI` | `http://localhost:3000/api/auth/onedrive/callback` | OAuth redirect |

### Frontend `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3001` | Backend API URL |

## User Roles & Seed Data

### Roles

| DB Role | Frontend Role | Description |
|---------|---------------|-------------|
| `Site Engineer` | `site` | Receives UAUC assignments, submits closure evidence |
| `EHSO` | `ehs` | Creates UAUCs, reviews and approves/rejects closures |
| `Super Admin` | `super_admin` | Full system access, user management, cross-project oversight |

### Seed Users

Created automatically on first run (or upserted for super admin):

| Employee Name | Role | PS Number | Password (Mail ID) |
|--------------|------|-----------|-------------------|
| TANMOY GOSWAMI | Site Engineer | `20056645` | tanmoygoswami@lntecc.com |
| SUNIL KUMAR CHAURSIYA | Site Engineer | `20036606` | skch@lntecc.com |
| BISWAJIT BHATTACHARJEE | Site Engineer | `20144817` | bbhattacharjee@lntecc.com |
| ANKIT KUMAR SINGH | Site Engineer | `20315339` | ankitkumarsingh@lntecc.com |
| DEEPSHIKHA | Site Engineer | `1234567` | deepshikha@lntecc.com |
| DEBADITYA KUNDU | EHS | `20116210` | kdebaditya@lntecc.com |
| SOURAV SINGHA | EHS | `20100604` | souravsingha@lntecc.com |
| PRATEEK SINGH | EHS | `20116240` | singh-prateek@lntecc.com |
| SUDHAGAR J | EHS | `20116150` | sudhagar-j@lntecc.com |
| SRAVAN | EHS | `2462634` | sravan@lntecc.com |
| **SUPER ADMIN** | Super Admin | **`admin123`** | **admin@lntecc.com** |

**Login**: Enter PS Number as Username, Mail ID as Password.

## Key Workflows

### UAUC Lifecycle

```
EHS observes unsafe act/condition
         │
         ▼
  EHS captures evidence + creates UAUC (Status: OPEN)
         │
         ▼
  UAUC assigned to Site Engineer (via email)
         │
         ▼
  Site Engineer fixes issue(s) + takes after-images
         │
         ▼
  Site Engineer submits closure (Status: AWAITING_APPROVAL)
         │
         ▼
  EHS reviews evidence
         │
     ┌───┴───┐
     │       │
  ACCEPT   REJECT
     │       │
  Status:   Status: REWORK_REQUIRED
  ACCEPTED  (if unresolved issues)
     │      or REJECTED
     ▼      (if no unresolved issues)
  CLOSED      │
              ▼
         Site Engineer reworks
         + resubmits closure
```

### Status Transitions

- `OPEN` — UAUC created, assigned to Site Engineer
- `AWAITING_APPROVAL` — Site Engineer submitted closure, awaiting EHS review
- `ACCEPTED` — EHS approved the closure
- `CLOSED` — Final accepted state
- `REWORK_REQUIRED` — EHS rejected with unresolved issues (increments rework count)
- `REJECTED` — EHS rejected with no unresolved issues
- `OVERDUE` — Virtual status (displayed when target date is past and status is not final)

### Super Admin Capabilities

- **User Management**: Add/edit/delete users with any role (Site Engineer, EHS, Super Admin)
- **System Dashboard**: Overview stats (total users, count by role, projects)
- **Full Data Access**: Can view all UAUCs across all projects via EHS/Site Engineer pages
- **All Approvals**: Can approve/reject any UAUC closure from any project
- **Cross-Project Oversight**: Accesses Executive Dashboard, Live Supervision, Safety Analytics, Activity Logs

## API Overview

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with `ps_number` + `mail_id` |
| GET | `/api/auth/users` | List all users (admin) |
| POST | `/api/auth/users` | Create user (admin) |
| PUT | `/api/auth/users/{ps_number}` | Update user (admin) |
| DELETE | `/api/auth/users/{ps_number}` | Delete user (admin) |
| GET | `/api/auth/stats` | System statistics (admin) |
| GET | `/api/auth/site-engineers` | List site engineers |

### UAUCs (`/api/uaucs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/uaucs/my` | List UAUCs (filtered by engineer/initiator or `role=super_admin`) |
| GET | `/api/uaucs/{id}` | Get UAUC detail |
| GET | `/api/uaucs/{id}/image` | Get UAUC image |
| PATCH | `/api/uaucs/{id}/status` | Update status |
| POST | `/api/uaucs/{id}/submit-closure` | Submit closure with evidence |
| POST | `/api/uaucs/{id}/review` | Review closure (accept/reject) |
| POST | `/api/uaucs/{id}/evidence-images` | Upload evidence image |
| GET | `/api/uaucs/{id}/evidence-images` | List evidence images |
| GET | `/api/uaucs/{id}/evidence-images/{eid}/image` | Get evidence image |
| DELETE | `/api/uaucs/{id}/evidence-images/{eid}` | Delete evidence image |

### Analytics (`/api/analytics`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/summary` | Dashboard KPIs |
| GET | `/api/analytics/weekly-data` | Weekly/monthly incident data |
| GET | `/api/analytics/module-performance` | AI module detection accuracy |
| GET | `/api/analytics/activity-trends` | Activity completion trends |
| GET | `/api/analytics/zone-risk` | Risk scores by zone |

### Cameras & Stream (`/api/cameras`, `/api/stream`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cameras` | List all cameras |
| POST | `/api/cameras` | Add camera |
| DELETE | `/api/cameras/{id}` | Delete camera |
| GET | `/api/stream/cameras` | List RTSP camera configs |
| GET | `/api/stream/{id}/snapshot` | Get latest live frame |

### Safety Model (`/api/safety-model`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/safety-model` | List incidents (paginated, filterable) |
| GET | `/api/safety-model/stats` | Incident statistics |
| GET | `/api/safety-model/{id}` | Single incident detail |
| PATCH | `/api/safety-model/{id}/remark` | Update incident remarks |

## Database Schema

### `compliance_audit` (UAUC records)
Core UAUC table storing all unsafe act/condition reports with status, evidence, assignments.

### `Site_Monitoring_Users`
User registry with role, project, PS number, and email.

### `uauc_evidence`
After-images uploaded by site engineers as closure evidence, linked to specific issues.

### `uauc_rejection_history`
Tracks rejection events with rework count, rejected-by, comments, and unresolved issues.

### `safety_model`
AI-detected safety incidents from CCTV analysis (pose, PPE, phone usage, etc.).

### `cameras`
Camera device registry with zone, status, and RTSP URL.

### `Incidents`
Legacy incident records from AI detection pipeline.

### `activity_logs` / `Activity_new`
Activity timeline data from CCTV zone analysis.

## Running with SQLite

For local SQLite development, use the following backend settings in `backend/.env`:

```dotenv
DB_BACKEND=sqlite
SQLITE_DB_PATH=local_dev.db
USE_SQLITE_FALLBACK=1
```

The application creates the SQLite file and all ORM tables automatically. Seed users are inserted on first startup. The chatbot uses the same SQLite database and automatically uses SQLite-compatible schema discovery, `COUNT(*)`, and `LIMIT` queries.

### Importing the QualityLabs SQLite backup

The repository includes a targeted importer for the QualityLabs backup. It imports only KnowHarmAI safety-monitoring records (`Incidents`, `activity_logs`, and older-format camera records when present); laboratory, Django, task-management, and authentication tables are intentionally excluded.

```powershell
cd backend
venv\Scripts\python.exe import_qualitylabs_sqlite.py
```

The importer reads the source database in read-only mode and is safe to rerun. Before the first import, create a backup of `local_dev.db` if the database contains local changes.

To use SQL Server later, set `DB_BACKEND=sqlserver`, configure the `DB_*` values, and install the SQL Server ODBC driver. `USE_SQLITE_FALLBACK=1` can remain enabled if you want fallback behavior.

## Email Notifications

Configured via Gmail SMTP. Sends emails for:
- UAUC assignment to Site Engineer
- Closure submission notification to EHS
- Closure acceptance/rejection to Site Engineer

Requires `SENDER_EMAIL` and `SENDER_APP_PASSWORD` (Gmail app password, not regular password) in `.env`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Invalid PS Number or Mail ID` | Ensure credentials match seed data. Enter PS Number as username, email as password. |
| `pyodbc` import/connection error | For local work, set `DB_BACKEND=sqlite`; SQL Server mode requires the `pyodbc` package and an installed ODBC driver |
| `npx vite build` fails | Check Node version (18+), delete `node_modules` and `package-lock.json`, re-run `npm install` |
| CORS errors | Ensure backend is running on port 3001; Vite proxies `/api` to it |
| Email not sending | Verify `SENDER_EMAIL` and `SENDER_APP_PASSWORD` in `.env` |
| Blank approval queue | The queue is session-based — submit a closure first, or for super admin use the EHS Engineer page which fetches from the database |
