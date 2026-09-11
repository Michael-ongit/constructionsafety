"""
AI-powered image analysis for construction site safety monitoring.

Pipeline:
  1. Read + resize input image
  2. Run YOLO models: pose (posture), phone (cell phone), helmet, vest, activity
  3. Run Azure OpenAI GPT-4o for validation + structured report
  4. Return safety issues, risks, recommendations + annotated image

All credentials are loaded from .env via database.py's env_values.

ENHANCED VERSION — Improved CV pipeline, posture analysis, and GPT prompting.
"""

import json
import re
import os
import base64
from pathlib import Path
import cv2
import numpy as np
from openai import AzureOpenAI
from ultralytics import YOLO
from datetime import datetime

# =====================================================
# AZURE OPENAI (lazy init)
# =====================================================

_client = None

def _get_openai_client():
    global _client
    if _client is None:
        _client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
        )
    return _client

# =====================================================
# YOLO MODEL LOADING (from env or defaults)
# =====================================================

BACKEND_DIR = Path(__file__).resolve().parent
# All bundled auxiliary models live beside this module. Do not carry forward
# a developer-machine model directory through an inherited environment.
KEYTEST_DIR = BACKEND_DIR


def _resolve_model_path(env_name: str, default_name: str) -> str:
    """Resolve a model from configuration, falling back to backend/*.pt.

    Older deployments used an absolute path on a developer machine. For the
    bundled ``best.pt`` model, the copy beside this module is authoritative so
    an inherited stale absolute path cannot be used.
    Relative paths are always resolved from this backend directory rather than
    from whichever directory started Uvicorn.
    """
    configured = os.getenv(env_name, "").strip()
    bundled_path = BACKEND_DIR / default_name

    # ``best.pt`` is shipped with this backend and must not resolve back to the
    # former developer-machine path through a stale environment variable.
    if default_name == "best.pt" and bundled_path.is_file():
        return str(bundled_path)

    candidates = []
    if configured:
        configured_path = Path(configured)
        candidates.append(
            configured_path if configured_path.is_absolute() else BACKEND_DIR / configured_path
        )
    candidates.append(bundled_path)

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(
        f"YOLO model for {env_name} was not found. Searched: {searched}"
    )

_pose_model = None
_phone_model = None
_helmet_model = None
_vest_model = None
_activity_models = None


def _get_pose_model():
    global _pose_model
    if _pose_model is None:
        _pose_model = YOLO(_resolve_model_path("YOLO_POSE_MODEL", "yolov8m-pose.pt"))
    return _pose_model


def _get_phone_model():
    global _phone_model
    if _phone_model is None:
        _phone_model = YOLO(_resolve_model_path("YOLO_PHONE_MODEL", "yolov8n.pt"))
    return _phone_model


def _get_helmet_model():
    global _helmet_model
    if _helmet_model is None:
        # vest_model.pt is the bundled PPE detector and includes a helmet class.
        _helmet_model = YOLO(_resolve_model_path("YOLO_HELMET_MODEL", "vest_model.pt"))
    return _helmet_model


def _get_vest_model():
    global _vest_model
    if _vest_model is None:
        _vest_model = YOLO(_resolve_model_path("YOLO_VEST_MODEL", "vest_model.pt"))
    return _vest_model


def _get_activity_models():
    global _activity_models
    if _activity_models is None:
        _activity_models = []
        _act_main = _resolve_model_path("YOLO_ACTIVITY_MODEL", "best.pt")
        _activity_models.append((YOLO(_act_main), "best"))
        for i in range(1, 7):
            path = KEYTEST_DIR / f"best ({i}).pt"
            if os.path.exists(path):
                _activity_models.append((YOLO(path), f"Model-{i}"))
    return _activity_models

# =====================================================
# GEOMETRY HELPERS
# =====================================================

def calculate_angle(a, b, c):
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba, bc = a - b, c - b
    norm_ba, norm_bc = np.linalg.norm(ba), np.linalg.norm(bc)
    if norm_ba == 0 or norm_bc == 0:
        return 180
    cosine = np.clip(np.dot(ba, bc) / (norm_ba * norm_bc), -1.0, 1.0)
    return np.degrees(np.arccos(cosine))

def distance(p1, p2):
    return np.linalg.norm(np.array(p1) - np.array(p2))

# =====================================================
# MAIN ANALYSIS FUNCTION — Enhanced version
# =====================================================

def analyze_frame(
    image_path: str,
    user_keyword: str = "",
    project: str = "",
    activity: str = "",
    sub_activity: str = "",
    remarks: str = "",
    initiated_by: str = "",
    location: str = "",
    site_engineer: str = "",
    target_date: str = "",
) -> dict:
    """
    Analyze a single construction-site image frame.

    Returns a dict with keys:
      - error / safety_issues / possible_risks / recommendations
      - annotated_image_bytes / detected_issues_raw / process_detections
      - report_text / observation_date / observation_time
      - project / activity / sub_activity / remarks / initiated_by
      - location / site_engineer / target_date
    """

    # =================================================
    # 1. Read & resize image
    # =================================================

    frame = cv2.imread(image_path)
    if frame is None:
        return {
            "error": "Image not found", "safety_issues": [], "possible_risks": [],
            "recommendations": [], "annotated_image_bytes": None,
            "detected_issues_raw": [], "process_detections": {},
            "observation_date": None, "observation_time": None,
            "project": project, "activity": activity, "sub_activity": sub_activity,
            "remarks": remarks, "initiated_by": initiated_by,
            "location": location, "site_engineer": site_engineer, "target_date": target_date,
        }

    h, w = frame.shape[:2]
    max_dim = 1920
    if w > max_dim or h > max_dim:
        r = max_dim / max(w, h)
        frame = cv2.resize(frame, (int(w * r), int(h * r)), interpolation=cv2.INTER_AREA)

    annotated = frame.copy()

    # =================================================
    # 2. Run YOLO models
    # =================================================

    pose_model   = _get_pose_model()
    phone_model  = _get_phone_model()
    helmet_model = _get_helmet_model()
    vest_model   = _get_vest_model()
    act_models   = _get_activity_models()

    pose_results   = pose_model(frame, imgsz=1280, conf=0.25)
    phone_results  = phone_model(frame, imgsz=1280, conf=0.25)
    helmet_results = helmet_model(frame, imgsz=1280, conf=0.25)
    vest_results   = vest_model(frame, imgsz=1280, conf=0.25)

    detected_issues = []
    helmet_detected = False
    vest_detected = False

    # -- Activity detection (classifier models) --
    process_detections = {}
    for model_obj, tag in act_models:
        try:
            results = model_obj(frame, imgsz=1280, conf=0.25)
            labels = []
            if results[0].boxes is not None and len(results[0].boxes) > 0:
                for box in results[0].boxes:
                    cls = int(box.cls[0])
                    label = model_obj.names[cls]
                    conf = float(box.conf[0])
                    labels.append(f"{label}({conf:.3f})")
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (200, 200, 0), 2)
                    cv2.putText(annotated, f"{tag}:{label}", (x1, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 0), 2)
            elif results[0].probs is not None:
                top5 = results[0].probs.top5
                top5conf = results[0].probs.top5conf
                for cls_idx, conf in zip(top5, top5conf):
                    conf = float(conf)
                    if conf >= 0.25:
                        label = model_obj.names[cls_idx]
                        labels.append(f"{label}({conf:.3f})")
            process_detections[tag] = labels
        except Exception:
            process_detections[tag] = []

    # -- Helmet detection --
    if helmet_results[0].boxes is not None:
        for box in helmet_results[0].boxes:
            cls = int(box.cls[0])
            label = helmet_model.names[cls]
            if "helmet" not in label.lower():
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            helmet_detected = True
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 0, 0), 2)
            cv2.putText(annotated, label, (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)

    # -- Vest detection --
    if vest_results[0].boxes is not None:
        for box in vest_results[0].boxes:
            cls = int(box.cls[0])
            label = vest_model.names[cls]
            if "vest" in label.lower():
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                vest_detected = True
                cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 255), 2)
                cv2.putText(annotated, label, (x1, y1 - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

    # -- PPE checks (gated by people count) --
    people_count = 0
    if pose_results[0].boxes is not None:
        people_count = len(pose_results[0].boxes)
    if people_count > 0:
        if not helmet_detected:
            detected_issues.append("HELMET NOT DETECTED")
        if not vest_detected:
            detected_issues.append("SAFETY VEST NOT DETECTED")

    # -- Phone detection (COCO class 67 = cell phone) --
    phone_boxes = []
    if phone_results[0].boxes is not None:
        for box, cls in zip(
            phone_results[0].boxes.xyxy.cpu().numpy(),
            phone_results[0].boxes.cls.cpu().numpy()
        ):
            if int(cls) == 67:
                x1, y1, x2, y2 = box
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                phone_boxes.append((cx, cy))
                cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), (255, 0, 0), 2)
                cv2.putText(annotated, "PHONE", (int(x1), int(y1) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

    # -- Pose / posture detection --
    if pose_results[0].boxes is not None:
        boxes = pose_results[0].boxes.xyxy.cpu().numpy()
        keypoints = pose_results[0].keypoints.xy.cpu().numpy()

        for i in range(len(boxes)):
            x1, y1, x2, y2 = map(int, boxes[i])
            kp = keypoints[i]

            nose, left_shoulder, right_shoulder = kp[0], kp[5], kp[6]
            left_hip, right_hip = kp[11], kp[12]
            left_knee, right_knee = kp[13], kp[14]
            left_ankle, right_ankle = kp[15], kp[16]
            left_wrist, right_wrist = kp[9], kp[10]

            shoulder = (left_shoulder + right_shoulder) / 2
            hip = (left_hip + right_hip) / 2
            knee = (left_knee + right_knee) / 2

            back_angle = calculate_angle(shoulder, hip, knee)
            knee_angle = calculate_angle(hip, knee, left_ankle)
            dx, dy = shoulder[0] - hip[0], shoulder[1] - hip[1]
            torso_tilt = abs(dx) / (abs(dy) + 1e-6)

            posture = "SAFE"
            color = (0, 255, 0)

            # Safety rules
            if back_angle < 120:
                posture, color = "UNSAFE BENDING", (0, 0, 255)
                detected_issues.append(posture)
            elif knee_angle < 90:
                posture, color = "SITTING / CROUCH", (0, 0, 255)
                detected_issues.append(posture)
            elif abs(left_ankle[1] - right_ankle[1]) > 80:
                posture, color = "CLIMBING", (0, 0, 255)
                detected_issues.append(posture)
            elif torso_tilt > 0.7 and knee_angle < 120:
                posture, color = "LEANING / RESTING", (0, 0, 255)
                detected_issues.append(posture)
            elif nose[1] - shoulder[1] > 120:
                posture, color = "POSSIBLE FATIGUE", (0, 0, 255)
                detected_issues.append(posture)
            elif back_angle < 140 and knee_angle > 150:
                posture, color = "UNSAFE LIFTING", (0, 0, 255)
                detected_issues.append(posture)

            # Phone usage check (near wrist)
            phone_detected = False
            for phone in phone_boxes:
                if distance(phone, left_wrist) < 100 or distance(phone, right_wrist) < 100:
                    posture, color = "PHONE USAGE", (255, 0, 0)
                    detected_issues.append(posture)
                    phone_detected = True
                    break

            # Possible phone usage (hand near face, head down)
            if not phone_detected:
                dist_left_face = distance(left_wrist, nose)
                dist_right_face = distance(right_wrist, nose)
                head_down = nose[1] > shoulder[1]
                left_hand_up = left_wrist[1] < shoulder[1] + 40
                right_hand_up = right_wrist[1] < shoulder[1] + 40
                if head_down and (
                    (dist_left_face < 80 and left_hand_up) or
                    (dist_right_face < 80 and right_hand_up)
                ):
                    posture, color = "POSSIBLE PHONE USAGE", (255, 0, 0)
                    detected_issues.append(posture)

            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(annotated, posture, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            for point in kp:
                cv2.circle(annotated, (int(point[0]), int(point[1])), 4, (0, 255, 255), -1)

    detected_issues = list(set(detected_issues))

    # =================================================
    # 3. Save annotated image to disk
    # =================================================

    annotated_path = os.path.splitext(image_path)[0] + "_annotated.jpg"
    _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    annotated_image_bytes = buffer.tobytes()
    with open(annotated_path, "wb") as f:
        f.write(annotated_image_bytes)

    # =================================================
    # 4. Encode frame for GPT-4o
    # =================================================

    _, gpt_buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    image_data = base64.b64encode(gpt_buffer.tobytes()).decode("utf-8")

    # =================================================
    # 5. Build dynamic prompt
    # =================================================

    user_prompt_text = f"""
    MODEL DETECTED ISSUES (VERIFY AGAINST IMAGE):
    {detected_issues}

    DETECTED ACTIVITIES (per model):
    {json.dumps(process_detections, indent=2)}
    """
    if user_keyword:
        user_prompt_text += f"""
>>> USER SPECIFIC SEARCH REQUEST <<<
    The user specifically requested you to check for this keyword/issue: "{user_keyword}"
    CRITICAL INSTRUCTION: You MUST actively search the image for the user's specific request. If found, add it to the Safety_Issues.
    However, you MUST ALSO perform your standard independent safety analysis. Do not ignore your own findings just because the user asked a specific question.
    """

    user_prompt_text += """
    Validate the model findings against the image.
    Add any additional visible safety issues.
    Return ONLY valid JSON in the following structure:
    {
        "Safety_Issues": [
            "issue 1",
            "issue 2"
        ],
        "Possible_Risks": [
            "risk 1",
            "risk 2"
        ],
        "Recommendations": [
            "recommendation 1",
            "recommendation 2"
        ]
    }
    Rules:
    - Combine model detections, user specific requests, and your own image observations.
    - Reject false detections.
    - Safety_Issues must contain only verified safety issues.
    - Possible_Risks must contain only realistic incidents/risks.
    - Recommendations must contain only corrective actions.
    - Do not create additional keys.
    - Return JSON only.
    """

    # =================================================
    # 6. GPT-4o validation & structured report
    # =================================================

    final_report = ""
    try:
        response = _get_openai_client().chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": """
    You are an expert construction safety inspector.
    A computer vision system has already analyzed this image.
    The detections come from:
    - YOLOv8m-pose for posture analysis
    - YOLOv8n for phone detection
    - Helmet detection model
    - Safety vest detection model

    Your responsibilities:
    1. Review the image carefully.
    2. Validate all model detections against the image.
    3. Reject incorrect model detections.
    4. Identify additional safety issues visible in the image that the models may have missed.
    5. Generate:
       - Safety_Issues
       - Possible_Risks
       - Recommendations

    MODEL VALIDATION RULES
    1. Model detections are suggestions only and may be incorrect.
    2. Validate every model finding against the image before reporting it.
    3. If a model reports a violation but the image does not support it, ignore the model finding.
    4. If a worker cannot be clearly inspected, do not report PPE violations.

    PPE VALIDATION RULES
    1. A missing helmet detection is NOT automatically a helmet violation.
    2. A missing vest detection is NOT automatically a vest violation.
    3. Report helmet violations only when:
       - A worker is clearly visible
       AND
       - The worker's head can be clearly inspected
       AND
       - Absence of a helmet can be visually confirmed.
    4. Report vest violations only when:
       - A worker is clearly visible
       AND
       - The worker's upper body can be clearly inspected
       AND
       - Absence of a safety vest can be visually confirmed.
    5. If workers are too small, too far away, blurred, partially hidden, obstructed, or cannot be clearly inspected:
       - Do NOT report helmet violations.
       - Do NOT report vest violations.
    6. If PPE compliance cannot be visually verified, ignore PPE-related findings.

    IMAGE ANALYSIS RULES
    1. Identify additional hazards that are clearly visible even if the model did not detect them.
    Examples include:
    - Slip hazards
    - Trip hazards
    - Poor housekeeping
    - Material obstruction
    - Unsafe access
    - Unsafe storage
    - Falling object hazards
    - Water accumulation
    - Open edges
    - Unsafe posture
    - Mobile phone usage
    - Equipment hazards
    - Electrical hazards
    - Missing barricades
    - Missing warning signs
    2. Only report issues that can be reasonably observed from the image.
    3. Do not invent hazards that are not visible.

    POSSIBLE RISKS
    Possible_Risks should describe realistic incidents that could occur because of the verified safety issues.
    Examples:
    - Slip and fall
    - Trip and fall
    - Head injury
    - Hand injury
    - Struck-by incident
    - Falling object injury
    - Equipment entanglement
    - Electrical shock

    RECOMMENDATIONS
    Recommendations should be corrective actions directly related to the verified safety issues.
    Examples:
    - Improve housekeeping.
    - Remove obstructions from walkways.
    - Wear required PPE.
    - Install barricades.
    - Dry wet surfaces.
    - Secure loose materials.
    - Follow safe lifting practices.

    IMPORTANT
    Return ONLY valid JSON.
    {
        "Safety_Issues": [],
        "Possible_Risks": [],
        "Recommendations": []
    }
    Do not return markdown.
    Do not return explanations.
    Do not return code blocks.
    """
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_prompt_text
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_data}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1500,
            temperature=0
        )
        final_report = response.choices[0].message.content.strip()
    except Exception:
        final_report = ""

    # =================================================
    # 7. Parse GPT response (robust)
    # =================================================

    report_json = None
    if final_report:
        stripped = re.sub(r'^```(?:json)?\s*\n?', '', final_report.strip())
        stripped = re.sub(r'\n?```\s*$', '', stripped)
        try:
            report_json = json.loads(stripped)
        except json.JSONDecodeError:
            try:
                report_json = json.loads(final_report)
            except json.JSONDecodeError:
                report_json = None

    if report_json and isinstance(report_json, dict):
        safety_issues = report_json.get("Safety_Issues") or report_json.get("safety_issues") or (detected_issues if detected_issues else ["No specific violations detected"])
        possible_risks = report_json.get("Possible_Risks") or report_json.get("possible_risks") or ["Review image for potential hazards"]
        recommendations = report_json.get("Recommendations") or report_json.get("recommendations") or ["Conduct a manual safety inspection"]
        if not isinstance(safety_issues, list): safety_issues = detected_issues if detected_issues else ["No specific violations detected"]
        if not isinstance(possible_risks, list): possible_risks = ["Review image for potential hazards"]
        if not isinstance(recommendations, list): recommendations = ["Conduct a manual safety inspection"]
    else:
        safety_issues = detected_issues if detected_issues else ["No specific violations detected"]
        possible_risks = ["Review image for potential hazards"]
        recommendations = ["Conduct a manual safety inspection"]

    # =================================================
    # 8. Timestamp
    # =================================================

    now = datetime.now()
    observation_date = now.date()
    observation_time = now.strftime("%H:%M:%S")

    return {
        "error": None,
        "safety_issues": safety_issues,
        "possible_risks": possible_risks,
        "recommendations": recommendations,
        "annotated_image_bytes": annotated_image_bytes,
        "detected_issues_raw": detected_issues,
        "process_detections": process_detections,
        "report_text": final_report,
        "observation_date": observation_date,
        "observation_time": observation_time,
        "project": project,
        "activity": activity,
        "sub_activity": sub_activity,
        "remarks": remarks,
        "initiated_by": initiated_by,
        "location": location,
        "site_engineer": site_engineer,
        "target_date": target_date,
    }


# ===========================================================================
# LEGACY CODE (commented out for reference)
# ===========================================================================
# """
# AI-powered image analysis for construction site safety monitoring.
#
# Pipeline:
#   1. Read + resize input image
#   2. Run YOLO models: pose (posture), phone (cell phone), helmet, vest, activity
#   3. Run Azure OpenAI GPT-4o for validation + structured report
#   4. Return safety issues, risks, recommendations + annotated image
#
# All credentials are loaded from .env via database.py's env_values.
# """
#
# import json
# import os
# import base64
# import cv2
# import numpy as np
# from openai import AzureOpenAI
# from ultralytics import YOLO
# from datetime import datetime
#
# # ---------------------------------------------------------------------------
# # Azure OpenAI client  (lazy init – only created when needed)
# # ---------------------------------------------------------------------------
# _client = None
#
# def _get_openai_client():
#     global _client
#     if _client is None:
#         _client = AzureOpenAI(
#             api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
#             api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
#             azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
#         )
#     return _client
#
# # ---------------------------------------------------------------------------
# # YOLO model paths (from env or defaults)
# # ---------------------------------------------------------------------------
# Legacy reference: model paths are resolved by _resolve_model_path().
#
# pose_model  = YOLO(os.getenv("YOLO_POSE_MODEL", "yolov8m-pose.pt"))
# phone_model = YOLO(os.getenv("YOLO_PHONE_MODEL", "yolov8n.pt"))
# helmet_model = YOLO(_resolve_model_path("YOLO_HELMET_MODEL", "best.pt"))
# vest_model   = YOLO(os.getenv("YOLO_VEST_MODEL", "vest_model.pt"))
#
# # Activity models: backend/best.pt plus optional additional local models.
# activity_models = []
# _act_main = os.getenv("YOLO_ACTIVITY_MODEL", "best.pt")
# activity_models.append((YOLO(_act_main), "best"))
# for i in range(1, 7):
#     path = os.path.join(KEYTEST_DIR, f"best ({i}).pt")
#     if os.path.exists(path):
#         activity_models.append((YOLO(path), f"Model-{i}"))
#
#
# # ---------------------------------------------------------------------------
# # Geometry helpers
# # ---------------------------------------------------------------------------
#
# def calculate_angle(a, b, c):
#     a, b, c = np.array(a), np.array(b), np.array(c)
#     ba, bc = a - b, c - b
#     norm_ba, norm_bc = np.linalg.norm(ba), np.linalg.norm(bc)
#     if norm_ba == 0 or norm_bc == 0:
#         return 180
#     cosine = np.clip(np.dot(ba, bc) / (norm_ba * norm_bc), -1.0, 1.0)
#     return np.degrees(np.arccos(cosine))
#
#
# def distance(p1, p2):
#     return np.linalg.norm(np.array(p1) - np.array(p2))
#
#
# # ---------------------------------------------------------------------------
# # Main analysis entry-point
# # ---------------------------------------------------------------------------
#
# def analyze_frame(
#     image_path: str,
#     user_keyword: str = "",
#     project: str = "",
#     activity: str = "",
#     sub_activity: str = "",
#     remarks: str = "",
#     initiated_by: str = "",
#     location: str = "",
#     site_engineer: str = "",
#     target_date: str = "",
# ) -> dict:
#     """
#     Analyze a single construction-site image frame.
#
#     Returns a dict with keys:
#       - error / safety_issues / possible_risks / recommendations
#       - annotated_image_bytes / detected_issues_raw / process_detections
#       - report_text / observation_date / observation_time
#       - project / activity / sub_activity / remarks / initiated_by
#       - location / site_engineer / target_date
#     """
#
#     # ---------------------------------------------------------------
#     # 1. Read & resize image
#     # ---------------------------------------------------------------
#     frame = cv2.imread(image_path)
#     if frame is None:
#         return {
#             "error": "Image not found", "safety_issues": [], "possible_risks": [],
#             "recommendations": [], "annotated_image_bytes": None,
#             "detected_issues_raw": [], "process_detections": {},
#             "observation_date": None, "observation_time": None,
#             "project": project, "activity": activity, "sub_activity": sub_activity,
#             "remarks": remarks, "initiated_by": initiated_by,
#             "location": location, "site_engineer": site_engineer, "target_date": target_date,
#         }
#
#     h, w = frame.shape[:2]
#     max_dim = 1920
#     if w > max_dim or h > max_dim:
#         r = max_dim / max(w, h)
#         frame = cv2.resize(frame, (int(w * r), int(h * r)), interpolation=cv2.INTER_AREA)
#     annotated = frame.copy()
#
#     detected_issues = []
#     helmet_detected = False
#     vest_detected = False
#
#     # ---------------------------------------------------------------
#     # 2. Run YOLO models
#     # ---------------------------------------------------------------
#     pose_results   = pose_model(frame, imgsz=1280, conf=0.25)
#     phone_results  = phone_model(frame, imgsz=1280, conf=0.25)
#     helmet_results = helmet_model(frame, imgsz=1280, conf=0.25)
#     vest_results   = vest_model(frame, imgsz=1280, conf=0.25)
#
#     # -- Activity detection (classifier models) --
#     process_detections = {}
#     for model_obj, tag in activity_models:
#         try:
#             results = model_obj(frame, imgsz=1280, conf=0.25)
#             labels = []
#             if results[0].boxes is not None and len(results[0].boxes) > 0:
#                 for box in results[0].boxes:
#                     cls = int(box.cls[0])
#                     label = model_obj.names[cls]
#                     conf = float(box.conf[0])
#                     labels.append(f"{label}({conf:.3f})")
#                     x1, y1, x2, y2 = map(int, box.xyxy[0])
#                     cv2.rectangle(annotated, (x1, y1), (x2, y2), (200, 200, 0), 2)
#                     cv2.putText(annotated, f"{tag}:{label}", (x1, y1 - 5),
#                                 cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 0), 2)
#             elif results[0].probs is not None:
#                 top5 = results[0].probs.top5
#                 top5conf = results[0].probs.top5conf
#                 for cls_idx, conf in zip(top5, top5conf):
#                     conf = float(conf)
#                     if conf >= 0.25:
#                         label = model_obj.names[cls_idx]
#                         labels.append(f"{label}({conf:.3f})")
#             process_detections[tag] = labels
#         except Exception:
#             process_detections[tag] = []
#
#     # -- Helmet --
#     if helmet_results[0].boxes is not None:
#         for box in helmet_results[0].boxes:
#             cls = int(box.cls[0])
#             label = helmet_model.names[cls]
#             x1, y1, x2, y2 = map(int, box.xyxy[0])
#             if "hardhat" in label.lower() and "no" not in label.lower():
#                 helmet_detected = True
#                 cv2.rectangle(annotated, (x1, y1), (x2, y2), (255, 0, 0), 2)
#                 cv2.putText(annotated, label, (x1, y1 - 5),
#                             cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
#             elif "no-hardhat" in label.lower() or "no_hardhat" in label.lower():
#                 detected_issues.append("NO HELMET")
#                 cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
#                 cv2.putText(annotated, label, (x1, y1 - 5),
#                             cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
#
#     # -- Vest --
#     if vest_results[0].boxes is not None:
#         for box in vest_results[0].boxes:
#             cls = int(box.cls[0])
#             label = vest_model.names[cls]
#             if "vest" in label.lower():
#                 x1, y1, x2, y2 = map(int, box.xyxy[0])
#                 vest_detected = True
#                 cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 255), 2)
#                 cv2.putText(annotated, label, (x1, y1 - 5),
#                             cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
#
#     # -- PPE checks (only if people are detected) --
#     people_count = 0
#     if pose_results[0].boxes is not None:
#         people_count = len(pose_results[0].boxes)
#     if people_count > 0:
#         if not helmet_detected:
#             detected_issues.append("HELMET NOT DETECTED")
#         if not vest_detected:
#             detected_issues.append("SAFETY VEST NOT DETECTED")
#
#     # -- Phone detection (COCO class 67 = cell phone) --
#     phone_boxes = []
#     if phone_results[0].boxes is not None:
#         for box, cls in zip(
#             phone_results[0].boxes.xyxy.cpu().numpy(),
#             phone_results[0].boxes.cls.cpu().numpy()
#         ):
#             if int(cls) == 67:
#                 x1, y1, x2, y2 = box
#                 cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
#                 phone_boxes.append((cx, cy))
#                 cv2.rectangle(annotated, (int(x1), int(y1)), (int(x2), int(y2)), (255, 0, 0), 2)
#                 cv2.putText(annotated, "PHONE", (int(x1), int(y1) - 10),
#                             cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
#
#     # -- Pose / posture detection --
#     if pose_results[0].boxes is not None:
#         boxes = pose_results[0].boxes.xyxy.cpu().numpy()
#         keypoints = pose_results[0].keypoints.xy.cpu().numpy()
#
#         for i in range(len(boxes)):
#             x1, y1, x2, y2 = map(int, boxes[i])
#             kp = keypoints[i]
#
#             nose, left_shoulder, right_shoulder = kp[0], kp[5], kp[6]
#             left_hip, right_hip = kp[11], kp[12]
#             left_knee, right_knee = kp[13], kp[14]
#             left_ankle, right_ankle = kp[15], kp[16]
#             left_wrist, right_wrist = kp[9], kp[10]
#
#             shoulder = (left_shoulder + right_shoulder) / 2
#             hip = (left_hip + right_hip) / 2
#             knee = (left_knee + right_knee) / 2
#
#             back_angle = calculate_angle(shoulder, hip, knee)
#             knee_angle = calculate_angle(hip, knee, left_ankle)
#             dx, dy = shoulder[0] - hip[0], shoulder[1] - hip[1]
#             torso_tilt = abs(dx) / (abs(dy) + 1e-6)
#
#             posture = "SAFE"
#             color = (0, 255, 0)
#
#             # Safety rules
#             if back_angle < 120:
#                 posture, color = "UNSAFE BENDING", (0, 0, 255)
#                 detected_issues.append(posture)
#             elif knee_angle < 90:
#                 posture, color = "SITTING / CROUCH", (0, 0, 255)
#                 detected_issues.append(posture)
#             elif abs(left_ankle[1] - right_ankle[1]) > 80:
#                 posture, color = "CLIMBING", (0, 0, 255)
#                 detected_issues.append(posture)
#             elif torso_tilt > 0.7 and knee_angle < 120:
#                 posture, color = "LEANING / RESTING", (0, 0, 255)
#                 detected_issues.append(posture)
#             elif nose[1] - shoulder[1] > 120:
#                 posture, color = "POSSIBLE FATIGUE", (0, 0, 255)
#                 detected_issues.append(posture)
#             elif back_angle < 140 and knee_angle > 150:
#                 posture, color = "UNSAFE LIFTING", (0, 0, 255)
#                 detected_issues.append(posture)
#
#             # Phone usage check
#             phone_detected = False
#             for phone in phone_boxes:
#                 if distance(phone, left_wrist) < 100 or distance(phone, right_wrist) < 100:
#                     posture, color = "PHONE USAGE", (255, 0, 0)
#                     detected_issues.append(posture)
#                     phone_detected = True
#                     break
#
#             if not phone_detected:
#                 dist_left_face = distance(left_wrist, nose)
#                 dist_right_face = distance(right_wrist, nose)
#                 head_down = nose[1] > shoulder[1]
#                 left_hand_up = left_wrist[1] < shoulder[1] + 40
#                 right_hand_up = right_wrist[1] < shoulder[1] + 40
#                 if head_down and (
#                     (dist_left_face < 80 and left_hand_up) or
#                     (dist_right_face < 80 and right_hand_up)
#                 ):
#                     posture, color = "POSSIBLE PHONE USAGE", (255, 0, 0)
#                     detected_issues.append(posture)
#
#             cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
#             cv2.putText(annotated, posture, (x1, y1 - 10),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
#             for point in kp:
#                 cv2.circle(annotated, (int(point[0]), int(point[1])), 4, (0, 255, 255), -1)
#
#     detected_issues = list(set(detected_issues))
#
#     # ---------------------------------------------------------------
#     # 3. Save annotated image to disk
#     # ---------------------------------------------------------------
#     annotated_path = os.path.splitext(image_path)[0] + "_annotated.jpg"
#     _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
#     annotated_image_bytes = buffer.tobytes()
#     with open(annotated_path, "wb") as f:
#         f.write(annotated_image_bytes)
#
#     # ---------------------------------------------------------------
#     # 4. Encode frame for GPT-4o
#     # ---------------------------------------------------------------
#     _, gpt_buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
#     image_data = base64.b64encode(gpt_buffer.tobytes()).decode("utf-8")
#
#     # ---------------------------------------------------------------
#     # 5. Build user prompt with keyword support
#     # ---------------------------------------------------------------
#     user_prompt_text = f"""
# MODEL DETECTED ISSUES (VERIFY AGAINST IMAGE):
# {detected_issues}
#
# DETECTED ACTIVITIES (per model):
# {json.dumps(process_detections, indent=2)}
# """
#     if user_keyword:
#         user_prompt_text += f"""
# >>> USER SPECIFIC SEARCH REQUEST <<<
# The user specifically requested you to check for this keyword/issue: "{user_keyword}"
# CRITICAL INSTRUCTION: You MUST actively search the image for the user's specific request. If found, add it to the Safety_Issues.
# However, you MUST ALSO perform your standard independent safety analysis. Do not ignore your own findings just because the user asked a specific question.
# """
#
#     user_prompt_text += """
# Validate the model findings against the image.
# Add any additional visible safety issues.
# Return ONLY valid JSON in the following structure:
# {
#     "Safety_Issues": [],
#     "Possible_Risks": [],
#     "Recommendations": []
# }
# Rules:
# - Combine model detections, user specific requests, and your own image observations.
# - Reject false detections.
# - Safety_Issues must contain only verified safety issues.
# - Possible_Risks must contain only realistic incidents/risks.
# - Recommendations must contain only corrective actions.
# - Do not create additional keys.
# - Return JSON only.
# """
#
#     # ---------------------------------------------------------------
#     # 6. GPT-4o validation & structured report
#     # ---------------------------------------------------------------
#     final_report = ""
#     try:
#         response = _get_openai_client().chat.completions.create(
#             model="gpt-4o",
#             messages=[
#                 {
#                     "role": "system",
#                     "content": """
# You are an expert construction safety inspector.
# A computer vision system has already analyzed this image.
# The detections come from:
# - YOLOv8m-pose for posture analysis
# - YOLOv8n for phone detection
# - Helmet detection model
# - Safety vest detection model
#
# Your responsibilities:
# 1. Review the image carefully.
# 2. Validate all model detections against the image.
# 3. Reject incorrect model detections.
# 4. Identify additional safety issues visible in the image that the models may have missed.
# 5. Generate:
#    - Safety_Issues
#    - Possible_Risks
#    - Recommendations
#
# MODEL VALIDATION RULES
# 1. Model detections are suggestions only and may be incorrect.
# 2. Validate every model finding against the image before reporting it.
# 3. If a model reports a violation but the image does not support it, ignore the model finding.
# 4. If a worker cannot be clearly inspected, do not report PPE violations.
#
# PPE VALIDATION RULES
# 1. A missing helmet detection is NOT automatically a helmet violation.
# 2. A missing vest detection is NOT automatically a vest violation.
# 3. Report helmet violations only when:
#    - A worker is clearly visible
#    AND
#    - The worker's head can be clearly inspected
#    AND
#    - Absence of a helmet can be visually confirmed.
# 4. Report vest violations only when:
#    - A worker is clearly visible
#    AND
#    - The worker's upper body can be clearly inspected
#    AND
#    - Absence of a safety vest can be visually confirmed.
# 5. If workers are too small, too far away, blurred, partially hidden, obstructed, or cannot be clearly inspected:
#    - Do NOT report helmet violations.
#    - Do NOT report vest violations.
# 6. If PPE compliance cannot be visually verified, ignore PPE-related findings.
#
# IMAGE ANALYSIS RULES
# 1. Identify additional hazards that are clearly visible even if the model did not detect them.
# Examples include:
# - Slip hazards
# - Trip hazards
# - Poor housekeeping
# - Material obstruction
# - Unsafe access
# - Unsafe storage
# - Falling object hazards
# - Water accumulation
# - Open edges
# - Unsafe posture
# - Mobile phone usage
# - Equipment hazards
# - Electrical hazards
# - Missing barricades
# - Missing warning signs
# 2. Only report issues that can be reasonably observed from the image.
# 3. Do not invent hazards that are not visible.
#
# POSSIBLE RISKS
# Possible_Risks should describe realistic incidents that could occur because of the verified safety issues.
# Examples:
# - Slip and fall
# - Trip and fall
# - Head injury
# - Hand injury
# - Struck-by incident
# - Falling object injury
# - Equipment entanglement
# - Electrical shock
#
# RECOMMENDATIONS
# Recommendations should be corrective actions directly related to the verified safety issues.
# Examples:
# - Improve housekeeping.
# - Remove obstructions from walkways.
# - Wear required PPE.
# - Install barricades.
# - Dry wet surfaces.
# - Secure loose materials.
# - Follow safe lifting practices.
#
# IMPORTANT
# Return ONLY valid JSON.
# {
#     "Safety_Issues": [],
#     "Possible_Risks": [],
#     "Recommendations": []
# }
# Do not return markdown.
# Do not return explanations.
# Do not return code blocks.
# """
#             },
#             {
#                 "role": "user",
#                 "content": [
#                     {
#                         "type": "text",
#                         "text": user_prompt_text
#                     },
#                     {
#                         "type": "image_url",
#                         "image_url": {
#                             "url": f"data:image/jpeg;base64,{image_data}"
#                         }
#                     }
#                 ]
#             }
#         ],
#         max_tokens=1500,
#         temperature=0
#     )
#         final_report = response.choices[0].message.content.strip()
#     except Exception:
#         final_report = ""
#
#     # ---------------------------------------------------------------
#     # 7. Parse GPT response
#     # ---------------------------------------------------------------
#     import re
#     report_json = None
#     if final_report:
#         stripped = re.sub(r'^```(?:json)?\s*\n?', '', final_report.strip())
#         stripped = re.sub(r'\n?```\s*$', '', stripped)
#         try:
#             report_json = json.loads(stripped)
#         except json.JSONDecodeError:
#             try:
#                 report_json = json.loads(final_report)
#             except json.JSONDecodeError:
#                 report_json = None
#     if report_json and isinstance(report_json, dict):
#         safety_issues = report_json.get("Safety_Issues") or report_json.get("safety_issues") or (detected_issues if detected_issues else ["No specific violations detected"])
#         possible_risks = report_json.get("Possible_Risks") or report_json.get("possible_risks") or ["Review image for potential hazards"]
#         recommendations = report_json.get("Recommendations") or report_json.get("recommendations") or ["Conduct a manual safety inspection"]
#         if not isinstance(safety_issues, list): safety_issues = detected_issues if detected_issues else ["No specific violations detected"]
#         if not isinstance(possible_risks, list): possible_risks = ["Review image for potential hazards"]
#         if not isinstance(recommendations, list): recommendations = ["Conduct a manual safety inspection"]
#     else:
#         safety_issues = detected_issues if detected_issues else ["No specific violations detected"]
#         possible_risks = ["Review image for potential hazards"]
#         recommendations = ["Conduct a manual safety inspection"]
#
#     # ---------------------------------------------------------------
#     # 8. Timestamp
#     # ---------------------------------------------------------------
#     now = datetime.now()
#     observation_date = now.date()
#     observation_time = now.strftime("%H:%M:%S")
#
#     return {
#         "error": None,
#         "safety_issues": safety_issues,
#         "possible_risks": possible_risks,
#         "recommendations": recommendations,
#         "annotated_image_bytes": annotated_image_bytes,
#         "detected_issues_raw": detected_issues,
#         "process_detections": process_detections,
#         "report_text": final_report,
#         "observation_date": observation_date,
#         "observation_time": observation_time,
#         "project": project,
#         "activity": activity,
#         "sub_activity": sub_activity,
#         "remarks": remarks,
#         "initiated_by": initiated_by,
#         "location": location,
#         "site_engineer": site_engineer,
#         "target_date": target_date,
#     }
