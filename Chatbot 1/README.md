# EHS Safety Text-to-SQL Chatbot — Production Build

SQL Server (SSMS) + OpenAI only. React sliding chat widget. CPU-only,
no GPU, no Docker.

```
backend/    FastAPI + OpenAI + pyodbc(SQL Server) + Chroma schema/SQL cache
frontend/   React + Vite sliding chat panel (Gemini/Copilot style)
DEPLOYMENT_GUIDE.md   Full setup: SSMS, OpenAI key, run/deploy both apps
```

## Quick start

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in MSSQL_* and OPENAI_API_KEY
python scripts/refresh_schema.py
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env      # set VITE_API_BASE_URL
npm run dev
```

Open http://localhost:5173 — a launcher button appears bottom-right; click
it to open the assistant.

See **DEPLOYMENT_GUIDE.md** for the full walkthrough (SSMS login setup,
ODBC driver install, production hardening, scheduled schema refresh, and
how to fold the widget into your existing webapp later).

## Design notes

- **One LLM provider (OpenAI), one database (SQL Server)** — no other
  option is wired in, by design, so there's nothing to misconfigure.
- **Stateless chat**: the client sends its own recent clean history with
  every request; nothing is cached server-side per user, which is what
  prevents history/context bleeding between different users or tabs.
- **Schema memory, not hand-written schema text**: `schema_profiler.py`
  reads real column names, types, and (for categorical columns) the
  actual top stored values directly from SQL Server, so the model always
  writes SQL against real values instead of guesses.
- **Semantic SQL cache**: near-identical repeat questions skip the LLM
  call entirely — faster and cheaper in practice for a small officer team
  asking similar questions throughout the day.
- **CPU-only embeddings** (`all-MiniLM-L6-v2` via sentence-transformers)
  for schema memory and the SQL cache — no GPU, no per-embedding API cost.
