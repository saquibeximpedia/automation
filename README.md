# BPS Indonesia Import & Export 1-Click Automation

Fully automated, zero-touch extraction of Indonesian trade data (**both Import and Export**) from [BPS Indonesia (bps.go.id/en/exim)](https://www.bps.go.id/en/exim).

---

## ⚡ 1-Click Usage

### Method 1: Double-Click Launcher (Windows)
1. Place your target HS codes into [`input_hs_codes.csv`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/input_hs_codes.csv) (one per line or standard CSV format).
2. Double-click **[`run_automation.bat`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/run_automation.bat)**.
3. The script will automatically:
   - Launch a secure Chrome session (bypassing Cloudflare protection seamlessly).
   - Parse all HS codes from your CSV.
   - Extract **Export** and **Import** records across all selected years.
   - Save clean results directly to CSV files in the same folder.

---

### Method 2: Command Line (Windows / Local Node)
```powershell
npm start
# or
node run.js
```

---

### Method 3: Virtual Machine Simulation (Docker / Cloud VM)
Run inside a headless Linux container with a single command:
```bash
docker compose up --build
```
Or with standard Docker:
```bash
docker build -t bps-automation .
docker run --rm -v "${PWD}:/app" bps-automation
```
All extracted CSV results will be saved directly to your project directory.

---

## 📊 Output Files Generated

| File | Description |
| :--- | :--- |
| `bps-combined-results.csv` (or `_part1.csv`, `_part2.csv`, ...) | Unified dataset containing both **Export** and **Import** records (auto-split every 900,000 / 9 lakh rows for Excel compatibility). |
| `bps-export-results.csv` (or `_part1.csv`, `_part2.csv`, ...) | Only **Export** records (auto-split every 900,000 / 9 lakh rows). |
| `bps-import-results.csv` (or `_part1.csv`, `_part2.csv`, ...) | Only **Import** records (auto-split every 900,000 / 9 lakh rows). |

---

## ✂️ Split Existing Large CSVs

If you already have a large CSV file that you want to split into 9 lakh (900,000) row chunks:
```powershell
node split_csv.js bps-export-results.csv
```

---

## ⚙️ Configuration (`run.js`)

You can edit [`run.js`](file:///c:/Users/Admin/Repositories/automation-v1/run.js) to tweak any setting:

```javascript
const CONFIG = {
  MODES: ["EXPORT", "IMPORT"], // Both modes
  YEARS: ["2026", "2025", "2024", "2023", "2022"], // Targeted years
  BATCH_SIZE: 5, // Number of HS codes queried together
  DELAY_MS: 1500, // Delay between batch queries
  MAX_RETRIES: 3, // Auto-retry on network error
  MAX_ROWS_PER_FILE: 900000, // 9 Lakh rows per CSV file
  INPUT_FILE: resolveInputPath(),
};
```
