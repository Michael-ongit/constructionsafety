"""
Upload, AI analysis, and audit-saving endpoints.

Routes:
  POST /api/upload-analysis    — upload image/video → YOLO + GPT analysis
  GET  /api/next-audit-id      — generate next audit ID for a project
  POST /api/save-audit         — persist a completed audit to compliance_audit
  POST /api/send-audit-email   — send audit PDF via email
  GET  /api/download-audit-pdf/{audit_id} — download stored PDF
"""

import os, uuid
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from audit import analyze_frame
from database import get_db
from email_alert import send_audit_email
from models import ActivityNew, ComplianceAudit, SafetyIncident
from schemas import UploadResponse
from auth import require_role

router = APIRouter(tags=["audit"])
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
AUDIT_REPORTS_DIR = Path("audit_reports")
AUDIT_REPORTS_DIR.mkdir(exist_ok=True)


def _clear_incident_cache():
    try:
        from routes.incidents import _cache
        _cache.clear()
    except Exception:
        pass


def _save_uploaded_video_frame(video_path: str) -> str:
    """Extract the first frame from a video file for analysis."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            raise ValueError("Could not read a frame from the uploaded video")
        frame_path = os.path.splitext(video_path)[0] + "_frame.jpg"
        cv2.imwrite(frame_path, frame)
        return frame_path
    finally:
        cap.release()


def _run_exact_audit_code(
    filepath: str, content_type, media_type: str,
    project: str = "", activity: str = "", sub_activity: str = "",
    remarks: str = "", initiated_by: str = "", location: str = "",
    site_engineer: str = "", target_date: str = "",
    user_keyword: str = "",
) -> dict:
    """Run YOLO + GPT analysis pipeline on the given file."""
    image_path = filepath
    if media_type == "video":
        image_path = _save_uploaded_video_frame(filepath)

    result = analyze_frame(
        image_path,
        user_keyword=user_keyword,
        project=project, activity=activity, sub_activity=sub_activity,
        remarks=remarks, initiated_by=initiated_by, location=location,
        site_engineer=site_engineer, target_date=target_date,
    )
    safety_issues = result.get("safety_issues", [])
    possible_risks = result.get("possible_risks", [])
    recommendations = result.get("recommendations", [])
    annotated_bytes = result.get("annotated_image_bytes")

    safety_issues_text = "; ".join(safety_issues) if safety_issues else "No safety issues detected"
    possible_risks_text = "; ".join(possible_risks) if possible_risks else ""
    recommendations_text = "; ".join(recommendations) if recommendations else "Review the image and follow site safety procedures."

    risk = "low"
    text_combined = " ".join(safety_issues + possible_risks).lower()
    if any(w in text_combined for w in ["fatal", "electrocution", "fall from height", "collapse", "critical"]):
        risk = "critical"
    elif any(w in text_combined for w in ["immediate", "high risk", "serious", "no helmet", "fall", "struck"]):
        risk = "high"
    elif safety_issues:
        risk = "medium"

    image_bytes = annotated_bytes
    if image_bytes is None:
        with open(image_path, "rb") as f:
            image_bytes = f.read()

    annotated_url = ""
    annotated_path_candidate = os.path.splitext(image_path)[0] + "_annotated.jpg"
    if os.path.exists(annotated_path_candidate):
        annotated_url = f"/uploads/{os.path.basename(annotated_path_candidate)}"

    return {
        "report": result.get("report_text", safety_issues_text),
        "unsafe_activity": safety_issues_text, "possible_incidents": possible_risks_text,
        "recommendation": recommendations_text, "recommendations_list": recommendations,
        "safety_issues_list": safety_issues, "possible_risks_list": possible_risks,
        "risk": risk, "violations": result.get("detected_issues_raw", []) or safety_issues,
        "worker_count": 0, "image_bytes": image_bytes, "media_type": media_type,
        "annotated_url": annotated_url,
        "process_detections": result.get("process_detections", {}),
        "observation_date": result.get("observation_date"),
        "observation_time": result.get("observation_time"),
    }


@router.post("/api/upload-analysis", response_model=UploadResponse, dependencies=[Depends(require_role("ehs", "super_admin"))])
async def upload_analysis(
    file: UploadFile = File(...),
    project: str = Form(""),
    activity: str = Form(""),
    sub_activity: str = Form(""),
    location: str = Form(""),
    remarks: str = Form(""),
    initiated_by: str = Form(""),
    db: Session = Depends(get_db),
):
    """Upload a file (image/video), run YOLO + GPT analysis, save to safety_model + Activity_new."""
    ext = file.filename.split(".")[-1].lower()
    filename = f"{uuid.uuid4()}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    content = await file.read()

    # Optimize image before saving
    if ext not in {"mp4", "mov", "avi", "webm", "mkv"}:
        try:
            import cv2, numpy as np
            nparr = np.frombuffer(content, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                h, w = img.shape[:2]
                if w > 1920 or h > 1920:
                    r = 1920 / max(w, h)
                    img = cv2.resize(img, (int(w * r), int(h * r)), interpolation=cv2.INTER_AREA)
                _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                content = buf.tobytes()
        except Exception:
            pass

    with open(filepath, "wb") as f:
        f.write(content)

    media_type = "video" if ext in {"mp4", "mov", "avi", "webm", "mkv"} else "image"
    media_url = f"/uploads/{filename}"

    try:
        result = _run_exact_audit_code(
            filepath, file.content_type, media_type,
            project=project, activity=activity, sub_activity=sub_activity,
            remarks=remarks, initiated_by=initiated_by, location=location,
            user_keyword=remarks,
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Azure OpenAI audit failed: {exc}") from exc

    analyzed_at = datetime.now()
    clean_project = project.strip()

    incident = SafetyIncident(Date=analyzed_at.date(), Time=analyzed_at.time().replace(microsecond=0),
                              CameraZone=location, Project=clean_project,
                              UnsafeActivity=result["unsafe_activity"], Risk=result["risk"],
                              Recommendation=result["recommendation"], Remarks=result["possible_incidents"],
                              ImageBlob=result["image_bytes"])
    log = ActivityNew(time_frame=analyzed_at, activity="UAUC Capture", zone=location, project=clean_project)

    try:
        db.add(incident); db.add(log); db.commit(); db.refresh(incident)
        _clear_incident_cache()
    except Exception:
        db.rollback()

    return {"mediaType": media_type, "mediaUrl": media_url, "annotatedMediaUrl": result["annotated_url"],
            "project": clean_project, "analyzedAt": analyzed_at.isoformat(), "incidentId": incident.ID if incident.ID else None,
            "analysis": {"worker_count": result["worker_count"], "violations": result["violations"],
                         "detections": [], "summary": result["report"], "report": result["report"],
                         "risk": result["risk"], "recommendation": result["recommendation"],
                         "safety_issues_list": result["safety_issues_list"],
                         "recommendations_list": result["recommendations_list"],
                         "possible_risks_list": result["possible_risks_list"]},
            "observation_date": str(result.get("observation_date", "")),
            "observation_time": str(result.get("observation_time", ""))}


def _next_audit_number(project: str, db: Session) -> int:
    """Compute the next incremental audit number for a project (e.g. MPSB-42)."""
    prefix = f"{project}-"
    rows = db.query(ComplianceAudit.Audit_Id).filter(
        ComplianceAudit.Project == project, ComplianceAudit.Audit_Id != None,
        ComplianceAudit.Audit_Id.like(f"{prefix}%")).all()
    max_num = 0
    for (aid,) in rows:
        if aid and aid.startswith(prefix):
            try:
                num = int(aid[len(prefix):])
                if num > max_num: max_num = num
            except ValueError: pass
    return max_num + 1


@router.get("/api/next-audit-id")
def next_audit_id(
    project: str = "",
    db: Session = Depends(get_db),
):
    """Return the next audit display ID for a project (e.g. MPSB-5)."""
    if not project: return {"audit_display_id": "PENDING"}
    return {"audit_display_id": f"{project}-{_next_audit_number(project, db)}"}


@router.post("/api/save-audit", dependencies=[Depends(require_role("ehs", "super_admin"))])
async def save_audit(
    project: str = Form(""),
    activity: str = Form(""),
    sub_activity: str = Form(""),
    location: str = Form(""),
    remarks: str = Form(""),
    initiated_by: str = Form(""),
    observation_date: str = Form(""),
    observation_time: str = Form(""),
    safety_issues: str = Form(""),
    possible_risks: str = Form(""),
    recommendations: str = Form(""),
    target_date: str = Form(""),
    site_engineer: str = Form(""),
    image_blob: UploadFile = File(None),
    db: Session = Depends(get_db),
):
    """Persist a completed UAUC audit (form data + image) to the compliance_audit table."""
    from datetime import date, datetime as dt
    obs_date = None
    try:
        obs_date = date.fromisoformat(observation_date) if observation_date else date.today()
    except Exception:
        obs_date = date.today()

    tgt_date = date.fromisoformat(target_date) if target_date else None

    image_bytes = None
    if image_blob and image_blob.filename:
        raw = await image_blob.read()
        try:
            import cv2, numpy as np
            nparr = np.frombuffer(raw, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                h, w = img.shape[:2]
                if w > 1920 or h > 1920:
                    r = 1920 / max(w, h)
                    img = cv2.resize(img, (int(w * r), int(h * r)), interpolation=cv2.INTER_AREA)
                _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                image_bytes = buf.tobytes()
            else:
                image_bytes = raw
        except Exception:
            image_bytes = raw

    audit_display_id = f"{project}-{_next_audit_number(project, db)}"
    obs_time = None
    if observation_time:
        try:
            obs_time = dt.strptime(observation_time, "%H:%M:%S").time()
        except Exception:
            obs_time = dt.now().time()

    compliance = ComplianceAudit(Project=project, Activity=activity, Sub_Activity=sub_activity,
                                 Location=location, Observation_Date=obs_date, Observation_Time=obs_time,
                                 Safety_Issues=safety_issues, Possible_Risks=possible_risks,
                                 Recommendations=recommendations, Breif_Desription=remarks,
                                 Initiated_By=initiated_by, Audit_Id=audit_display_id,
                                 Image_Blob=image_bytes, Target_Date=tgt_date, Site_Engineer=site_engineer)
    try:
        db.add(compliance); db.commit(); db.refresh(compliance)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save audit: {exc}")

    return {"status": "success", "id": compliance.Sl_No, "audit_display_id": audit_display_id}


@router.post("/api/send-audit-email", dependencies=[Depends(require_role("ehs", "super_admin"))])
async def send_audit_email_endpoint(
    request: Request,
    audit_id: str = Form(""),
    project: str = Form(""),
    location: str = Form(""),
    remarks: str = Form(""),
    target_date: str = Form(""),
    attachment_name: str = Form(""),
    attachment_size: str = Form(""),
    site_engineer: str = Form(""),
    recipient_email: str = Form(""),
    pdf_file: UploadFile = File(None),
    download_url: str = Form(""),
):
    """Send the audit report PDF via email."""
    pdf_bytes = await pdf_file.read() if pdf_file and pdf_file.filename else None
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF file is required")
    pdf_path = AUDIT_REPORTS_DIR / f"{audit_id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    try:
        sent = send_audit_email(audit_id, project, pdf_bytes, location=location, remarks=remarks,
                                target_date=target_date, attachment_name=attachment_name,
                                attachment_size=attachment_size, site_engineer=site_engineer,
                                recipient_email=recipient_email, download_url=download_url)
        return {"status": "success" if sent else "skipped", "audit_id": audit_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {exc}")


@router.get("/api/download-audit-pdf/{audit_id}")
async def download_audit_pdf(
    audit_id: str,
):
    """Download a previously generated audit PDF."""
    pdf_path = AUDIT_REPORTS_DIR / f"{audit_id}.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(str(pdf_path), media_type="application/pdf",
                        filename=f"Audit_Report_{audit_id}.pdf")
