"""
Pydantic request/response models for API endpoints.

Grouped by domain: camera, incident, analytics, upload/audit.
Only schemas actively used by the current API routes are kept here.
"""

from pydantic import BaseModel
from typing import Optional, List


# ── Incident ──────────────────────────────────────────────────────────────
class IncidentOut(BaseModel):
    """Response model for /api/incidents."""
    id: str
    timestamp: str
    cameraZone: str
    unsafeActivity: str
    status: str
    risk: str
    imageUrl: Optional[str] = None
    hasImage: bool = False
    oneDriveUrl: Optional[str] = None
    localPath: Optional[str] = None

    class Config:
        from_attributes = True


# ── Analytics ─────────────────────────────────────────────────────────────
class AnalyticsSummary(BaseModel):
    """Response model for /api/analytics/summary."""
    compliance_rate: float
    total_workers: int
    total_incidents: int
    critical_alerts: int
    active_cameras: int


# ── Upload / Audit ────────────────────────────────────────────────────────
class Detection(BaseModel):
    """Individual object detection within an image."""
    label: str
    bbox: List[float]
    confidence: float
    color: str
    violation: bool = False


class AnalysisResult(BaseModel):
    """AI analysis summary returned after upload."""
    worker_count: int
    violations: List[str]
    detections: List[Detection]
    summary: str
    report: Optional[str] = None
    risk: Optional[str] = None
    recommendation: Optional[str] = None
    safety_issues_list: Optional[List[str]] = None
    recommendations_list: Optional[List[str]] = None
    possible_risks_list: Optional[List[str]] = None


class UploadResponse(BaseModel):
    """Full response from /api/upload-analysis."""
    mediaType: str   # "image" | "video"
    mediaUrl: str
    annotatedMediaUrl: Optional[str] = None
    analysis: AnalysisResult
    project: Optional[str] = None
    analyzedAt: Optional[str] = None
    incidentId: Optional[int] = None
    observation_date: Optional[str] = None
    observation_time: Optional[str] = None
