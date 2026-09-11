"""
SMTP email notification helpers for the UAUC lifecycle.

Notification types:
  1. Audit report (upload confirmation with PDF)
  2. Closure submitted (notifies EHS that SE has submitted)
  3. Closure accepted (notifies SE that EHS approved)
  4. Closure rejected / rework required (notifies SE with comments)
  5. UAUC assigned (notifies SE of new assignment)

Email notifications are permanently disabled in this deployment. The helper
functions remain as no-op compatibility shims for existing API routes.
"""

import os
import smtplib
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from typing import Optional


SENDER_EMAIL = ""
SENDER_APP_PASSWORD = ""
# Safety switch: keep email delivery disabled even if SMTP credentials are
# accidentally present in the process environment.
EMAIL_NOTIFICATIONS_ENABLED = False

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))


def _configured_value(env_key: str, file_value: str) -> str:
    return (os.getenv(env_key) or file_value).strip()


def is_email_configured() -> bool:
    """Return whether email delivery is enabled and configured."""
    if not EMAIL_NOTIFICATIONS_ENABLED:
        return False
    return bool(
        _configured_value("SENDER_EMAIL", SENDER_EMAIL)
        and _configured_value("SENDER_APP_PASSWORD", SENDER_APP_PASSWORD)
    )


def _send_email(msg: EmailMessage) -> bool:
    """Low-level SMTP send; returns False when not configured."""
    if not is_email_configured():
        print("[EMAIL] _send_email skipped: SMTP not configured")
        return False
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    password = _configured_value("SENDER_APP_PASSWORD", SENDER_APP_PASSWORD)
    print(f"[EMAIL] Connecting to {SMTP_HOST}:{SMTP_PORT} as {sender}")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender, password)
        server.send_message(msg)
    print(f"[EMAIL] Message sent successfully to {msg['To']}")
    return True


# ---------------------------------------------------------------------------
# Audit report email
# ---------------------------------------------------------------------------

def build_audit_email(
    audit_id: str, project: str, pdf_bytes: bytes,
    location: str = "", remarks: str = "", target_date: str = "",
    attachment_name: str = "", attachment_size: str = "",
    site_engineer: str = "", recipient_email: str = "", download_url: str = "",
) -> EmailMessage:
    """Build an HTML email with audit report PDF attachment."""
    msg = EmailMessage()
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    recipient = recipient_email or sender
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = f"UAUC Capture Report - {audit_id} - {project or 'Unknown Project'}"

    today = datetime.now().strftime("%d %b %Y")
    fmt_target = target_date
    if target_date:
        try:
            from datetime import datetime as _dt
            fmt_target = _dt.strptime(target_date, "%Y-%m-%d").strftime("%d %b %Y")
        except Exception:
            pass

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UAUC Report</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f6f9;">
<tr><td align="center" style="padding:30px 15px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background-color:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="padding:30px 30px 20px 30px;">
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">Dear {site_engineer or 'Site Engineer'},</p>
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">UAUC has been raised.</p>
<p style="font-size:14px;color:#475569;margin:0 0 20px 0;">Please find the details below and the AI analysis report attached.</p>
<table style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;width:100%;">
<thead><tr style="background-color:#1e3a5f;">
<th style="padding:10px 14px;text-align:left;font-size:13px;font-weight:700;color:#fff;">Audit ID</th>
<th style="padding:10px 14px;text-align:left;font-size:13px;font-weight:700;color:#fff;">Date</th>
<th style="padding:10px 14px;text-align:left;font-size:13px;font-weight:700;color:#fff;">Location</th>
<th style="padding:10px 14px;text-align:left;font-size:13px;font-weight:700;color:#fff;">Target Date</th>
</tr></thead>
<tbody><tr style="background-color:#fff;">
<td style="padding:10px 14px;font-size:14px;color:#1e293b;font-weight:600;">{audit_id or '—'}</td>
<td style="padding:10px 14px;font-size:14px;color:#1e293b;">{today}</td>
<td style="padding:10px 14px;font-size:14px;color:#1e293b;">{location or '—'}</td>
<td style="padding:10px 14px;font-size:14px;color:#1e293b;">{fmt_target or '—'}</td>
</tr></tbody></table>
<p style="font-size:14px;color:#475569;margin:22px 0 0 0;">AI Analysis Report is attached for your reference.</p>
</td></tr>
<tr><td style="padding:20px 30px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
<p style="margin:0;">This is an automated notification from Know Harm AI.</p>
</td></tr>
</table></td></tr></table></body></html>"""

    plain = f"""UAUC has been raised.\n\nAudit ID: {audit_id or 'N/A'}\nDate: {today}\nLocation: {location or 'N/A'}\nTarget Date: {fmt_target or 'N/A'}\n\nAI Analysis Report is attached.\n\nRegards,\nDigital Team"""
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    if pdf_bytes:
        msg.add_attachment(pdf_bytes, maintype="application", subtype="pdf",
                           filename=f"Audit_Report_{audit_id}.pdf")
    return msg


def send_audit_email(
    audit_id: str, project: str, pdf_bytes: bytes,
    location: str = "", remarks: str = "", target_date: str = "",
    attachment_name: str = "", attachment_size: str = "",
    site_engineer: str = "", recipient_email: str = "", download_url: str = "",
) -> bool:
    """Send a compliance audit report email with PDF."""
    if not is_email_configured():
        print("Audit email not sent: SMTP not configured.")
        return False
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    password = _configured_value("SENDER_APP_PASSWORD", SENDER_APP_PASSWORD)
    msg = build_audit_email(audit_id, project, pdf_bytes, location=location,
                            remarks=remarks, target_date=target_date,
                            attachment_name=attachment_name, attachment_size=attachment_size,
                            site_engineer=site_engineer, recipient_email=recipient_email,
                            download_url=download_url)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.ehlo(); server.starttls(); server.ehlo()
        server.login(sender, password)
        server.send_message(msg)
    return True


# ---------------------------------------------------------------------------
# UAUC lifecycle notification emails
# ---------------------------------------------------------------------------

def build_closure_submitted_email(
    audit_id: str, project: str, site_engineer: str,
    activity: str, location: str, description: str, recipient_email: str,
) -> EmailMessage:
    """Notify EHS that a Site Engineer has submitted closure."""
    msg = EmailMessage()
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    msg["From"] = sender
    msg["To"] = recipient_email
    msg["Subject"] = f"UAUC Closure Submitted - {audit_id} - {project or 'Unknown Project'}"
    today = datetime.now().strftime("%d %b %Y")
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>UAUC Closure Submitted</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" style="background:#f4f6f9;"><tr><td align="center" style="padding:30px 15px;">
<table width="600" style="background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="padding:30px;">
<p style="font-size:15px;color:#1e293b;margin:0 0 6px 0;">Dear EHS Team,</p>
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">A UAUC closure has been submitted by <strong>{site_engineer}</strong>.</p>
<p style="font-size:14px;color:#475569;margin:0 0 20px 0;">Please review at the earliest.</p>
<table style="border-collapse:collapse;border:1px solid #e2e8f0;width:100%;">
<thead><tr style="background:#1e3a5f;">
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Audit ID</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Date</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Activity</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Location</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">SE</th>
</tr></thead>
<tbody><tr style="background:#fff;">
<td style="padding:10px;font-size:14px;color:#1e293b;font-weight:600;">{audit_id or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{today}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{activity or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{location or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{site_engineer or '—'}</td>
</tr></tbody></table>
<p style="font-size:14px;color:#475569;margin:22px 0 0 0;"><strong>Description:</strong><br>{description or '—'}</p>
<p style="font-size:14px;color:#1e293b;margin:24px 0 2px 0;">Regards,<br><strong>Digital Team</strong></p>
</td></tr>
<tr><td style="padding:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
<p style="margin:0;">Automated notification from Know Harm AI.</p>
</td></tr></table></td></tr></table></body></html>"""
    plain = f"""UAUC Closure Submitted - {audit_id}\n\nSite Engineer {site_engineer} has submitted a closure.\n\nAudit ID: {audit_id or 'N/A'}\nDate: {today}\nActivity: {activity or 'N/A'}\nLocation: {location or 'N/A'}\nSite Engineer: {site_engineer or 'N/A'}\nDescription: {description or 'N/A'}\n\nRegards,\nDigital Team"""
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    return msg


def build_closure_accepted_email(
    audit_id: str, project: str, site_engineer: str, recipient_email: str,
) -> EmailMessage:
    """Notify Site Engineer that their closure was accepted."""
    msg = EmailMessage()
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    msg["From"] = sender
    msg["To"] = recipient_email
    msg["Subject"] = f"UAUC Closure Accepted - {audit_id} - {project or 'Unknown Project'}"
    today = datetime.now().strftime("%d %b %Y")
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>UAUC Closure Accepted</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" style="background:#f4f6f9;"><tr><td align="center" style="padding:30px 15px;">
<table width="600" style="background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="padding:30px;">
<p style="font-size:15px;color:#1e293b;margin:0 0 6px 0;">Dear {site_engineer or 'Site Engineer'},</p>
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">Your closure for <strong>{audit_id}</strong> has been reviewed and <strong style="color:#16a34a;">accepted</strong>.</p>
<p style="font-size:14px;color:#475569;margin:0 0 20px 0;">The UAUC is now closed. No further action required.</p>
<table style="border-collapse:collapse;border:1px solid #e2e8f0;width:100%;">
<thead><tr style="background:#1e3a5f;">
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Audit ID</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Project</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Status</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Closed Date</th>
</tr></thead>
<tbody><tr style="background:#fff;">
<td style="padding:10px;font-size:14px;color:#1e293b;font-weight:600;">{audit_id or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{project or '—'}</td>
<td style="padding:10px;font-size:14px;color:#16a34a;font-weight:600;">ACCEPTED</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{today}</td>
</tr></tbody></table>
<p style="font-size:14px;color:#1e293b;margin:24px 0 2px 0;">Regards,<br><strong>Digital Team</strong></p>
</td></tr>
<tr><td style="padding:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
<p style="margin:0;">Automated notification from Know Harm AI.</p>
</td></tr></table></td></tr></table></body></html>"""
    plain = f"""UAUC Closure Accepted - {audit_id}\n\nYour closure for {audit_id} has been accepted.\n\nAudit ID: {audit_id or 'N/A'}\nProject: {project or 'N/A'}\nStatus: ACCEPTED\nClosed Date: {today}\n\nNo further action required.\n\nRegards,\nDigital Team"""
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    return msg


def build_closure_rejected_email(
    audit_id: str, project: str, site_engineer: str,
    comment: str, unresolved_issues: str, recipient_email: str,
) -> EmailMessage:
    """Notify Site Engineer that their closure needs rework or was rejected."""
    msg = EmailMessage()
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    msg["From"] = sender
    msg["To"] = recipient_email
    msg["Subject"] = f"UAUC Closure Requires Rework - {audit_id} - {project or 'Unknown Project'}"
    today = datetime.now().strftime("%d %b %Y")
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>UAUC Closure Rework Required</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" style="background:#f4f6f9;"><tr><td align="center" style="padding:30px 15px;">
<table width="600" style="background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="padding:30px;">
<p style="font-size:15px;color:#1e293b;margin:0 0 6px 0;">Dear {site_engineer or 'Site Engineer'},</p>
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">Your closure for <strong>{audit_id}</strong> requires <strong style="color:#dc2626;">rework</strong>.</p>
<p style="font-size:14px;color:#475569;margin:0 0 20px 0;">Please address the issues below and resubmit.</p>
<table style="border-collapse:collapse;border:1px solid #e2e8f0;width:100%;">
<thead><tr style="background:#1e3a5f;">
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Audit ID</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Project</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Status</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Date</th>
</tr></thead>
<tbody><tr style="background:#fff;">
<td style="padding:10px;font-size:14px;color:#1e293b;font-weight:600;">{audit_id or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{project or '—'}</td>
<td style="padding:10px;font-size:14px;color:#dc2626;font-weight:600;">REWORK REQUIRED</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{today}</td>
</tr></tbody></table>
<p style="font-size:14px;color:#475569;margin:22px 0 6px 0;"><strong>Review Comments:</strong><br>{comment or 'No comments.'}</p>
<p style="font-size:14px;color:#475569;margin:0 0 18px 0;"><strong>Unresolved Issues:</strong><br>{unresolved_issues or '—'}</p>
<p style="font-size:14px;color:#1e293b;margin:24px 0 2px 0;">Regards,<br><strong>Digital Team</strong></p>
</td></tr>
<tr><td style="padding:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
<p style="margin:0;">Automated notification from Know Harm AI.</p>
</td></tr></table></td></tr></table></body></html>"""
    plain = f"""UAUC Closure Requires Rework - {audit_id}\n\nYour closure for {audit_id} requires rework.\n\nAudit ID: {audit_id or 'N/A'}\nProject: {project or 'N/A'}\nStatus: REWORK REQUIRED\nDate: {today}\n\nComments: {comment or 'N/A'}\nUnresolved Issues: {unresolved_issues or 'N/A'}\n\nPlease address and resubmit.\n\nRegards,\nDigital Team"""
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    return msg


def build_uauc_assigned_email(
    audit_id: str, project: str, site_engineer: str,
    location: str, remarks: str, target_date: str, recipient_email: str,
) -> EmailMessage:
    """Notify Site Engineer about a newly assigned UAUC."""
    msg = EmailMessage()
    sender = _configured_value("SENDER_EMAIL", SENDER_EMAIL)
    msg["From"] = sender
    msg["To"] = recipient_email
    msg["Subject"] = f"New UAUC Assigned - {audit_id} - {project or 'Unknown Project'}"
    today = datetime.now().strftime("%d %b %Y")
    fmt_target = target_date
    if target_date:
        try:
            from datetime import datetime as _dt
            fmt_target = _dt.strptime(target_date, "%Y-%m-%d").strftime("%d %b %Y")
        except Exception:
            pass
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>New UAUC Assigned</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:sans-serif;">
<table width="100%" style="background:#f4f6f9;"><tr><td align="center" style="padding:30px 15px;">
<table width="600" style="background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="padding:30px;">
<p style="font-size:15px;color:#1e293b;margin:0 0 6px 0;">Dear {site_engineer or 'Site Engineer'},</p>
<p style="font-size:15px;color:#1e293b;margin:0 0 14px 0;">A new UAUC has been assigned to you.</p>
<p style="font-size:14px;color:#475569;margin:0 0 20px 0;">Please review and take action by the target date.</p>
<table style="border-collapse:collapse;border:1px solid #e2e8f0;width:100%;">
<thead><tr style="background:#1e3a5f;">
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Audit ID</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Date</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Location</th>
<th style="padding:10px;text-align:left;font-size:13px;color:#fff;">Target Date</th>
</tr></thead>
<tbody><tr style="background:#fff;">
<td style="padding:10px;font-size:14px;color:#1e293b;font-weight:600;">{audit_id or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{today}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{location or '—'}</td>
<td style="padding:10px;font-size:14px;color:#1e293b;">{fmt_target or '—'}</td>
</tr></tbody></table>
<p style="font-size:14px;color:#1e293b;margin:24px 0 2px 0;">Regards,<br><strong>Digital Team</strong></p>
</td></tr>
<tr><td style="padding:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
<p style="margin:0;">Automated notification from Know Harm AI.</p>
</td></tr></table></td></tr></table></body></html>"""
    plain = f"""New UAUC Assigned - {audit_id}\n\nA new UAUC has been assigned to you.\n\nAudit ID: {audit_id or 'N/A'}\nDate: {today}\nLocation: {location or 'N/A'}\nTarget Date: {fmt_target or 'N/A'}\n\nPlease take necessary action.\n\nRegards,\nDigital Team"""
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    return msg


# ---------------------------------------------------------------------------
# Public send functions
# ---------------------------------------------------------------------------

def send_closure_submitted_notification(
    audit_id: str, project: str, site_engineer: str,
    activity: str, location: str, description: str, recipient_email: str,
) -> bool:
    if not is_email_configured():
        print("Closure notification not sent: SMTP not configured.")
        return False
    msg = build_closure_submitted_email(audit_id, project, site_engineer, activity, location, description, recipient_email)
    return _send_email(msg)


def send_closure_accepted_notification(
    audit_id: str, project: str, site_engineer: str, recipient_email: str,
) -> bool:
    if not is_email_configured():
        print("Closure acceptance not sent: SMTP not configured.")
        return False
    msg = build_closure_accepted_email(audit_id, project, site_engineer, recipient_email)
    return _send_email(msg)


def send_closure_rejected_notification(
    audit_id: str, project: str, site_engineer: str, comment: str, unresolved_issues: str, recipient_email: str,
) -> bool:
    if not is_email_configured():
        print("Closure rejection not sent: SMTP not configured.")
        return False
    msg = build_closure_rejected_email(audit_id, project, site_engineer, comment, unresolved_issues, recipient_email)
    return _send_email(msg)


def send_uauc_assigned_notification(
    audit_id: str, project: str, site_engineer: str,
    location: str, remarks: str, target_date: str, recipient_email: str,
) -> bool:
    if not is_email_configured():
        print("UAUC assigned notification not sent: SMTP not configured.")
        return False
    msg = build_uauc_assigned_email(audit_id, project, site_engineer, location, remarks, target_date, recipient_email)
    return _send_email(msg)
