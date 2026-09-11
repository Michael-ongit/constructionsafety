"""
Authentication & user management endpoints.

Routes:
  POST   /api/auth/login          — authenticate user (PS_Number + Mail_ID)
  GET    /api/auth/user-project   — get project name for a PS_Number
  GET    /api/auth/site-engineers — list all Site Engineer users
  GET    /api/auth/stats          — system statistics (user counts, projects)
  GET    /api/auth/users          — list all users (response includes mapped role)
  POST   /api/auth/users          — create a new user
  PUT    /api/auth/users/{ps}     — update an existing user
  DELETE /api/auth/users/{ps}     — delete a user (Super Admin protected)
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from models import SiteMonitoringUser
from auth import (
    TokenPayload, create_access_token, get_current_user, require_role,
)
import time

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# M6: Rate limiting for login endpoint
# ---------------------------------------------------------------------------
class _LoginRateLimiter:
    """Simple in-memory sliding window rate limiter."""
    def __init__(self, max_attempts: int = 10, window_seconds: int = 300):
        self._max = max_attempts
        self._window = window_seconds
        self._attempts: dict[str, list[float]] = {}

    def is_rate_limited(self, key: str) -> bool:
        now = time.time()
        attempts = self._attempts.get(key, [])
        attempts = [t for t in attempts if now - t < self._window]
        self._attempts[key] = attempts
        if len(attempts) >= self._max:
            return True
        attempts.append(now)
        self._attempts[key] = attempts
        return False

_login_limiter = _LoginRateLimiter(max_attempts=10, window_seconds=300)

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    ps_number: str
    mail_id: str

class LoginResponse(BaseModel):
    success: bool
    employee_name: str
    role: str
    project_name: str
    ps_number: str
    mail_id: str
    sbg: str = ""
    bu: str = ""
    access_token: str = ""

class SiteEngineerItem(BaseModel):
    ps_number: str
    employee_name: str
    mail_id: str
    project_name: str

class UserListItem(BaseModel):
    ps_number: str
    employee_name: str
    mail_id: str
    role: str
    project_name: str
    sbg: str = ""
    bu: str = ""

class UserCreateRequest(BaseModel):
    ps_number: str
    employee_name: str
    mail_id: str
    role: str
    project_name: str = "MPSB"

class UserUpdateRequest(BaseModel):
    employee_name: str = ""
    mail_id: str = ""
    role: str = ""
    project_name: str = ""

# ---------------------------------------------------------------------------
# Role mapping helpers
# ---------------------------------------------------------------------------

def _map_role(r: str) -> str:
    """Convert DB role (EHSO, Site Engineer, Super Admin, SBG) to frontend-facing name."""
    ru = r.upper()
    if ru == "SUPER ADMIN": return "super_admin"
    if ru == "EHSO": return "ehs"
    if ru == "DASHBOARD": return "sbg"
    if ru == "SBG": return "sbg"
    return "site"

def _reverse_map_role(mapped: str) -> str:
    """Convert frontend-facing role back to DB role string."""
    lookup = {"super_admin": "Super Admin", "ehs": "EHSO", "site": "Site Engineer", "sbg": "SBG"}
    return lookup.get(mapped, "Site Engineer")

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate using PS_Number + Mail_ID (no password)."""
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{req.ps_number}"
    if _login_limiter.is_rate_limited(rate_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    user = db.query(SiteMonitoringUser).filter(
        SiteMonitoringUser.PS_Number == req.ps_number,
        SiteMonitoringUser.Mail_ID == req.mail_id
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid PS Number or Mail ID")
    mapped_role = _map_role(user.Role)
    token = create_access_token(TokenPayload(
        sub=user.PS_Number,
        role=mapped_role,
        name=user.Employee_Name,
        mail_id=user.Mail_ID,
        project_name=user.Project_Name,
        sbg=user.SBG or "",
        bu=user.BU or "",
    ))
    return LoginResponse(
        success=True,
        employee_name=user.Employee_Name,
        role=mapped_role,
        project_name=user.Project_Name,
        ps_number=user.PS_Number,
        mail_id=user.Mail_ID,
        sbg=user.SBG or "",
        bu=user.BU or "",
        access_token=token,
    )


@router.get("/user-project")
def get_user_project(
    ps_number: str = "",
    db: Session = Depends(get_db),
):
    """Return the project name for a given PS_Number."""
    if not ps_number:
        return {"project_name": ""}
    user = db.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == ps_number).first()
    return {"project_name": user.Project_Name if user else ""}


@router.get("/site-engineers", response_model=List[SiteEngineerItem])
def get_site_engineers(
    project: str = "",
    db: Session = Depends(get_db),
):
    """List all users with role 'Site Engineer'."""
    query = db.query(SiteMonitoringUser).filter(
        func.lower(SiteMonitoringUser.Role) == "site engineer"
    )
    engineers = query.all()
    return [
        SiteEngineerItem(ps_number=eng.PS_Number, employee_name=eng.Employee_Name,
                         mail_id=eng.Mail_ID, project_name=eng.Project_Name)
        for eng in engineers
    ]


@router.get("/stats", dependencies=[Depends(require_role("super_admin"))])
def get_admin_stats(
    db: Session = Depends(get_db),
):
    """Return system statistics: total/role user counts + distinct projects."""
    total = db.query(func.count(SiteMonitoringUser.Sr_No)).scalar() or 0
    ehs_count = db.query(func.count(SiteMonitoringUser.Sr_No)).filter(func.upper(SiteMonitoringUser.Role) == "EHSO").scalar() or 0
    site_count = db.query(func.count(SiteMonitoringUser.Sr_No)).filter(func.upper(SiteMonitoringUser.Role) == "SITE ENGINEER").scalar() or 0
    super_admin_count = db.query(func.count(SiteMonitoringUser.Sr_No)).filter(func.upper(SiteMonitoringUser.Role) == "SUPER ADMIN").scalar() or 0
    projects = [r[0] for r in db.query(SiteMonitoringUser.Project_Name).distinct().order_by(SiteMonitoringUser.Project_Name).all()]
    return {"total_users": total, "by_role": {"site": site_count, "ehs": ehs_count, "super_admin": super_admin_count}, "projects": projects}


@router.get("/users", response_model=List[UserListItem])
def get_all_users(
    db: Session = Depends(get_db),
):
    """List all registered users, ordered by name, with mapped roles."""
    users = db.query(SiteMonitoringUser).order_by(SiteMonitoringUser.Employee_Name).all()
    return [UserListItem(ps_number=u.PS_Number, employee_name=u.Employee_Name,
                         mail_id=u.Mail_ID, role=_map_role(u.Role), project_name=u.Project_Name,
                         sbg=u.SBG or "", bu=u.BU or "") for u in users]


@router.post("/users", response_model=UserListItem, dependencies=[Depends(require_role("super_admin"))])
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
):
    """Create a new user. Duplicate PS_Number raises 409."""
    existing = db.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == payload.ps_number).first()
    if existing:
        raise HTTPException(status_code=409, detail="User with this PS Number already exists")
    user = SiteMonitoringUser(PS_Number=payload.ps_number, Employee_Name=payload.employee_name,
                              Mail_ID=payload.mail_id, Role=_reverse_map_role(payload.role),
                              Project_Name=payload.project_name or "MPSB")
    db.add(user); db.commit(); db.refresh(user)
    return UserListItem(ps_number=user.PS_Number, employee_name=user.Employee_Name,
                        mail_id=user.Mail_ID, role=_map_role(user.Role), project_name=user.Project_Name,
                        sbg=user.SBG or "", bu=user.BU or "")


@router.put("/users/{ps_number}", response_model=UserListItem, dependencies=[Depends(require_role("super_admin"))])
def update_user(
    ps_number: str,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
):
    """Update an existing user's fields."""
    user = db.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == ps_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.employee_name: user.Employee_Name = payload.employee_name
    if payload.mail_id: user.Mail_ID = payload.mail_id
    if payload.role: user.Role = _reverse_map_role(payload.role)
    if payload.project_name: user.Project_Name = payload.project_name
    db.commit(); db.refresh(user)
    return UserListItem(ps_number=user.PS_Number, employee_name=user.Employee_Name,
                        mail_id=user.Mail_ID, role=_map_role(user.Role), project_name=user.Project_Name,
                        sbg=user.SBG or "", bu=user.BU or "")


@router.delete("/users/{ps_number}", dependencies=[Depends(require_role("super_admin"))])
def delete_user(
    ps_number: str,
    db: Session = Depends(get_db),
):
    """Delete a user. Super Admin accounts cannot be deleted."""
    user = db.query(SiteMonitoringUser).filter(SiteMonitoringUser.PS_Number == ps_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.Role.upper() == "SUPER ADMIN":
        raise HTTPException(status_code=403, detail="Cannot delete a Super Admin user")
    db.delete(user); db.commit()
    return {"detail": "User deleted"}
