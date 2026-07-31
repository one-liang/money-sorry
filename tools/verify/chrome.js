// ══════════════════════════════════════════════════════════════════════════
// 找出系統上已安裝的 Chrome（verify.js 與 verify-output.js 共用）
//
// 一律用系統上的正式版 Chrome，不另外下載瀏覽器——驗證要跑在使用者真正
// 會用的瀏覽器上。找不到時可用 CHROME_PATH 指定。
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  win32: [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files',
              'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
              'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '',
              'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
};

/** @returns {string} Chrome 執行檔的絕對路徑；找不到時 null */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of CANDIDATES[process.platform] || []) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = { findChrome };
