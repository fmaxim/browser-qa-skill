#!/usr/bin/env node
/**
 * browser-qa v2 — Comprehensive Test Suite
 *
 * Tests all modes and features of the v2 Playwright script against the test app.
 *
 * Setup:
 *   cd tests/test-app && node server.js    # Start test app on port 3099
 *
 * Run:
 *   node tests/test-suite.mjs              # From skill root
 *   TEST_URL=http://localhost:4000 node tests/test-suite.mjs   # Custom URL
 *
 * Requires: test app running, Playwright installed
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'scripts', 'playwright-qa.mjs');
const BASE_URL = process.env.TEST_URL || 'http://localhost:3099';

if (!existsSync(SCRIPT)) {
  console.error(`Script not found: ${SCRIPT}`);
  process.exit(1);
}

const results = [];
let passed = 0;
let failed = 0;

function run(args, timeout = 30000) {
  try {
    const out = execSync(`node "${SCRIPT}" ${args}`, {
      timeout,
      encoding: 'utf-8',
      cwd: resolve(__dirname, '..'),
    });
    return JSON.parse(out.trim());
  } catch (e) {
    if (e.stdout) {
      try { return JSON.parse(e.stdout.trim()); } catch {}
    }
    return { error: e.message };
  }
}

function assert(name, condition, detail = '') {
  if (condition) {
    results.push({ name, status: 'PASS', detail });
    passed++;
  } else {
    results.push({ name, status: 'FAIL', detail });
    failed++;
  }
}

function hasIssue(data, severity, category, messagePattern) {
  return (data.issues || []).some(i =>
    (!severity || i.severity === severity) &&
    (!category || i.category === category) &&
    (!messagePattern || new RegExp(messagePattern, 'i').test(i.message))
  );
}

console.log('=== browser-qa v2 Test Suite ===\n');
console.log(`Script: ${SCRIPT}`);
console.log(`Target: ${BASE_URL}\n`);

// Check test app is running
try {
  execSync(`curl -s -o /dev/null -w "%{http_code}" ${BASE_URL}`, { timeout: 5000, encoding: 'utf-8' });
} catch {
  console.error(`Test app not reachable at ${BASE_URL}`);
  console.error('Start it with: cd tests/test-app && node server.js');
  process.exit(1);
}

// -------------------------------------------------------
// UC-2: JS Error Detection
// -------------------------------------------------------
console.log('--- UC-2: JavaScript Errors ---');
const uc2 = run(`${BASE_URL}/js-errors`);
assert('UC-2: Script runs without error', !uc2.error);
assert('UC-2: Detects TypeError', hasIssue(uc2, 'CRITICAL', 'js-error', 'Cannot read properties'));
assert('UC-2: Detects deprecation warnings', hasIssue(uc2, 'WARNING', 'console', 'DEPRECATED'));
assert('UC-2: Has timing data', uc2.duration_ms > 0);

// -------------------------------------------------------
// UC-4: Network Errors
// -------------------------------------------------------
console.log('--- UC-4: Network Errors ---');
const uc4 = run(`${BASE_URL}/network`);
assert('UC-4: Script runs without error', !uc4.error);
assert('UC-4: Detects 404s', hasIssue(uc4, 'ERROR', 'network', '404'));
assert('UC-4: Detects missing image', hasIssue(uc4, 'ERROR', 'network', 'missing-image'));
assert('UC-4: Detects malformed JSON error', hasIssue(uc4, 'ERROR', null, 'parse error|SyntaxError'));

// -------------------------------------------------------
// UC-5: Tracking / BI Events
// -------------------------------------------------------
console.log('--- UC-5: Tracking ---');
const uc5 = run(`${BASE_URL}/tracking`);
assert('UC-5: Script runs without error', !uc5.error);
assert('UC-5: Captures tracking calls', uc5.trackingCalls > 0);
assert('UC-5: Detects duplicate tracking', hasIssue(uc5, 'WARNING', 'tracking', 'Duplicate'));

// -------------------------------------------------------
// UC-6: Debug Console
// -------------------------------------------------------
console.log('--- UC-6: Debug Console ---');
const uc6 = run(`${BASE_URL}/debug`);
assert('UC-6: Detects [ERROR] app logs', hasIssue(uc6, 'ERROR', 'app-log', 'user_segment'));
assert('UC-6: Detects [WARN] app logs', hasIssue(uc6, 'WARNING', 'app-log', 'experiment_variant'));

// -------------------------------------------------------
// UC-8: Security
// -------------------------------------------------------
console.log('--- UC-8: Security ---');
const uc8 = run(`${BASE_URL}/security`);
assert('UC-8: Detects secrets (DB_PASSWORD)', hasIssue(uc8, 'SECURITY', 'security', 'DB_PASSWORD'));
assert('UC-8: Detects secrets (API_KEY)', hasIssue(uc8, 'SECURITY', 'security', 'API_KEY'));
assert('UC-8: Detects secrets (Stripe key)', hasIssue(uc8, 'SECURITY', 'security', 'Stripe'));
assert('UC-8: Detects XSS (eval)', hasIssue(uc8, 'SECURITY', 'security', 'eval'));
assert('UC-8: Detects XSS (innerHTML)', hasIssue(uc8, 'SECURITY', 'security', 'innerHTML'));
assert('UC-8: Detects open redirect', hasIssue(uc8, 'SECURITY', 'security', 'redirect'));
assert('UC-8: Detects CORS wildcard on responses', hasIssue(uc8, 'SECURITY', 'security', 'CORS wildcard'));
assert('UC-8: Detects missing CSP', hasIssue(uc8, 'SECURITY', 'security', 'Content-Security-Policy'));
assert('UC-8: Total security issues >= 6', (uc8.counts?.security || 0) >= 6);

// -------------------------------------------------------
// UC-13: Accessibility
// -------------------------------------------------------
console.log('--- UC-13: Accessibility ---');
const uc13 = run(`${BASE_URL}/accessibility`);
assert('UC-13: Detects missing alt', hasIssue(uc13, 'A11Y', 'accessibility', 'alt'));
assert('UC-13: Detects button without name', hasIssue(uc13, 'A11Y', 'accessibility', 'Button.*no accessible'));
assert('UC-13: Detects inputs with placeholder-only (no real label)', hasIssue(uc13, 'A11Y', 'accessibility', 'placeholder only'));
assert('UC-13: Detects low contrast text', hasIssue(uc13, 'A11Y', 'accessibility', 'Low contrast'));
assert('UC-13: Detects role=button missing tabindex', hasIssue(uc13, 'A11Y', 'accessibility', 'role.*button.*not keyboard'));
assert('UC-13: Detects role=button missing keyboard handler', hasIssue(uc13, 'A11Y', 'accessibility', 'role.*button.*no keyboard handler'));

// -------------------------------------------------------
// UC-14: Visual Quality
// -------------------------------------------------------
console.log('--- UC-14: Visual Quality ---');
const uc14 = run(`${BASE_URL}/bad-ecommerce`);
assert('UC-14: Detects Comic Sans', hasIssue(uc14, 'WARNING', 'visual', 'Comic Sans'));
assert('UC-14: Detects invisible text', hasIssue(uc14, 'WARNING', 'visual', 'Invisible'));
assert('UC-14: Detects small fonts', hasIssue(uc14, 'WARNING', 'visual', 'Font too small'));
assert('UC-14: Detects low contrast', hasIssue(uc14, 'A11Y', 'accessibility', 'Low contrast'));
assert('UC-14: Detects cursor:default on button', hasIssue(uc14, 'WARNING', 'visual', 'cursor:default'));
assert('UC-14: Detects deprecated marquee', hasIssue(uc14, 'WARNING', 'visual', 'marquee'));

// UC-14: Bad Dashboard
console.log('--- UC-14: Bad Dashboard ---');
const uc14dash = run(`${BASE_URL}/bad-dashboard`);
assert('UC-14-dash: Detects invisible badge text', hasIssue(uc14dash, 'WARNING', 'visual', 'Invisible'));
assert('UC-14-dash: Detects low contrast sidebar', hasIssue(uc14dash, 'A11Y', 'accessibility', 'Low contrast'));
assert('UC-14-dash: Detects small fonts', hasIssue(uc14dash, 'WARNING', 'visual', 'Font too small'));

// UC-14: Bad Landing
console.log('--- UC-14: Bad Landing ---');
const uc14land = run(`${BASE_URL}/bad-landing`);
assert('UC-14-land: Detects Impact font', hasIssue(uc14land, 'WARNING', 'visual', 'Impact'));
assert('UC-14-land: Detects Papyrus font', hasIssue(uc14land, 'WARNING', 'visual', 'Papyrus'));
assert('UC-14-land: Detects too many fonts', hasIssue(uc14land, 'WARNING', 'visual', 'Too many font'));
assert('UC-14-land: Detects seizure-risk animation', hasIssue(uc14land, 'A11Y', 'accessibility', 'Seizure.*blink'));
assert('UC-14-land: Detects low contrast footer', hasIssue(uc14land, 'A11Y', 'accessibility', 'Low contrast'));

// UC-1: UI Integrity
console.log('--- UC-1: UI Integrity ---');
const uc1 = run(`${BASE_URL}/ui`);
assert('UC-1: Detects missing CSS 404', hasIssue(uc1, 'ERROR', 'network', 'missing-styles'));
assert('UC-1: Detects broken font 404', hasIssue(uc1, 'ERROR', 'network', 'nonexistent-font'));
assert('UC-1: Detects pointer-events:none', hasIssue(uc1, 'WARNING', 'visual', 'pointer-events:none'));
assert('UC-1: Detects overflow:hidden clipping', hasIssue(uc1, 'WARNING', 'layout', 'overflow:hidden'));
assert('UC-1: Detects stretched image', hasIssue(uc1, 'WARNING', 'visual', 'Stretched image'));
assert('UC-1: Detects z-index modal behind overlay', hasIssue(uc1, 'WARNING', 'layout', 'z-index.*modal.*behind|Modal.*z-index'));

// UC-14: Bad Landing — new checks
console.log('--- UC-14: Bad Landing (new checks) ---');
assert('UC-14-land: Detects negative letter-spacing', hasIssue(uc14land, 'WARNING', 'visual', 'letter-spacing'));
assert('UC-14-land: Detects element overlap', hasIssue(uc14land, 'WARNING', 'layout', 'overlap'));

// UC-13: Accessibility (interactive — focus trap)
console.log('--- UC-13: Accessibility (interactive) ---');
const uc13i = run(`${BASE_URL}/accessibility --interactive`, 60000);
assert('UC-13: Detects focus trap (no close/escape)', hasIssue(uc13i, 'A11Y', 'accessibility', 'Focus trap'));

// UC-2: JS Errors (interactive — memory leak detection)
console.log('--- UC-2: JS Errors (interactive) ---');
const uc2i = run(`${BASE_URL}/js-errors --interactive`, 60000);
assert('UC-2: Detects unhandled promise rejection (interactive)', hasIssue(uc2i, 'CRITICAL', null, 'token|JSON'));
assert('UC-2: Detects ReferenceError (interactive)', hasIssue(uc2i, 'CRITICAL', null, 'undeclaredFunction|not defined'));
assert('UC-2: Detects silent console.error (interactive)', hasIssue(uc2i, 'WARNING', null, 'memory leak|PERFORMANCE|listener'));

// -------------------------------------------------------
// --from-verify Mode
// -------------------------------------------------------
console.log('--- --from-verify Mode ---');
const verify1 = run(`${BASE_URL}/js-errors --from-verify`);
assert('from-verify: Has pass field', 'pass' in verify1);
assert('from-verify: Returns false for page with errors', verify1.pass === false);
assert('from-verify: Has errors array', Array.isArray(verify1.errors));
assert('from-verify: Has warnings array', Array.isArray(verify1.warnings));
assert('from-verify: Has duration_ms', verify1.duration_ms > 0);
assert('from-verify: Has screenshot path', typeof verify1.screenshot === 'string');
assert('from-verify: Completes in <10s', verify1.duration_ms < 10000);

const verify2 = run(`${BASE_URL}/ --from-verify`);
assert('from-verify: Returns true for clean page', verify2.pass === true);

// -------------------------------------------------------
// --interactive Mode
// -------------------------------------------------------
console.log('--- --interactive Mode ---');
const interactive = run(`${BASE_URL}/login --interactive`);
assert('interactive: Script completes', !interactive.error);
assert('interactive: Has issues array', Array.isArray(interactive.issues));
assert('interactive: Duration is longer than non-interactive',
  interactive.duration_ms > 3000, `${interactive.duration_ms}ms`);

// -------------------------------------------------------
// Viewport Mode (Mobile)
// -------------------------------------------------------
console.log('--- Viewport: Mobile (375x667) ---');
const mobile = run(`${BASE_URL}/responsive --viewport 375x667`);
assert('viewport-mobile: Reports correct viewport', mobile.viewport === '375x667');
assert('viewport-mobile: Detects horizontal overflow', hasIssue(mobile, 'WARNING', 'layout', 'Horizontal scroll'));
assert('viewport-mobile: Detects small touch target', hasIssue(mobile, 'A11Y', 'accessibility', 'Touch target'));

// -------------------------------------------------------
// Viewport Mode (Desktop)
// -------------------------------------------------------
console.log('--- Viewport: Desktop (1440x900) ---');
const desktop = run(`${BASE_URL}/responsive --viewport 1440x900`);
assert('viewport-desktop: Reports correct viewport', desktop.viewport === '1440x900');

// -------------------------------------------------------
// Homepage (Clean page)
// -------------------------------------------------------
console.log('--- Homepage (clean page) ---');
const home = run(`${BASE_URL}/`);
assert('homepage: Loads without critical errors', (home.counts?.critical || 0) === 0);
assert('homepage: Takes screenshot', existsSync(home.screenshot || ''));

// -------------------------------------------------------
// Output Format Validation
// -------------------------------------------------------
console.log('--- Output Format ---');
assert('format: Has url field', typeof uc2.url === 'string');
assert('format: Has viewport field', typeof uc2.viewport === 'string');
assert('format: Has timestamp field', typeof uc2.timestamp === 'string');
assert('format: Has counts object', typeof uc2.counts === 'object');
assert('format: Has networkRequests count', typeof uc2.networkRequests === 'number');
assert('format: Issues have severity', (uc2.issues || []).every(i => i.severity));
assert('format: Issues have category', (uc2.issues || []).every(i => i.category));
assert('format: Issues have message', (uc2.issues || []).every(i => i.message));

// -------------------------------------------------------
// REPORT
// -------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));

for (const r of results) {
  const icon = r.status === 'PASS' ? '  PASS' : '  FAIL';
  const detail = r.detail ? ` (${r.detail})` : '';
  console.log(`${icon}  ${r.name}${detail}`);
}

console.log('='.repeat(60));
console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
console.log(`Pass rate: ${Math.round(passed / results.length * 100)}%`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
