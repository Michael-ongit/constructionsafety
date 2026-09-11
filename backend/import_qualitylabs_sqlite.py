"""Import KnowHarmAI-compatible records from the QualityLabs SQLite backup.

The source database contains many unrelated laboratory/Django tables. This
script intentionally imports only the safety-monitoring tables that match the
active KnowHarmAI API schema. The source is opened read-only.
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


DEFAULT_SOURCE = Path(
    "C:/Michael/LT_internship/QualityLabs_files/QualityLabs/"
    "laboratory_backup_before_cleanup.db"
)
DEFAULT_TARGET = Path(__file__).with_name("local_dev.db")


def quote(identifier: str) -> str:
    return "[" + identifier.replace("]", "]]" ) + "]"


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


def source_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA table_info({quote(table)})")]


def import_activity_logs(source: sqlite3.Connection, target: sqlite3.Connection) -> int:
    if not table_exists(source, "activity_logs") or not table_exists(target, "activity_logs"):
        return 0

    columns = source_columns(source, "activity_logs")
    names = ", ".join(quote(column) for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    rows = source.execute(f"SELECT {names} FROM [activity_logs]").fetchall()
    target.executemany(
        f"INSERT OR IGNORE INTO [activity_logs] ({names}) VALUES ({placeholders})",
        rows,
    )
    return len(rows)


def import_incidents(source: sqlite3.Connection, target: sqlite3.Connection) -> int:
    if not table_exists(source, "Incidents") or not table_exists(target, "Incidents"):
        return 0

    existing = {
        row[0]
        for row in target.execute(
            "SELECT incident_id FROM [Incidents] WHERE incident_id IS NOT NULL"
        )
    }
    rows = source.execute(
        """SELECT id, timestamp, camera, zone, type, confidence, status,
                  severity, imageUrl, oneDriveUrl, localPath
           FROM [Incidents]"""
    ).fetchall()
    next_id = target.execute("SELECT COALESCE(MAX(id), 0) FROM [Incidents]").fetchone()[0] + 1
    imported = 0
    for row in rows:
        source_id = row[0]
        if source_id in existing:
            continue
        target.execute(
            """INSERT INTO [Incidents]
               (id, incident_id, timestamp, camera, zone, type, confidence,
                status, severity, imageUrl, oneDriveUrl, localPath)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (next_id, source_id, *row[1:]),
        )
        existing.add(source_id)
        next_id += 1
        imported += 1
    return imported


def import_cameras(source: sqlite3.Connection, target: sqlite3.Connection) -> int:
    """Map the older camera shape if it contains records."""
    if not table_exists(source, "cameras") or not table_exists(target, "cameras"):
        return 0

    rows = source.execute(
        "SELECT id, camera_name, rtsp_url, location FROM [cameras]"
    ).fetchall()
    imported = 0
    for source_id, name, rtsp_url, location in rows:
        camera_id = f"CAM-{source_id}"
        exists = target.execute(
            "SELECT 1 FROM [cameras] WHERE camera_id=?", (camera_id,)
        ).fetchone()
        if exists:
            continue
        target.execute(
            """INSERT INTO [cameras]
               (camera_id, name, zone, status, detection, video_url, type)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (camera_id, name or camera_id, location or "Unknown", "Normal",
             "Safety monitoring", rtsp_url, "static"),
        )
        imported += 1
    return imported


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source database does not exist: {args.source}")
    if not args.target.exists():
        raise SystemExit(f"Target database does not exist: {args.target}")

    source = sqlite3.connect(f"file:{args.source.resolve()}?mode=ro", uri=True)
    target = sqlite3.connect(args.target)
    try:
        with target:
            activity_count = import_activity_logs(source, target)
            incident_count = import_incidents(source, target)
            camera_count = import_cameras(source, target)
        print(f"Imported activity_logs rows: {activity_count}")
        print(f"Imported Incidents rows: {incident_count}")
        print(f"Imported cameras rows: {camera_count}")
    finally:
        source.close()
        target.close()


if __name__ == "__main__":
    main()
