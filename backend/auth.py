"""
JWT authentication utilities and FastAPI dependencies.

Provides:
  - create_access_token() — mint a JWT with role claim
  - get_current_user()    — FastAPI dependency: verify Bearer token → UserPayload
  - require_role()        — FastAPI dependency factory: enforce role whitelist
"""

import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import SiteMonitoringUser

# ---------------------------------------------------------------------------
# Configuration (from .env — no hardcoded fallbacks)
# ---------------------------------------------------------------------------
_SECRET_RAW = os.getenv("JWT_SECRET_KEY", "").strip()
if not _SECRET_RAW:
    raise RuntimeError(
        "JWT_SECRET_KEY environment variable is not set. "
        "The application cannot start without a valid JWT signing secret. "
        "Set JWT_SECRET_KEY in your .env or environment to a cryptographically "
        "random string of at least 32 characters."
    )
if len(_SECRET_RAW) < 32:
    raise RuntimeError(
        f"JWT_SECRET_KEY must be at least 32 characters long "
        f"(got {len(_SECRET_RAW)}). "
        "Use: python -c \"import secrets; print(secrets.token_urlsafe(48))\" "
        "to generate a suitable key."
    )
if _SECRET_RAW in ("sitemonitor-ai-jwt-secret-key-2026-change-in-production", "CHANGE_ME", "secret", "changeme"):
    raise RuntimeError(
        "JWT_SECRET_KEY is set to a well-known default value. "
        "Replace it with a cryptographically random secret. "
        "Use: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )
SECRET_KEY = _SECRET_RAW

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "24"))

# Reusable HTTP bearer scheme (reads Authorization: Bearer <token>)
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Token minting
# ---------------------------------------------------------------------------

class TokenPayload(BaseModel):
    sub: str        # PS_Number (unique identifier)
    role: str       # frontend role: ehs | site | super_admin | sbg
    name: str       # Employee_Name
    mail_id: str
    project_name: str
    sbg: str = ""
    bu: str = ""


def create_access_token(user: TokenPayload) -> str:
    """Create a signed JWT with the given claims, expiring in EXPIRY_HOURS."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=EXPIRY_HOURS)
    claims = {
        "sub": user.sub,
        "role": user.role,
        "name": user.name,
        "mail_id": user.mail_id,
        "project_name": user.project_name,
        "sbg": user.sbg,
        "bu": user.bu,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT. Raises JWTError on failure."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> TokenPayload:
    """
    Dependency: extract and verify the Bearer token from the Authorization header.
    Returns a TokenPayload on success, raises 401 on failure.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Verify the user still exists in the database
    user = db.query(SiteMonitoringUser).filter(
        SiteMonitoringUser.PS_Number == payload.get("sub", "")
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenPayload(
        sub=payload["sub"],
        role=payload["role"],
        name=payload["name"],
        mail_id=payload["mail_id"],
        project_name=payload["project_name"],
        sbg=payload.get("sbg", ""),
        bu=payload.get("bu", ""),
    )


def require_role(*allowed_roles: str):
    """
    Dependency factory: returns a dependency that enforces the current user's
    role is in the allowed_roles whitelist.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role("super_admin"))])
        def admin_endpoint(): ...

        @router.post("/closure", dependencies=[Depends(require_role("site", "super_admin"))])
        def submit_closure(): ...
    """
    async def _check(user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' is not authorized for this action. Required: {', '.join(allowed_roles)}",
            )
        return user
    return _check


# Convenience: any authenticated user (no role restriction)
AnyUser = get_current_user
