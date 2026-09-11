"""
Dashboard analytics endpoints.

Routes:
  GET /api/analytics/summary              — top-level KPI cards
  GET /api/analytics/weekly-data          — daily/weekly/monthly incident chart data
  GET /api/analytics/module-performance   — AI module detection accuracy (simulated)
  GET /api/analytics/activity-trends      — hourly activity completion trends
  GET /api/analytics/zone-risk            — risk scores by CCTV zone
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, extract
from datetime import datetime, timedelta
from database import get_db
from models import Incident, Camera, ActivityLog, SafetyIncident
from schemas import AnalyticsSummary

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def get_summary(
    db: Session = Depends(get_db),
):
    """Return top-level KPI values for the executive dashboard."""
    try:
        total_incidents = db.query(func.count(Incident.id)).scalar() or 0
        critical_alerts = db.query(func.count(SafetyIncident.ID)).filter(SafetyIncident.Risk.in_(["high", "critical"])).scalar() or 0
        active_cameras  = db.query(func.count(Camera.id)).scalar() or 0
        total_logs = db.query(func.count(ActivityLog.id)).scalar() or 1
        compliant = db.query(func.count(ActivityLog.id)).filter(ActivityLog.action.in_(["Completed", "Verified"])).scalar() or 0
        compliance_rate = round((compliant / total_logs) * 100, 1)
        total_workers = db.query(func.count(Camera.id)).scalar() or 0
        return {"compliance_rate": compliance_rate, "total_workers": total_workers,
                "total_incidents": total_incidents, "critical_alerts": critical_alerts,
                "active_cameras": active_cameras}
    except Exception as e:
        print(f"Error in analytics summary: {e}")
        return {"compliance_rate": 0, "total_workers": 0, "total_incidents": 0,
                "critical_alerts": 0, "active_cameras": 0}


@router.get("/weekly-data")
def get_weekly_data(
    db: Session = Depends(get_db),
):
    """Return weekly (7-day) + monthly incident data for chart widgets."""
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=55)

    daily_data = (db.query(cast(SafetyIncident.Date, Date).label('date'), func.count(SafetyIncident.ID).label('incidents'))
                  .filter(cast(SafetyIncident.Date, Date) >= start_date)
                  .group_by(cast(SafetyIncident.Date, Date)).order_by(cast(SafetyIncident.Date, Date)).all())

    monthly_data = (db.query(extract('year', SafetyIncident.Date).label('year'),
                             extract('month', SafetyIncident.Date).label('month'),
                             func.count(SafetyIncident.ID).label('incidents'))
                    .filter(cast(SafetyIncident.Date, Date) >= start_date)
                    .group_by(extract('year', SafetyIncident.Date), extract('month', SafetyIncident.Date))
                    .order_by(extract('year', SafetyIncident.Date), extract('month', SafetyIncident.Date)).all())

    week_data = []
    for i in range(7):
        d = end_date - timedelta(days=6 - i)
        day_name = d.strftime('%a')
        day_data = next((x for x in daily_data if x.date == d), None)
        incidents_count = day_data.incidents if day_data else 0
        compliance = max(85, min(98, 100 - (incidents_count * 2))) if day_data else 95
        week_data.append({'day': day_name, 'incidents': incidents_count, 'compliance': compliance,
                          'workers': 40 + (i * 2), 'danger_zones': max(0, incidents_count - 2),
                          'ppe_violations': max(0, incidents_count - 1), 'response_time': 10 + (incidents_count * 2)})

    monthly_formatted = [{'month': f"{int(m.year)}-{int(m.month):02d}",
                          'label': datetime(int(m.year), int(m.month), 1).strftime('%b %Y'),
                          'incidents': m.incidents} for m in monthly_data]

    return {'weekly': week_data, 'monthly': monthly_formatted,
            'daily': [{'date': d.date.strftime('%Y-%m-%d'), 'incidents': d.incidents} for d in daily_data]}


@router.get("/module-performance")
def get_module_performance(
    db: Session = Depends(get_db),
):
    """Return simulated AI module performance percentages."""
    type_counts = (db.query(Incident.type, func.count(Incident.id).label('count')).group_by(Incident.type).all())
    modules = [
        {'name': 'Helmet detection', 'value': 97, 'color': '#10b981'},
        {'name': 'Vest detection',   'value': 93, 'color': '#3b82f6'},
        {'name': 'Boot detection',   'value': 91, 'color': '#3b82f6'},
        {'name': 'Phone detection',  'value': 79, 'color': '#f97316'},
        {'name': 'Danger zone',      'value': 82, 'color': '#f97316'},
    ]
    for module in modules:
        module_type = module['name'].replace(' detection', '').title()
        count_data = next((c for c in type_counts if c.type == module_type), None)
        if count_data and count_data.count > 0:
            module['value'] = max(70, 100 - (count_data.count * 3))
    return modules


@router.get("/activity-trends")
def get_activity_trends(
    db: Session = Depends(get_db),
):
    """
    Return hourly activity completion trends.

    Hourly grouping is done in Python (not SQL) to avoid SQL Server strict-mode
    incompatibilities with substr() / left() in GROUP BY.
    """
    try:
        all_times = db.query(ActivityLog.time).filter(ActivityLog.time.isnot(None)).all()
        hourly_map = {}
        for (t,) in all_times:
            try:
                hour = int(t[:2])
                hourly_map[hour] = hourly_map.get(hour, 0) + 1
            except (ValueError, TypeError, IndexError):
                pass
        hourly_data = [{'time': f"{h:02d}:00", 'count': hourly_map.get(h, 0) + (h - 8)} for h in range(8, 19)]

        ACT_NAMES = ['Outer Shutter', 'Bulk Head Fixing', 'Cage Placement', 'Inner Mould',
                     'Concreting', 'Curing', 'Shifting']
        ACT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ef4444', '#8b5cf6', '#ec4899']

        return {'activity_mix': [{'name': n, 'value': 15, 'color': ACT_COLORS[i]} for i, n in enumerate(ACT_NAMES)],
                'hourly_trends': hourly_data,
                'activity_duration': [{'name': n, 'duration': 10 + i * 5} for i, n in enumerate(ACT_NAMES)]}
    except Exception as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e), "detail": "Failed to fetch activity trends"})


@router.get("/zone-risk")
def get_zone_risk(
    db: Session = Depends(get_db),
):
    """Return risk scores per CCTV zone, adjusted by incident counts."""
    zone_counts = (db.query(Incident.zone, func.count(Incident.id).label('count')).group_by(Incident.zone).all())
    zones = [{'zone': f'CCTV{i}', 'score': score} for i, score in enumerate([45, 32, 68, 51, 82, 44], 1)]
    for zone in zones:
        zone_data = next((z for z in zone_counts if z.zone == zone['zone']), None)
        if zone_data and zone_data.count > 0:
            zone['score'] = min(100, zone['score'] + (zone_data.count * 5))
    return zones
