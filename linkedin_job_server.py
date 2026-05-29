# save as linkedin_job_server.py
from flask import Flask, request, jsonify, Response
import sqlite3
import json
import csv
import io
from datetime import datetime

DB = "linkedin_jobs.sqlite"

app = Flask(__name__)


def get_conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with sqlite3.connect(DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                linkedin_job_id TEXT UNIQUE,
                linkedin_url TEXT UNIQUE,
                title TEXT,
                company TEXT,
                location TEXT,
                workplace TEXT,
                employment_type TEXT,
                salary TEXT,
                about_job TEXT,
                json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'saved',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        # Migrate existing databases that predate the status column.
        existing = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
        if "status" not in existing:
            conn.execute("ALTER TABLE jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'saved'")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL REFERENCES jobs(id),
                linkedin_job_id TEXT,
                company TEXT,
                type TEXT NOT NULL,
                note TEXT,
                occurred_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)


_UPSERT_SET = """
    linkedin_url    = excluded.linkedin_url,
    title           = excluded.title,
    company         = excluded.company,
    location        = excluded.location,
    workplace       = excluded.workplace,
    employment_type = excluded.employment_type,
    salary          = excluded.salary,
    about_job       = excluded.about_job,
    json            = excluded.json,
    updated_at      = excluded.updated_at
"""

_SUMMARY_COLS = (
    "id, linkedin_job_id, linkedin_url, title, company, location, "
    "workplace, employment_type, salary, status, created_at, updated_at"
)


@app.post("/jobs")
def save_job():
    data = request.get_json(force=True)
    now = datetime.now().isoformat()
    job_id = data.get("linkedin_job_id")

    # Conflict target: job_id when present, url as fallback.
    # NULL != NULL in SQL so ON CONFLICT(linkedin_job_id) won't fire for nulls.
    conflict_col = "linkedin_job_id" if job_id else "linkedin_url"

    params = (
        job_id,
        data.get("linkedin_url"),
        data.get("title"),
        data.get("company"),
        data.get("location"),
        data.get("workplace"),
        data.get("employment_type"),
        data.get("salary"),
        data.get("about_job"),
        json.dumps(data, indent=2),
        now,
        now,
    )

    with get_conn() as conn:
        conn.execute(f"""
            INSERT INTO jobs
                (linkedin_job_id, linkedin_url, title, company, location,
                 workplace, employment_type, salary, about_job, json,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT({conflict_col}) DO UPDATE SET {_UPSERT_SET}
        """, params)

    return jsonify({"ok": True, "status": "saved"})


@app.get("/jobs")
def list_jobs():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {_SUMMARY_COLS} FROM jobs ORDER BY created_at DESC"
        ).fetchall()
    return jsonify({"jobs": [dict(r) for r in rows], "count": len(rows)})


@app.get("/jobs/recent")
def recent_jobs():
    n = request.args.get("n", 10, type=int)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {_SUMMARY_COLS} FROM jobs ORDER BY created_at DESC LIMIT ?", (n,)
        ).fetchall()
    return jsonify({"jobs": [dict(r) for r in rows], "count": len(rows)})


@app.get("/jobs/search")
def search_jobs():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "q parameter required"}), 400
    pattern = f"%{q}%"
    with get_conn() as conn:
        rows = conn.execute(f"""
            SELECT {_SUMMARY_COLS} FROM jobs
            WHERE title LIKE ? OR company LIKE ? OR location LIKE ? OR about_job LIKE ?
            ORDER BY created_at DESC
        """, (pattern, pattern, pattern, pattern)).fetchall()
    return jsonify({"jobs": [dict(r) for r in rows], "count": len(rows)})


@app.get("/jobs/<int:job_id>/markdown")
def job_markdown(job_id):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return jsonify({"error": "not found"}), 404

    r = dict(row)
    lines = [
        f"# {r['title'] or 'Untitled'}",
        f"**Company:** {r['company'] or '—'}",
        f"**Location:** {r['location'] or '—'}",
        f"**Workplace:** {r['workplace'] or '—'}",
        f"**Employment type:** {r['employment_type'] or '—'}",
        f"**Salary:** {r['salary'] or '—'}",
        f"**LinkedIn URL:** {r['linkedin_url'] or '—'}",
        "",
        "## About the job",
        "",
        r['about_job'] or '—',
    ]

    return Response(
        "\n".join(lines),
        mimetype="text/markdown",
        headers={"Content-Disposition": f"inline; filename=job_{job_id}.md"},
    )


@app.get("/jobs/export/json")
def export_json():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    return Response(
        json.dumps([dict(r) for r in rows], indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=linkedin_jobs.json"},
    )


@app.get("/jobs/export/csv")
def export_csv():
    cols = [
        "id", "linkedin_job_id", "linkedin_url", "title", "company",
        "location", "workplace", "employment_type", "salary",
        "about_job", "created_at", "updated_at",
    ]
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(cols)} FROM jobs ORDER BY created_at DESC"
        ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(cols)
    writer.writerows(rows)
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=linkedin_jobs.csv"},
    )


VALID_STATUSES = {"saved", "interested", "applied", "skipped", "recruiter", "follow-up"}


@app.patch("/jobs/<int:job_id>/status")
def update_status(job_id):
    data = request.get_json(force=True)
    status = data.get("status", "").strip()
    if status not in VALID_STATUSES:
        return jsonify({"error": f"invalid status; must be one of {sorted(VALID_STATUSES)}"}), 400
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
            (status, datetime.now().isoformat(), job_id),
        )
    if result.rowcount == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True, "status": status})


@app.post("/jobs/<int:job_id>/interactions")
def add_interaction(job_id):
    data = request.get_json(force=True)
    interaction_type = data.get("type", "").strip()
    if not interaction_type:
        return jsonify({"error": "type is required"}), 400
    now = datetime.now().isoformat()
    occurred_at = data.get("occurred_at") or now

    with get_conn() as conn:
        job = conn.execute(
            "SELECT linkedin_job_id, company FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if job is None:
            return jsonify({"error": "job not found"}), 404
        cursor = conn.execute(
            """INSERT INTO interactions
               (job_id, linkedin_job_id, company, type, note, occurred_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (job_id, job["linkedin_job_id"], job["company"],
             interaction_type, data.get("note"), occurred_at, now),
        )
    return jsonify({"ok": True, "id": cursor.lastrowid}), 201


@app.get("/jobs/<int:job_id>/interactions")
def list_interactions(job_id):
    with get_conn() as conn:
        job = conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job is None:
            return jsonify({"error": "not found"}), 404
        rows = conn.execute(
            "SELECT * FROM interactions WHERE job_id = ? ORDER BY occurred_at DESC",
            (job_id,),
        ).fetchall()
    return jsonify({"interactions": [dict(r) for r in rows], "count": len(rows)})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5055)
