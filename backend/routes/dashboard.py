"""
Dashboard role endpoints.

Routes:
  GET /api/dashboard/projects  — curated project list
  GET /api/dashboard/locations — distinct locations for a project from compliance_audit
  GET /api/dashboard/stats     — KPI summary for a given project
  GET /api/dashboard/incidents — safety incidents for a given project
  GET /api/dashboard/uaucs     — UAUC records from compliance_audit for a given project
"""

import os
from datetime import date, time as _time, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, defer
from sqlalchemy import func, extract
from database import get_db
from models import SafetyIncident, Camera, ComplianceAudit, SiteMonitoringUser, ProjectCategory
from auth import require_role

_openai_client = None

def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import AzureOpenAI
        _openai_client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
        )
    return _openai_client


def _analyze_unsafe_activities(safety_issues_text: str) -> str:
    """Send aggregated safety issues to GPT-4o and return the most frequent unsafe activity."""
    if not safety_issues_text or not safety_issues_text.strip():
        return ""
    try:
        response = _get_openai_client().chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a construction safety analyst. You receive a list of safety issues "
                        "collected from UAUC (Unsafe Act / Unsafe Condition) observations for a specific "
                        "construction activity. Your task is to analyze the safety issues and identify "
                        "the MOST FREQUENT unsafe activity pattern. Return a concise 1-2 sentence summary "
                        "of the most common unsafe activity. Be specific about the hazard type. "
                        "Do NOT use markdown. Keep it under 100 words."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Below are the safety issues recorded for this activity. "
                        f"Identify the most frequent unsafe activity:\n\n{safety_issues_text}"
                    ),
                },
            ],
            max_tokens=200,
            temperature=0,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"GPT-4o unsafe activity analysis error: {e}")
        return ""

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ---------------------------------------------------------------------------
# Project → Category (BU) mapping — loaded from dbo.Project_Categories
# ---------------------------------------------------------------------------

def _load_project_category_map(db: Session) -> dict:
    """Query dbo.Project_Categories and return {Project_Name: Category}."""
    try:
        rows = db.query(ProjectCategory.Project_Name, ProjectCategory.Category).all()
        return {r.Project_Name: r.Category for r in rows if r.Project_Name and r.Category}
    except Exception as e:
        print(f"Error loading Project_Categories: {e}")
        return {}


def _get_categories(db: Session) -> list:
    """Return distinct categories from dbo.Project_Categories."""
    try:
        rows = db.query(ProjectCategory.Category).filter(
            ProjectCategory.Category.isnot(None), ProjectCategory.Category != ""
        ).distinct().all()
        return sorted([r[0] for r in rows])
    except Exception as e:
        print(f"Error loading categories: {e}")
        return []


def _get_project_list(db: Session) -> list:
    """Return project names from dbo.Project_Categories."""
    try:
        rows = db.query(ProjectCategory.Project_Name).filter(
            ProjectCategory.Project_Name.isnot(None), ProjectCategory.Project_Name != ""
        ).distinct().order_by(ProjectCategory.Project_Name).all()
        return [r[0] for r in rows]
    except Exception as e:
        print(f"Error loading project list: {e}")
        return []


@router.get("/projects")
def get_projects(
    db: Session = Depends(get_db),
):
    """Return the project list from dbo.Project_Categories."""
    return _get_project_list(db)


@router.get("/debug/projects-in-db", dependencies=[Depends(require_role("super_admin"))])
def get_projects_in_db(
    db: Session = Depends(get_db),
):
    """Debug: return distinct Project values actually in compliance_audit."""
    rows = db.query(ComplianceAudit.Project).filter(ComplianceAudit.Project.isnot(None), ComplianceAudit.Project != "").distinct().all()
    return [r[0] for r in rows]


@router.get("/debug/category-counts", dependencies=[Depends(require_role("super_admin"))])
def get_category_counts(
    db: Session = Depends(get_db),
):
    """Debug: return UAUC counts per category."""
    cat_map = _load_project_category_map(db)
    rows = db.query(ComplianceAudit.Project, func.count(ComplianceAudit.Sl_No)).filter(
        ComplianceAudit.Project.isnot(None), ComplianceAudit.Project != ""
    ).group_by(ComplianceAudit.Project).all()
    cat_counts = {}
    for proj, cnt in rows:
        cat = cat_map.get(proj, "Unmapped")
        cat_counts[cat] = cat_counts.get(cat, 0) + cnt
    return cat_counts


@router.get("/locations")
def get_locations(
    project: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Return distinct Location values from compliance_audit for a given project."""
    try:
        q = db.query(ComplianceAudit.Location).filter(
            ComplianceAudit.Location.isnot(None), ComplianceAudit.Location != ""
        )
        if project:
            q = q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
        rows = q.distinct().order_by(ComplianceAudit.Location).all()
        return [r[0] for r in rows]
    except Exception as e:
        print(f"Dashboard locations error: {e}")
        return []


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_stats(
    project: str = Query(default=""),
    location: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Return summary KPIs for a project from compliance_audit + safety_model."""
    try:
        # UAUC counts from compliance_audit
        uauc_q = db.query(func.count(ComplianceAudit.Sl_No))
        open_q = db.query(func.count(ComplianceAudit.Sl_No)).filter(ComplianceAudit.Status.in_(["OPEN", "AWAITING_APPROVAL", "REWORK_REQUIRED"]))
        closed_q = db.query(func.count(ComplianceAudit.Sl_No)).filter(ComplianceAudit.Status.in_(["CLOSED", "ACCEPTED"]))
        overdue_q = db.query(func.count(ComplianceAudit.Sl_No)).filter(
            ComplianceAudit.Status.in_(["OPEN", "AWAITING_APPROVAL", "REWORK_REQUIRED"]),
            ComplianceAudit.Target_Date.isnot(None), ComplianceAudit.Target_Date < date.today())

        if project:
            uauc_q = uauc_q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
            open_q = open_q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
            closed_q = closed_q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
            overdue_q = overdue_q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
        if location:
            uauc_q = uauc_q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))
            open_q = open_q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))
            closed_q = closed_q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))
            overdue_q = overdue_q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))

        total_uaucs = uauc_q.scalar() or 0
        open_uaucs = open_q.scalar() or 0
        closed_uaucs = closed_q.scalar() or 0
        overdue_uaucs = overdue_q.scalar() or 0

        # Safety incidents from safety_model
        si_q = db.query(func.count(SafetyIncident.ID))
        if project:
            si_q = si_q.filter(SafetyIncident.Project == project)
        if location:
            si_q = si_q.filter(SafetyIncident.CameraZone.ilike(f"%{location}%"))
        total_incidents = si_q.scalar() or 0

        # Critical alerts
        cr_q = db.query(func.count(SafetyIncident.ID)).filter(SafetyIncident.Risk.in_(["high", "critical"]))
        if project:
            cr_q = cr_q.filter(SafetyIncident.Project == project)
        if location:
            cr_q = cr_q.filter(SafetyIncident.CameraZone.ilike(f"%{location}%"))
        critical_alerts = cr_q.scalar() or 0

        return {
            "total_uaucs": total_uaucs,
            "open_uaucs": open_uaucs,
            "closed_uaucs": closed_uaucs,
            "overdue_uaucs": overdue_uaucs,
            "total_incidents": total_incidents,
            "critical_alerts": critical_alerts,
        }
    except Exception as e:
        print(f"Dashboard stats error: {e}")
        return {"total_uaucs": 0, "open_uaucs": 0, "closed_uaucs": 0, "overdue_uaucs": 0,
                "total_incidents": 0, "critical_alerts": 0}


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

@router.get("/incidents")
def get_incidents(
    project: str = Query(default=""),
    location: str = Query(default=""),
    limit: int = Query(default=50),
    db: Session = Depends(get_db),
):
    """Return safety incidents filtered by project and/or location."""
    try:
        q = db.query(
            SafetyIncident.ID,
            SafetyIncident.Date,
            SafetyIncident.Time,
            SafetyIncident.CameraZone,
            SafetyIncident.Project,
            SafetyIncident.UnsafeActivity,
            SafetyIncident.Risk,
            SafetyIncident.Recommendation,
            SafetyIncident.Remarks,
        ).order_by(SafetyIncident.ID.desc())

        if project:
            q = q.filter(SafetyIncident.Project.ilike(f"%{project}%"))
        if location:
            q = q.filter(SafetyIncident.CameraZone.ilike(f"%{location}%"))

        rows = q.limit(limit).all()

        return [
            {
                "id": r.ID,
                "date": str(r.Date) if r.Date else "",
                "time": str(r.Time) if r.Time else "",
                "camera_zone": r.CameraZone or "",
                "project": r.Project or "",
                "unsafe_activity": r.UnsafeActivity or "",
                "risk": r.Risk or "",
                "recommendation": r.Recommendation or "",
                "remark": r.Remarks or "",
            }
            for r in rows
        ]
    except Exception as e:
        print(f"Dashboard incidents error: {e}")
        return []


# ---------------------------------------------------------------------------
# UAUCs (from compliance_audit)
# ---------------------------------------------------------------------------

@router.get("/uaucs")
def get_uaucs(
    project: str = Query(default=""),
    location: str = Query(default=""),
    sbg: str = Query(default=""),
    bu: str = Query(default=""),
    from_date: str = Query(default=""),
    to_date: str = Query(default=""),
    activity: str = Query(default=""),
    limit: int = Query(default=200),
    db: Session = Depends(get_db),
):
    """Return UAUC records from compliance_audit with optional filters."""
    try:
        q = db.query(ComplianceAudit).options(defer(ComplianceAudit.Image_Blob))
        if project:
            q = q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
        if location:
            q = q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))
        if sbg:
            q = q.filter(ComplianceAudit.SBG.ilike(f"%{sbg}%"))
        if bu:
            q = q.filter(ComplianceAudit.BU.ilike(f"%{bu}%"))
        if activity:
            q = q.filter(ComplianceAudit.Activity.ilike(f"%{activity}%"))
        if from_date:
            try:
                q = q.filter(ComplianceAudit.Observation_Date >= date.fromisoformat(from_date))
            except ValueError:
                pass
        if to_date:
            try:
                q = q.filter(ComplianceAudit.Observation_Date <= date.fromisoformat(to_date))
            except ValueError:
                pass
        rows = q.order_by(ComplianceAudit.Sl_No.desc()).limit(limit).all()

        today = date.today()
        items = []
        for r in rows:
            status = r.Status or "OPEN"
            if status not in ("CLOSED", "ACCEPTED", "REJECTED", "REWORK_REQUIRED") and r.Target_Date:
                try:
                    if r.Target_Date < today:
                        status = "OVERDUE"
                except Exception:
                    pass

            def _fmt(d):
                if not d:
                    return None
                return d.isoformat() if hasattr(d, "isoformat") else str(d)

            shift = "Unknown"
            obs_time_str = None
            if r.Observation_Time:
                s = _classify_shift(r.Observation_Time)
                if s != "Unknown":
                    shift = s
                    obs_time_str = str(r.Observation_Time)

            items.append({
                "id": r.Sl_No,
                "audit_id": r.Audit_Id or f"UAUC-{r.Sl_No}",
                "project": r.Project or "",
                "bu": r.BU or "",
                "sbg": r.SBG or "",
                "activity": r.Activity or "",
                "sub_activity": r.Sub_Activity or "",
                "location": r.Location or "",
                "initiated_by": r.Initiated_By or "",
                "site_engineer": r.Site_Engineer or "",
                "observation_date": _fmt(r.Observation_Date),
                "observation_time": obs_time_str,
                "shift": shift,
                "target_date": _fmt(r.Target_Date),
                "closed_date": _fmt(r.Closed_Date),
                "status": status,
                "safety_issues": r.Safety_Issues or "",
                "brief_description": r.Breif_Desription or "",
                "has_image": r.Image_Blob is not None,
            })

        return items
    except Exception as e:
        print(f"Dashboard UAUCs error: {e}")
        return []


# ---------------------------------------------------------------------------
# SBG-scoped locations
# ---------------------------------------------------------------------------

@router.get("/sbg-locations")
def get_sbg_locations(
    sbg: str = Query(default=""),
    project: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Return distinct locations scoped to an SBG (and optionally a project)."""
    try:
        q = db.query(ComplianceAudit.Location).filter(
            ComplianceAudit.Location.isnot(None), ComplianceAudit.Location != ""
        )
        if sbg:
            q = q.filter(ComplianceAudit.SBG.ilike(f"%{sbg}%"))
        if project:
            q = q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
        rows = q.distinct().order_by(ComplianceAudit.Location).all()
        return [r[0] for r in rows]
    except Exception as e:
        print(f"SBG locations error: {e}")
        return []


# ---------------------------------------------------------------------------
# SBG-scoped BUs
# ---------------------------------------------------------------------------

@router.get("/sbg-bus")
def get_sbg_bus(
    sbg: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Return distinct BUs (categories) from dbo.Project_Categories."""
    return _get_categories(db)


# ---------------------------------------------------------------------------
# SBG-scoped projects
# ---------------------------------------------------------------------------

@router.get("/sbg-projects")
def get_sbg_projects(
    sbg: str = Query(default=""),
    bu: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Return distinct projects scoped to an SBG (and optionally a BU category)."""
    try:
        cat_map = _load_project_category_map(db)
        categories = _get_categories(db)
        q = db.query(ComplianceAudit.Project).filter(
            ComplianceAudit.Project.isnot(None), ComplianceAudit.Project != ""
        )
        if sbg:
            q = q.filter(ComplianceAudit.SBG.ilike(f"%{sbg}%"))
        rows = q.distinct().order_by(ComplianceAudit.Project).all()
        projects = [r[0] for r in rows]
        if bu and bu in categories:
            projects = [p for p in projects if cat_map.get(p) == bu]
        return projects
    except Exception as e:
        print(f"SBG projects error: {e}")
        return []


# ---------------------------------------------------------------------------
# SBG Rollup — comprehensive dashboard data in one call
# ---------------------------------------------------------------------------

def _classify_shift(obs_time) -> str:
    """Derive Day/Night from Observation_Time. Day = 06:00-17:59, Night = 18:00-05:59."""
    if not obs_time:
        return "Unknown"
    try:
        if isinstance(obs_time, str):
            parts = obs_time.strip().split()
            time_part = parts[-1]
            h = int(time_part.split(":")[0])
        else:
            h = obs_time.hour if hasattr(obs_time, "hour") else int(str(obs_time).split(":")[0])
        return "Day" if 6 <= h < 18 else "Night"
    except Exception:
        return "Unknown"


def _apply_scope_filters(q, sbg="", bu="", project="", location="", activity="", from_date="", to_date="", cat_map=None, categories=None):
    """Apply common scope filters to a UAUC query."""
    if sbg:
        q = q.filter(ComplianceAudit.SBG.ilike(f"%{sbg}%"))
    if bu:
        # If bu is a category, filter by mapped projects from DB
        if categories and bu in categories:
            cat_projects = [p for p, c in (cat_map or {}).items() if c == bu]
            if cat_projects:
                q = q.filter(ComplianceAudit.Project.in_(cat_projects))
        else:
            q = q.filter(ComplianceAudit.BU.ilike(f"%{bu}%"))
    if project:
        q = q.filter(ComplianceAudit.Project.ilike(f"%{project}%"))
    if location:
        q = q.filter(ComplianceAudit.Location.ilike(f"%{location}%"))
    if activity:
        q = q.filter(ComplianceAudit.Activity.ilike(f"%{activity}%"))
    if from_date:
        try:
            q = q.filter(ComplianceAudit.Observation_Date >= date.fromisoformat(from_date))
        except ValueError:
            pass
    if to_date:
        try:
            q = q.filter(ComplianceAudit.Observation_Date <= date.fromisoformat(to_date))
        except ValueError:
            pass
    return q


@router.get("/sbg-rollup")
def sbg_rollup(
    sbg: str = Query(default=""),
    bu: str = Query(default=""),
    project: str = Query(default=""),
    location: str = Query(default=""),
    activity: str = Query(default=""),
    from_date: str = Query(default=""),
    to_date: str = Query(default=""),
    compare_from_date: str = Query(default=""),
    compare_to_date: str = Query(default=""),
    compare_b_from_date: str = Query(default=""),
    compare_b_to_date: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """
    Comprehensive SBG dashboard rollup.
    Returns: kpis, activities (ranked + day/night), BU comparison,
             project summary, trend (daily counts), and SBG name.
    """
    try:
        today = date.today()

        # Load project→category mapping from DB
        cat_map = _load_project_category_map(db)
        categories = _get_categories(db)

        # ── Base query ──────────────────────────────────────────────
        base = db.query(ComplianceAudit).options(defer(ComplianceAudit.Image_Blob))
        base = _apply_scope_filters(base, sbg, bu, project, location, activity, from_date, to_date, cat_map, categories)
        all_rows = base.order_by(ComplianceAudit.Sl_No.desc()).all()

        # If no SBG column data exists yet, fall back to project-scoped
        has_sbg_data = any(r.SBG for r in all_rows)

        # ── KPIs ────────────────────────────────────────────────────
        total = len(all_rows)
        open_statuses = {"OPEN", "AWAITING_APPROVAL", "REWORK_REQUIRED"}
        closed_statuses = {"CLOSED", "ACCEPTED"}
        open_count = 0
        closed_count = 0
        overdue_count = 0
        day_count = 0
        night_count = 0
        unknown_shift = 0
        close_days_sum = 0
        close_count = 0

        for r in all_rows:
            s = (r.Status or "OPEN").upper()
            if s in open_statuses:
                open_count += 1
            if s in closed_statuses:
                closed_count += 1
                if r.Observation_Date and r.Closed_Date:
                    close_days_sum += (r.Closed_Date - r.Observation_Date).days
                    close_count += 1
            if s in open_statuses and r.Target_Date and r.Target_Date < today:
                overdue_count += 1
            shift = _classify_shift(r.Observation_Time)
            if shift == "Day":
                day_count += 1
            elif shift == "Night":
                night_count += 1
            else:
                unknown_shift += 1

        avg_close_days = round(close_days_sum / close_count, 1) if close_count > 0 else 0

        # Month-wise average closure time — uses ALL closed records (no date
        # filter) so the historical trend chart always has data to display.
        closed_base = db.query(ComplianceAudit).options(
            defer(ComplianceAudit.Image_Blob),
        )
        closed_base = _apply_scope_filters(closed_base, sbg, bu, project, location, "", "")
        closed_rows = closed_base.filter(
            ComplianceAudit.Status.in_(list(closed_statuses))
        ).all()
        monthly_close = {}
        for r in closed_rows:
            if not r.Observation_Date or not r.Closed_Date:
                continue
            try:
                obs = r.Observation_Date if hasattr(r.Observation_Date, "strftime") else date.fromisoformat(str(r.Observation_Date)[:10])
                cl  = r.Closed_Date if hasattr(r.Closed_Date, "strftime") else date.fromisoformat(str(r.Closed_Date)[:10])
            except Exception:
                continue
            month = obs.strftime("%Y-%m")
            hours = (cl - obs).days * 24
            if month not in monthly_close:
                monthly_close[month] = {"sum": 0, "count": 0}
            monthly_close[month]["sum"] += hours
            monthly_close[month]["count"] += 1
        monthly_avg_close_hours = [
            {"month": month, "avg_hours": round(values["sum"] / values["count"], 1)}
            for month, values in sorted(monthly_close.items())
            if values["count"]
        ]

        kpis = {
            "total_uaucs": total,
            "open_uaucs": open_count,
            "closed_uaucs": closed_count,
            "overdue_uaucs": overdue_count,
            "day_uaucs": day_count,
            "night_uaucs": night_count,
            "unknown_shift_uaucs": unknown_shift,
            "avg_close_days": avg_close_days,
            "monthly_avg_close_hours": monthly_avg_close_hours,
        }

        # ── Activity ranking ────────────────────────────────────────
        act_map = {}
        for r in all_rows:
            act = r.Activity or "Unknown"
            if act not in act_map:
                act_map[act] = {"name": act, "total": 0, "day": 0, "night": 0}
            act_map[act]["total"] += 1
            shift = _classify_shift(r.Observation_Time)
            if shift == "Day":
                act_map[act]["day"] += 1
            elif shift == "Night":
                act_map[act]["night"] += 1

        activities = sorted(act_map.values(), key=lambda x: x["total"], reverse=True)[:10]

        # Most frequent sub-activity for the SBG-wide top activity.  This is
        # the sub_activity captured when the UAUC is filed in compliance_audit.
        # Uses case-insensitive matching on both Activity and Sub_Activity.
        # Sub_Activity may contain multiple values separated by ; or \n.
        top_sub_activity = {"name": "", "total": 0}
        if activities:
            top_act_key = activities[0]["name"].strip().casefold()
            sub_map = {}
            for r in all_rows:
                row_act_key = (r.Activity or "").strip().casefold()
                if row_act_key != top_act_key:
                    continue
                raw_sub = r.Sub_Activity or ""
                sub_parts = [s.strip() for s in raw_sub.replace("\n", ";").split(";") if s.strip()]
                for sub_name in sub_parts:
                    key = sub_name.casefold()
                    if key not in sub_map:
                        sub_map[key] = {"name": sub_name, "total": 0}
                    sub_map[key]["total"] += 1
            if sub_map:
                top_sub_activity = max(sub_map.values(), key=lambda x: x["total"])

        # Most frequent safety issue for the most critical activity.
        # Safety_Issues is semicolon/newline-delimited (e.g. "No PPE\nNo Helmet").
        # Split into individual issues and count each one separately.
        top_safety_issue = {"name": "", "total": 0}
        if activities:
            top_act_key = activities[0]["name"].strip().casefold()
            issue_map = {}
            for r in all_rows:
                row_act_key = (r.Activity or "").strip().casefold()
                if row_act_key != top_act_key:
                    continue
                raw_issues = r.Safety_Issues or ""
                parts = [s.strip() for s in raw_issues.replace("\n", ";").split(";") if s.strip()]
                for issue_name in parts:
                    key = issue_name.casefold()
                    if key not in issue_map:
                        issue_map[key] = {"name": issue_name, "total": 0}
                    issue_map[key]["total"] += 1
            if issue_map:
                top_safety_issue = max(issue_map.values(), key=lambda x: x["total"])

        # ── GPT-4o unsafe activity analysis for most critical activity ──
        top_unsafe_analysis = ""
        if activities:
            top_act_key = activities[0]["name"].strip().casefold()
            top_act_safety = [r.Safety_Issues for r in all_rows if (r.Activity or "").strip().casefold() == top_act_key and r.Safety_Issues]
            if top_act_safety:
                combined = "\n".join(f"- {s}" for s in top_act_safety)
                top_unsafe_analysis = _analyze_unsafe_activities(combined)

        # Period A vs Period B comparison
        compare_from = None
        compare_to = None
        compare_b_from = None
        compare_b_to = None
        period_a_total = 0
        period_b_total = 0
        try:
            if compare_from_date:
                compare_from = date.fromisoformat(compare_from_date)
                compare_to = date.fromisoformat(compare_to_date) if compare_to_date else compare_from
                period_a_total = _apply_scope_filters(
                    db.query(ComplianceAudit), sbg=sbg, bu=bu, project=project, location=location,
                    from_date=compare_from.isoformat(), to_date=compare_to.isoformat()
                ).count()
            if compare_b_from_date:
                compare_b_from = date.fromisoformat(compare_b_from_date)
                compare_b_to = date.fromisoformat(compare_b_to_date) if compare_b_to_date else compare_b_from
                period_b_total = _apply_scope_filters(
                    db.query(ComplianceAudit), sbg=sbg, bu=bu, project=project, location=location,
                    from_date=compare_b_from.isoformat(), to_date=compare_b_to.isoformat()
                ).count()
            if period_b_total > 0:
                change_pct = round(((period_b_total - period_a_total) / period_b_total) * 100, 1)
                trend_dir = "up" if change_pct > 0 else ("down" if change_pct < 0 else "flat")
            else:
                change_pct = 0
                trend_dir = "new" if period_a_total > 0 else "unknown"
        except Exception:
            period_a_total = 0
            period_b_total = 0
            change_pct = 0
            trend_dir = "unknown"

        # ── BU comparison ───────────────────────────────────────────
        bu_map = {}
        for r in all_rows:
            # Use project→category map from DB
            b = cat_map.get(r.Project, "Unassigned")
            if b == "Unassigned":
                continue
            if b not in bu_map:
                bu_map[b] = {"name": b, "total": 0, "open": 0, "overdue": 0, "day": 0, "night": 0, "activities": {}}
            bu_map[b]["total"] += 1
            s = (r.Status or "OPEN").upper()
            if s in open_statuses:
                bu_map[b]["open"] += 1
            if s in open_statuses and r.Target_Date and r.Target_Date < today:
                bu_map[b]["overdue"] += 1
            shift = _classify_shift(r.Observation_Time)
            if shift == "Day":
                bu_map[b]["day"] += 1
            elif shift == "Night":
                bu_map[b]["night"] += 1
            act = r.Activity or "Unknown"
            bu_map[b]["activities"][act] = bu_map[b]["activities"].get(act, 0) + 1

        # Ensure all defined categories always appear (even with 0 data)
        for _cat in categories:
            if _cat not in bu_map:
                bu_map[_cat] = {"name": _cat, "total": 0, "open": 0, "overdue": 0, "day": 0, "night": 0, "activities": {}}

        bus = []
        for b_name, b_data in sorted(bu_map.items(), key=lambda x: x[1]["total"], reverse=True):
            top_act = max(b_data["activities"], key=b_data["activities"].get) if b_data["activities"] else "--"
            total_b = b_data["total"]
            bus.append({
                "name": b_name,
                "total_uaucs": b_data["total"],
                "open": b_data["open"],
                "overdue": b_data["overdue"],
                "top_activity": top_act,
                "day_pct": round((b_data["day"] / total_b) * 100) if total_b else 0,
                "night_pct": round((b_data["night"] / total_b) * 100) if total_b else 0,
            })

        # ── Project summary ─────────────────────────────────────────
        proj_map = {}
        for r in all_rows:
            p = r.Project or "Unknown"
            if p not in proj_map:
                # Use project→category map from DB
                b = cat_map.get(r.Project, "Unassigned")
                proj_map[p] = {"name": p, "bu": b, "total": 0, "open": 0, "overdue": 0, "activities": {}, "locations": set()}
            proj_map[p]["total"] += 1
            s = (r.Status or "OPEN").upper()
            if s in open_statuses:
                proj_map[p]["open"] += 1
            if s in open_statuses and r.Target_Date and r.Target_Date < today:
                proj_map[p]["overdue"] += 1
            act = r.Activity or "Unknown"
            proj_map[p]["activities"][act] = proj_map[p]["activities"].get(act, 0) + 1
            if r.Location:
                proj_map[p]["locations"].add(r.Location)

        projects = []
        for p_name, p_data in sorted(proj_map.items(), key=lambda x: x[1]["total"], reverse=True):
            top_act = max(p_data["activities"], key=p_data["activities"].get) if p_data["activities"] else "--"
            projects.append({
                "name": p_name,
                "bu": p_data["bu"],
                "total_uaucs": p_data["total"],
                "open": p_data["open"],
                "overdue": p_data["overdue"],
                "top_activity": top_act,
                "locations_count": len(p_data["locations"]),
            })

        # ── Daily trend ─────────────────────────────────────────────
        daily = {}
        for r in all_rows:
            if r.Observation_Date:
                d_str = r.Observation_Date.isoformat() if hasattr(r.Observation_Date, "isoformat") else str(r.Observation_Date)
                if d_str not in daily:
                    daily[d_str] = {"date": d_str, "day": 0, "night": 0, "total": 0}
                daily[d_str]["total"] += 1
                shift = _classify_shift(r.Observation_Time)
                if shift == "Day":
                    daily[d_str]["day"] += 1
                elif shift == "Night":
                    daily[d_str]["night"] += 1

        daily_trend = sorted(daily.values(), key=lambda x: x["date"])

        # ── User's SBG name ─────────────────────────────────────────
        sbg_name = sbg or ""

        return {
            "sbg_name": sbg_name,
            "has_sbg_data": has_sbg_data,
            "kpis": kpis,
            "activities": activities,
            "top_sub_activity": top_sub_activity,
            "top_safety_issue": top_safety_issue,
            "top_unsafe_analysis": top_unsafe_analysis,
            "monthly_avg_close_hours": monthly_avg_close_hours,
            "trend": {
                "daily": daily_trend,
            },
            "period_comparison": {
                "period_a_total": period_a_total,
                "period_b_total": period_b_total,
                "change_pct": change_pct,
                "direction": trend_dir,
                "period_a_from": compare_from.isoformat() if 'compare_from' in locals() and compare_from else "",
                "period_a_to": compare_to.isoformat() if 'compare_to' in locals() and compare_to else "",
                "period_b_from": compare_b_from.isoformat() if 'compare_b_from' in locals() and compare_b_from else "",
                "period_b_to": compare_b_to.isoformat() if 'compare_b_to' in locals() and compare_b_to else "",
            },
            "bus": bus,
            "projects": projects,
            "filters": {
                "sbgs": list(set(r.SBG for r in all_rows if r.SBG)),
                "bus": list(set(cat_map.get(r.Project, "Unassigned") for r in all_rows if cat_map.get(r.Project, "Unassigned") != "Unassigned")),
                "projects": list(set(r.Project for r in all_rows if r.Project)),
                "locations": list(set(r.Location for r in all_rows if r.Location)),
                "activities_list": list(set(r.Activity for r in all_rows if r.Activity)),
                "project_category_map": cat_map,
            },
        }
    except Exception as e:
        print(f"SBG rollup error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "sbg_name": sbg,
            "has_sbg_data": False,
            "kpis": {"total_uaucs": 0, "open_uaucs": 0, "closed_uaucs": 0, "overdue_uaucs": 0,
                     "day_uaucs": 0, "night_uaucs": 0, "unknown_shift_uaucs": 0},
            "activities": [],
            "top_sub_activity": {"name": "", "total": 0},
            "top_safety_issue": {"name": "", "total": 0},
            "top_unsafe_analysis": "",
            "monthly_avg_close_hours": [],
            "trend": {"daily": []},
            "period_comparison": {"period_a_total": 0, "period_b_total": 0, "change_pct": 0, "direction": "unknown", "period_a_from": "", "period_a_to": "", "period_b_from": "", "period_b_to": ""},
            "bus": [],
            "projects": [],
            "filters": {"sbgs": [], "bus": [], "projects": [], "locations": [], "activities_list": []},
        }
