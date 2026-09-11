"""
OneDrive OAuth integration (stub / WIP).

Routes:
  GET /api/auth/onedrive/url      — return Microsoft OAuth2 URL
  GET /api/auth/onedrive/callback — handle OAuth callback (placeholder)

The actual token exchange is not implemented. The callback simply posts
the authorization code back to the opener window and closes.
"""

import os
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/auth/onedrive", tags=["onedrive"])

CLIENT_ID    = os.getenv("ONEDRIVE_CLIENT_ID", "YOUR_CLIENT_ID")
REDIRECT_URI = os.getenv("ONEDRIVE_REDIRECT_URI", "http://localhost:5001/api/auth/onedrive/callback")
TENANT_ID    = os.getenv("ONEDRIVE_TENANT_ID", "common")


@router.get("/url")
def get_auth_url():
    """Return the Microsoft OAuth2 URL so the frontend can open it in a popup."""
    scope = "Files.ReadWrite.All offline_access"
    url = (f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize"
           f"?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}"
           f"&scope={scope.replace(' ', '%20')}&response_mode=query")
    return {"url": url}


@router.get("/callback")
def auth_callback(code: str, request: Request = None):
    """
    Stub callback: posts the authorization code back to the parent window.
    Token exchange with Microsoft is not yet implemented.
    """
    from fastapi.responses import HTMLResponse
    origin = "http://localhost:5001"
    if request and request.headers.get("origin"):
        origin = request.headers["origin"]
    html = f"""<html><body><script>
      window.opener.postMessage({{ type: 'ONEDRIVE_AUTH_SUCCESS', tokens: {{ code: '{code}' }} }}, '{origin}');
      window.close();
    </script></body></html>"""
    return HTMLResponse(content=html)
