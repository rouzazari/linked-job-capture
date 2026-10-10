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

  // Indeed's job-view page is rendered with hashed/atomic CSS classes that
  // change on every deploy, so DOM selectors are not viable. The page does
  // reliably embed a schema.org JobPosting as JSON-LD — use that instead.

  function getJobPosting() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try { data = JSON.parse(script.textContent); } catch (e) { continue; }
      if (data && data["@type"] === "JobPosting") return data;
    }
    return null;
  }

  function htmlToText(html) {
    const el = document.createElement("div");
    el.innerHTML = html || "";
    return clean(el.innerText || el.textContent);
  }

  function formatLocation(jobLocation) {
    const address = jobLocation && jobLocation.address;
    if (!address) return null;
    const cityState = clean([address.addressLocality, address.addressRegion].filter(Boolean).join(", "));
    return cityState || address.addressCountry || null;
  }

  function formatWorkplace(posting) {
    return posting.jobLocationType === "TELECOMMUTE" ? "Remote" : null;
  }

  const EMPLOYMENT_TYPE_LABELS = {
    FULL_TIME:  "Full-time",
    PART_TIME:  "Part-time",
    CONTRACTOR: "Contract",
    TEMPORARY:  "Temporary",
    INTERN:     "Internship",
    PER_DIEM:   "Per diem",
    VOLUNTEER:  "Volunteer",
    OTHER:      "Other",
  };

  function formatEmploymentType(posting) {
    const type = posting.employmentType && posting.employmentType[0];
    return type ? (EMPLOYMENT_TYPE_LABELS[type] || type) : null;
  }

  const SALARY_UNIT_LABELS = { YEAR: "a year", HOUR: "an hour", MONTH: "a month", WEEK: "a week", DAY: "a day" };

  function formatSalary(posting) {
    const value = posting.baseSalary && posting.baseSalary.value;
    if (!value) return null;
    const currency = posting.baseSalary.currency === "USD" ? "$" : ((posting.baseSalary.currency || "") + " ");
    const unit = SALARY_UNIT_LABELS[value.unitText] || "";
    const fmt = n => Number(n).toLocaleString("en-US");
    if (value.minValue != null && value.maxValue != null && value.minValue !== value.maxValue) {
      return clean(`${currency}${fmt(value.minValue)} - ${currency}${fmt(value.maxValue)} ${unit}`);
    }
    const single = value.value != null ? value.value : (value.minValue != null ? value.minValue : value.maxValue);
    return single != null ? clean(`${currency}${fmt(single)} ${unit}`) : null;
  }

  function getJobData() {
    const posting = getJobPosting();
    return {
      source:          "indeed",
      job_id:          getIndeedJobId(),
      job_url:         location.href,
      title:           posting ? clean(posting.title) : clean(document.title.split(" - ")[0]) || null,
      company:         posting && posting.hiringOrganization ? clean(posting.hiringOrganization.name) : null,
      location:        posting ? formatLocation(posting.jobLocation) : null,
      workplace:       posting ? formatWorkplace(posting) : null,
      employment_type: posting ? formatEmploymentType(posting) : null,
      salary:          posting ? formatSalary(posting) : null,
      about_job:       posting ? htmlToText(posting.description) : null,
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
          const link = document.getElementById("ij-view-link");
          if (link) { link.href = "http://127.0.0.1:5055/jobs/" + job.id; link.style.display = "inline"; }
        } else if (response.status === 404) {
          setStatus("● not saved", "#444");
          const link = document.getElementById("ij-view-link");
          if (link) link.style.display = "none";
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

    const statusRow = document.createElement("div");
    statusRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:1px 0";

    const statusEl = document.createElement("div");
    statusEl.id = "ij-status";
    statusEl.style.cssText = "font-size:11px;letter-spacing:0.05em;color:#555";
    statusEl.textContent = "● checking…";

    const viewLink = document.createElement("a");
    viewLink.id = "ij-view-link";
    viewLink.target = "_blank";
    viewLink.rel = "noopener noreferrer";
    viewLink.textContent = "view →";
    viewLink.style.cssText = "font-size:11px;letter-spacing:0.05em;color:#c8a84b;text-decoration:none;display:none";
    viewLink.onmouseenter = () => { viewLink.style.textDecoration = "underline"; };
    viewLink.onmouseleave = () => { viewLink.style.textDecoration = "none"; };

    statusRow.appendChild(statusEl);
    statusRow.appendChild(viewLink);

    panel.appendChild(btnRow);
    panel.appendChild(divider);
    panel.appendChild(statusRow);
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
      const viewLink = document.getElementById("ij-view-link");
      if (viewLink) viewLink.style.display = "none";
      checkStatus();
    }
  }, 1500);

  createPanel();
})();
