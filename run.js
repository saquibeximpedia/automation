const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const CONFIG = {
  MODES: ["EXPORT", "IMPORT"], // Extracts both Export and Import sequentially
  YEARS: ["2026", "2025", "2024", "2023", "2022"],
  BATCH_SIZE: 5,
  DELAY_MS: 1500, // Delay between batch requests in ms
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 3000,
  CHROME_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  USER_DATA_DIR: path.join(__dirname, '.chrome-session'),
  NEXT_ACTION_ID: "7fd94b4fd486e628393d87e2227fb54cffd6c6c4c1",
  INPUT_FILE: path.join(__dirname, 'input_hs_codes.csv'),
  EXPORT_OUTPUT_FILE: path.join(__dirname, 'bps-export-results.csv'),
  IMPORT_OUTPUT_FILE: path.join(__dirname, 'bps-import-results.csv'),
  COMBINED_OUTPUT_FILE: path.join(__dirname, 'bps-combined-results.csv'),
};

// ==========================================
// 2. PARSERS & HELPERS
// ==========================================
const parseHsCodes = (csvContent) => {
  const lines = csvContent.split(/\r?\n/);
  const seen = new Set();
  const codes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by comma, semicolon, tab, or whitespace
    const cols = line.split(/[,;\t]/);
    for (const col of cols) {
      let raw = col.trim().replace(/^["']|["']$/g, '');
      // Only treat as HS code if it contains digits
      if (/^\d{1,8}$/.test(raw)) {
        let fixed = raw.padStart(8, '0');
        if (/^\d{8}$/.test(fixed) && !seen.has(fixed)) {
          seen.add(fixed);
          codes.push(fixed);
        }
      }
    }
  }
  return codes;
};

const csvEscape = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const saveCsv = (rows, filepath) => {
  if (!rows || rows.length === 0) {
    console.log(`⚠️  No records to write for: ${path.basename(filepath)}`);
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

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.tradeType,
      row.hsCode,
      row.month,
      row.year,
      row.originCountry,
      row.destinationCountry,
      row.port,
      row.netWeight,
      row.value
    ].map(csvEscape).join(','));
  }

  fs.writeFileSync(filepath, lines.join('\r\n'), 'utf8');
  console.log(`💾 Saved: ${path.basename(filepath)} (${rows.length.toLocaleString()} rows)`);
};

// ==========================================
// 3. MAIN AUTOMATION RUNNER
// ==========================================
(async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       BPS Indonesia Trade Data 1-Click Automation            ║');
  console.log('║               (Import & Export Extractor)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Check Input File
  let inputPath = CONFIG.INPUT_FILE;
  if (!fs.existsSync(inputPath)) {
    const fallbackPath = path.join(__dirname, 'sample_hs_codes.csv');
    if (fs.existsSync(fallbackPath)) {
      inputPath = fallbackPath;
    } else {
      console.error(`❌ Input file not found: ${inputPath}`);
      console.error(`   Please place your HS codes CSV file as 'input_hs_codes.csv'.`);
      process.exit(1);
    }
  }

  console.log(`📖 Reading input CSV from: ${path.basename(inputPath)}...`);
  const rawCsv = fs.readFileSync(inputPath, 'utf8');
  const hsCodes = parseHsCodes(rawCsv);

  if (hsCodes.length === 0) {
    console.error(`❌ No valid 8-digit HS codes found in ${path.basename(inputPath)}.`);
    process.exit(1);
  }

  console.log(`✅ Loaded ${hsCodes.length} unique HS codes to query.`);
  console.log(`   Sample codes: [${hsCodes.slice(0, 5).join(', ')}${hsCodes.length > 5 ? '...' : ''}]`);

  // 2. Launch Chrome
  console.log(`\n🚀 Launching Chrome browser session...`);
  if (!fs.existsSync(CONFIG.CHROME_PATH)) {
    console.error(`❌ Chrome not found at: ${CONFIG.CHROME_PATH}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROME_PATH,
    headless: false,
    userDataDir: CONFIG.USER_DATA_DIR,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run'
    ]
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log(`🌐 Navigating to BPS portal (https://www.bps.go.id/en/exim)...`);
  await page.goto('https://www.bps.go.id/en/exim', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log(`⏳ Initializing secure session (3s)...`);
  await new Promise(r => setTimeout(r, 3000));

  // 3. Run Batches
  console.log(`\n⚡ Starting automated extraction across modes: [${CONFIG.MODES.join(', ')}]...`);

  const results = await page.evaluate(async (codesList, cfg) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    const buildPayload = (codesString, yearsString, tradeMode) => {
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

    const fetchBatch = async (batchCodesList, tradeMode, retryCount = 0) => {
      const yearsString = cfg.YEARS.join(",");
      const batchCodes = batchCodesList.join(",");
      const payload = buildPayload(batchCodes, yearsString, tradeMode);
      const isExport = tradeMode.toUpperCase() === "EXPORT";

      try {
        const response = await fetch("https://www.bps.go.id/en/exim", {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "text/x-component",
            "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
            "content-type": "text/plain;charset=UTF-8",
            "next-action": cfg.NEXT_ACTION_ID,
            "next-router-state-tree":
              "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22lang%22%2C%22en%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22exim%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2C%22%2Fen%2Fexim%22%2C%22refresh%22%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
            priority: "u=1, i",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const textResponse = await response.text();
        const isAvailable = !textResponse.includes("not-available") && !textResponse.includes("Data tidak tersedia");

        let parsedData = null;
        const lines = textResponse.split("\n");
        const dataLine = lines.find((line) => line.includes('"response":'));
        if (dataLine) {
          const jsonStr = dataLine.substring(dataLine.indexOf("{"));
          try {
            parsedData = JSON.parse(jsonStr);
          } catch (e) {
            const endIdx = jsonStr.lastIndexOf("}");
            if (endIdx > 0) parsedData = JSON.parse(jsonStr.substring(0, endIdx + 1));
          }
        }

        const dataRecords = parsedData?.response?.data;
        if (isAvailable && Array.isArray(dataRecords) && dataRecords.length > 0) {
          return dataRecords.map((record) => ({
            tradeType: isExport ? "Export" : "Import",
            hsCode: extractHsCode(record.kodehs) || batchCodesList[0],
            month: extractMonth(record.bulan),
            year: record.tahun || "",
            originCountry: isExport ? "Indonesia" : (record.ctr || ""),
            destinationCountry: isExport ? (record.ctr || "") : "Indonesia",
            port: record.pod || "",
            netWeight: record.netweight ?? "",
            value: record.value ?? "",
          }));
        } else if (isAvailable && typeof dataRecords === "object" && dataRecords !== null) {
          return [{
            tradeType: isExport ? "Export" : "Import",
            hsCode: extractHsCode(dataRecords.kodehs) || batchCodesList[0],
            month: extractMonth(dataRecords.bulan),
            year: dataRecords.tahun || "",
            originCountry: isExport ? "Indonesia" : (dataRecords.ctr || ""),
            destinationCountry: isExport ? (dataRecords.ctr || "") : "Indonesia",
            port: dataRecords.pod || "",
            netWeight: dataRecords.netweight ?? "",
            value: dataRecords.value ?? "",
          }];
        }
        return [];
      } catch (err) {
        if (retryCount < cfg.MAX_RETRIES) {
          await sleep(cfg.RETRY_DELAY_MS);
          return fetchBatch(batchCodesList, tradeMode, retryCount + 1);
        }
        return [];
      }
    };

    // Partition into batches
    const batches = [];
    for (let i = 0; i < codesList.length; i += cfg.BATCH_SIZE) {
      batches.push(codesList.slice(i, i + cfg.BATCH_SIZE));
    }

    const exportRows = [];
    const importRows = [];

    for (const mode of cfg.MODES) {
      const isExport = mode.toUpperCase() === "EXPORT";
      const targetArr = isExport ? exportRows : importRows;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const rows = await fetchBatch(batch, mode);
        targetArr.push(...rows);

        if (i < batches.length - 1 || mode !== cfg.MODES[cfg.MODES.length - 1]) {
          await sleep(cfg.DELAY_MS);
        }
      }
    }

    return { exportRows, importRows };
  }, hsCodes, CONFIG);

  console.log(`🔒 Closing browser session...`);
  await browser.close();

  const combinedRows = [...results.exportRows, ...results.importRows];

  // 4. Save Output CSVs
  console.log(`\n==============================================================`);
  console.log(`                  EXTRACTION SUMMARY                          `);
  console.log(`==============================================================`);
  console.log(`  Export Records Extracted : ${results.exportRows.length.toLocaleString()}`);
  console.log(`  Import Records Extracted : ${results.importRows.length.toLocaleString()}`);
  console.log(`  Total Combined Records   : ${combinedRows.length.toLocaleString()}`);
  console.log(`==============================================================\n`);

  saveCsv(results.exportRows, CONFIG.EXPORT_OUTPUT_FILE);
  saveCsv(results.importRows, CONFIG.IMPORT_OUTPUT_FILE);
  saveCsv(combinedRows, CONFIG.COMBINED_OUTPUT_FILE);

  console.log(`\n✨ Done! All trade data has been extracted and saved.`);
})();
