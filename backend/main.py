"""
FastAPI application entry-point.

Initialises the app, database tables, seed data, CORS, static file serving,
and registers all API route modules.

Security:
  - AuthMiddleware: validates JWT Bearer tokens on /api/* and /chat-api/api/*
  - SecurityHeadersMiddleware: adds X-Frame-Options, CSP, HSTS, etc.
"""

import os
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from database import engine, Base
import models  # noqa: F401

load_dotenv()

logger = logging.getLogger("sitemonitor.security")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Construction Site Monitor API",
    description="AI-powered safety monitoring system for construction sites",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# H4: Error Disclosure — sanitize exception responses
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("%s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )


# ---------------------------------------------------------------------------
# Security Headers Middleware (Phases 3 + 5) — M1: covers chatbot too
# ---------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' ws: wss: http: https:; "
            "font-src 'self' data:; "
            "frame-ancestors 'self'"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# ---------------------------------------------------------------------------
# C2 + Auth Middleware — protects /api/* AND /chat-api/api/*
# ---------------------------------------------------------------------------
_AUTH_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/onedrive/url",
    "/api/auth/onedrive/callback",
}

# Chat paths that are exempt from JWT but have their own auth
_CHAT_EXEMPT_PATHS = {
    "/chat-api/api/schema/refresh",
}


def _is_protected_path(path: str) -> bool:
    """Return True if the path requires JWT authentication."""
    if path.startswith("/chat-api/api/") and path not in _CHAT_EXEMPT_PATHS:
        return True
    if not path.startswith("/api/"):
        return False
    if path in _AUTH_EXEMPT_PATHS:
        return False
    import re
    if re.match(r"/api/uaucs/\d+/image$", path): return False
    if re.match(r"/api/uaucs/\d+/evidence-images/\d+/image$", path): return False
    if re.match(r"/api/incidents/\d+/image$", path): return False
    return True


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Validates a Bearer JWT token on /api/* and /chat-api/api/* routes.

    Exempt paths: login, OneDrive OAuth, chatbot schema/refresh.
    On success, decoded token payload is stored in request.state.user
    so downstream route handlers can access the authenticated identity.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if not _is_protected_path(path):
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated. Please log in."},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header[7:]
        try:
            from auth import decode_access_token
            payload = decode_access_token(token)
            request.state.user = payload
        except Exception:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        return await call_next(request)


# Register auth middleware BEFORE CORS so CORS handles OPTIONS preflight first
app.add_middleware(AuthMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# Database: create all tables
# ---------------------------------------------------------------------------
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Database connection failed: {e}")
    print("Streaming will still work, but database features are unavailable.")

# ---------------------------------------------------------------------------
# Lightweight migration — add missing columns to existing tables
# ---------------------------------------------------------------------------
try:
    from database import engine as _engine
    from sqlalchemy import text as _sql_text
    with _engine.connect() as _conn:
        _alterations = [
            ("compliance_audit", "SBG", "VARCHAR(255)"),
            ("compliance_audit", "BU", "VARCHAR(255)"),
            ("Site_Monitoring_Users", "SBG", "VARCHAR(255)"),
            ("Site_Monitoring_Users", "BU", "VARCHAR(255)"),
        ]
        for _table, _col, _dtype in _alterations:
            try:
                _conn.execute(_sql_text(f"ALTER TABLE [{_table}] ADD [{_col}] {_dtype}"))
                _conn.commit()
                print(f"Migration: added column {_col} to {_table}.")
            except Exception:
                pass
except Exception as e:
    print(f"Migration step skipped: {e}")

# ---------------------------------------------------------------------------
# Seed Site_Monitoring_Users (10 default + 1 Super Admin)
# ---------------------------------------------------------------------------
try:
    from database import SessionLocal
    from models import SiteMonitoringUser
    db_seed = SessionLocal()
    if db_seed.query(SiteMonitoringUser).count() == 0:
        seed_users = [
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="TANMOY GOSWAMI", Role="Site Engineer", PS_Number="20056645", Mail_ID="tanmoygoswami@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="SUNIL KUMAR CHAURSIYA", Role="Site Engineer", PS_Number="20036606", Mail_ID="skch@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="BISWAJIT BHATTACHARJEE", Role="Site Engineer", PS_Number="20144817", Mail_ID="bbhattacharjee@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="ANKIT KUMAR SINGH", Role="Site Engineer", PS_Number="20315339", Mail_ID="ankitkumarsingh@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="DEBADITYA KUNDU", Role="EHSO", PS_Number="20116210", Mail_ID="kdebaditya@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="SOURAV SINGHA", Role="EHSO", PS_Number="20100604", Mail_ID="souravsingha@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="PRATEEK SINGH", Role="EHSO", PS_Number="20116240", Mail_ID="singh-prateek@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="SUDHAGAR J", Role="EHSO", PS_Number="20116150", Mail_ID="sudhagar-j@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="SRAVAN", Role="EHSO", PS_Number="2462634", Mail_ID="sravan@lntecc.com"),
            SiteMonitoringUser(Project_Name="MPSB", Employee_Name="DEEPSHIKHA", Role="Site Engineer", PS_Number="1234567", Mail_ID="deepshikha@lntecc.com"),
        ]
        for u in seed_users:
            db_seed.add(u)
        db_seed.commit()
        print(f"Seeded {len(seed_users)} users into Site_Monitoring_Users.")

    existing = db_seed.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == "admin123").first()
    if not existing:
        super_admin = SiteMonitoringUser(
            Project_Name="MPSB", Employee_Name="SUPER ADMIN", Role="Super Admin",
            PS_Number="admin123", Mail_ID="admin@lntecc.com"
        )
        db_seed.add(super_admin)
        db_seed.commit()
        print("Seeded Super Admin user into Site_Monitoring_Users.")

    existing_sbg = db_seed.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == "sbg001").first()
    if not existing_sbg:
        sbg_user = SiteMonitoringUser(
            Project_Name="MPSB", Employee_Name="SBG DASHBOARD USER", Role="SBG",
            PS_Number="sbg001", Mail_ID="sbg@lntecc.com"
        )
        db_seed.add(sbg_user)
        db_seed.commit()
        print("Seeded SBG user into Site_Monitoring_Users.")
    db_seed.close()
except Exception as e:
    print(f"Could not seed users: {e}")

# ---------------------------------------------------------------------------
# M4: CORS — least-privilege methods and headers
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://localhost:3000",
        "http://10.18.0.4:3000",
        "http://20.244.104.81:3000",
        "http://localhost:3001",
        "https://localhost:3001",
        "http://20.244.104.81:3001",
        "http://20.244.104.81:5001",
        "http://localhost:3002",
        "https://localhost:3002",
        "http://10.18.0.4:3002",
        "http://20.244.104.81:3002",
        "https://10.18.0.4:3002",
        "http://localhost:3005",
        "http://localhost:5001",
        "https://localhost:5001",
        "https://localhost:3005",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With", "X-Admin-Token"],
)

# ---------------------------------------------------------------------------
# Static files — uploads directory served at /uploads
# ---------------------------------------------------------------------------
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ---------------------------------------------------------------------------
# Register API route modules
# ---------------------------------------------------------------------------
from routes import (
    incidents, activity_logs, analytics, safety_model, upload, onedrive,
    stream, cameras, activity_insights, segments, uaucs, auth, speech, dashboard
)

app.include_router(incidents.router)
app.include_router(activity_logs.router)
app.include_router(analytics.router)
app.include_router(safety_model.router)
app.include_router(upload.router)
app.include_router(onedrive.router)
app.include_router(stream.router)
app.include_router(cameras.router)
app.include_router(activity_insights.router)
app.include_router(segments.router)
app.include_router(uaucs.router)
app.include_router(auth.router)
app.include_router(speech.router)
app.include_router(dashboard.router)

# ---------------------------------------------------------------------------
# Mount chatbot (Text-to-SQL RAG) sub-app at /chat-api
# ---------------------------------------------------------------------------
try:
    from chatbot.main import chatbot_app
    app.mount("/chat-api", chatbot_app)
    print("Chatbot (Text-to-SQL) mounted at /chat-api")
except Exception as e:
    print(f"Chatbot mount failed (non-fatal): {e}")

# ---------------------------------------------------------------------------
# Run with: python main.py
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
