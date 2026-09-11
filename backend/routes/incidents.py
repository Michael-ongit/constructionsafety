"""
Incidents (safety_model) endpoints.

Routes:
  GET /api/incidents              — list incidents (cached, 10s TTL)
  GET /api/incidents/{id}/image   — serve incident image blob
"""

import time
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import case
from typing import List
import io
from database import get_db
from models import SafetyIncident
from schemas import IncidentOut

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

_cache: dict = {}
_CACHE_TTL = 10  # seconds


def _row_to_schema(row) -> dict:
    ts_str = f"{row.Date}T{row.Time}" if (row.Date and row.Time) else ""
    return {"id": str(row.ID), "timestamp": ts_str, "cameraZone": row.CameraZone or "Unknown",
            "unsafeActivity": row.UnsafeActivity or "Violation", "status": "Violation Recorded",
            "risk": "high", "imageUrl": f"/api/incidents/{row.ID}/image" if row.has_image else None,
            "hasImage": row.has_image}


@router.get("", response_model=List[IncidentOut])
def get_incidents(
    limit: int = Query(default=0),
    db: Session = Depends(get_db),
):
    """List recent incidents with optional limit. Results cached for 10s."""
    now = time.time()
    cached = _cache.get("incidents")
    if cached and (now - cached["ts"]) < _CACHE_TTL:
        data = cached["data"]
        return data[:limit] if limit > 0 else data
    try:
        query = db.query(SafetyIncident.ID, SafetyIncident.Date, SafetyIncident.Time,
                         SafetyIncident.CameraZone, SafetyIncident.UnsafeActivity,
                         case((SafetyIncident.ImageBlob.isnot(None), True), else_=False).label('has_image')
                         ).order_by(SafetyIncident.ID.desc())
        if limit > 0:
            query = query.limit(limit)
        rows = query.all()
        result = [_row_to_schema(r) for r in rows]
        _cache["incidents"] = {"data": result, "ts": now}
        return result
    except Exception as e:
        import traceback
        print(f"Error fetching incidents: {e}")
        print(traceback.format_exc())
        return []


@router.get("/{incident_id}/image")
def get_incident_image(
    incident_id: int,
    db: Session = Depends(get_db),
):
    """Serve the image blob for a given incident."""
    incident = db.query(SafetyIncident.ImageBlob).filter(SafetyIncident.ID == incident_id).first()
    if not incident or not incident.ImageBlob:
        raise HTTPException(status_code=404, detail="Image not found")
    blob = incident.ImageBlob
    if isinstance(blob, str):
        hex_str = blob.replace("0x", "").replace("0X", "")
        blob = bytes.fromhex(hex_str)
    content_type = "image/jpeg"
    if isinstance(blob, (bytes, bytearray)) and len(blob) >= 4:
        if blob[:4] == b'\x89PNG': content_type = "image/png"
        elif blob[:3] == b'GIF': content_type = "image/gif"
        elif blob[:2] == b'\xFF\xD8': content_type = "image/jpeg"
    return StreamingResponse(io.BytesIO(blob), media_type=content_type)
