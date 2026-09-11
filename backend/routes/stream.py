"""
RTSP camera snapshot streaming.

Routes:
  GET /api/stream/cameras          — list configured RTSP cameras
  GET /api/stream/{camera_id}/snapshot — get latest frame as JPEG
  GET /api/stream/{camera_id}      — alias for snapshot

Cameras are defined in CAMERA_CONFIGS (hardcoded). Each runs a background
thread that continuously reads RTSP frames and caches the latest JPEG.
"""

import os
import time, threading
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

router = APIRouter(prefix="/api/stream", tags=["stream"])

CAMERA_CONFIGS = {
    "BAY2_LLM1_CENTRE": {
        "rtsp_url": os.getenv("RTSP_BAY2_URL", "rtsp://user:password@10.0.0.1:8862/Streaming/Channels/102"),
        "name": "BAY2_LLM1_CENTRE", "project": "BAY2_LLM_CENTRE",
        "zone": "BAY2_LLM_CENTRE", "location": "Bay 2 LLM Centre"},
    "BAY1_LLM2": {
        "rtsp_url": os.getenv("RTSP_BAY1_URL", "rtsp://user:password@10.0.0.2:8866/Streaming/Channels/102"),
        "name": "BAY1_LLM2", "project": "BAY1_LLM2_CENTRE",
        "zone": "BAY1_LLM2_CENTRE", "location": "Bay 1 LLM 2"},
}

_frame_buffers: dict[str, bytes] = {}
_capture_threads: dict[str, threading.Thread] = {}
_stop_flags: dict[str, threading.Event] = {}
_lock = threading.Lock()

# Lazy OpenCV import
_cv2, _np = None, None
try:
    import cv2 as _cv2
    import numpy as _np
except ImportError:
    print("WARNING: opencv-python not installed. RTSP capture disabled.")


def _make_placeholder(text: str) -> bytes:
    """Generate a text-overlay placeholder image."""
    if _cv2 is not None and _np is not None:
        try:
            img = _np.zeros((480, 640, 3), dtype=_np.uint8)
            _cv2.putText(img, text, (50, 240), _cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
            _, buf = _cv2.imencode('.jpg', img, [int(_cv2.IMWRITE_JPEG_QUALITY), 70])
            return buf.tobytes()
        except Exception as e:
            print(f"Placeholder generation failed: {e}")
    return b""


for cid in CAMERA_CONFIGS:
    try:
        _frame_buffers[cid] = _make_placeholder("Connecting...")
    except Exception as e:
        print(f"Failed to create placeholder for {cid}: {e}")
        _frame_buffers[cid] = b""


def _capture_loop(camera_id: str, rtsp_url: str):
    """Background thread: continuously read RTSP frames into buffer."""
    if _cv2 is None:
        print(f"OpenCV not available, cannot capture {camera_id}")
        return
    stop = _stop_flags.get(camera_id)
    if stop is None: return
    retries = 0
    while not stop.is_set():
        cap = None
        try:
            cap = _cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                cap = _cv2.VideoCapture(rtsp_url, _cv2.CAP_FFMPEG)
            if not cap.isOpened():
                print(f"RTSP open failed for {camera_id}")
                _frame_buffers[camera_id] = _make_placeholder("Camera Unavailable")
            else:
                cap.set(_cv2.CAP_PROP_BUFFERSIZE, 3)
                retries = 0
                while not stop.is_set():
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        break
                    _, buf = _cv2.imencode('.jpg', frame, [int(_cv2.IMWRITE_JPEG_QUALITY), 40])
                    _frame_buffers[camera_id] = buf.tobytes()
                    time.sleep(0.03)
        except Exception as e:
            print(f"Capture error for {camera_id}: {e}")
        finally:
            if cap: cap.release()
        retries += 1
        wait = min(retries * 2, 30)
        for _ in range(wait * 10):
            if stop.is_set(): break
            time.sleep(0.1)
    with _lock:
        _stop_flags.pop(camera_id, None)
        _capture_threads.pop(camera_id, None)
        _frame_buffers[camera_id] = _make_placeholder("Disconnected")


def _ensure_capture(camera_id: str, rtsp_url: str):
    """Start background capture thread if not already running."""
    with _lock:
        if camera_id in _capture_threads and _capture_threads[camera_id].is_alive():
            return
        _stop_flags[camera_id] = threading.Event()
        t = threading.Thread(target=_capture_loop, args=(camera_id, rtsp_url), daemon=True)
        _capture_threads[camera_id] = t
        t.start()


@router.get("/cameras")
def get_stream_cameras(
):
    """List all configured RTSP cameras (from hardcoded config)."""
    return [{"id": cid, "name": cfg["name"], "project": cfg["project"],
             "zone": cfg["zone"], "location": cfg["location"]}
            for cid, cfg in CAMERA_CONFIGS.items()]


@router.get("/{camera_id}/snapshot")
@router.get("/{camera_id}")
def get_snapshot(
    camera_id: str,
):
    """Return the latest cached JPEG frame for a camera."""
    config = CAMERA_CONFIGS.get(camera_id)
    if not config: raise HTTPException(status_code=404, detail="Camera not found")
    _ensure_capture(camera_id, config["rtsp_url"])
    buf = _frame_buffers.get(camera_id) or _make_placeholder("Connecting...")
    return Response(content=buf, media_type="image/jpeg",
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
