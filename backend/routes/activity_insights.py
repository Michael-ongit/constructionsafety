"""
Activity insight summary endpoints.

Routes:
  GET /api/activity-insights/summary — activity mix, trend, durations, stats

Processes raw Activity_new records into hourly trends,
activity-type distribution, and average duration per activity.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import ActivityNew
from sqlalchemy import asc
from datetime import datetime, timedelta
from typing import Optional

router = APIRouter(prefix="/api/activity-insights", tags=["activity-insights"])


@router.get("/summary")
def get_activity_insights(
    db: Session = Depends(get_db),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    """Return activity trend, mix, durations, and stats for the dashboard."""
    try:
        q = db.query(ActivityNew)
        if start or end:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=90)
            if start:
                try: start_date = datetime.strptime(start, "%Y-%m-%d")
                except ValueError: pass
            if end:
                try: end_date = datetime.strptime(end, "%Y-%m-%d") + timedelta(days=1)
                except ValueError: pass
            q = q.filter(ActivityNew.time_frame >= start_date, ActivityNew.time_frame < end_date)
        all_records = q.order_by(asc(ActivityNew.time_frame)).all()
        if not all_records:
            return {"activityTrend": [], "activityMix": [], "activityDurations": [],
                    "activityStats": [], "totalEvents": 0}

        # Filter out uncertain/not_detected
        all_records = [r for r in all_records if (r.activity or "").lower().replace('_done', '')
                       not in ("uncertain", "not_detected")]

        activity_durations = {}
        activity_counts = {}
        hourly_counts = {}
        i, n = 0, len(all_records)
        while i < n:
            current = all_records[i]
            activity_name = current.activity or ""
            start_time = current.time_frame
            end_time = start_time
            j = i + 1
            while j < n and all_records[j].activity == activity_name:
                end_time = all_records[j].time_frame
                j += 1
            duration_seconds = max(1, int((end_time - start_time).total_seconds()))
            activity_durations.setdefault(activity_name, []).append(duration_seconds)
            activity_counts[activity_name] = activity_counts.get(activity_name, 0) + 1
            hour = start_time.hour
            hourly_counts[hour] = hourly_counts.get(hour, 0) + 1
            i = j

        activity_trend = [{"time": f"{h:02d}:00", "count": hourly_counts.get(h, 0)} for h in range(24)]
        total_count = sum(activity_counts.values())
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#94a3b8', '#ef4444', '#8b5cf6']
        activity_mix = [{"name": a.replace('_done', '').replace('_', ' ').title(),
                         "value": int((c / total_count) * 100) if total_count > 0 else 0,
                         "color": colors[i % len(colors)]}
                        for i, (a, c) in enumerate(activity_counts.items())]
        activity_durations_list = [{"name": a.replace('_done', '').replace('_', ' ').title(),
                                    "duration": round(sum(d) / len(d) / 60, 1)}
                                   for a, d in activity_durations.items()]
        activity_stats = [{"label": a.replace('_done', '').replace('_', ' ').title(),
                           "count": c, "time": f"{int(sum(activity_durations[a]) / len(activity_durations[a]) / 60)}m avg",
                           "status": "On Track"} for a, c in activity_counts.items()]

        return {"activityTrend": activity_trend, "activityMix": activity_mix,
                "activityDurations": activity_durations_list, "activityStats": activity_stats,
                "totalEvents": total_count}
    except Exception as e:
        print(f"Error fetching activity insights: {e}")
        import traceback; traceback.print_exc()
        return {"activityTrend": [], "activityMix": [], "activityDurations": [],
                "activityStats": [], "totalEvents": 0}
