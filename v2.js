(async function runBpsDualAutomation() {
  // ==========================================
  // 1. CONFIGURATION
  // ==========================================
  const CONFIG = {
    MODES: ["EXPORT", "IMPORT"], // Process both modes sequentially
    YEARS: ["2026", "2025", "2024", "2023", "2022"],
    BATCH_SIZE: 5,
    DELAY_MS: 2000,
    MAX_RETRIES: 2,
    RETRY_DELAY_MS: 3000,
    ENDPOINT_URL: "https://www.bps.go.id/en/exim",
    NEXT_ACTION_ID: "7fd94b4fd486e628393d87e2227fb54cffd6c6c4c1",
    SAVE_COMBINED_FILE: true,   // Generates a unified 'bps-combined-import-export-results.csv'
    SAVE_INDIVIDUAL_FILES: true, // Generates 'bps-export-results.csv' and 'bps-import-results.csv'
    MAX_ROWS_PER_FILE: 900000   // 9 lakh rows per CSV file
  };

  // ==========================================
  // 2. UI PROGRESS OVERLAY (Visual Feedback)
  // ==========================================
  const createProgressUI = () => {
    const existing = document.getElementById("bps-automation-overlay");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "bps-automation-overlay";
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 360px;
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      z-index: 999999;
      overflow: hidden;
      transition: all 0.3s ease;
    `;

    container.innerHTML = `
      <div style="background: #0f172a; padding: 12px 16px; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #10b981;" id="bps-status-dot"></span>
          <strong style="font-size: 14px; font-weight: 600;">BPS Import/Export Automation</strong>
        </div>
        <button id="bps-close-ui" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
      </div>
      <div style="padding: 16px;">
        <div id="bps-status-text" style="font-weight: 500; margin-bottom: 8px; color: #e2e8f0;">Waiting for CSV file...</div>
        <div style="background: #334155; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 12px;">
          <div id="bps-progress-bar" style="background: linear-gradient(90deg, #3b82f6, #10b981); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; color: #94a3b8; font-size: 11px;">
          <span id="bps-mode-badge">Mode: Idle</span>
          <span id="bps-stats-badge">0 / 0 batches (0 records)</span>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    container.querySelector("#bps-close-ui").addEventListener("click", () => container.remove());

    return {
      update: (text, percent, modeText, statsText, dotColor = "#3b82f6") => {
        const statusText = document.getElementById("bps-status-text");
        const progressBar = document.getElementById("bps-progress-bar");
        const modeBadge = document.getElementById("bps-mode-badge");
        const statsBadge = document.getElementById("bps-stats-badge");
        const dot = document.getElementById("bps-status-dot");

        if (statusText) statusText.innerText = text;
        if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        if (modeBadge && modeText) modeBadge.innerText = modeText;
        if (statsBadge && statsText) statsBadge.innerText = statsText;
        if (dot && dotColor) dot.style.background = dotColor;
      },
      close: () => {
        setTimeout(() => {
          const el = document.getElementById("bps-automation-overlay");
          if (el) el.remove();
        }, 5000);
      }
    };
  };

  // ==========================================
  // 3. PAYLOAD BUILDER & HELPERS
  // ==========================================
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const buildPayload = (codesString, yearsString, tradeMode) => {
    // "1" = EXPORT, "2" = IMPORT
    const tradeCode = tradeMode.toUpperCase() === "EXPORT" || tradeMode === "1" ? "1" : "2";
    return [
      "en",
      "www.bps.go.id",
      tradeCode,
      codesString,
      "",
      "",
      "2",
      yearsString,
      "",
    ];
  };

  const extractHsCode = (value) => {
    if (Array.isArray(value) && value.length > 0) value = value[0];
    const match = String(value || "").match(/\[?(\d{8})\]?/);
    return match ? match[1] : "";
  };

  const extractMonth = (value) => {
    const match = String(value || "").match(/\[(\d{2})\]/);
    return match ? match[1] : String(value || "").trim();
  };

  const parseCSV = (csvText) => {
    const lines = csvText.trim().split(/\r?\n/);
    const data = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");
      for (const col of cols) {
        let raw = col.trim().replace(/^["']|["']$/g, "");
        let fixed = raw.padStart(8, "0");

        if (/^\d{8}$/.test(fixed) && !seen.has(fixed)) {
          seen.add(fixed);
          data.push({ hsCode: fixed });
        }
      }
    }
    return data;
  };

  const csvEscape = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (
      str.includes(",") ||
      str.includes('"') ||
      str.includes("\n") ||
      str.includes("\r")
    ) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const downloadCSV = (rows, filename, maxRows = CONFIG.MAX_ROWS_PER_FILE || 900000) => {
    if (!rows || rows.length === 0) {
      console.warn(`[Download] No data rows to save for ${filename}`);
      return;
    }

    const headers = [
      "Trade Type",
      "HS Code",
      "Month",
      "Year",
      "Origin Country",
      "Destination Country",
      "Port",
      "Net Weight (kg)",
      "Value (USD)"
    ];

    const totalChunks = Math.ceil(rows.length / maxRows);
    const dotIndex = filename.lastIndexOf(".");
    const base = dotIndex !== -1 ? filename.slice(0, dotIndex) : filename;
    const ext = dotIndex !== -1 ? filename.slice(dotIndex) : ".csv";

    for (let part = 0; part < totalChunks; part++) {
      const chunkRows = rows.slice(part * maxRows, (part + 1) * maxRows);
      const chunkFilename = totalChunks === 1 ? filename : `${base}_part${part + 1}${ext}`;

      const csvLines = [headers.join(",")];
      for (const row of chunkRows) {
        csvLines.push(
          [
            row.tradeType,
            row.hsCode,
            row.month,
            row.year,
            row.originCountry,
            row.destinationCountry,
            row.port,
            row.netWeight,
            row.value,
          ]
            .map(csvEscape)
            .join(",")
        );
      }

      const csvContent = csvLines.join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = chunkFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // ==========================================
  // 4. FETCH BATCH LOGIC WITH RETRIES
  // ==========================================
  const fetchBatch = async (batchItems, tradeMode, retryCount = 0) => {
    const yearsString = CONFIG.YEARS.join(",");
    const batchCodes = batchItems.map((item) => item.hsCode).join(",");
    const payload = buildPayload(batchCodes, yearsString, tradeMode);
    const isExport = tradeMode.toUpperCase() === "EXPORT";

    try {
      const response = await fetch(CONFIG.ENDPOINT_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "text/x-component",
          "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": CONFIG.NEXT_ACTION_ID,
          "next-router-state-tree":
            "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22lang%22%2C%22en%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22exim%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2C%22%2Fen%2Fexim%22%2C%22refresh%22%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
          priority: "u=1, i",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const textResponse = await response.text();

      let parsedData = null;
      let isAvailable =
        !textResponse.includes("not-available") &&
        !textResponse.includes("Data tidak tersedia");

      const lines = textResponse.split("\n");
      const dataLine = lines.find((line) => line.includes('"response":'));
      if (dataLine) {
        const jsonStr = dataLine.substring(dataLine.indexOf("{"));
        try {
          parsedData = JSON.parse(jsonStr);
        } catch (jsonErr) {
          // If trailing next.js stream tokens exist, try extracting balanced object
          const endIdx = jsonStr.lastIndexOf("}");
          if (endIdx > 0) {
            parsedData = JSON.parse(jsonStr.substring(0, endIdx + 1));
          }
        }
      }

      let dataRecords = parsedData?.response?.data;

      if (isAvailable && Array.isArray(dataRecords) && dataRecords.length > 0) {
        const rows = [];

        for (const record of dataRecords) {
          const code =
            extractHsCode(record.kodehs) ||
            (batchItems.length === 1 ? batchItems[0].hsCode : "");
          const month = extractMonth(record.bulan);

          rows.push({
            tradeType: isExport ? "Export" : "Import",
            hsCode: code || batchItems[0].hsCode,
            month: month,
            year: record.tahun || "",
            originCountry: isExport ? "Indonesia" : (record.ctr || ""),
            destinationCountry: isExport ? (record.ctr || "") : "Indonesia",
            port: record.pod || "",
            netWeight: record.netweight ?? "",
            value: record.value ?? "",
          });
        }

        return rows;
      } else if (
        isAvailable &&
        typeof dataRecords === "object" &&
        dataRecords !== null
      ) {
        const code = extractHsCode(dataRecords.kodehs) || batchItems[0].hsCode;
        const month = extractMonth(dataRecords.bulan);

        return [
          {
            tradeType: isExport ? "Export" : "Import",
            hsCode: code,
            month: month,
            year: dataRecords.tahun || "",
            originCountry: isExport ? "Indonesia" : (dataRecords.ctr || ""),
            destinationCountry: isExport ? (dataRecords.ctr || "") : "Indonesia",
            port: dataRecords.pod || "",
            netWeight: dataRecords.netweight ?? "",
            value: dataRecords.value ?? "",
          },
        ];
      } else {
        return [];
      }
    } catch (error) {
      if (retryCount < CONFIG.MAX_RETRIES) {
        console.warn(`[${tradeMode}] Batch [${batchCodes}] failed (${error.message}). Retrying in ${CONFIG.RETRY_DELAY_MS}ms... (Attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
        await sleep(CONFIG.RETRY_DELAY_MS);
        return fetchBatch(batchItems, tradeMode, retryCount + 1);
      } else {
        console.error(`[${tradeMode}] Error fetching batch [${batchCodes}] after ${CONFIG.MAX_RETRIES} retries:`, error.message);
        return [];
      }
    }
  };

  // ==========================================
  // 5. EXECUTION CONTROLLER
  // ==========================================
  const ui = createProgressUI();

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.txt";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  console.log("📂 [BPS Automation] Please select your input CSV/TXT file with HS codes...");
  ui.update("Please select your HS code CSV file...", 0, "Idle", "Waiting for input...", "#eab308");

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      ui.update("No file chosen.", 0, "Cancelled", "0 records", "#ef4444");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const csvText = e.target.result;
      const items = parseCSV(csvText);

      if (items.length === 0) {
        console.error("❌ No valid 8-digit HS codes found in CSV.");
        ui.update("Error: No 8-digit HS codes found!", 0, "Error", "0 HS Codes", "#ef4444");
        return;
      }

      // Create batches of size BATCH_SIZE
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        batches.push(items.slice(i, i + BATCH_SIZE));
      }

      const totalBatchesAllModes = batches.length * CONFIG.MODES.length;
      let completedBatchesGlobal = 0;

      const exportResults = [];
      const importResults = [];
      const combinedResults = [];

      console.log(`🚀 Starting extraction: ${items.length} HS codes across ${batches.length} batches per mode. Modes: [${CONFIG.MODES.join(", ")}]`);

      for (const mode of CONFIG.MODES) {
        const isExport = mode.toUpperCase() === "EXPORT";
        const currentModeResults = isExport ? exportResults : importResults;

        console.log(`\n========================================\n▶ Starting Mode: ${mode}\n========================================`);

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const codesList = batch.map((item) => item.hsCode).join(", ");
          
          completedBatchesGlobal++;
          const progressPercent = Math.round((completedBatchesGlobal / totalBatchesAllModes) * 100);

          ui.update(
            `Fetching ${mode} batch ${i + 1}/${batches.length}...`,
            progressPercent,
            `Mode: ${mode}`,
            `Global: ${completedBatchesGlobal}/${totalBatchesAllModes} batches | ${combinedResults.length} total rows`,
            "#3b82f6"
          );

          console.log(`⏳ [${mode}] Batch ${i + 1}/${batches.length}: [${codesList}]...`);

          const resultRows = await fetchBatch(batch, mode);
          currentModeResults.push(...resultRows);
          combinedResults.push(...resultRows);

          console.log(`   + [${mode}] Added ${resultRows.length} rows (Mode Total: ${currentModeResults.length} | Grand Total: ${combinedResults.length})`);

          // Delay between requests
          if (i < batches.length - 1 || mode !== CONFIG.MODES[CONFIG.MODES.length - 1]) {
            await sleep(CONFIG.DELAY_MS);
          }
        }

        // Save individual mode file if enabled
        if (CONFIG.SAVE_INDIVIDUAL_FILES && currentModeResults.length > 0) {
          const filename = `bps-${mode.toLowerCase()}-results.csv`;
          console.log(`💾 Saving individual mode data to ${filename} (${currentModeResults.length} records)...`);
          downloadCSV(currentModeResults, filename);
          await sleep(1000); // Small pause between triggers
        }
      }

      // Save unified combined file if enabled
      if (CONFIG.SAVE_COMBINED_FILE && combinedResults.length > 0) {
        const combinedFilename = `bps-combined-import-export-results.csv`;
        console.log(`💾 Saving unified combined data to ${combinedFilename} (${combinedResults.length} records)...`);
        downloadCSV(combinedResults, combinedFilename);
      }

      console.log(`\n🎉 COMPLETED ALL MODES! Total rows extracted: ${combinedResults.length} (Export: ${exportResults.length}, Import: ${importResults.length})`);
      ui.update(
        `Completed! Total ${combinedResults.length} rows extracted.`,
        100,
        "Finished",
        `Export: ${exportResults.length} | Import: ${importResults.length}`,
        "#10b981"
      );

      ui.close();
      document.body.removeChild(fileInput);
    };

    reader.readAsText(file);
  });

  fileInput.click();
})();
