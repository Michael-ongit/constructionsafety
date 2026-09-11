"""
Rebuilds the schema memory (Chroma "schema_knowledge" collection) from the
live SQL Server database. Run this once after deployment, and then on a
schedule (e.g. every 15-30 minutes via Windows Task Scheduler or cron) so the
chatbot's understanding of your data stays current as it changes -- without
needing to restart the API.

Usage (from the backend/ directory, with the virtualenv active):
    python scripts/refresh_schema.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import vector_store  # noqa: E402

if __name__ == "__main__":
    report = vector_store.build_schema_knowledge()
    print("Schema memory rebuilt for tables:", ", ".join(report["tables_profiled"]))
