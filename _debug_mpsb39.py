import sys; sys.path.insert(0, 'backend')
from database import SessionLocal
from models import ComplianceAudit, UAucEvidence, UAucRejectionHistory
import json

db = SessionLocal()

row = db.query(ComplianceAudit).filter(ComplianceAudit.Audit_Id == 'MPSB-39').first()
if not row:
    rows = db.query(ComplianceAudit).filter(ComplianceAudit.Audit_Id.like('%MPSB%')).all()
    for r in rows:
        print(f'Found: Sl_No={r.Sl_No}, Audit_Id={r.Audit_Id}, Status={r.Status}')
    db.close()
    exit()

print('=== COMPLIANCE_AUDIT ===')
print(f'Sl_No: {row.Sl_No}')
print(f'Audit_Id: {row.Audit_Id}')
print(f'Project: {row.Project}')
print(f'Activity: {row.Activity}')
print(f'Location: {row.Location}')
print(f'Safety_Issues: {repr(row.Safety_Issues)}')
print(f'Status: {row.Status}')
print(f'Target_Date: {row.Target_Date}')
print(f'Closed_Date: {row.Closed_Date}')
print(f'Closure_SE_Date: {row.Closure_SE_Date}')
print(f'Closure_SE_Time: {row.Closure_SE_Time}')
print(f'Corrective_Action_Taken: {repr(row.Corrective_Action_Taken)}')
print(f'Initiator_comment: {repr(row.Initiator_comment)}')
print(f'Initiated_By: {row.Initiated_By}')
print(f'Site_Engineer: {row.Site_Engineer}')
print(f'Breif_Desription: {repr(row.Breif_Desription)}')
print(f'Tot_Rework_Count: {row.Tot_Rework_Count}')
print(f'Image_Blob: {len(row.Image_Blob) if row.Image_Blob else 0} bytes')
print(f'Pending_Evidence keys: {list(json.loads(row.Pending_Evidence).keys()) if row.Pending_Evidence else None}')

latest = db.query(UAucRejectionHistory).filter(
    UAucRejectionHistory.Audit_Id == 'MPSB-39'
).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
if latest:
    print(f'\n=== REJECTION HISTORY ===')
    print(f'Latest rejection - Unresolved: {latest.Unresolved_Issues}')
    print(f'Rejected_By: {latest.Rejected_By}')
    print(f'Rejection_Date: {latest.Rejection_Date}')
    print(f'Rejection_Comment: {latest.Rejection_Comment}')
    print(f'Rework_Count: {latest.Rework_Count}')

ev_count = db.query(UAucEvidence).filter(UAucEvidence.Audit_Id == 'MPSB-39').count()
print(f'\n=== UAUC_EVIDENCE rows: {ev_count} ===')
for e in db.query(UAucEvidence).filter(UAucEvidence.Audit_Id == 'MPSB-39').all():
    print(f'  Eid={e.Evidence_Id} Issue={e.Issue_Name} has_img={e.After_Image_Blob is not None}')

issues = [s.strip() for s in (row.Safety_Issues or '').replace('\n', ';').split(';') if s.strip()]
print(f'\n=== SAFETY ISSUES ({len(issues)}) ===')
for i, iss in enumerate(issues):
    marker = ' <-- UNRESOLVED' if latest and latest.Unresolved_Issues and iss in latest.Unresolved_Issues else ''
    print(f'  [{i}] {iss}{marker}')

print(f'\n=== PENDING EVIDENCE ===')
if row.Pending_Evidence:
    pe = json.loads(row.Pending_Evidence)
    for k, v in pe.items():
        if isinstance(v, str):
            print(f'  key {k}: {v[:60]}... (base64, {len(v)} chars)')
        elif isinstance(v, dict):
            print(f'  key {k}: dict with keys {list(v.keys())}')
else:
    print('  None')

db.close()
