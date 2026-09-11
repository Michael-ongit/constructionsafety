"""
Safety model (AI-detected incidents) CRUD + stats.

Routes:
  GET    /api/safety-model              — list incidents (paginated, filterable)
  GET    /api/safety-model/stats        — summary statistics (by zone, activity)
  GET    /api/safety-model/time-series  — incident counts by date
  GET    /api/safety-model/by-project   — incidents grouped by project
  GET    /api/safety-model/high-risk-count — count of high risk incidents
  GET    /api/safety-model/{id}         — single incident detail
  PATCH  /api/safety-model/{id}/remark  — update incident remark
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import case
from typing import Optional
from datetime import date, time
from pydantic import BaseModel
import re
from database import get_db
from models import SafetyIncident
from auth import get_current_user

router = APIRouter(prefix="/api/safety-model", tags=["safety-model"])


def process_activity_text(text: str) -> str:
    """Extract a clean, human-readable name from unsafe-activity text."""
    if not text or not text.strip():
        return "Unknown"
    items = re.split(r'\s*\d+\.\s+', text)
    items = [item.strip().rstrip('.').strip() for item in items if item.strip()]
    if not items: return "Unknown Activity"
    first = items[0]
    if len(first) > 60: first = first[:57] + "..."
    return first[0].upper() + first[1:] if first else "Unknown Activity"


class RemarkUpdate(BaseModel):
    remark: str


@router.get("")
def get_safety_incidents(
    skip: int = 0, limit: int = 0,
    camera_zone: Optional[str] = None,
    start_date: Optional[date] = None, end_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    """List safety incidents with optional filtering and pagination."""
    query = db.query(SafetyIncident.ID, SafetyIncident.Date, SafetyIncident.Time,
                     SafetyIncident.CameraZone, SafetyIncident.Project,
                     SafetyIncident.UnsafeActivity, SafetyIncident.Risk,
                     SafetyIncident.Recommendation, SafetyIncident.Remarks,
                     case((SafetyIncident.ImageBlob.isnot(None), True), else_=False).label('has_image'))
    if camera_zone: query = query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: query = query.filter(SafetyIncident.Date >= start_date)
    if end_date: query = query.filter(SafetyIncident.Date <= end_date)
    total = query.count()
    rows = (query.order_by(SafetyIncident.ID.desc()).offset(skip).limit(limit).all()
            if limit > 0 else query.order_by(SafetyIncident.ID.desc()).all())
    return {"data": [{"id": r.ID, "date": r.Date.isoformat() if r.Date else "",
                      "time": r.Time.strftime("%H:%M:%S") if r.Time else "",
                      "camera_zone": r.CameraZone or "Unknown", "project": r.Project or "N/A",
                      "unsafe_activity": r.UnsafeActivity or "N/A", "risk": r.Risk or "N/A",
                      "recommendation": r.Recommendation or "N/A", "remark": r.Remarks or "",
                      "has_image": r.has_image} for r in rows],
            "total": total, "skip": skip, "limit": limit}


@router.patch("/{incident_id}/remark", dependencies=[Depends(get_current_user)])
def update_remark(
    incident_id: int,
    body: RemarkUpdate,
    db: Session = Depends(get_db),
):
    """Update the remark / notes for a safety incident."""
    incident = db.query(SafetyIncident).filter(SafetyIncident.ID == incident_id).first()
    if not incident: raise HTTPException(status_code=404, detail="Incident not found")
    incident.Remarks = body.remark
    db.commit(); db.refresh(incident)
    return {"id": incident.ID, "remark": incident.Remarks, "message": "Remark updated successfully"}


@router.get("/stats")
def get_safety_stats(
    db: Session = Depends(get_db),
    start_date: Optional[date] = None, end_date: Optional[date] = None,
    camera_zone: Optional[str] = None,
):
    """Return summary statistics with optional date/camera filters."""
    from sqlalchemy import func
    base = db.query(SafetyIncident)
    if camera_zone: base = base.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: base = base.filter(SafetyIncident.Date >= start_date)
    if end_date: base = base.filter(SafetyIncident.Date <= end_date)
    total_incidents = base.count()

    zone_query = db.query(SafetyIncident.CameraZone, func.count(SafetyIncident.ID).label('count')).group_by(SafetyIncident.CameraZone)
    if camera_zone: zone_query = zone_query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: zone_query = zone_query.filter(SafetyIncident.Date >= start_date)
    if end_date: zone_query = zone_query.filter(SafetyIncident.Date <= end_date)
    zone_stats = zone_query.all()

    act_query = db.query(SafetyIncident.UnsafeActivity)
    if camera_zone: act_query = act_query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: act_query = act_query.filter(SafetyIncident.Date >= start_date)
    if end_date: act_query = act_query.filter(SafetyIncident.Date <= end_date)
    all_activities = act_query.all()

    activity_dict = {}
    for (activity_str,) in all_activities:
        items = re.split(r'\s*\d+\.\s+', activity_str or "")
        items = [it.strip().rstrip('.').strip() for it in items if it.strip()]
        if not items:
            key = "Unknown Activity"
            activity_dict.setdefault(key, {"activity": key, "count": 0})["count"] += 1
            continue
        for item in items:
            act = item[:50] + "..." if len(item) > 50 else item
            act = ' '.join(w.capitalize() for w in act.split()) if act else "Unknown Activity"
            activity_dict.setdefault(act, {"activity": act, "count": 0})["count"] += 1

    today = date.today()
    return {"total_incidents": total_incidents, "today_incidents": base.filter(SafetyIncident.Date == today).count(),
            "by_zone": [{"zone": z, "count": c} for z, c in zone_stats if z],
            "by_activity": sorted(activity_dict.values(), key=lambda x: x["count"], reverse=True)[:10]}


@router.get("/time-series")
def get_time_series(
    db: Session = Depends(get_db),
    start_date: Optional[date] = None, end_date: Optional[date] = None,
    camera_zone: Optional[str] = None, period: Optional[str] = None,
):
    """Incident counts by date (optionally grouped by month/year)."""
    from sqlalchemy import func
    query = db.query(SafetyIncident.Date, func.count(SafetyIncident.ID).label('count'))
    if camera_zone: query = query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: query = query.filter(SafetyIncident.Date >= start_date)
    if end_date: query = query.filter(SafetyIncident.Date <= end_date)
    results = query.group_by(SafetyIncident.Date).order_by(SafetyIncident.Date).all()

    if period == 'month':
        from collections import defaultdict
        mm = defaultdict(int)
        for r in results:
            if r.Date: mm[r.Date.strftime('%b %Y')] += r.count
        return [{"date": k, "count": v} for k, v in sorted(mm.items())]
    if period == 'year':
        from collections import defaultdict
        ym = defaultdict(int)
        for r in results:
            if r.Date: ym[r.Date.strftime('%Y')] += r.count
        return [{"date": k, "count": v} for k, v in sorted(ym.items())]
    return [{"date": r.Date.isoformat() if r.Date else "", "count": r.count} for r in results]


@router.get("/by-project")
def get_by_project(
    db: Session = Depends(get_db),
    start_date: Optional[date] = None, end_date: Optional[date] = None,
    camera_zone: Optional[str] = None,
):
    """Incident counts grouped by project."""
    from sqlalchemy import func
    query = db.query(SafetyIncident.Project, func.count(SafetyIncident.ID).label('count'))
    if camera_zone: query = query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: query = query.filter(SafetyIncident.Date >= start_date)
    if end_date: query = query.filter(SafetyIncident.Date <= end_date)
    results = query.group_by(SafetyIncident.Project).order_by(func.count(SafetyIncident.ID).desc()).all()
    return [{"project": r.Project or "N/A", "count": r.count} for r in results]


@router.get("/high-risk-count")
def get_high_risk_count(
    db: Session = Depends(get_db),
    start_date: Optional[date] = None, end_date: Optional[date] = None,
    camera_zone: Optional[str] = None,
):
    """Count of high-risk incidents."""
    query = db.query(SafetyIncident).filter(SafetyIncident.Risk.ilike('high'))
    if camera_zone: query = query.filter(SafetyIncident.CameraZone.ilike(f"%{camera_zone}%"))
    if start_date: query = query.filter(SafetyIncident.Date >= start_date)
    if end_date: query = query.filter(SafetyIncident.Date <= end_date)
    return {"count": query.count()}


@router.get("/{incident_id}")
def get_safety_incident(
    incident_id: int,
    db: Session = Depends(get_db),
):
    """Return details for a single incident."""
    incident = db.query(SafetyIncident).filter(SafetyIncident.ID == incident_id).first()
    if not incident: raise HTTPException(status_code=404, detail="Incident not found")
    return {"id": incident.ID, "date": incident.Date.isoformat() if incident.Date else "",
            "time": incident.Time.strftime("%H:%M:%S") if incident.Time else "",
            "camera_zone": incident.CameraZone or "Unknown", "project": incident.Project or "N/A",
            "unsafe_activity": incident.UnsafeActivity or "N/A", "risk": incident.Risk or "N/A",
            "recommendation": incident.Recommendation or "N/A", "remark": incident.Remarks or "",
            "has_image": incident.ImageBlob is not None}
