const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const findChromePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || (process.platform === 'win32' ? candidates[0] : "/usr/bin/google-chrome-stable");
};

const isDockerOrLinux = process.platform !== 'win32' || process.env.DOCKER === 'true';
const isHeadless = process.env.HEADLESS !== undefined 
  ? process.env.HEADLESS === 'true' 
  : isDockerOrLinux;

// Resolve Input CSV File: Priority: CLI arg > input.csv > input_hs_codes.csv > sample_hs_codes.csv
const resolveInputPath = () => {
  if (process.argv[2]) {
    const custom = path.resolve(process.argv[2]);
    if (fs.existsSync(custom)) return custom;
  }
  const defaultCandidates = [
    path.join(__dirname, 'input.csv'),
    path.join(__dirname, 'input_hs_codes.csv'),
    path.join(__dirname, 'sample_hs_codes.csv')
  ];
  return defaultCandidates.find((f) => fs.existsSync(f)) || defaultCandidates[0];
};

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
  CHROME_PATH: findChromePath(),
  USER_DATA_DIR: isDockerOrLinux ? '/tmp/.chrome-session' : path.join(__dirname, '.chrome-session'),
  NEXT_ACTION_ID: "7fd94b4fd486e628393d87e2227fb54cffd6c6c4c1",
  INPUT_FILE: resolveInputPath(),
  EXPORT_OUTPUT_FILE: path.join(__dirname, 'bps-export-results.csv'),
  IMPORT_OUTPUT_FILE: path.join(__dirname, 'bps-import-results.csv'),
  COMBINED_OUTPUT_FILE: path.join(__dirname, 'bps-combined-results.csv'),
  MAX_ROWS_PER_FILE: 900000, // 9 lakh rows per CSV file
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

const saveCsv = (rows, filepath, silent = false, maxRows = CONFIG.MAX_ROWS_PER_FILE || 900000) => {
  if (!rows || rows.length === 0) {
    if (!silent) console.log(`⚠️  No records to write for: ${path.basename(filepath)}`);
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
  const ext = path.extname(filepath);
  const base = filepath.slice(0, -ext.length);

  for (let part = 0; part < totalChunks; part++) {
    const chunkRows = rows.slice(part * maxRows, (part + 1) * maxRows);
    const chunkPath = totalChunks === 1 ? filepath : `${base}_part${part + 1}${ext}`;

    const lines = [headers.join(',')];
    for (const row of chunkRows) {
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

    fs.writeFileSync(chunkPath, lines.join('\r\n'), 'utf8');
    if (!silent) {
      console.log(`💾 Saved: ${path.basename(chunkPath)} (${chunkRows.length.toLocaleString()} rows${totalChunks > 1 ? ` - Part ${part + 1} of ${totalChunks}` : ''})`);
    }
  }

  // If split into multiple parts and the legacy unparted file exists, clean it up
  if (totalChunks > 1 && fs.existsSync(filepath)) {
    try {
      fs.unlinkSync(filepath);
    } catch (e) {}
  }
};

// Helper to recover from Cloudflare / navigation reset
const recoverCloudflareSession = async (page) => {
  console.log(`\n  🛡️  [Cloudflare Auto-Recovery] Re-authenticating session...`);
  try {
    await page.goto('https://www.bps.go.id/en/exim', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    // Check if Cloudflare turnstile checkbox or challenge exists inside any iframe
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const box = await frame.$('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage');
        if (box) {
          console.log(`  🔘 Found Cloudflare Turnstile checkbox, clicking...`);
          await box.click().catch(() => {});
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {}
    }
    console.log(`  ✅ Cloudflare session re-authenticated successfully.\n`);
  } catch (e) {
    console.warn(`  ⚠️ Session recovery notice: ${e.message}`);
  }
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
  const inputPath = CONFIG.INPUT_FILE;
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error(`   Please place your HS codes CSV file as 'input.csv' or pass it as an argument: node run.js myfile.csv`);
    process.exit(1);
  }

  console.log(`📖 Reading input CSV from: ${path.basename(inputPath)}...`);
  const rawCsv = fs.readFileSync(inputPath, 'utf8');
  const hsCodes = parseHsCodes(rawCsv);

  if (hsCodes.length === 0) {
    console.error(`❌ No valid 8-digit HS codes found in ${path.basename(inputPath)}.`);
    process.exit(1);
  }

  console.log(`✅ Loaded ${hsCodes.length.toLocaleString()} unique HS codes to query.`);
  console.log(`   Sample codes: [${hsCodes.slice(0, 5).join(', ')}${hsCodes.length > 5 ? '...' : ''}]`);

  // 2. Launch Chrome
  console.log(`\n🚀 Launching Chrome browser session...`);
  if (!fs.existsSync(CONFIG.CHROME_PATH)) {
    console.error(`❌ Chrome not found at: ${CONFIG.CHROME_PATH}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROME_PATH,
    headless: isHeadless ? true : false,
    userDataDir: CONFIG.USER_DATA_DIR,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
      ...(isHeadless ? [] : ['--start-maximized'])
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

  // 3. Prepare Batches
  const batches = [];
  for (let i = 0; i < hsCodes.length; i += CONFIG.BATCH_SIZE) {
    batches.push(hsCodes.slice(i, i + CONFIG.BATCH_SIZE));
  }

  console.log(`\n⚡ Total Batches per Mode: ${batches.length.toLocaleString()} (Batch size: ${CONFIG.BATCH_SIZE})`);
  console.log(`⚡ Starting automated extraction across modes: [${CONFIG.MODES.join(', ')}]...\n`);

  const exportRows = [];
  const importRows = [];
  const MAX_CONSECUTIVE_ZEROS = 8; // If 8 batches in a row return 0 rows, trigger Cloudflare re-auth and rewind

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // Helper to fetch one batch in page context
  const executeBatch = async (batchCodes, tradeMode) => {
    return page.evaluate(async (batchCodesList, tradeMode, cfg) => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));

      const buildPayload = (codesString, yearsString, mode) => {
        const tradeCode = mode.toUpperCase() === "EXPORT" || mode === "1" ? "1" : "2";
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

      const fetchBatchWithRetry = async (retryCount = 0) => {
        const yearsString = cfg.YEARS.join(",");
        const codesStr = batchCodesList.join(",");
        const payload = buildPayload(codesStr, yearsString, tradeMode);
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

          if (response.status === 403 || response.status === 429 || response.status === 503) {
            return { status: 'CHALLENGE', records: [] };
          }

          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const textResponse = await response.text();
          if (
            textResponse.includes('cf-browser-verification') ||
            textResponse.includes('Just a moment...') ||
            textResponse.includes('challenge-platform')
          ) {
            return { status: 'CHALLENGE', records: [] };
          }

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
            return {
              status: 'OK',
              records: dataRecords.map((record) => ({
                tradeType: isExport ? "Export" : "Import",
                hsCode: extractHsCode(record.kodehs) || batchCodesList[0],
                month: extractMonth(record.bulan),
                year: record.tahun || "",
                originCountry: isExport ? "Indonesia" : (record.ctr || ""),
                destinationCountry: isExport ? (record.ctr || "") : "Indonesia",
                port: record.pod || "",
                netWeight: record.netweight ?? "",
                value: record.value ?? "",
              }))
            };
          } else if (isAvailable && typeof dataRecords === "object" && dataRecords !== null) {
            return {
              status: 'OK',
              records: [{
                tradeType: isExport ? "Export" : "Import",
                hsCode: extractHsCode(dataRecords.kodehs) || batchCodesList[0],
                month: extractMonth(dataRecords.bulan),
                year: dataRecords.tahun || "",
                originCountry: isExport ? "Indonesia" : (dataRecords.ctr || ""),
                destinationCountry: isExport ? (dataRecords.ctr || "") : "Indonesia",
                port: dataRecords.pod || "",
                netWeight: dataRecords.netweight ?? "",
                value: dataRecords.value ?? "",
              }]
            };
          }
          return { status: 'OK', records: [] };
        } catch (err) {
          if (retryCount < cfg.MAX_RETRIES) {
            await wait(cfg.RETRY_DELAY_MS);
            return fetchBatchWithRetry(retryCount + 1);
          }
          return { status: 'ERROR', error: err.message, records: [] };
        }
      };

      return fetchBatchWithRetry(0);
    }, batchCodes, tradeMode, CONFIG);
  };

  // Run extraction loops per mode with real-time feedback and self-healing
  for (const mode of CONFIG.MODES) {
    const isExport = mode.toUpperCase() === "EXPORT";
    const targetArr = isExport ? exportRows : importRows;
    const outputFile = isExport ? CONFIG.EXPORT_OUTPUT_FILE : CONFIG.IMPORT_OUTPUT_FILE;

    console.log(`▶ Starting Mode: [${mode}] (${batches.length.toLocaleString()} batches)...`);

    let zeroStreakStartIndex = null;
    let consecutiveZeros = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNum = i + 1;
      const progressPercent = ((batchNum / batches.length) * 100).toFixed(1);

      let batchRes;
      try {
        batchRes = await executeBatch(batch, mode);
      } catch (err) {
        if (
          err.message.includes('Execution context was destroyed') ||
          err.message.includes('Target closed') ||
          err.message.includes('Session closed')
        ) {
          console.warn(`\n  ⚠️ Context reset / Cloudflare navigation on batch ${batchNum}.`);
          await recoverCloudflareSession(page);
          if (zeroStreakStartIndex !== null) {
            console.log(`  🔄 Rewinding to batch ${zeroStreakStartIndex + 1} to re-fetch missed records...`);
            i = zeroStreakStartIndex - 1;
            zeroStreakStartIndex = null;
            consecutiveZeros = 0;
          } else {
            i = i - 1; // Retry current batch
          }
          continue;
        }
        console.warn(`  ⚠️ Error on batch ${batchNum}: ${err.message}`);
        continue;
      }

      // Check if Cloudflare challenged the request
      if (batchRes && batchRes.status === 'CHALLENGE') {
        console.warn(`\n  🛡️ Cloudflare challenge detected on batch ${batchNum}.`);
        await recoverCloudflareSession(page);
        if (zeroStreakStartIndex !== null) {
          console.log(`  🔄 Rewinding to batch ${zeroStreakStartIndex + 1} to re-fetch missed records...`);
          i = zeroStreakStartIndex - 1;
          zeroStreakStartIndex = null;
          consecutiveZeros = 0;
        } else {
          i = i - 1;
        }
        continue;
      }

      const rows = (batchRes && batchRes.records) || [];

      // Check for zero-row streaks (Cloudflare silent block)
      if (rows.length === 0) {
        if (zeroStreakStartIndex === null) {
          zeroStreakStartIndex = i;
        }
        consecutiveZeros++;

        if (consecutiveZeros >= MAX_CONSECUTIVE_ZEROS) {
          console.warn(`\n  🛡️ Detected ${consecutiveZeros} consecutive 0-row batches (batches ${zeroStreakStartIndex + 1} to ${batchNum}).`);
          console.log(`  🔄 Triggering Cloudflare re-authentication and rewinding from batch ${zeroStreakStartIndex + 1}...`);
          await recoverCloudflareSession(page);
          i = zeroStreakStartIndex - 1;
          zeroStreakStartIndex = null;
          consecutiveZeros = 0;
          await sleep(2000);
          continue;
        }
      } else {
        targetArr.push(...rows);
        zeroStreakStartIndex = null;
        consecutiveZeros = 0;
      }

      const sampleBatch = batch.length > 1 ? `${batch[0]}..${batch[batch.length - 1]}` : batch[0];
      console.log(
        `  [${mode}] [${batchNum}/${batches.length}] (${progressPercent}%) HS:[${sampleBatch}] -> +${rows.length} rows (Total: ${targetArr.length.toLocaleString()})`
      );

      // Auto-save progress every 50 batches
      if (batchNum % 50 === 0) {
        saveCsv(targetArr, outputFile, true);
      }

      if (i < batches.length - 1) {
        await sleep(CONFIG.DELAY_MS);
      }
    }

    // Save final output for this mode
    saveCsv(targetArr, outputFile);
    console.log(`✅ Completed Mode [${mode}]: ${targetArr.length.toLocaleString()} records extracted.\n`);
  }

  console.log(`🔒 Closing browser session...`);
  await browser.close();

  const combinedRows = [...exportRows, ...importRows];

  // 4. Save Combined Output CSV
  console.log(`\n==============================================================`);
  console.log(`                  EXTRACTION SUMMARY                          `);
  console.log(`==============================================================`);
  console.log(`  Export Records Extracted : ${exportRows.length.toLocaleString()}`);
  console.log(`  Import Records Extracted : ${importRows.length.toLocaleString()}`);
  console.log(`  Total Combined Records   : ${combinedRows.length.toLocaleString()}`);
  console.log(`==============================================================\n`);

  saveCsv(combinedRows, CONFIG.COMBINED_OUTPUT_FILE);

  console.log(`\n✨ Done! All trade data has been extracted and saved.`);
})();
