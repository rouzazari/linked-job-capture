// ==UserScript==
// @name         LinkedIn Job Parser
// @match        https://www.linkedin.com/jobs/view/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const stopMarkers = [
    "Benefits found in job post",
    "Similar jobs",
    "People also viewed",
    "Set alert for similar jobs",
    "Explore more jobs",
    "LinkedIn Corporation ©"
  ];

  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function getLinkedInJobId() {
    const match = location.href.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }

  function getTitleAndCompany() {
    const parts = document.title.split("|").map(x => x.trim());
    return {
      title: parts[0] || null,
      company: parts[1] || null
    };
  }

  function getTopMetaLines() {
    const text = document.body.innerText;
    const lines = text
      .split("\n")
      .map(clean)
      .filter(Boolean);

    const { title } = getTitleAndCompany();
    const titleIndex = lines.findIndex(line => line === title);
    if (titleIndex === -1) return [];

    return lines.slice(titleIndex, titleIndex + 10);
  }

  function parseLocationAndPostingInfo() {
    const lines = getTopMetaLines();

    const locationLine = lines.find(line =>
      line.includes("·") &&
      !line.includes("Promoted by") &&
      !line.includes("Responses managed")
    );

    const pieces = locationLine
      ? locationLine.split("·").map(clean)
      : [];

    return {
      location: pieces[0] || null,
      posted_info: pieces[1] || null,
      applicant_info: pieces.slice(2).join(" · ") || null
    };
  }

  function parseWorkplaceAndEmploymentType() {
    const text = document.body.innerText;

    const workplaceTypes = ["Remote", "Hybrid", "On-site"];
    const employmentTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Internship"];

    return {
      workplace: workplaceTypes.find(type => text.includes(type)) || null,
      employment_type: employmentTypes.find(type => text.includes(type)) || null
    };
  }

  function parseSalary() {
    const text = document.body.innerText;

    const salaryPatterns = [
      /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[—-]\s*\$\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:USD|per Year|\/year|a year)?/i,
      /between\s+\$\d{1,3}(?:,\d{3})*(?:\.\d+)?\s+and\s+\$\d{1,3}(?:,\d{3})*(?:\.\d+)?\s+per\s+Year/i,
      /salary range\s*\n?\s*\$\d{1,3}(?:,\d{3})*(?:\.\d+)?[—-]\$\d{1,3}(?:,\d{3})*(?:\.\d+)?/i
    ];

    for (const pattern of salaryPatterns) {
      const match = text.match(pattern);
      if (match) return clean(match[0]);
    }

    return null;
  }

  function extractSection(text, startMarker, stopMarkers) {
    const startIndex = text.indexOf(startMarker);
    if (startIndex === -1) return "";

    const sectionStart = startIndex + startMarker.length;
    const afterStart = text.slice(sectionStart);

    const stopIndexes = stopMarkers
      .map(marker => afterStart.indexOf(marker))
      .filter(index => index !== -1);

    const sectionEnd =
      stopIndexes.length > 0
        ? Math.min(...stopIndexes)
        : afterStart.length;

    return afterStart.slice(0, sectionEnd).trim();
  }

  function getJobData() {
    const text = document.body.innerText;
    const { title, company } = getTitleAndCompany();
    const posting = parseLocationAndPostingInfo();
    const work = parseWorkplaceAndEmploymentType();
    const aboutJob = extractSection(text, "About the job", stopMarkers);

    return {
      linkedin_job_id: getLinkedInJobId(),
      linkedin_url: location.href,
      title,
      company,
      location: posting.location,
      posted_info: posting.posted_info,
      applicant_info: posting.applicant_info,
      workplace: work.workplace,
      employment_type: work.employment_type,
      salary: parseSalary(),
      about_job: aboutJob,
      captured_at: new Date().toISOString()
    };
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  const STATUS_COLORS = {
    saved:        "#4a8fa8",
    interested:   "#8b6cc4",
    applied:      "#5aab72",
    skipped:      "#888888",
    recruiter:    "#c8a84b",
    "follow-up":  "#c26b4a",
  };

  let currentStatus = { html: "● checking…", color: "#555" };

  function setStatus(html, color) {
    currentStatus = { html, color };
    const el = document.getElementById("lj-status");
    if (el) { el.innerHTML = html; el.style.color = color; }
  }

  function flashStatus(html, color, ms = 2000) {
    const el = document.getElementById("lj-status");
    if (!el) return;
    el.innerHTML = html;
    el.style.color = color;
    setTimeout(() => {
      el.innerHTML = currentStatus.html;
      el.style.color = currentStatus.color;
    }, ms);
  }

  function checkStatus() {
    const jobId = getLinkedInJobId();
    if (!jobId) { setStatus("● no job id", "#555"); return; }
    setStatus("● checking…", "#555");

    GM_xmlhttpRequest({
      method: "GET",
      url: "http://127.0.0.1:5055/jobs/lookup?linkedin_job_id=" + jobId,
      onload: function (response) {
        if (response.status === 200) {
          const job = JSON.parse(response.responseText);
          const color = STATUS_COLORS[job.status] || "#888";
          setStatus("● " + job.status, color);
        } else if (response.status === 404) {
          setStatus("● not saved", "#444");
        } else {
          setStatus("● server error", "#c26b4a");
        }
      },
      onerror: function () {
        setStatus("● server offline", "#444");
      }
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function copyJob() {
    const data = getJobData();
    const output = JSON.stringify(data, null, 2);
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(output);
    } else {
      navigator.clipboard.writeText(output);
    }
    flashStatus("● copied to clipboard", "#5aab72");
  }

  function saveJob() {
    const data = getJobData();
    const saveBtn = document.getElementById("lj-save-btn");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    setStatus("● saving…", "#888");

    GM_xmlhttpRequest({
      method: "POST",
      url: "http://127.0.0.1:5055/jobs",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(data),
      onload: function (response) {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Job"; }
        if (response.status >= 200 && response.status < 300) {
          checkStatus();
        } else {
          setStatus("● save failed (" + response.status + ")", "#c26b4a");
        }
      },
      onerror: function () {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Job"; }
        setStatus("● server offline", "#444");
      }
    });
  }

  // ── Panel ────────────────────────────────────────────────────────────────────

  function createPanel() {
    if (document.getElementById("lj-panel")) return;

    const panel = document.createElement("div");
    panel.id = "lj-panel";
    panel.style.cssText = [
      "position:fixed", "top:80px", "right:20px", "z-index:999999",
      "background:#131312", "border:1px solid #3a3a37", "border-radius:6px",
      "padding:12px", "box-shadow:0 4px 24px rgba(0,0,0,0.5)",
      "font-family:'JetBrains Mono',Consolas,monospace", "min-width:218px",
    ].join(";");

    const btnBase = [
      "flex:1", "padding:7px 8px", "background:#1a1a18", "color:#ddd8c4",
      "border:1px solid #3a3a37", "border-radius:3px", "cursor:pointer",
      "font-family:'JetBrains Mono',Consolas,monospace",
      "font-size:11px", "font-weight:500", "letter-spacing:0.03em",
    ].join(";");

    function makeBtn(id, label, handler) {
      const btn = document.createElement("button");
      btn.id = id;
      btn.textContent = label;
      btn.style.cssText = btnBase;
      btn.onmouseenter = () => { btn.style.background = "#222220"; };
      btn.onmouseleave = () => { btn.style.background = "#1a1a18"; };
      btn.onclick = handler;
      return btn;
    }

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;margin-bottom:10px";
    btnRow.appendChild(makeBtn("lj-save-btn",              "Save Job",  saveJob));
    btnRow.appendChild(makeBtn("copy-linkedin-job-json",   "Copy JSON", copyJob));

    const divider = document.createElement("div");
    divider.style.cssText = "height:1px;background:#262622;margin-bottom:8px";

    const statusEl = document.createElement("div");
    statusEl.id = "lj-status";
    statusEl.style.cssText = "font-size:11px;letter-spacing:0.05em;color:#555;padding:1px 0";
    statusEl.textContent = "● checking…";

    panel.appendChild(btnRow);
    panel.appendChild(divider);
    panel.appendChild(statusEl);
    document.body.appendChild(panel);

    checkStatus();
  }

  // ── SPA navigation watcher ───────────────────────────────────────────────────

  let lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      const saveBtn = document.getElementById("lj-save-btn");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Job"; }
      checkStatus();
    }
  }, 1500);

  createPanel();
})();
