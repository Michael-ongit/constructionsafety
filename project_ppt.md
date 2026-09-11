Create however many slides required for an academic presentation in an Image and Video Analytics course.

Project title:
“KnowHarm AI: Computer Vision for Construction-Site Safety Monitoring”

Audience:
Faculty and students studying computer vision, image analytics, video analytics and applied artificial intelligence.

Presentation style:
Use the christ university ppt format. Use real construction-site imagery and annotated computer-vision frames where possible. Prefer diagrams, tables and annotated screenshots over decorative stock imagery.

Use large readable fonts:
- Slide titles: 30 to 38 pt
- Body text: at least 18 pt
- Table text: at least 14 to 16 pt

Do not invent:
- Team member names
- Accuracy values
- Precision, recall, F1-score or mAP
- Dataset size beyond the repository evidence
- Training methodology that is not documented
- Organization-specific business results
- Real-time video performance

Clearly distinguish implemented functionality from prototype, simulated or future functionality.

Slide 1: Title and team details

Title:
“KnowHarm AI: Computer Vision for Construction-Site Safety Monitoring”

Subtitle:
“Image and Video Analytics Project”

Include:
- Team member 1: Michael J Kurian
- Course: Image and Video Analytics
- Institution: Christ University
- Guide or faculty: [Faculty name]


Visual:
Use a construction-site background with a subtle overlay of bounding boxes, pose keypoints and safety-alert labels.

Slide 2: Introduction

Title:
“Introduction”

Use approximately 130 to 160 words:

“Construction sites produce a continuous stream of visual evidence from photographs, CCTV feeds and mobile captures. KnowHarm AI applies computer vision to this evidence to identify visible safety violations such as missing helmets or vests, unsafe postures and mobile-phone use. The backend combines YOLOv8 pose estimation for people and body keypoints, COCO-pretrained YOLOv8n for cell-phone detection, a custom PPE detector and a custom construction-activity classifier. An Azure OpenAI GPT-4o vision step reviews the raw image and model findings, rejects unsupported detections and returns structured safety issues, risks and recommendations. The platform stores incidents, annotated images and activity records in a database and presents them through dashboards and camera views.The project demonstrates frame-level video input rather than complete temporal action recognition. This distinction defines the current system boundary and motivates future work using tracking and sequence models.”

Visual:
Show a simple progression:
Image or video input → AI analysis → validated safety report → corrective workflow.

Slide 3: Problem statement

Title:
“Problem Statement”

Explain that construction-site safety monitoring faces these challenges:

- Manual inspections are periodic and depend heavily on human availability.
- Unsafe PPE usage and posture violations may be missed between inspections.
- CCTV footage contains scale changes, occlusion, poor lighting and clutter.
- A detector can produce false positives when workers are distant or partially visible.
- Safety teams need evidence, risk interpretation, recommendations and follow-up.
- Conventional frame-based detection does not capture the full temporal context of an activity.

End with a concise problem statement:

“Develop a computer-vision-assisted safety monitoring system that detects visible construction hazards, validates model findings and converts them into actionable safety records.”

Visual:
Use a contrast between manual inspection and AI-assisted inspection.

Slide 4: Motivation and PoC context

Title:
“Motivation and PoC Context”

Mention:
- Motivation from the Digital Team, L&T TIIC context
- Need for faster and more consistent safety observation
- Need to transform site images into structured UAUC or safety records
- Need to support EHS personnel with evidence and recommendations
- Need to connect computer vision with operational workflows


Include a highlighted scope statement:

“Current PoC capability: frame-level safety analysis with database-backed incident workflow.”


Visual:
Create a PoC boundary diagram with:
CCTV or mobile capture → AI analysis → EHS review → incident record → corrective action.

Slide 5: Literature survey

Title:
“Literature Survey”

Create an editable table with these columns:

Work | Year | Main contribution | Relevance to this project | Limitation or gap

Include these rows:

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

Add a small note:
“The project applies these ideas through a modular pipeline combining detection, pose estimation, rule-based reasoning and visual validation.”

Slide 6: Implementation, model training and dataset

Title:
“Implementation, Model Training and Dataset”

Divide the slide into three sections.

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


Visual:
Show a model-training pipeline:
Dataset → Pretrained YOLO backbone → Fine-tuning → Validation → `.pt` checkpoint → Application inference.

Slide 7: Objective 1 and implementation

Title:
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

Label these clearly:
“Reported validation metrics embedded in vest_model.pt checkpoint.”


Visual:
Use an annotated construction image with separate colors for:
- Person
- Helmet
- Vest
- Pose keypoints

Slide 8: Objective 2 and implementation

Title:
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

Label these clearly:
“Reported validation metrics embedded in best.pt checkpoint.”

Add the limitation:
“These metrics are checkpoint-reported validation results. The source dataset and class distribution are not included in the repository.”

Visual:
Show a pose skeleton with back-angle and knee-angle annotations beside an activity-classification label list.

Slide 9: Objective 3 and implementation

Title:
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

Include a compact technical distinction:

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


Slide 10: General architecture

Title:
“General Architecture”

Create an editable architecture diagram with the following flow:

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

Use solid arrows for implemented data paths. Use dashed arrows for prototype or simulated frontend overlays.

Slide 11: Conclusion

Title:
“Conclusion”

Include these key conclusions:

- The project demonstrates a modular computer-vision pipeline for construction-site safety.
- YOLOv8 pose estimation supports worker and posture analysis.
- Custom PPE and activity models extend the system beyond generic object detection.
- Rule-based reasoning converts keypoints into interpretable safety labels.
- GPT-4o provides a second-stage visual validation and structured reporting layer.
- Database integration connects image analysis to incident and corrective-action workflows.
- The checkpoint metadata shows that the project combines official YOLOv8 models with custom fine-tuned PPE and activity models. 

Slide 12: References

Title:
“References”

Use IEEE-style formatting and include:

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

[6] KnowHarm AI project implementation:
- backend/audit.py
- backend/routes/upload.py
- backend/routes/stream.py
- backend/routes/analytics.py
- frontend/src/App.tsx
- README.md

Final design requirements:
- Use editable tables and diagrams.
- Include one real annotated project image if available.
- Do not show fabricated accuracy values.
- Add short speaker notes explaining the technical purpose of each slide.