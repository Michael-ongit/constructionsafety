"""
UAUC (Unsafe Act / Unsafe Condition) lifecycle endpoints.

Lifecycle states:
  OPEN → AWAITING_APPROVAL → ACCEPTED → CLOSED
                           → REWORK_REQUIRED → (back to AWAITING_APPROVAL)
                           → REJECTED

Routes:
  GET    /api/uaucs/my                                     — list (filtered, paginated)
  GET    /api/uaucs/{id}                                   — detail view
  GET    /api/uaucs/{id}/image                             — primary image blob
  GET    /api/uaucs/{id}/evidence-images                   — list after-image evidence
  GET    /api/uaucs/{id}/evidence-images/{eid}/image       — evidence image blob
  POST   /api/uaucs/{id}/evidence-images                   — upload after-image
  DELETE /api/uaucs/{id}/evidence-images/{eid}             — delete evidence
  POST   /api/uaucs/{id}/pending-evidence                  — save pending (in-progress) evidence
  DELETE /api/uaucs/{id}/pending-evidence/{idx}            — remove pending evidence
  POST   /api/uaucs/{id}/submit-closure                    — SE submits closure
  POST   /api/uaucs/{id}/review                            — EHS accepts / rejects / rework
  PATCH  /api/uaucs/{id}/status                            — direct status update
  GET    /api/uaucs/debug/test-email                       — SMTP config diagnostics
"""

import base64, json
from datetime import date, datetime, time
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session, defer
from sqlalchemy import func, extract
from typing import Optional
from database import get_db
from models import ComplianceAudit, UAucEvidence, UAucRejectionHistory, SiteMonitoringUser
from auth import get_current_user, require_role, TokenPayload
from email_alert import (
    send_closure_submitted_notification,
    send_closure_accepted_notification,
    send_closure_rejected_notification,
)

router = APIRouter(prefix="/api/uaucs", tags=["uaucs"])


# ---------------------------------------------------------------------------
# H1: IDOR helper — ownership / authorization verification
# ---------------------------------------------------------------------------
def _norm_identity(value: str | None) -> str:
    """Normalize names/project values before comparing DB and JWT data."""
    return (value or "").strip().casefold()


def _check_uauc_access(request: Request, row: ComplianceAudit, db: Session) -> None:
    """Raise 403 if the authenticated user is not authorized to access this UAUC.
    Allows unauthenticated access (for image serving when no token is present)."""
    user = getattr(request.state, "user", None)
    if not user:
        return  # allow unauthenticated access (image endpoints)
    role = user.get("role", "")
    if role == "super_admin":
        return  # unrestricted
    if role == "site":
        user_name = db.query(SiteMonitoringUser.Employee_Name).filter(
            SiteMonitoringUser.PS_Number == user.get("sub", "")
        ).scalar()
        if not user_name or _norm_identity(user_name) != _norm_identity(row.Site_Engineer):
            raise HTTPException(status_code=403, detail="Access denied: not your UAUC")
    elif role == "ehs":
        user_name = db.query(SiteMonitoringUser.Employee_Name).filter(
            SiteMonitoringUser.PS_Number == user.get("sub", "")
        ).scalar()
        # EHS engineers review corrective actions for their project, even when
        # another EHS user originally created the UAUC. Keep the initiator
        # match as a fallback for legacy rows without a project value.
        same_project = (
            _norm_identity(user.get("project_name"))
            and _norm_identity(user.get("project_name")) == _norm_identity(row.Project)
        )
        same_initiator = user_name and _norm_identity(user_name) == _norm_identity(row.Initiated_By)
        if not user_name or not (same_project or same_initiator):
            raise HTTPException(status_code=403, detail="Access denied: UAUC is outside your project")
    else:
        raise HTTPException(status_code=403, detail="Access denied")


# ---------------------------------------------------------------------------
# Image optimisation helper
# ---------------------------------------------------------------------------

def _optimize_image_bytes(image_bytes: bytes, max_dim: int = 1920, quality: int = 85) -> bytes:
    """Resize image if its largest dimension exceeds max_dim; re-encode as JPEG."""
    try:
        import cv2, numpy as np
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return image_bytes
        h, w = img.shape[:2]
        if w > max_dim or h > max_dim:
            r = max_dim / max(w, h)
            img = cv2.resize(img, (int(w * r), int(h * r)), interpolation=cv2.INTER_AREA)
        _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buf.tobytes()
    except Exception:
        return image_bytes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_uauc(row: ComplianceAudit, rework_count: int = 0,
                    resolved_issues: set = None, rework_unresolved: str = None,
                    has_image: bool = None) -> dict:
    """Convert a ComplianceAudit ORM row into a JSON-serialisable dict."""
    issues_raw = row.Safety_Issues or ""
    issues_list = [s.strip() for s in issues_raw.replace("\n", ";").split(";") if s.strip()]
    risk_raw = row.Possible_Risks or ""
    risks_list = [s.strip() for s in risk_raw.replace("\n", ";").split(";") if s.strip()]
    recs_raw = row.Recommendations or ""
    recs_list = [s.strip() for s in recs_raw.replace("\n", ";").split(";") if s.strip()]

    def _fmt_date(d):
        if not d: return None
        if isinstance(d, str):
            try: return date.fromisoformat(d).isoformat()
            except: return d
        return d.isoformat()

    obs_date = _fmt_date(row.Observation_Date)
    target_date = _fmt_date(row.Target_Date)
    closed_date = _fmt_date(row.Closed_Date)
    closed_time = str(row.Closed_Time) if row.Closed_Time else None

    if has_image is None: has_image = row.Image_Blob is not None
    image_url = f"/api/uaucs/{row.Sl_No}/image" if has_image else None
    corrective = row.Corrective_Action_Taken or ""
    closure_se_date = row.Closure_SE_Date
    closure_se_time = row.Closure_SE_Time

    # Determine unresolved issues string
    if row.Status in ('ACCEPTED', 'CLOSED'):
        unresolved_str = ""
    elif rework_unresolved and rework_count > 0:
        unresolved_str = rework_unresolved
    else:
        all_issue_names = set(issues_list)
        resolved = resolved_issues or set()
        unresolved_names = all_issue_names - resolved
        unresolved_str = "; ".join(sorted(unresolved_names)) if unresolved_names else ""

    return {"id": row.Sl_No, "audit_id": row.Audit_Id or f"UAUC-{row.Sl_No}",
            "project": row.Project or "", "activity": row.Activity or "",
            "sub_activity": row.Sub_Activity or "", "location": row.Location or "",
            "observation_date": obs_date, "observation_time": str(row.Observation_Time) if row.Observation_Time else None,
            "safety_issues": issues_list, "safety_issues_text": row.Safety_Issues or "",
            "issues_count": len(issues_list), "possible_risks": risks_list,
            "recommendations": recs_list, "breif_description": row.Breif_Desription or "",
            "initiated_by": row.Initiated_By or "", "site_engineer": row.Site_Engineer or "",
            "target_date": target_date, "status": row.Status or "OPEN",
            "closed_date": closed_date, "closed_time": closed_time,
            "has_image": has_image, "image_url": image_url,
            "corrective_action_taken": corrective, "initiator_comment": row.Initiator_comment or "",
            "closure_se_date": _fmt_date(closure_se_date),
            "closure_se_time": closure_se_time if closure_se_time else None,
            "unresolved_issues": unresolved_str, "rework_count": rework_count}


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------

@router.get("/my")
def get_my_uaucs(
    request: Request,
    engineer: str = Query(""),
    initiated_by: str = Query(""),
    status: str = Query(""),
    search: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    List UAUCs with filtering and status summary.
    Scope is determined by the authenticated user's role from the JWT token.
    """
    # Determine scope from the authenticated user's JWT role
    user = getattr(request.state, "user", None)
    user_role = user.get("role", "") if user else ""
    user_ps = user.get("sub", "") if user else ""
    is_super = user_role == "super_admin"
    is_ehs = user_role == "ehs"
    ehs_project = _norm_identity(user.get("project_name")) if is_ehs and not is_super else ""

    # C3: For non-admin users, ALWAYS override client params — never trust client-supplied scope
    # Resolve PS_Number → Employee_Name for DB column matching (Site_Engineer / Initiated_By store names)
    if not is_super:
        user_name = db.query(SiteMonitoringUser.Employee_Name).filter(
            SiteMonitoringUser.PS_Number == user_ps
        ).scalar()
        if user_name:
            if is_ehs:
                # EHS review is project-scoped, not limited to rows created by
                # the currently logged-in EHS engineer.
                initiated_by = ""
            else:
                engineer = user_name

    if is_ehs and not ehs_project:
        # Avoid accidentally returning all projects if a malformed token has no
        # project claim; the user can still access legacy rows by initiator only
        # through the detail authorization fallback.
        ehs_project = "__missing_project__"

    # Which rows have images?
    image_query = db.query(ComplianceAudit.Sl_No).filter(ComplianceAudit.Image_Blob.isnot(None))
    if engineer and not is_super: image_query = image_query.filter(ComplianceAudit.Site_Engineer == engineer)
    if initiated_by and not is_super: image_query = image_query.filter(ComplianceAudit.Initiated_By == initiated_by)
    if is_ehs and not is_super: image_query = image_query.filter(func.lower(ComplianceAudit.Project) == ehs_project)
    image_id_set = {sl for (sl,) in image_query.all()}

    query = db.query(ComplianceAudit).options(defer(ComplianceAudit.Image_Blob))
    if engineer and not is_super: query = query.filter(ComplianceAudit.Site_Engineer == engineer)
    if initiated_by and not is_super: query = query.filter(ComplianceAudit.Initiated_By == initiated_by)
    if is_ehs and not is_super: query = query.filter(func.lower(ComplianceAudit.Project) == ehs_project)

    today = date.today()
    if status:
        if status == "OVERDUE":
            query = query.filter(~ComplianceAudit.Status.in_(["CLOSED", "ACCEPTED", "REJECTED"]),
                                 ComplianceAudit.Target_Date.isnot(None), ComplianceAudit.Target_Date < today)
        else:
            query = query.filter(ComplianceAudit.Status == status)

    if search:
        like = f"%{search}%"
        query = query.filter(ComplianceAudit.Audit_Id.ilike(like) | ComplianceAudit.Location.ilike(like)
                             | ComplianceAudit.Safety_Issues.ilike(like)
                             | ComplianceAudit.Breif_Desription.ilike(like)
                             | ComplianceAudit.Activity.ilike(like))

    total = query.count()
    rows = query.order_by(ComplianceAudit.Sl_No.desc()).offset(skip).limit(limit).all()

    def _scope(q):
        if engineer and not is_super: q = q.filter(ComplianceAudit.Site_Engineer == engineer)
        if initiated_by and not is_super: q = q.filter(ComplianceAudit.Initiated_By == initiated_by)
        if is_ehs and not is_super: q = q.filter(func.lower(ComplianceAudit.Project) == ehs_project)
        return q

    status_rows = _scope(db.query(ComplianceAudit.Status, func.count(ComplianceAudit.Sl_No)).group_by(ComplianceAudit.Status)).all()
    counts = {r.Status: r[1] for r in status_rows}
    open_count = counts.get("OPEN", 0)
    awaiting_count = counts.get("AWAITING_APPROVAL", 0)
    rework_count = counts.get("REWORK_REQUIRED", 0)

    closed_this_month = _scope(db.query(func.count(ComplianceAudit.Sl_No)).filter(
        ComplianceAudit.Status.in_(["CLOSED", "ACCEPTED"]), ComplianceAudit.Closed_Date.isnot(None),
        extract('year', ComplianceAudit.Closed_Date) == today.year,
        extract('month', ComplianceAudit.Closed_Date) == today.month)).scalar() or 0

    overdue_count = _scope(db.query(func.count(ComplianceAudit.Sl_No)).filter(
        ComplianceAudit.Status.in_(["OPEN", "AWAITING_APPROVAL", "REWORK_REQUIRED"]),
        ComplianceAudit.Target_Date.isnot(None), ComplianceAudit.Target_Date < today)).scalar() or 0

    # Fetch rework / evidence / unresolved for listed rows
    audit_ids = [r.Audit_Id for r in rows if r.Audit_Id]
    rework_map, unresolved_map, evidence_map = {}, {}, {}
    if audit_ids:
        for c in db.query(ComplianceAudit.Audit_Id, ComplianceAudit.Tot_Rework_Count).filter(
                ComplianceAudit.Audit_Id.in_(audit_ids)).all():
            if c.Audit_Id: rework_map[c.Audit_Id] = c.Tot_Rework_Count or 0

        seen = set()
        for h in db.query(UAucRejectionHistory).filter(UAucRejectionHistory.Audit_Id.in_(audit_ids)
                        ).order_by(UAucRejectionHistory.Rejection_Id.desc()).all():
            if h.Audit_Id not in seen:
                seen.add(h.Audit_Id)
                if h.Unresolved_Issues: unresolved_map[h.Audit_Id] = h.Unresolved_Issues

        for e in db.query(UAucEvidence.Audit_Id, UAucEvidence.Issue_Name).filter(
                UAucEvidence.Audit_Id.in_(audit_ids)).distinct().all():
            evidence_map.setdefault(e.Audit_Id, set()).add(e.Issue_Name)

    items = [_serialize_uauc(r, rework_count=rework_map.get(r.Audit_Id, 0),
                             resolved_issues=evidence_map.get(r.Audit_Id, set()),
                             rework_unresolved=unresolved_map.get(r.Audit_Id),
                             has_image=(r.Sl_No in image_id_set)) for r in rows]

    # OVERDUE status override
    for item in items:
        if item["status"] not in ("CLOSED","ACCEPTED","REJECTED","REWORK_REQUIRED") and item["target_date"]:
            try:
                if date.fromisoformat(item["target_date"]) < today:
                    item["status"] = "OVERDUE"
            except: pass

    return {"items": items, "total": total, "skip": skip, "limit": limit,
            "summary": {"open": open_count, "closed_this_month": closed_this_month,
                        "awaiting_approval": awaiting_count, "rework_required": rework_count,
                        "overdue": overdue_count}}


@router.get("/{uauc_id}")
def get_uauc_detail(
    request: Request,
    uauc_id: int,
    db: Session = Depends(get_db),
):
    """Return full detail for a single UAUC, including evidence images."""
    row = db.query(ComplianceAudit).options(defer(ComplianceAudit.Image_Blob)).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, row, db)
    rework_count, resolved, rework_unresolved = 0, set(), None
    if row.Audit_Id:
        rework_count = row.Tot_Rework_Count or 0
        latest = db.query(UAucRejectionHistory.Unresolved_Issues).filter(
            UAucRejectionHistory.Audit_Id == row.Audit_Id).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
        if latest: rework_unresolved = latest.Unresolved_Issues
        resolved = set(e.Issue_Name for e in db.query(UAucEvidence.Issue_Name).filter(
            UAucEvidence.Audit_Id == row.Audit_Id).distinct().all())
    has_image = db.query(ComplianceAudit.Sl_No).filter(
        ComplianceAudit.Sl_No == uauc_id, ComplianceAudit.Image_Blob.isnot(None)).first() is not None
    result = _serialize_uauc(row, rework_count=rework_count, resolved_issues=resolved,
                             rework_unresolved=rework_unresolved, has_image=has_image)
    if row.Pending_Evidence:
        try: result["pending_evidence"] = json.loads(row.Pending_Evidence)
        except json.JSONDecodeError: result["pending_evidence"] = None
    else: result["pending_evidence"] = None

    result["evidence_images"] = []
    if row.Audit_Id:
        for e in db.query(UAucEvidence).filter(UAucEvidence.Audit_Id == row.Audit_Id).order_by(UAucEvidence.Evidence_Id.desc()).all():
            result["evidence_images"].append({"evidence_id": e.Evidence_Id, "issue_name": e.Issue_Name,
                                              "after_image_url": f"/api/uaucs/{uauc_id}/evidence-images/{e.Evidence_Id}/image" if e.After_Image_Blob else None})
    return result


# ---------------------------------------------------------------------------
# Image serving
# ---------------------------------------------------------------------------

def _serve_image_blob(blob):
    """Return a FastAPI Response for a raw image blob with content-type detection."""
    from fastapi.responses import Response
    if isinstance(blob, str):
        hex_str = blob.replace("0x", "").replace("0X", "")
        blob = bytes.fromhex(hex_str)
    content_type = "image/jpeg"
    if isinstance(blob, (bytes, bytearray)) and len(blob) >= 4:
        if blob[:4] == b'\x89PNG': content_type = "image/png"
        elif blob[:3] == b'GIF': content_type = "image/gif"
        elif blob[:2] == b'\xFF\xD8': content_type = "image/jpeg"
    return Response(content=blob, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{uauc_id}/image")
def get_uauc_image(
    request: Request,
    uauc_id: int,
    db: Session = Depends(get_db),
):
    """Serve the primary image for a UAUC."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row or not row.Image_Blob: raise HTTPException(status_code=404, detail="Image not found")
    _check_uauc_access(request, row, db)
    return _serve_image_blob(row.Image_Blob)


@router.get("/{uauc_id}/evidence-images/{evidence_id}/image")
def get_evidence_image(
    request: Request,
    uauc_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
):
    """Serve an after-image evidence blob."""
    evidence = db.query(UAucEvidence).filter(UAucEvidence.Evidence_Id == evidence_id).first()
    if not evidence or not evidence.After_Image_Blob: raise HTTPException(status_code=404, detail="Evidence image not found")
    uauc_row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not uauc_row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, uauc_row, db)
    return _serve_image_blob(evidence.After_Image_Blob)


@router.get("/{uauc_id}/evidence-images")
def list_evidence_images(
    request: Request,
    uauc_id: int,
    db: Session = Depends(get_db),
):
    """List all after-images for a UAUC as base64 data URLs."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, row, db)
    return [{"evidence_id": e.Evidence_Id, "issue_name": e.Issue_Name,
             "after_image": "data:image/png;base64," + base64.b64encode(e.After_Image_Blob).decode("ascii") if e.After_Image_Blob else None}
            for e in db.query(UAucEvidence).filter(UAucEvidence.Audit_Id == row.Audit_Id).all()]


# ---------------------------------------------------------------------------
# Evidence CRUD
# ---------------------------------------------------------------------------

class EvidenceImageSubmit(BaseModel):
    audit_id: str
    issue_name: str
    after_image: str  # base64 data URL

@router.post("/{uauc_id}/evidence-images")
def save_evidence_image(
    request: Request,
    uauc_id: int,
    payload: EvidenceImageSubmit,
    db: Session = Depends(get_db),
):
    """Save an after-image for a specific issue."""
    uauc_row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not uauc_row:
        raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, uauc_row, db)
    raw = payload.after_image
    if "," in raw: raw = raw.split(",", 1)[1]
    image_bytes = _optimize_image_bytes(base64.b64decode(raw))
    evidence = UAucEvidence(Audit_Id=payload.audit_id, Issue_Name=payload.issue_name, After_Image_Blob=image_bytes)
    db.add(evidence); db.commit(); db.refresh(evidence)
    return {"evidence_id": evidence.Evidence_Id, "issue_name": evidence.Issue_Name}


@router.delete("/{uauc_id}/evidence-images/{evidence_id}")
def delete_evidence_image(
    request: Request,
    uauc_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
):
    """Delete a specific evidence image."""
    evidence = db.query(UAucEvidence).filter(UAucEvidence.Evidence_Id == evidence_id).first()
    if not evidence: raise HTTPException(status_code=404, detail="Evidence not found")
    uauc_row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not uauc_row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, uauc_row, db)
    db.delete(evidence); db.commit()
    return {"detail": "deleted"}


# ---------------------------------------------------------------------------
# Pending evidence (in-progress closure)
# ---------------------------------------------------------------------------

class PendingEvidencePayload(BaseModel):
    issue_index: int
    after_image: str  # base64 data URL

class ClosureSubmit(BaseModel):
    corrective_action_taken: str = ""
    closure_date_time: Optional[str] = None
    status: str = "AWAITING_APPROVAL"
    after_images: Optional[dict] = None  # {issue_index: {issue_name, image_data}}


@router.post("/{uauc_id}/pending-evidence")
def save_pending_evidence(
    request: Request,
    uauc_id: int,
    payload: PendingEvidencePayload,
    db: Session = Depends(get_db),
):
    """Save in-progress evidence (not yet submitted) to Pending_Evidence JSON field."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, row, db)
    pending = {}
    if row.Pending_Evidence:
        try: pending = json.loads(row.Pending_Evidence)
        except json.JSONDecodeError: pending = {}
    pending[str(payload.issue_index)] = payload.after_image
    row.Pending_Evidence = json.dumps(pending)
    db.commit()
    return {"issue_index": payload.issue_index}


@router.delete("/{uauc_id}/pending-evidence/{issue_index}")
def delete_pending_evidence(
    request: Request,
    uauc_id: int,
    issue_index: int,
    db: Session = Depends(get_db),
):
    """Remove a single pending evidence entry."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, row, db)
    pending = {}
    if row.Pending_Evidence:
        try: pending = json.loads(row.Pending_Evidence)
        except json.JSONDecodeError: pending = {}
    pending.pop(str(issue_index), None)
    row.Pending_Evidence = json.dumps(pending) if pending else None
    db.commit()
    return {"detail": "deleted"}


# ---------------------------------------------------------------------------
# Closure submission
# ---------------------------------------------------------------------------

@router.post("/{uauc_id}/submit-closure")
def submit_uauc_closure(
    request: Request,
    uauc_id: int,
    payload: ClosureSubmit,
    db: Session = Depends(get_db),
):
    """Site Engineer submits closure: corrective action, after-images, status -> AWAITING_APPROVAL."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")

    # Verify the submitter is the assigned Site Engineer or Super Admin
    user = getattr(request.state, "user", None)
    if user and user.get("role") not in ("super_admin", "site"):
        raise HTTPException(status_code=403, detail="Only Site Engineers can submit closures")
    if user and user.get("role") == "site" and row.Site_Engineer:
        user_name = db.query(SiteMonitoringUser.Employee_Name).filter(
            SiteMonitoringUser.PS_Number == user.get("sub", "")).scalar()
        if user_name and _norm_identity(user_name) != _norm_identity(row.Site_Engineer):
            raise HTTPException(status_code=403, detail="You can only submit closures for your own UAUCs")

    if payload.corrective_action_taken:
        row.Corrective_Action_Taken = payload.corrective_action_taken
    if payload.closure_date_time and not row.Closure_SE_Date:
        try:
            dt = datetime.fromisoformat(payload.closure_date_time.replace('Z', '+00:00'))
            row.Closure_SE_Date = dt.date()
            row.Closure_SE_Time = dt.strftime('%H:%M')
        except: pass

    # H2: Only super_admin can set arbitrary status; site engineers always submit as AWAITING_APPROVAL
    user_role = user.get("role", "") if user else ""
    if user_role == "site":
        new_status = "AWAITING_APPROVAL"
    else:
        new_status = payload.status.upper()
    if new_status in ("OPEN","CLOSED","ACCEPTED","REJECTED","AWAITING_APPROVAL","REWORK_REQUIRED"):
        row.Status = new_status
        if new_status in ("CLOSED","ACCEPTED"):
            row.Closed_Date = date.today()
            row.Closed_Time = datetime.now().time()
        elif new_status in ("OPEN","REWORK_REQUIRED"):
            row.Closed_Date = None; row.Closed_Time = None

    if payload.after_images:
        row.Pending_Evidence = json.dumps(payload.after_images)
    db.commit(); db.refresh(row)

    # Notify EHS initiator
    if row.Status == "AWAITING_APPROVAL" and row.Audit_Id and row.Initiated_By:
        initiator = db.query(SiteMonitoringUser).filter(
            func.lower(SiteMonitoringUser.Employee_Name) == func.lower(row.Initiated_By),
            SiteMonitoringUser.Project_Name == row.Project).first()
        if initiator:
            try:
                send_closure_submitted_notification(audit_id=row.Audit_Id, project=row.Project or "",
                    site_engineer=row.Site_Engineer or "", activity=row.Activity or "",
                    location=row.Location or "", description=row.Breif_Desription or "",
                    recipient_email=initiator.Mail_ID)
            except Exception as exc:
                print(f"[EMAIL] Failed to send closure-submitted email: {exc}")
        else:
            fallback = db.query(SiteMonitoringUser).filter(
                SiteMonitoringUser.Project_Name == row.Project,
                SiteMonitoringUser.Role == "EHSO").first()
            if fallback:
                try:
                    send_closure_submitted_notification(audit_id=row.Audit_Id, project=row.Project or "",
                        site_engineer=row.Site_Engineer or "", activity=row.Activity or "",
                        location=row.Location or "", description=row.Breif_Desription or "",
                        recipient_email=fallback.Mail_ID)
                except Exception as exc:
                    print(f"[EMAIL] Failed to send email (fallback): {exc}")

    rc, resolved, rework_unresolved = 0, set(), None
    if row.Audit_Id:
        rc = row.Tot_Rework_Count or 0
        latest = db.query(UAucRejectionHistory.Unresolved_Issues).filter(
            UAucRejectionHistory.Audit_Id == row.Audit_Id).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
        if latest: rework_unresolved = latest.Unresolved_Issues
        resolved = set(e.Issue_Name for e in db.query(UAucEvidence.Issue_Name).filter(
            UAucEvidence.Audit_Id == row.Audit_Id).distinct().all())
    return _serialize_uauc(row, rework_count=rc, resolved_issues=resolved, rework_unresolved=rework_unresolved)


# ---------------------------------------------------------------------------
# Review (EHS decision)
# ---------------------------------------------------------------------------

class ReviewSubmit(BaseModel):
    decision: str  # 'accepted' or 'rejected'
    comment: str = ""
    rejected_by: str = ""
    unresolved_issues: Optional[str] = None


@router.post("/{uauc_id}/review")
def review_uauc_closure(
    request: Request,
    uauc_id: int,
    payload: ReviewSubmit,
    db: Session = Depends(get_db),
):
    """EHS reviews a closure submission: accepts, rejects, or marks as rework-required."""
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    _check_uauc_access(request, row, db)
    if payload.decision not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid decision. Must be 'accepted' or 'rejected'")

    # Verify the reviewer has EHS or Super Admin role
    user = getattr(request.state, "user", None)
    if user and user.get("role") not in ("super_admin", "ehs"):
        raise HTTPException(status_code=403, detail="Only EHS or Super Admin can review closures")

    row.Initiator_comment = payload.comment

    if payload.decision == "accepted":
        row.Status = "ACCEPTED"
        row.Closed_Date = date.today()
        row.Closed_Time = datetime.now().time()
        # Migrate Pending_Evidence → UAucEvidence rows
        if row.Pending_Evidence:
            try:
                pending = json.loads(row.Pending_Evidence)
                all_issues = [s.strip() for s in (row.Safety_Issues or "").replace("\n", ";").split(";") if s.strip()]
                for idx_str, img_data in pending.items():
                    try: idx = int(idx_str)
                    except: continue
                    issue_name = None
                    if isinstance(img_data, dict):
                        issue_name = img_data.get("issue_name", "")
                        img_data = img_data.get("image_data", "")
                    if not issue_name: issue_name = all_issues[idx] if 0 <= idx < len(all_issues) else f"Issue {idx + 1}"
                    if isinstance(img_data, str) and img_data:
                        raw = img_data.split(",", 1)[1] if "," in img_data else img_data
                        try:
                            evidence = UAucEvidence(Audit_Id=row.Audit_Id, Issue_Name=issue_name,
                                                    After_Image_Blob=_optimize_image_bytes(base64.b64decode(raw)))
                            db.add(evidence)
                        except: pass
                row.Pending_Evidence = None
            except json.JSONDecodeError: pass
    else:
        if payload.unresolved_issues:
            row.Status = "REWORK_REQUIRED"
            row.Closed_Date = None; row.Closed_Time = None
        else:
            row.Status = "REJECTED"
            row.Closed_Date = None; row.Closed_Time = None
            row.Pending_Evidence = None

        prev = row.Tot_Rework_Count or 0
        db.add(UAucRejectionHistory(Audit_Id=row.Audit_Id, Rejected_By=payload.rejected_by,
                                     Rejection_Date=date.today(), Rejection_Comment=payload.comment,
                                     Unresolved_Issues=payload.unresolved_issues or "", Rework_Count=prev + 1))
        row.Tot_Rework_Count = prev + 1

    db.commit(); db.refresh(row)

    # Notify Site Engineer
    if row.Audit_Id and row.Site_Engineer:
        se_email = (db.query(SiteMonitoringUser.Mail_ID).filter(
            func.lower(SiteMonitoringUser.Employee_Name) == func.lower(row.Site_Engineer),
            SiteMonitoringUser.Project_Name == row.Project).scalar()
                    or db.query(SiteMonitoringUser.Mail_ID).filter(
                        func.lower(SiteMonitoringUser.Employee_Name) == func.lower(row.Site_Engineer)).scalar())
        if se_email:
            try:
                if payload.decision == "accepted":
                    send_closure_accepted_notification(audit_id=row.Audit_Id, project=row.Project or "",
                        site_engineer=row.Site_Engineer, recipient_email=se_email)
                else:
                    unresolved = payload.unresolved_issues or ("Closure has been rejected. Please contact your EHS team."
                                                                if row.Status == "REJECTED" else "")
                    send_closure_rejected_notification(audit_id=row.Audit_Id, project=row.Project or "",
                        site_engineer=row.Site_Engineer, comment=payload.comment or "",
                        unresolved_issues=unresolved, recipient_email=se_email)
            except Exception as exc:
                print(f"[EMAIL] Failed to send decision email: {exc}")

    rc, rework_unresolved = 0, None
    if row.Audit_Id:
        rc = row.Tot_Rework_Count or 0
        latest = db.query(UAucRejectionHistory.Unresolved_Issues).filter(
            UAucRejectionHistory.Audit_Id == row.Audit_Id).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
        if latest: rework_unresolved = latest.Unresolved_Issues
    return _serialize_uauc(row, rework_count=rc, rework_unresolved=rework_unresolved)


# ---------------------------------------------------------------------------
# Direct status update
# ---------------------------------------------------------------------------

@router.patch("/{uauc_id}/status")
def update_uauc_status(
    request: Request,
    uauc_id: int,
    payload: dict,
    db: Session = Depends(get_db),
):
    """Directly update the status of a UAUC (Super Admin only)."""
    # Only Super Admin can directly change status
    user = getattr(request.state, "user", None)
    if user and user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only Super Admin can directly change UAUC status")
    row = db.query(ComplianceAudit).filter(ComplianceAudit.Sl_No == uauc_id).first()
    if not row: raise HTTPException(status_code=404, detail="UAUC not found")
    new_status = payload.get("status", "").upper()
    if new_status not in ("OPEN","CLOSED","ACCEPTED","REJECTED","AWAITING_APPROVAL","REWORK_REQUIRED"):
        raise HTTPException(status_code=400, detail="Invalid status")
    row.Status = new_status
    if new_status in ("CLOSED","ACCEPTED"):
        row.Closed_Date = date.today(); row.Closed_Time = datetime.now().time()
    elif new_status == "OPEN":
        row.Closed_Date = None; row.Closed_Time = None
    db.commit(); db.refresh(row)
    rc, rework_unresolved = 0, None
    if row.Audit_Id:
        rc = row.Tot_Rework_Count or 0
        latest = db.query(UAucRejectionHistory.Unresolved_Issues).filter(
            UAucRejectionHistory.Audit_Id == row.Audit_Id).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
        if latest: rework_unresolved = latest.Unresolved_Issues
    return _serialize_uauc(row, rework_count=rc, rework_unresolved=rework_unresolved)


# ---------------------------------------------------------------------------
# Debug / diagnostics
# ---------------------------------------------------------------------------

@router.get("/debug/test-email", dependencies=[Depends(require_role("super_admin"))])
def test_email_endpoint(
):
    """Return SMTP configuration status for debugging."""
    from email_alert import is_email_configured, SMTP_HOST, SMTP_PORT
    if not is_email_configured():
        return {"status": "SMTP_NOT_CONFIGURED", "message": "SENDER_EMAIL or SENDER_APP_PASSWORD not set"}
    import os
    sender = os.getenv("SENDER_EMAIL", "")
    app_pass = os.getenv("SENDER_APP_PASSWORD", "")
    return {"status": "CONFIGURED", "sender": sender,
            "password_masked": app_pass[:4] + "****" if len(app_pass) > 4 else "****",
            "smtp_host": SMTP_HOST, "smtp_port": SMTP_PORT}
