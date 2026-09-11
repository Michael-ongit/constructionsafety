Project analysis
The project is a construction-site safety monitoring platform called SiteMonitor AI. Its strongest component is frame-based image analytics. It combines object detection, pose estimation, rule-based reasoning, multimodal validation, incident storage, and dashboards.
Relevant files:
- [README.md](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/README.md)
- [backend/audit.py](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/audit.py)
- [backend/routes/upload.py](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/routes/upload.py)
- [backend/routes/stream.py](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/routes/stream.py)
- [backend/routes/analytics.py](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/routes/analytics.py)
- [frontend/src/App.tsx](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/frontend/src/App.tsx)
1. Image analytics pipeline
The main processing function is analyze_frame() in backend/audit.py.
Processing sequence:
1. Read the image using OpenCV.
2. Resize images larger than 1920 pixels.
3. Load several YOLO models.
4. Run object detection, pose estimation, PPE detection, and activity classification.
5. Apply geometric safety rules.
6. Draw annotations on the image.
7. Send the original frame and model findings to Azure OpenAI GPT-4o.
8. Parse a structured JSON response containing:
   - Safety issues
   - Possible risks
   - Recommendations
9. Save the annotated image and return the analysis.
2. Models included in the repository
Model	Task	Role in the project
yolov8m-pose.pt	Pose estimation	Detects people and 17 body keypoints
yolov8n.pt	Object detection	Detects COCO objects, especially cell phone class 67
vest_model.pt	PPE object detection	Detects gloves, vest, goggles, helmet, mask and safety shoes
best.pt	Image classification	Classifies construction activities


The custom activity classifier contains these classes:
- Buffing
- Bulkhead fixing
- Cage lowering
- Concreting
- Curing
- Inner mould fixing
- Oiling
- Outer shuttering
- Reinforcement cover adjustment
- Shifting
3. Unsafe posture detection
The system derives posture indicators from pose keypoints.
It calculates:
- Back angle using shoulder, hip and knee points
- Knee angle using hip, knee and ankle points
- Torso tilt
- Difference between ankle heights
- Nose-to-shoulder position
- Distance between detected phones and wrists
It then assigns labels such as:
- UNSAFE BENDING
- SITTING / CROUCH
- CLIMBING
- LEANING / RESTING
- POSSIBLE FATIGUE
- UNSAFE LIFTING
- PHONE USAGE
- POSSIBLE PHONE USAGE
The result is rule-based classification on top of neural-network keypoints.
4. PPE detection
The system checks whether people are present using the pose model. If a person is found but the PPE model does not detect a helmet or vest, it creates a violation.
5. GPT-4o validation layer
The GPT-4o stage is not the primary detector. It acts as a visual reviewer.
It receives:
- The original image
- Raw model-detected issues
- Detected activity labels
- Optional user remarks
It is instructed to:
- Validate model findings against the image
- Reject false positives
- Avoid reporting PPE violations when workers are too small or obstructed
- Identify additional visible hazards
- Return JSON only
This is useful because the rule-based detector can produce false positives. GPT-4o provides a second-stage visual review.
6. Risk scoring and database storage
After analysis, the upload route:
- Creates a SafetyIncident
- Stores the annotated image as a database blob
- Stores the project and location
- Stores unsafe activity, risk, recommendations and remarks
- Adds an ActivityNew record
- Refreshes incident and analytics views
Risk is assigned using keyword rules:
- Critical: fatal, electrocution, fall from height, collapse
- High: immediate, high risk, serious, no helmet, fall, struck
- Medium: other detected safety issues
- Low: no detected issue
This is a heuristic risk score, not a calibrated probability model.
7. Video analytics reality
The project accepts video extensions in the backend, but uploaded-video processing is currently frame-based:
Uploaded video
      ↓
OpenCV reads the first frame
      ↓
First frame is saved as an image
      ↓
Image analysis pipeline runs
Therefore, the project currently does not perform:
- Multi-frame video analysis
- Object tracking
- Temporal action recognition
- Motion analysis
- Activity duration estimation directly from video
- Event detection across consecutive frames
The live RTSP component continuously reads camera frames and caches the latest JPEG frame. The frontend displays these snapshots, but the backend stream route does not run YOLO inference on every live frame.
The frontend also contains simulated AI overlays and a hardcoded Gemini analysis stub. These should be presented as prototype UI elements, not validated model results.
8. Dataset assessment
The repository contains four model weights but no clear training dataset, annotation files, dataset YAML files, training scripts, or evaluation reports.
At inspection time:
- backend/uploads contained 782 media files
- These included annotated duplicates
- No video files were found in backend/uploads
- local_dev.db contained 17 safety incidents
- local_dev.db contained 17 Activity_new records
- local_dev.db contained 100 activity-log records
- No database camera records existed, although two RTSP cameras are hardcoded in the stream route
The presentation should clearly distinguish between:
- Model inference assets
- Uploaded operational examples
- Database incident records
- Training data
Do not claim that the 782 uploaded files form a labelled training dataset.
9. Main limitations to mention
- Video input is reduced to the first frame.
- No object tracking exists.
- PPE is not associated with individual workers.
- No precision, recall, F1-score or mAP evaluation is included.
- The returned worker_count is hardcoded to zero in the upload response.
- The module-performance endpoint contains simulated percentages.
- The frontend webcam detection overlay is simulated.
- The activity classifier output is not temporally validated.
- Risk scores are keyword-based.
- Model provenance and custom training details are undocumented.
The literature choices below are grounded in the original YOLO paper, multi-person pose estimation research, official Ultralytics YOLOv8 documentation, and construction PPE detection studies: YOLO, OpenPose, Ultralytics YOLOv8, CIB-SE-YOLOv8, and PPE detection in extreme construction conditions.


“Construction sites produce a continuous stream of visual evidence from photographs, CCTV feeds and mobile captures. SiteMonitor AI applies computer vision to this evidence to identify visible safety violations such as missing helmets or vests, unsafe postures and mobile-phone use. The backend combines YOLOv8 pose estimation for people and body keypoints, COCO-pretrained YOLOv8n for cell-phone detection, a custom PPE detector and a custom construction-activity classifier. An Azure OpenAI GPT-4o vision step reviews the raw image and model findings, rejects unsupported detections and returns structured safety issues, risks and recommendations. The platform stores incidents, annotated images and activity records in a database and presents them through dashboards and camera views. In the current implementation, uploaded videos are reduced to their first frame for analysis. Therefore, the project demonstrates frame-level video input rather than complete temporal action recognition. This distinction defines the current system boundary and motivates future work using tracking and sequence models.”


Image or video input → AI analysis → validated safety report → corrective workflow.

“Problem Statement”

- Manual inspections are periodic and depend heavily on human availability.
- Unsafe PPE usage and posture violations may be missed between inspections.
- CCTV footage contains scale changes, occlusion, poor lighting and clutter.
- A detector can produce false positives when workers are distant or partially visible.
- Safety teams need evidence, risk interpretation, recommendations and follow-up.
- Conventional frame-based detection does not capture the full temporal context of an activity.
concise problem statement:

“Develop a computer-vision-assisted safety monitoring system that detects visible construction hazards, validates model findings and converts them into actionable safety records.”


“Motivation and PoC Context”
- Need for faster and more consistent safety observation
- Need to transform site images into structured UAUC or safety records
- Need to support EHS personnel with evidence and recommendations
- Need to connect computer vision with operational workflows

Include a highlighted scope statement:

“Current PoC capability: frame-level safety analysis with database-backed incident workflow.”


“Literature Survey”


Work | Year | Main contribution | Relevance to this project | Limitation or gap


1. Redmon et al., “You Only Look Once: Unified, Real-Time Object Detection”
   Year: 2016
   Contribution: Single-stage object detection using one neural-network inference
   Relevance: Conceptual foundation for real-time object detection and YOLO-based deployment
   Limitation: Generic object detection does not directly understand worker safety context

2. Cao et al., “Realtime Multi-Person 2D Pose Estimation Using Part Affinity Fields”
   Year: 2017
   Contribution: Multi-person 2D pose estimation using body-part association
   Relevance: Supports the use of keypoints for posture and ergonomic reasoning
   Limitation: Keypoints alone do not guarantee correct safety interpretation

3. Ultralytics YOLOv8 Documentation
   Year: 2023
   Contribution: Unified support for detection, classification and pose tasks
   Relevance: Matches the project’s use of YOLOv8 detection, pose and classification models
   Limitation: Pretrained models require domain adaptation for construction environments

4. CIB-SE-YOLOv8: Optimized YOLOv8 for Real-Time Safety Equipment Detection on Construction Sites
   Year: 2024
   Contribution: Construction PPE detection with attention to safety-equipment recognition
   Relevance: Demonstrates the importance of domain-specific PPE detection
   Limitation: Reported performance depends on its dataset and experimental setup

5. Personal Protective Equipment Detection in Extreme Construction Conditions
   Year: 2023
   Contribution: PPE detection under challenging construction conditions
   Relevance: Highlights occlusion, lighting and small-object challenges
   Limitation: Robust deployment requires local validation data
“The project applies these ideas through a modular pipeline combining detection, pose estimation, rule-based reasoning and visual validation.”


“Implementation and Dataset”

Section A: Implementation stack

- Frontend: React, TypeScript, Vite, Tailwind CSS and Recharts
- Backend: Python, FastAPI, SQLAlchemy and OpenCV
- Computer vision: YOLOv8 detection, pose estimation and classification
- Multimodal validation: Azure OpenAI GPT-4o
- Storage: SQLite fallback or Azure SQL Server
- Streaming: OpenCV-based RTSP frame capture

Section B: Available project evidence

- `yolov8m-pose.pt`: pose model
- `yolov8n.pt`: COCO object detector
- `vest_model.pt`: custom PPE detector
- `best.pt`: custom construction-activity classifier
- 782 media files currently present in `backend/uploads`
- No video files found in the upload folder during inspection
- No labelled training dataset, dataset YAML or evaluation report found in the repository


“Objective 1: Detect Workers and PPE”

Objective:
Detect workers and identify visible PPE compliance issues.

Implementation:
- YOLOv8m-pose detects people and body keypoints.
- `vest_model.pt` detects PPE classes including helmet and vest.
- The system draws bounding boxes and labels on the frame.
- PPE checks are activated only when at least one person is detected.
- GPT-4o reviews whether the worker is sufficiently visible before reporting a violation.

Show an annotated image with:
- Person bounding box
- Helmet bounding box
- Vest bounding box
- Pose keypoints


“Objective 2: Recognize Unsafe Posture, Phone Use and Activities”

Objective:
Identify unsafe worker behavior and classify visible construction activities.

Implementation:
- Calculate back angle, knee angle and torso tilt from pose keypoints.
- Use ankle-height differences as a climbing indicator.
- Detect phones using COCO class 67.
- Compare phone location with wrist keypoints.
- Use hand-to-face and head-position heuristics for possible phone use.
- Use `best.pt` to classify construction activities.

Example outputs:
- Unsafe bending
- Sitting or crouching
- Climbing
- Leaning or resting
- Possible fatigue
- Unsafe lifting
- Phone usage
- Construction activity labels


“Objective 3: Convert Vision Results into Actionable Safety Records”

Objective:
Convert model findings into structured safety information and an operational workflow.

Implementation:
- Combine raw detections with user remarks.
- Send the original frame to GPT-4o for visual validation.
- Return structured JSON containing issues, risks and recommendations.
- Assign a heuristic risk level using keywords.
- Store the incident and annotated image in the database.
- Display results in safety analytics, incident views and UAUC workflows.
- Support corrective-action evidence through the application workflow.


Safety issue:
“Worker at height without visible fall protection”

Possible risk:
“Fall from height causing serious injury”

Recommendation:
“Provide approved fall protection and restrict access until corrected”


Slide 10: General architecture

Title:
“General Architecture”


Input sources:
- Uploaded image
- Uploaded video
- RTSP camera
- Browser camera

Preprocessing:
- OpenCV image decoding
- Resize to maximum dimension
- First-frame extraction for uploaded video

Parallel AI modules:
- YOLOv8m-pose
- YOLOv8n phone detector
- Custom PPE detector
- Construction activity classifier

Reasoning layer:
- Pose geometry rules
- PPE presence checks
- Phone-to-wrist proximity
- Activity labels
- User remarks

Validation layer:
- Azure OpenAI GPT-4o
- JSON safety report

Application layer:
- Risk classification
- Incident database
- Activity logs
- Annotated evidence
- Safety analytics dashboard
- UAUC corrective workflow


COnclusions:

- The project demonstrates a modular computer-vision pipeline for construction-site safety.
- YOLOv8 pose estimation supports worker and posture analysis.
- Custom PPE and activity models extend the system beyond generic object detection.
- Rule-based reasoning converts keypoints into interpretable safety labels.
- GPT-4o provides a second-stage visual validation and structured reporting layer.
- Database integration connects image analysis to incident and corrective-action workflows.


“References”


[1] J. Redmon, S. Divvala, R. Girshick and A. Farhadi, “You Only Look Once: Unified, Real-Time Object Detection,” CVPR, 2016.
https://openaccess.thecvf.com/content_cvpr_2016/papers/Redmon_You_Only_Look_CVPR_2016_paper.pdf

[2] Z. Cao, T. Simon, S.-E. Wei and Y. Sheikh, “Realtime Multi-Person 2D Pose Estimation Using Part Affinity Fields,” CVPR, 2017.
https://openaccess.thecvf.com/content_cvpr_2017/html/Cao_Realtime_Multi-Person_2D_CVPR_2017_paper.html

[3] Ultralytics, “YOLOv8 Documentation.”
https://docs.ultralytics.com/models/yolov8

[4] “CIB-SE-YOLOv8: Optimized YOLOv8 for Real-Time Safety Equipment Detection on Construction Sites,” arXiv, 2024.
https://arxiv.org/abs/2410.20699

[5] “Personal Protective Equipment Detection in Extreme Construction Conditions,” arXiv, 2023.
https://arxiv.org/abs/2307.13654

[6] SiteMonitor AI project implementation:
- backend/audit.py
- backend/routes/upload.py
- backend/routes/stream.py
- backend/routes/analytics.py
- frontend/src/App.tsx
- README.md


I checked the checkpoint metadata. The project uses two standard Ultralytics checkpoints and two custom-trained models.
Model	Training source and method	Checkpoint-reported validation
yolov8m-pose.pt	Official YOLOv8m pose model, trained using COCO-Pose metadata, 1,000 configured epochs, SGD, 640px images, batch 128, AMP and pose augmentation	No project-specific metrics included
yolov8n.pt	Official YOLOv8n detector using COCO metadata, 500 configured epochs, SGD, 640px images, batch 16, mosaic augmentation and AMP	No project-specific metrics included
vest_model.pt	Custom PPE detector fine-tuned from yolov8n.pt using PPE_Dataset_new/data.yaml, 50 configured epochs, batch 32, 640px images, automatic optimizer, pretrained weights, RandAugment and validation split	Precision: 0.8098, Recall: 0.7466, mAP50: 0.8062, mAP50-95: 0.5352
best.pt	Custom activity classifier fine-tuned from yolov8n-cls.pt using E:\MPSB_FRAMES\dataset, 20 configured epochs, batch 32, 320px images, automatic optimizer, pretrained weights, RandAugment, random erasing and validation split	Top-1 accuracy: 0.9853, Top-5 accuracy: 1.0000, validation loss: 0.0691


Section A: Model inventory

1. YOLOv8m-Pose:
   - Official Ultralytics pose checkpoint
   - COCO-Pose training metadata
   - Used to detect workers and 17 body keypoints
   - Inference configuration in the project: 1280px image size and 0.25 confidence threshold

2. YOLOv8n:
   - Official COCO object-detection checkpoint
   - Used mainly for cell-phone detection
   - Cell phone corresponds to COCO class 67
   - Inference configuration in the project: 1280px image size and 0.25 confidence threshold

3. vest_model.pt:
   - Custom PPE detector
   - Fine-tuned from YOLOv8n
   - Detects Gloves, Vest, goggles, helmet, mask and safety_shoe

4. best.pt:
   - Custom YOLOv8 classification model
   - Fine-tuned from YOLOv8n-cls
   - Classifies construction activities

Section B: Training methods

For `vest_model.pt`:
- Dataset configuration: PPE_Dataset_new/data.yaml
- 50 configured training epochs
- Batch size: 32
- Image size: 640 × 640
- Pretrained YOLOv8n initialization
- Automatic optimizer selection
- Automatic mixed precision
- RandAugment
- Horizontal flipping
- Validation split enabled
- Deterministic seed: 0

For `best.pt`:
- Dataset path recorded in checkpoint: E:\MPSB_FRAMES\dataset
- 20 configured training epochs
- Batch size: 32
- Image size: 320 × 320
- Pretrained YOLOv8n-cls initialization
- Automatic optimizer selection
- Automatic mixed precision
- RandAugment
- Random erasing
- Horizontal flipping
- Validation split enabled
- Deterministic seed: 0

Section C: Dataset caveat

- The custom training datasets are not stored in the repository.
- The repository contains model checkpoints but no training images, labels or YAML files.
- The uploaded media folder contains operational examples and annotated duplicates, not a confirmed training dataset.
- Checkpoint metrics should be described as reported validation metrics, not independent project test results.


“Objective 1: Worker and PPE Detection”

Objective:
Detect workers and identify visible personal protective equipment.

Implementation:
- Use the official YOLOv8m-Pose model to detect people and body keypoints.
- Use the custom `vest_model.pt` detector for PPE recognition.
- The PPE model was fine-tuned from YOLOv8n using a custom PPE dataset.
- The detector contains six classes:
  Gloves, Vest, goggles, helmet, mask and safety_shoe.
- The project filters the PPE outputs specifically for helmet and vest detection.
- The system draws person boxes, PPE boxes and pose keypoints on the image.
- GPT-4o reviews whether the worker is sufficiently visible before confirming a violation.

Include the checkpoint-reported PPE validation metrics:
- Precision: 80.98%
- Recall: 74.66%
- mAP50: 80.62%
- mAP50-95: 53.52%

“Objective 2: Unsafe Posture, Phone Use and Activity Recognition”

Objective:
Recognize unsafe worker behavior and classify construction activities.

Part A: Pose and posture reasoning

- YOLOv8m-Pose provides 17 body keypoints.
- The system calculates back angle, knee angle and torso tilt.
- Ankle-height differences are used as a climbing indicator.
- Nose and shoulder positions support fatigue and head-down heuristics.
- Rule thresholds generate labels such as:
  Unsafe bending, sitting or crouching, climbing, leaning, possible fatigue and unsafe lifting.

Part B: Phone detection

- YOLOv8n uses the COCO cell-phone class.
- Detected phone centers are compared with wrist keypoints.
- The system also checks hand-to-face distance and head position.
- These rules generate phone usage or possible phone usage warnings.

Part C: Activity classification

- `best.pt` was fine-tuned from YOLOv8n-cls.
- Training configuration recorded in the checkpoint:
  20 configured epochs, 320px images, batch size 32, pretrained initialization, automatic optimizer, RandAugment, random erasing and validation split.
- It classifies ten activities including concreting, curing, buffing, shifting and shuttering-related operations.

Include checkpoint-reported activity-classification metrics:
- Top-1 validation accuracy: 98.53%
- Top-5 validation accuracy: 100%
- Validation loss: 0.0691

“Objective 3: From Model Outputs to Safety Decisions”

Objective:
Convert model outputs into validated safety reports and operational records.

Implementation:
1. Run the parallel vision models.
2. Combine model detections with pose-rule outputs.
3. Add user remarks or a specific inspection request.
4. Send the original image and model findings to GPT-4o.
5. Ask GPT-4o to reject false positives and verify visible hazards.
6. Return structured JSON containing:
   - Safety issues
   - Possible risks
   - Recommendations
7. Assign a heuristic risk level using safety-related keywords.
8. Store the incident, annotated image and activity record in the database.
9. Display the result in the safety dashboard and UAUC workflow.

Neural models:
- Detect objects
- Estimate pose
- Classify activities

Rule engine:
- Converts keypoints into posture labels
- Checks phone-to-wrist proximity
- Applies PPE presence rules

GPT-4o:
- Reviews visual evidence
- Rejects unsupported detections
- Produces structured natural-language recommendations

Add two accuracy caveats:
- GPT-4o is a validation and reporting layer, not the primary detector.
- The current uploaded-video path extracts only the first frame, so temporal video understanding is not yet implemented.
Also update the conclusion slide with this sentence:
The checkpoint metadata shows that the project combines official YOLOv8 models with custom fine-tuned PPE and activity models. However, the reported validation metrics belong to the individual checkpoints and should not be presented as end-to-end system accuracy.
Relevant checkpoint files:
- [vest_model.pt](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/vest_model.pt)
- [best.pt](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/best.pt)
- [yolov8m-pose.pt](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/yolov8m-pose.pt)
- [yolov8n.pt](C:/Michael/Projects/KnowHarmAI/KNOW_HARM_AI/KNOW_HARM_AI_HB_REWORK_FIX/backend/yolov8n.pt)
