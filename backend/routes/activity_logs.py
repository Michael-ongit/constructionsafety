"""
Activity log timeline endpoints.

Routes:
  GET /api/activity-logs — timeline of construction activities with idle detection

Builds a block-based timeline: consecutive same-activity records are merged;
gaps > 5 min between same-activity blocks are treated as separate blocks;
idle/uncertain/detection-gaps are flagged.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import ActivityNew
from sqlalchemy import asc
from datetime import datetime, timedelta
from collections import defaultdict

router = APIRouter(prefix="/api/activity-logs", tags=["activity-logs"])

ACTIVITY_ORDER = ["outer_shuttering", "bulkhead_fixing", "oiling", "cage_lowering",
                  "inner_mould_fixing", "concrete", "curing", "shifting"]


def format_duration(seconds: int) -> str:
    """Convert seconds to human-readable string (Xh Ym Zs)."""
    if seconds < 60: return f"{seconds}s"
    if seconds < 3600: return f"{seconds // 60}m {seconds % 60}s"
    hours, rem = divmod(seconds, 3600)
    return f"{hours}h {rem // 60}m"


def normalize_activity(name: Optional[str]) -> str:
    """Strip activity suffixes (_done, _not_detected) for grouping."""
    if not name: return "unknown"
    n = name.lower().strip()
    for suffix in ["_done", "_not_detected"]:
        if n.endswith(suffix): n = n[:-len(suffix)]
    return n if n else name.lower().strip()


def is_idle_type(name: str) -> bool:
    """Check whether an activity name represents idle/uncertain state."""
    if not name: return True
    n = name.lower().strip()
    return "idle" in n or n in ("uncertain", "not_valid", "not_detected")


def build_timeline_blocks(records):
    """Merge consecutive activity records into timeline blocks, merging gaps ≤ 5 min."""
    blocks = []
    current = None
    prev_time = None
    for r in records:
        act = normalize_activity(r.activity)
        idle = is_idle_type(act)
        ts = r.time_frame
        if current is None:
            current = {"is_idle": idle, "activity": act, "project": r.project or "",
                       "zone": r.zone or "", "startTime": ts, "endTime": ts}
            blocks.append(current)
        elif idle and current["is_idle"]:
            current["endTime"] = ts
        elif not idle and not current["is_idle"] and current["activity"] == act:
            if prev_time and (ts - prev_time).total_seconds() <= 300:
                current["endTime"] = ts
            else:
                current = {"is_idle": False, "activity": act, "project": r.project or "",
                           "zone": r.zone or "", "startTime": ts, "endTime": ts}
                blocks.append(current)
        else:
            current = {"is_idle": idle, "activity": act if not idle else "idle",
                       "project": r.project or "", "zone": r.zone or "",
                       "startTime": ts, "endTime": ts}
            blocks.append(current)
        prev_time = ts
    return blocks


@router.get("")
def get_activity_logs(
    db: Session = Depends(get_db),
    project: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    skip: int = Query(0), limit: int = Query(0),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """Return activity timeline with idle-time computation per activity."""
    try:
        if not start_date and not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
            start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

        query = db.query(ActivityNew)
        if project: query = query.filter(ActivityNew.project.like(f"%{project}%"))
        if zone: query = query.filter(ActivityNew.zone.like(f"%{zone}%"))
        if start_date: query = query.filter(ActivityNew.time_frame >= start_date)
        if end_date: query = query.filter(ActivityNew.time_frame <= end_date + " 23:59:59")

        all_records = query.order_by(asc(ActivityNew.time_frame)).all()
        if not all_records:
            return {"data": [], "total": 0}

        blocks = build_timeline_blocks(all_records)
        activity_blocks = defaultdict(list)
        for b in blocks:
            if not b["is_idle"]:
                activity_blocks[(b["activity"], b["project"], b["zone"])].append(b)

        result = []
        total_idle_all = 0
        for (act_name, proj, zone_name), act_blocks in activity_blocks.items():
            act_blocks.sort(key=lambda x: x["startTime"])
            total_idle_seconds = 0
            earliest_start = act_blocks[0]["startTime"]
            latest_end = act_blocks[-1]["endTime"]
            total_work_seconds = max(0, int((latest_end - earliest_start).total_seconds()))
            for idx in range(len(act_blocks) - 1):
                curr, nxt = act_blocks[idx], act_blocks[idx + 1]
                for mb in blocks:
                    if mb["startTime"] > curr["endTime"] and mb["endTime"] < nxt["startTime"]:
                        if mb["is_idle"]:
                            dur = (mb["endTime"] - mb["startTime"]).total_seconds()
                            if dur > 0: total_idle_seconds += dur
            total_idle_all += total_idle_seconds
            result.append({"project": proj, "zone": zone_name, "activity": act_name,
                           "startTime": earliest_start.strftime("%Y-%m-%d %H:%M:%S"),
                           "endTime": latest_end.strftime("%Y-%m-%d %H:%M:%S"),
                           "totalIdleTime": format_duration(total_idle_seconds),
                           "totalIdleSeconds": total_idle_seconds,
                           "totalWorkSeconds": total_work_seconds, "count": len(act_blocks)})

        order_map = {name: i for i, name in enumerate(ACTIVITY_ORDER)}
        result.sort(key=lambda x: order_map.get(x["activity"], len(ACTIVITY_ORDER)))
        total_unique = len(result)
        paginated = result[skip: skip + limit] if limit > 0 else (result[skip:] if skip < total_unique else [])
        return {"data": paginated, "total": total_unique, "totalIdleSeconds": total_idle_all}
    except Exception as e:
        print(f"Error: {e}")
        import traceback; traceback.print_exc()
        return {"data": [], "total": 0}
