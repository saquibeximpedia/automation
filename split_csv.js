const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Splits large CSV files into chunks of 9 lakh (900,000) data rows each.
 * Usage: node split_csv.js [optional_file_path] [optional_rows_per_file]
 */

const targetFile = process.argv[2] 
  ? path.resolve(process.argv[2]) 
  : path.join(__dirname, 'bps-export-results.csv');

const MAX_ROWS = process.argv[3] ? parseInt(process.argv[3], 10) : 900000;

if (!fs.existsSync(targetFile)) {
  console.error(`❌ File not found: ${targetFile}`);
  console.log(`Usage: node split_csv.js <path-to-csv> [rows-per-file]`);
  process.exit(1);
}

(async () => {
  console.log(`\n✂️  Starting CSV Splitter...`);
  console.log(`📄 Target File: ${path.basename(targetFile)}`);
  console.log(`📏 Chunk size: ${MAX_ROWS.toLocaleString()} rows (9 Lakh rows)\n`);

  const fileStream = fs.createReadStream(targetFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let header = null;
  let currentChunk = 1;
  let currentRowCount = 0;
  let totalRows = 0;
  let currentWriteStream = null;

  const ext = path.extname(targetFile);
  const base = targetFile.slice(0, -ext.length);

  const openNewChunk = () => {
    if (currentWriteStream) {
      currentWriteStream.end();
    }
    const chunkPath = `${base}_part${currentChunk}${ext}`;
    console.log(`📝 Writing Part ${currentChunk}: ${path.basename(chunkPath)}...`);
    currentWriteStream = fs.createWriteStream(chunkPath, { encoding: 'utf8' });
    if (header) {
      currentWriteStream.write(header + '\r\n');
    }
    currentRowCount = 0;
  };

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (header === null) {
      header = line;
      openNewChunk();
      continue;
    }

    if (currentRowCount >= MAX_ROWS) {
      currentChunk++;
      openNewChunk();
    }

    currentWriteStream.write(line + '\r\n');
    currentRowCount++;
    totalRows++;

    if (totalRows % 200000 === 0) {
      console.log(`   Processed ${totalRows.toLocaleString()} rows...`);
    }
  }

  if (currentWriteStream) {
    currentWriteStream.end();
  }

  console.log(`\n✅ Completed!`);
  console.log(`   Total Rows Split : ${totalRows.toLocaleString()}`);
  console.log(`   Files Created    : ${currentChunk} chunk files (~${MAX_ROWS.toLocaleString()} rows each).\n`);
})();
