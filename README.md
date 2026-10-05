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

### Method 2: Command Line
```powershell
npm start
# or
node run.js
```

---

## 📊 Output Files Generated

| File | Description |
| :--- | :--- |
| [`bps-combined-results.csv`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/bps-combined-results.csv) | Unified dataset containing both **Export** and **Import** records with a dedicated `Trade Type` column. |
| [`bps-export-results.csv`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/bps-export-results.csv) | Only **Export** records. |
| [`bps-import-results.csv`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/bps-import-results.csv) | Only **Import** records. |

---

## ⚙️ Configuration (`run.js`)

You can edit [`run.js`](file:///c:/Users/Admin/Desktop/bps-extractor-browser/automation/run.js) to tweak any setting:

```javascript
const CONFIG = {
  MODES: ["EXPORT", "IMPORT"], // Both modes
  YEARS: ["2026", "2025", "2024", "2023", "2022"], // Targeted years
  BATCH_SIZE: 5, // Number of HS codes queried together
  DELAY_MS: 1500, // Delay between batch queries
  MAX_RETRIES: 3, // Auto-retry on network error
  INPUT_FILE: path.join(__dirname, "input_hs_codes.csv"),
};
```
