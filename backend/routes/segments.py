"""
Casting-segment analysis endpoints.

Routes:
  GET /api/segments/casting-data — aggregated casting activity data

Processes Activity_new records into segment groups (project × zone),
computes average activity times, idle times, monthly throughput,
mould efficiency, and sub-process analysis.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta
from sqlalchemy import asc
from database import get_db
from models import ActivityNew
from collections import defaultdict

router = APIRouter(prefix="/api/segments", tags=["segments"])


def clean_activity(name: str) -> str:
    return name.replace('_done', '')


def merge_activities(rows):
    """Merge consecutive same-activity records into blocks."""
    if not rows: return []
    sorted_rows = sorted(rows, key=lambda r: r.time_frame or datetime.min)
    merged = []
    i = 0
    while i < len(sorted_rows):
        current = sorted_rows[i]
        activity_name = current.activity or ""
        start_time = current.time_frame
        zone = current.zone or ""
        project = current.project or ""
        end_time = start_time
        while i < len(sorted_rows) - 1 and (sorted_rows[i + 1].activity or "") == activity_name:
            i += 1
            end_time = sorted_rows[i].time_frame
        duration = max(1, int((end_time - start_time).total_seconds() / 60))
        merged.append({"activity": activity_name, "start_time": start_time, "end_time": end_time,
                       "zone": zone, "project": project, "duration": duration})
        i += 1

    result = []
    prev_end = None
    for r in merged:
        is_idle = ("idle" in r["activity"].lower() or
                   r["activity"].lower().replace("_done", "").replace(" ", "_")
                   in ("uncertain", "not_valid", "not_detected", "not detected"))
        if is_idle: continue
        idle_seconds = max(0, int((r["start_time"] - prev_end).total_seconds() / 60)) if prev_end and r["start_time"] else 0
        wt = r["duration"]
        at = wt + idle_seconds
        result.append({"activity": clean_activity(r["activity"]), "start_time": r["start_time"],
                       "end_time": r["end_time"], "zone": r["zone"], "project": r["project"],
                       "duration": at, "idle": idle_seconds, "wt": wt, "at": at})
        prev_end = r["end_time"]
    return result


@router.get("/casting-data")
def get_casting_data(
    db: Session = Depends(get_db),
    yard: Optional[str] = Query(None), mould: Optional[str] = Query(None),
    start: Optional[str] = Query(None), end: Optional[str] = Query(None),
):
    """Return aggregated casting segment data."""
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
        merged = merge_activities(all_records)
        if not merged:
            return _empty_response()

        segment_groups = defaultdict(list)
        for r in merged:
            segment_groups[(r["project"], r["zone"])].append(r)

        segments = []
        for (proj, zone_name), acts in segment_groups.items():
            activity_groups = defaultdict(list)
            for a in acts: activity_groups[a["activity"]].append(a)
            activities_list = []
            total_at = 0
            for act_name, entries in activity_groups.items():
                avg_at = sum(e["at"] for e in entries) / len(entries)
                avg_wt = sum(e["wt"] for e in entries) / len(entries)
                avg_idle = sum(e["idle"] for e in entries) / len(entries)
                at = round(avg_at, 1)
                total_at += at
                activities_list.append({"name": act_name, "standardTime": round(avg_wt, 1),
                                        "idleNew": 0, "idle": round(avg_idle, 1),
                                        "wt": round(avg_wt, 1), "at": at})
            activities_list.sort(key=lambda x: -x["at"])
            segments.append({"segmentId": f"{proj}-{zone_name}".replace(" ", "_"),
                             "mouldNo": proj, "castingYard": zone_name,
                             "startDate": min(a["start_time"] for a in acts).strftime("%Y-%m-%d"),
                             "endDate": max(a["end_time"] for a in acts).strftime("%Y-%m-%d"),
                             "activities": activities_list, "totalAT": total_at})
        segments.sort(key=lambda s: s["startDate"])
        if yard and yard != "All": segments = [s for s in segments if s["castingYard"] == yard]
        if mould and mould != "All": segments = [s for s in segments if s["mouldNo"] == mould]
        if start: segments = [s for s in segments if s["startDate"] >= start]
        if end: segments = [s for s in segments if s["startDate"] <= end]

        monthly = {m: 0 for m in range(1, 13)}
        for s in segments:
            try: monthly[int(s["startDate"].split("-")[1])] += 1
            except: pass
        monthly_throughput = [{"month": i, "count": monthly[i]} for i in range(1, 13)]

        all_merged = merge_activities(all_records)
        all_at_vals = [r["at"] for r in all_merged]
        avg_at_val = round(sum(all_at_vals) / len(all_at_vals), 1) if all_at_vals else 0

        act_stats = defaultdict(lambda: {"idle": [], "wt": []})
        for r in all_merged:
            act_stats[r["activity"]]["idle"].append(r["idle"])
            act_stats[r["activity"]]["wt"].append(r["wt"])

        activity_perf = [{"name": n, "avgIdle": round(sum(d["idle"]) / len(d["idle"]), 1) if d["idle"] else 0,
                          "avgWT": round(sum(d["wt"]) / len(d["wt"]), 1) if d["wt"] else 0}
                         for n, d in sorted(act_stats.items())]

        proj_stats = defaultdict(lambda: {"totalIdle": 0, "totalWT": 0, "count": 0})
        for s in segments:
            for act in s["activities"]:
                proj_stats[s["mouldNo"]]["totalIdle"] += act["idle"]
                proj_stats[s["mouldNo"]]["totalWT"] += act["wt"]
                proj_stats[s["mouldNo"]]["count"] += 1

        mould_eff_list = [{"mould": pn, "avgIdle": round(d["totalIdle"] / (d["count"] or 1), 1),
                           "avgWT": round(d["totalWT"] / (d["count"] or 1), 1)}
                          for pn, d in sorted(proj_stats.items())]

        sub_process = {}
        for name in act_stats:
            rows = [{"mould": s["mouldNo"], "time": round(a["at"] / 60, 1)}
                    for s in segments for a in s["activities"] if a["name"] == name]
            sub_process[name] = rows

        activities_list_resp = [{"name": n, "standardTime": round(sum(d["wt"]) / len(d["wt"]), 1) if d["wt"] else 0}
                                for n, d in sorted(act_stats.items())]

        return {"segments": segments,
                "yards": sorted(set(r["zone"] for r in merged if r["zone"])),
                "moulds": sorted(set(r["project"] for r in merged if r["project"])),
                "activities": activities_list_resp, "totalSegments": len(segments),
                "bestTime": None, "avgAT": avg_at_val,
                "monthlyThroughput": monthly_throughput, "activityPerformance": activity_perf,
                "mouldEfficiency": mould_eff_list, "subProcessAnalysis": sub_process}
    except Exception as e:
        print(f"Error fetching casting data: {e}")
        import traceback; traceback.print_exc()
        return _empty_response()


def _empty_response():
    return {"segments": [], "yards": [], "moulds": [], "activities": [], "totalSegments": 0,
            "bestTime": None, "avgAT": 0,
            "monthlyThroughput": [{"month": i, "count": 0} for i in range(1, 13)],
            "activityPerformance": [], "mouldEfficiency": [], "subProcessAnalysis": {}}
