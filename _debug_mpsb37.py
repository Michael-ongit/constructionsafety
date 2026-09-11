import sys; sys.path.insert(0, 'backend')
from database import SessionLocal
from models import ComplianceAudit, UAucEvidence, UAucRejectionHistory
import json

db = SessionLocal()

row = db.query(ComplianceAudit).filter(ComplianceAudit.Audit_Id == 'MPSB-37').first()
if not row:
    rows = db.query(ComplianceAudit).filter(ComplianceAudit.Audit_Id.like('%MPSB%')).all()
    for r in rows:
        print(f'Found: Sl_No={r.Sl_No}, Audit_Id={r.Audit_Id}, Status={r.Status}')
    db.close()
    exit()

print('=== COMPLIANCE_AUDIT ===')
print(f'Sl_No: {row.Sl_No}')
print(f'Audit_Id: {row.Audit_Id}')
print(f'Safety_Issues: {repr(row.Safety_Issues)}')
print(f'Status: {row.Status}')
print(f'Pending_Evidence keys: {list(json.loads(row.Pending_Evidence).keys()) if row.Pending_Evidence else None}')
print(f'Image_Blob: {len(row.Image_Blob) if row.Image_Blob else 0} bytes')

latest = db.query(UAucRejectionHistory).filter(
    UAucRejectionHistory.Audit_Id == 'MPSB-37'
).order_by(UAucRejectionHistory.Rejection_Id.desc()).first()
if latest:
    print(f'Latest rejection - Unresolved: {latest.Unresolved_Issues}')
    print(f'Rework_Count: {latest.Rework_Count}')

ev_count = db.query(UAucEvidence).filter(UAucEvidence.Audit_Id == 'MPSB-37').count()
print(f'\nUAUC_EVIDENCE rows: {ev_count}')

issues = [s.strip() for s in (row.Safety_Issues or '').replace('\n', ';').split(';') if s.strip()]
print(f'\nSafety_Issues ({len(issues)}):')
for i, iss in enumerate(issues):
    marker = ' <-- UNRESOLVED' if latest and i == issues.index(latest.Unresolved_Issues) else ''
    print(f'  [{i}] {iss}{marker}')

unresolved_idx = -1
if latest and latest.Unresolved_Issues:
    try:
        unresolved_idx = issues.index(latest.Unresolved_Issues)
    except ValueError:
        print(f'WARNING: Unresolved_Issues text not found in Safety_Issues list!')

print(f'\nHow frontend would render (approval page):')
mapped = [''] * len(issues)
if row.Pending_Evidence:
    pe = json.loads(row.Pending_Evidence)
    # Approval page loads ALL pending_evidence (no rework filter on pending_evidence load)
    for i in range(len(issues)):
        if str(i) in pe:
            mapped[i] = f'PENDING_EVIDENCE[{i}]'
            print(f'  Issue [{i}]: After = Pending_Evidence["{i}"]')

# No evidence_images since UAUC_EVIDENCE is empty
print(f'\nNo UAucEvidence rows exist -- no evidence_images to overwrite.')

# Check what images each pending_evidence key has
print(f'\nPending_Evidence content:')
for k, v in json.loads(row.Pending_Evidence).items():
    if isinstance(v, str):
        print(f'  key {k}: {v[:60]}... (base64, {len(v)} chars)')
    elif isinstance(v, dict):
        print(f'  key {k}: dict with keys {list(v.keys())}')

db.close()
