import sys; sys.path.insert(0, 'backend')
from database import SessionLocal
from models import ComplianceAudit
import json

db = SessionLocal()
row = db.query(ComplianceAudit).filter(ComplianceAudit.Audit_Id == 'MPSB-37').first()
pe = json.loads(row.Pending_Evidence)

print("Pending_Evidence image comparison:")
for k, v in pe.items():
    if isinstance(v, str):
        print(f'  key {k}: {len(v)} chars, starts with: {v[:40]}..., ends with: ...{v[-20:]}')

# Compare key 0 and key 2
img0 = pe.get("0", "")
img2 = pe.get("2", "")
if isinstance(img0, str) and isinstance(img2, str):
    print(f'\nKey 0 == Key 2: {img0 == img2}')
    print(f'Key 0 length: {len(img0)}, Key 2 length: {len(img2)}')
    if len(img0) == len(img2):
        # Check first and last 100 chars
        print(f'  First 50 same: {img0[:50] == img2[:50]}')
        print(f'  Last 50 same: {img0[-50:] == img2[-50:]}')

# Check if any keys have the same content
seen = {}
for k, v in pe.items():
    if isinstance(v, str):
        if v in seen:
            print(f'\n!!! KEY {k} IS IDENTICAL TO KEY {seen[v]} !!!')
        else:
            seen[v] = k

# Check pending_evidence history - is there a pattern of re-submissions overwriting?
print(f'\n--- Submit-closure flow analysis ---')
print(f'Status: {row.Status}')
print(f'Corrective_Action_Taken: {repr(row.Corrective_Action_Taken)}')
print(f'Rework count from compliance_audit: {row.Tot_Rework_Count}')

db.close()
