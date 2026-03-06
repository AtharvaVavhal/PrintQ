const fs   = require('fs');
const path = require('path');

async function extractPageCount(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return countPdfPages(filePath);
  }
  if (ext === '.docx') {
    return countDocxPages(filePath);
  }
  throw new Error('Unsupported file type: ' + ext);
}

function countPdfPages(filePath) {
  return new Promise((resolve) => {
    const content = fs.readFileSync(filePath).toString('latin1');
    const pageTreeMatch = content.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
    if (pageTreeMatch) {
      const count = parseInt(pageTreeMatch[1], 10);
      if (count > 0) return resolve(count);
    }
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) return resolve(pageMatches.length);
    resolve(1);
  });
}

async function countDocxPages(filePath) {
  try {
    const str = fs.readFileSync(filePath).toString('utf8');
    const match = str.match(/<Pages>(\d+)<\/Pages>/);
    if (match) {
      const count = parseInt(match[1], 10);
      if (count > 0) return count;
    }
    return 1;
  } catch (err) {
    return 1;
  }
}

module.exports = { extractPageCount };