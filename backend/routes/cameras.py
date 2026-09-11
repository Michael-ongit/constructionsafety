"""
Camera device CRUD endpoints.

Routes:
  GET    /api/cameras     — list all cameras
  POST   /api/cameras     — add a new camera
  DELETE /api/cameras/{id} — remove a camera
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Camera
from auth import require_role

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("")
def get_cameras(
    db: Session = Depends(get_db),
):
    """List all registered CCTV cameras."""
    return [{"id": c.camera_id, "name": c.name, "zone": c.zone, "status": c.status,
             "detection": c.detection, "videoUrl": c.video_url, "type": c.type}
            for c in db.query(Camera).all()]


@router.post("", dependencies=[Depends(require_role("super_admin"))])
def add_camera(
    camera: dict,
    db: Session = Depends(get_db),
):
    """Register a new camera device."""
    new_cam = Camera(camera_id=camera.get("id") or camera.get("camera_id"), name=camera.get("name"),
                     zone=camera.get("zone"), status=camera.get("status", "Normal"),
                     detection=camera.get("detection", "Safety monitoring"),
                     video_url=camera.get("videoUrl"), type=camera.get("type", "static"))
    db.add(new_cam); db.commit(); db.refresh(new_cam)
    return {"id": new_cam.camera_id, "name": new_cam.name, "zone": new_cam.zone,
            "status": new_cam.status, "detection": new_cam.detection,
            "videoUrl": new_cam.video_url, "type": new_cam.type}


@router.delete("/{camera_id}", dependencies=[Depends(require_role("super_admin"))])
def delete_camera(
    camera_id: str,
    db: Session = Depends(get_db),
):
    """Delete a camera by its camera_id."""
    cam = db.query(Camera).filter(Camera.camera_id == camera_id).first()
    if not cam: raise HTTPException(status_code=404, detail="Camera not found")
    db.delete(cam); db.commit()
    return {"message": "Camera deleted"}
