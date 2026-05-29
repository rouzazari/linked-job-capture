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

  function copyJob() {
    const data = getJobData();
    const output = JSON.stringify(data, null, 2);

    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(output);
    } else {
      navigator.clipboard.writeText(output);
    }
  }

  function saveJob() {
    const data = getJobData();

    GM_xmlhttpRequest({
      method: "POST",
      url: "http://127.0.0.1:5055/jobs",
      headers: {
        "Content-Type": "application/json"
      },
      data: JSON.stringify(data),
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          alert("LinkedIn job saved");
        } else {
          alert("Save failed: " + response.status);
        }
      },
      onerror: function () {
        alert("Save failed. Is the local server running?");
      }
    });
  }

  function addButton() {
    const copyButtonExists = document.getElementById("copy-linkedin-job-json");
    const saveButtonExists = document.getElementById("save-linkedin-job-json");

    const cssText = `
      position: fixed;
      z-index: 999999;
      padding: 10px 14px;
      background: #0a66c2;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    `;

    if (!copyButtonExists) {
      const copyButton = document.createElement("button");
      copyButton.id = "copy-linkedin-job-json";
      copyButton.textContent = "Copy Job JSON";
      copyButton.style.cssText = cssText + `
        top: 80px;
        right: 20px;
      `;
      copyButton.onclick = copyJob;
      document.body.appendChild(copyButton);
    }

    if (!saveButtonExists) {
      const saveButton = document.createElement("button");
      saveButton.id = "save-linkedin-job-json";
      saveButton.textContent = "Save Job";
      saveButton.style.cssText = cssText + `
        top: 80px;
        right: 150px;
      `;
      saveButton.onclick = saveJob;
      document.body.appendChild(saveButton);
    }
  }

  addButton();
})();
