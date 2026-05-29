# LinkedIn Job Capture

A personal productivity tool for saving LinkedIn job postings to a local SQLite database with one click.

## How It Works

1. A TamperMonkey userscript runs on LinkedIn job pages and injects two buttons into the page.
2. Clicking **Save Job** sends the parsed job data as JSON to a local Flask server.
3. The server stores the data in a local SQLite database, deduplicating by LinkedIn job ID.

All data stays on your machine — nothing is sent to any third-party service.

## Requirements

- Python 3.x
- Flask (`pip install flask`)
- [TamperMonkey](https://www.tampermonkey.net/) browser extension

## Setup

### 1. Start the local server

```bash
python linkedin_job_server.py
```

The server runs at `http://127.0.0.1:5055`. The SQLite database (`linkedin_jobs.sqlite`) is created automatically on first run.

### 2. Install the userscript

1. Open TamperMonkey in your browser and create a new script.
2. Paste the contents of `tamper-monkey-script.js` and save.

### 3. Use it

Navigate to any LinkedIn job page (`linkedin.com/jobs/view/*`). Two buttons appear in the top-right corner:

- **Save Job** — sends the job to the local server and saves it to the database
- **Copy Job JSON** — copies the extracted JSON to clipboard (useful as a fallback or for pasting into ChatGPT/Claude)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs` | Save or update a job |
| `GET` | `/jobs` | List all saved jobs |
| `GET` | `/jobs/recent?n=10` | List the N most recently saved jobs |
| `GET` | `/jobs/search?q=<term>` | Search by title, company, location, or description |
| `GET` | `/jobs/<id>/markdown` | Export a single job as Markdown |
| `GET` | `/jobs/export/json` | Download all jobs as JSON |
| `GET` | `/jobs/export/csv` | Download all jobs as CSV |

## Database Schema

```sql
CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_job_id TEXT UNIQUE,
    linkedin_url    TEXT UNIQUE,
    title           TEXT,
    company         TEXT,
    location        TEXT,
    workplace       TEXT,   -- Remote | Hybrid | On-site
    employment_type TEXT,   -- Full-time | Part-time | Contract | etc.
    salary          TEXT,
    about_job       TEXT,
    json            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
```

## Parsed Fields

The userscript extracts the following from the rendered page:

- LinkedIn job ID (from the URL)
- LinkedIn URL
- Title and company (from `document.title`)
- Location, posting date, applicant count (from the header line)
- Workplace type and employment type (text scan)
- Salary range (regex patterns for common formats)
- Full "About the job" section (text between the section header and the next stop marker)
- Capture timestamp
