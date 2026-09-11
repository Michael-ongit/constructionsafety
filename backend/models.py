"""
SQLAlchemy ORM models mirroring Azure SQL Server tables.

Tables:
  - safety_model        → SafetyIncident    (AI-detected violations)
  - cameras             → Camera            (camera registry)
  - Incidents           → Incident          (merged incident view)
  - activity_logs       → ActivityLog       (per-camera activity timeline)
  - Activity_new        → ActivityNew       (construction activity records)
  - compliance_audit    → ComplianceAudit   (UAUC core records)
  - uauc_evidence       → UAucEvidence      (closure after-images)
  - uauc_rejection_history → UAucRejectionHistory (rejection audit trail)
  - Site_Monitoring_Users → SiteMonitoringUser (user registry)
"""

from sqlalchemy import Column, Integer, String, Date, Time, LargeBinary, Float, DateTime, Text, Sequence
from sqlalchemy.sql import func
from database import Base, engine


class SafetyIncident(Base):
    """AI-detected safety incidents from the safety_model table."""
    __tablename__ = "safety_model"
    __table_args__ = {'quote': False}
    ID = Column('ID', Integer, primary_key=True, index=True, quote=False)
    Date = Column('Date', Date, quote=False)
    Time = Column('Time', Time, quote=False)
    CameraZone = Column('CameraZone', String(255), quote=False)
    Project = Column('Project', String(255), quote=False)
    UnsafeActivity = Column('UnsafeActivity', String(255), quote=False)
    Risk = Column('Risk', String(50), quote=False)
    Recommendation = Column('Recommendation', String(500), quote=False)
    Remarks = Column('Remarks', String(1000), nullable=True, quote=False)
    ImageBlob = Column('ImageBlob', LargeBinary, quote=False)


class Camera(Base):
    """Registered CCTV cameras with zone and status."""
    __tablename__ = "cameras"
    __table_args__ = {'quote': False}
    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String(50), nullable=False)
    name = Column(String(100), nullable=False)
    zone = Column(String(100), nullable=False)
    status = Column(String(50), default="Normal")
    detection = Column(String(200), default="Safety monitoring")
    video_url = Column(String(500), nullable=True)
    type = Column(String(20), default="static")
    created_at = Column(DateTime, server_default=func.now())


class Incident(Base):
    """Incidents table — merged view of safety events."""
    __tablename__ = "Incidents"
    __table_args__ = {'quote': False}
    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column('incident_id', String(50), quote=False)
    timestamp = Column('timestamp', DateTime, quote=False)
    camera = Column('camera', String(100), quote=False)
    zone = Column('zone', String(100), quote=False)
    type = Column('type', String(100), quote=False)
    confidence = Column('confidence', Float, quote=False)
    status = Column('status', String(100), quote=False)
    severity = Column('severity', String(20), quote=False)
    imageUrl = Column('imageUrl', String(500), quote=False)
    oneDriveUrl = Column('oneDriveUrl', String(500), quote=False, nullable=True)
    localPath = Column('localPath', String(500), quote=False, nullable=True)


class ActivityLog(Base):
    """Per-camera activity logs from CCTV analysis."""
    __tablename__ = "activity_logs"
    __table_args__ = {'quote': False}
    id = Column(Integer, primary_key=True, index=True)
    log_id = Column('log_id', String(50), quote=False)
    day = Column('day', String(20), quote=False)
    time = Column('time', String(20), quote=False)
    camera_zone = Column('camera_zone', String(100), quote=False)
    activity = Column('activity', String(200), quote=False)
    start_time = Column('start_time', String(20), quote=False)
    end_time = Column('end_time', String(20), quote=False)
    action = Column('action', String(50), quote=False)
    image_url = Column('image_url', String(500), quote=False)
    created_at = Column('created_at', DateTime, quote=False)


class ActivityNew(Base):
    """Construction activity records (casting, curing, etc.)."""
    __tablename__ = "Activity_new"
    __table_args__ = {'quote': False}
    id = Column(Integer, primary_key=True, index=True)
    time_frame = Column('TimeFrame', DateTime, quote=False)
    activity = Column('Activity', String(255), quote=False)
    zone = Column('zone', String(255), quote=False)
    project = Column('Project', String(255), quote=False)


class ComplianceAudit(Base):
    """
    Core UAUC records.

    Lifecycle: OPEN → AWAITING_APPROVAL → ACCEPTED → CLOSED
                                         → REWORK_REQUIRED → (back to AWAITING_APPROVAL)
                                         → REJECTED
    """
    __tablename__ = "compliance_audit"
    Sl_No = Column('Sl.No', Integer, primary_key=True, index=True, autoincrement=True, quote=True)
    Project = Column('Project', String(200), nullable=True)
    Activity = Column('Activity', String(200), nullable=True)
    Sub_Activity = Column('Sub_Activity', String(200), nullable=True)
    Observation_Date = Column('Observation_Date', Date, nullable=True)
    Observation_Time = Column('Observation_Time', Time, nullable=True)
    Safety_Issues = Column('Safety_Issues', String, nullable=True)
    Possible_Risks = Column('Possible_Risks', String, nullable=True)
    Recommendations = Column('Recommendations', String, nullable=True)
    Breif_Desription = Column('Breif_Desription', String, nullable=True)
    Image_Blob = Column('Image_Blob', LargeBinary, nullable=True)
    Initiated_By = Column('Initiated_By', String(255), nullable=True)
    Location = Column('Location', String(255), nullable=True)
    Audit_Id = Column('Audit_Id', String(255), nullable=True)
    Target_Date = Column('Target_Date', Date, nullable=True)
    Site_Engineer = Column('Site_Engineer', String(255), nullable=True)
    Status = Column('Status', String(50), nullable=False, server_default='OPEN')
    Closed_Date = Column('Closed_Date', Date, nullable=True)
    Closed_Time = Column('Closed_Time', Time, nullable=True)
    Corrective_Action_Taken = Column('Corrective_Action_Taken', String, nullable=True)
    Initiator_comment = Column('Initiator_comment', Text, nullable=True)
    Closure_SE_Date = Column('Closure_SE_Date', Date, nullable=True)
    Closure_SE_Time = Column('Closure_SE_Time', String(10), nullable=True)
    Pending_Evidence = Column('Pending_Evidence', Text, nullable=True)
    Tot_Rework_Count = Column('Tot_Rework_Count', Integer, nullable=True, default=0)
    SBG = Column('SBG', String(255), nullable=True)
    BU = Column('BU', String(255), nullable=True)


class UAucEvidence(Base):
    """After-images uploaded by Site Engineer during closure."""
    __tablename__ = "uauc_evidence"
    Evidence_Id = Column('Evidence_Id', Integer, primary_key=True, autoincrement=True)
    Audit_Id = Column('Audit_Id', String(255), nullable=True)
    Issue_Name = Column('Issue_Name', String, nullable=True)
    After_Image_Blob = Column('After_Image_Blob', LargeBinary, nullable=True)


class UAucRejectionHistory(Base):
    """Audit trail for rejected/rework UAUCs."""
    __tablename__ = "uauc_rejection_history"
    Rejection_Id = Column('Rejection_Id', Integer, primary_key=True, index=True, autoincrement=True)
    Audit_Id = Column('Audit_Id', String(255), nullable=True)
    Rejected_By = Column('Rejected_By', String(255), nullable=True)
    Rejection_Date = Column('Rejection_Date', Date, nullable=True)
    Rejection_Comment = Column('Rejection_Comment', Text, nullable=True)
    Unresolved_Issues = Column('Unresolved_Issues', Text, nullable=True)
    Rework_Count = Column('Rework_Count', Integer, nullable=True)


class ProjectCategory(Base):
    """Project-to-category (BU) mapping from dbo.Project_Categories."""
    __tablename__ = "Project_Categories"
    # SQLite has no SQL Server-style schemas. Keep dbo for SQL Server while
    # allowing a clean local SQLite database to be created from the ORM.
    __table_args__ = ({'schema': 'dbo', 'quote': True}
                      if engine.dialect.name != 'sqlite' else {'quote': True})
    Project_Name = Column('Project_Name', String(255), primary_key=True)
    Category = Column('Category', String(255), nullable=True)


class SiteMonitoringUser(Base):
    """Application users (Site Engineers, EHSO, Super Admins, SBG)."""
    __tablename__ = "Site_Monitoring_Users"
    Sr_No = Column('Sr_No', Integer, primary_key=True, index=True, autoincrement=True)
    Project_Name = Column('Project_Name', String(255), nullable=False)
    Employee_Name = Column('Employee_Name', String(255), nullable=False)
    Role = Column('Role', String(100), nullable=False)
    PS_Number = Column('PS_Number', String(50), nullable=False, unique=True)
    Mail_ID = Column('Mail_ID', String(255), nullable=False)
    SBG = Column('SBG', String(255), nullable=True)
    BU = Column('BU', String(255), nullable=True)
