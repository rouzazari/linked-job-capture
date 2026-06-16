// ==UserScript==
// @name         Indeed Job Parser
// @match        https://www.indeed.com/viewjob*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  function clean(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function getIndeedJobId() {
    return new URLSearchParams(location.search).get("jk") || null;
  }

  function getTitle() {
    const el =
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
      document.querySelector("h1.jobsearch-JobInfoHeader-title") ||
      document.querySelector("h1");
    return el ? clean(el.innerText) : null;
  }

  function getCompany() {
    const el =
      document.querySelector('[data-testid="inlineHeader-companyName"]') ||
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-companyName"]') ||
      document.querySelector('[data-company-name="true"]');
    return el ? clean(el.innerText) : null;
  }

  function getLocation() {
    const el =
      document.querySelector('[data-testid="job-location"]') ||
      document.querySelector('[data-testid="jobsearch-JobInfoHeader-locationText"]') ||
      document.querySelector(".jobsearch-JobInfoHeader-subtitle .icl-u-xs-mt--xs");
    return el ? clean(el.innerText) : null;
  }

  function getJobDescription() {
    const el =
      document.getElementById("jobDescriptionText") ||
      document.querySelector('[id*="jobDescriptionText"]') ||
      document.querySelector(".jobsearch-jobDescriptionText");
    return el ? clean(el.innerText) : null;
  }

  function getAttributeSnippets() {
    const snippets = document.querySelectorAll(
      '[data-testid="attribute_snippet_testid"], ' +
      '[data-testid="jobsearch-JobMetadataHeader--item"], ' +
      '.jobsearch-JobMetadataHeader-item'
    );
    return Array.from(snippets).map(el => clean(el.innerText)).filter(Boolean);
  }

  function parseWorkplaceAndType(attrs) {
    const workplaceTypes = ["Remote", "Hybrid", "On-site"];
    const employmentTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Casual"];
    const text = attrs.join(" ");
    return {
      workplace:       workplaceTypes.find(t => text.includes(t)) || null,
      employment_type: employmentTypes.find(t => text.includes(t)) || null,
    };
  }

  function parseSalary(attrs) {
    const patterns = [
      /\$[\d,]+(?:\.\d+)?\s*[–—\-]\s*\$[\d,]+(?:\.\d+)?(?:\s*(?:a year|\/year|per year|an hour|\/hour|per hour))?/i,
      /\$[\d,]+(?:\.\d+)?\s*(?:a year|\/year|per year|an hour|\/hour|per hour)/i,
    ];
    const text = attrs.join(" ");
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return clean(m[0]);
    }
    return null;
  }

  function getJobData() {
    const attrs = getAttributeSnippets();
    const { workplace, employment_type } = parseWorkplaceAndType(attrs);
    return {
      source:          "indeed",
      job_id:          getIndeedJobId(),
      job_url:         location.href,
      title:           getTitle(),
      company:         getCompany(),
      location:        getLocation(),
      workplace,
      employment_type,
      salary:          parseSalary(attrs),
      about_job:       getJobDescription(),
      captured_at:     new Date().toISOString(),
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
    "rejected":   "#a03a3a",
    "closed":     "#52504a",
  };

  let currentStatus = { html: "● checking…", color: "#555" };

  function setStatus(html, color) {
    currentStatus = { html, color };
    const el = document.getElementById("ij-status");
    if (el) { el.innerHTML = html; el.style.color = color; }
  }

  function flashStatus(html, color, ms = 2000) {
    const el = document.getElementById("ij-status");
    if (!el) return;
    el.innerHTML = html;
    el.style.color = color;
    setTimeout(() => {
      el.innerHTML = currentStatus.html;
      el.style.color = currentStatus.color;
    }, ms);
  }

  function checkStatus() {
    const jobId = getIndeedJobId();
    if (!jobId) { setStatus("● no job id", "#555"); return; }
    setStatus("● checking…", "#555");

    GM_xmlhttpRequest({
      method: "GET",
      url: "http://127.0.0.1:5055/jobs/lookup?source=indeed&job_id=" + jobId,
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
    const saveBtn = document.getElementById("ij-save-btn");
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
    if (document.getElementById("ij-panel")) return;

    const panel = document.createElement("div");
    panel.id = "ij-panel";
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
    btnRow.appendChild(makeBtn("ij-save-btn", "Save Job",  saveJob));
    btnRow.appendChild(makeBtn("ij-copy-btn", "Copy JSON", copyJob));

    const divider = document.createElement("div");
    divider.style.cssText = "height:1px;background:#262622;margin-bottom:8px";

    const statusEl = document.createElement("div");
    statusEl.id = "ij-status";
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
      const saveBtn = document.getElementById("ij-save-btn");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Job"; }
      checkStatus();
    }
  }, 1500);

  createPanel();
})();
