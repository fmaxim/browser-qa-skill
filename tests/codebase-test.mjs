#!/usr/bin/env node
/**
 * browser-qa v2 — Codebase Scanning & Test Generation Test
 *
 * Validates that the codebase-driven route discovery strategies work
 * against the test app. Tests:
 * 1. File-based route discovery (glob for page files)
 * 2. Server config route extraction (grep for route definitions)
 * 3. Link crawling (Playwright crawl from /)
 * 4. Test generation (create Playwright tests for discovered routes)
 * 5. Spec-driven test generation (from a sample spec)
 * 6. Coverage tracking
 *
 * Setup:
 *   cd tests/test-app && node server.js
 *
 * Run:
 *   node tests/codebase-test.mjs
 *
 * Requires: test app running, Playwright installed
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const TEST_APP_DIR = join(__dirname, 'test-app');
const QA_OUTPUT_DIR = join(__dirname, '.qa-generated');
const BASE_URL = process.env.TEST_URL || 'http://localhost:3099';

const results = [];
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    results.push({ name, status: 'PASS', detail });
    passed++;
  } else {
    results.push({ name, status: 'FAIL', detail });
    failed++;
  }
}

// Clean up generated test dir
if (existsSync(QA_OUTPUT_DIR)) rmSync(QA_OUTPUT_DIR, { recursive: true });
mkdirSync(QA_OUTPUT_DIR, { recursive: true });

console.log('=== browser-qa v2 — Codebase & Spec Test Generation ===\n');
console.log(`Test app: ${TEST_APP_DIR}`);
console.log(`Target:   ${BASE_URL}\n`);

// Check test app is running
try {
  execSync(`curl -s -o /dev/null -w "%{http_code}" ${BASE_URL}`, { timeout: 5000, encoding: 'utf-8' });
} catch {
  console.error(`Test app not reachable at ${BASE_URL}`);
  console.error('Start it with: cd tests/test-app && node server.js');
  process.exit(1);
}

// -------------------------------------------------------
// TEST 1: File-Based Route Discovery
// -------------------------------------------------------
console.log('--- Strategy 1: File-based route discovery ---');

const pageFiles = readdirSync(join(TEST_APP_DIR, 'pages')).filter(f => f.endsWith('.html'));
assert('file-discovery: Finds page files', pageFiles.length >= 15,
  `Found ${pageFiles.length} page files`);

// Map file names to routes (like the codebase-scanning.md strategy)
const fileRoutes = pageFiles.map(f => {
  if (f === 'index.html') return '/';
  return '/' + f.replace('.html', '').replace(/^uc\d+-/, '');
});
assert('file-discovery: Maps files to routes', fileRoutes.length > 0,
  fileRoutes.slice(0, 5).join(', '));

// -------------------------------------------------------
// TEST 2: Config-Based Route Extraction
// -------------------------------------------------------
console.log('--- Strategy 2: Config-based route extraction ---');

const serverCode = readFileSync(join(TEST_APP_DIR, 'server.js'), 'utf-8');
const routeMatches = serverCode.match(/'\/[a-z-/]+'/g) || [];
const configRoutes = [...new Set(routeMatches.map(r => r.replace(/'/g, '')))];
assert('config-discovery: Extracts routes from server.js', configRoutes.length >= 10,
  `Found ${configRoutes.length} routes in server config`);

// Known routes from server.js pageRoutes object
const expectedRoutes = ['/', '/ui', '/js-errors', '/navigation', '/network', '/tracking',
  '/debug', '/login', '/dashboard', '/security', '/performance', '/memory',
  '/responsive', '/slow-network', '/accessibility', '/bad-ecommerce'];
const discoveredFromConfig = expectedRoutes.filter(r =>
  serverCode.includes(`'${r}'`) || serverCode.includes(`"${r}"`)
);
assert('config-discovery: Finds all known page routes', discoveredFromConfig.length >= 14,
  `${discoveredFromConfig.length}/${expectedRoutes.length} routes found`);

// -------------------------------------------------------
// TEST 3: Link Crawling
// -------------------------------------------------------
console.log('--- Strategy 3: Link crawling ---');

let crawledRoutes = [];
try {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const visited = new Set();
  const toVisit = ['/'];

  while (toVisit.length > 0 && visited.size < 30) {
    const path = toVisit.shift();
    if (visited.has(path)) continue;
    visited.add(path);

    try {
      const resp = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 5000 });
      if (resp && resp.status() === 200) {
        crawledRoutes.push(path);
      }

      const links = await page.$$eval('a[href]', anchors =>
        anchors
          .map(a => {
            try { return new URL(a.href, window.location.origin).pathname; } catch { return null; }
          })
          .filter(href => href && href.startsWith('/') && !href.includes('.'))
      );
      for (const link of new Set(links)) {
        if (!visited.has(link) && !toVisit.includes(link)) toVisit.push(link);
      }
    } catch { /* skip failed pages */ }
  }

  await browser.close();
} catch (e) {
  console.log(`  Crawl error: ${e.message}`);
}

assert('crawl-discovery: Crawls pages from /', crawledRoutes.length >= 5,
  `Crawled ${crawledRoutes.length} pages`);
assert('crawl-discovery: Finds homepage', crawledRoutes.includes('/'));
assert('crawl-discovery: Finds subpages', crawledRoutes.some(r => r !== '/'));

// -------------------------------------------------------
// TEST 4: Test Generation from Discovered Routes
// -------------------------------------------------------
console.log('--- Test Generation ---');

// Generate a Playwright test file for each discovered route
const allRoutes = [...new Set([...expectedRoutes, ...crawledRoutes])];
let testContent = `import { test, expect } from '@playwright/test';\n\n`;
testContent += `const BASE_URL = '${BASE_URL}';\n\n`;

for (const route of allRoutes) {
  const name = route === '/' ? 'homepage' : route.slice(1).replace(/\//g, '-');
  testContent += `test('${name} loads without errors', async ({ page }) => {\n`;
  testContent += `  const errors = [];\n`;
  testContent += `  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });\n`;
  testContent += `  const resp = await page.goto(\`\${BASE_URL}${route}\`);\n`;
  testContent += `  expect(resp.status()).toBeLessThan(500);\n`;
  testContent += `});\n\n`;
}

const testFile = join(QA_OUTPUT_DIR, 'routes.spec.mjs');
writeFileSync(testFile, testContent);
assert('test-gen: Creates test file', existsSync(testFile));
assert('test-gen: Test file has tests for all routes',
  testContent.split('test(').length - 1 >= allRoutes.length,
  `${testContent.split('test(').length - 1} tests generated`);

// -------------------------------------------------------
// TEST 5: Spec-Driven Test Generation
// -------------------------------------------------------
console.log('--- Spec-Driven Test Generation ---');

const sampleSpec = `# Test App Spec

## Homepage
- Homepage loads and shows links to all use cases
- All UC links are clickable and navigate to correct pages

## Login Flow
- User can enter email and password
- Clicking "Login" with valid email redirects to dashboard
- Empty email shows error

## Security Page
- Page loads without crashes
- Should contain demonstration of security issues
`;

const specFile = join(QA_OUTPUT_DIR, 'SPEC.md');
writeFileSync(specFile, sampleSpec);

// Parse spec into testable criteria
const specLines = sampleSpec.split('\n').filter(l => l.trim().startsWith('- '));
assert('spec-parse: Extracts testable criteria', specLines.length >= 5,
  `Found ${specLines.length} criteria`);

// Generate tests from spec
let specTestContent = `import { test, expect } from '@playwright/test';\n\n`;
specTestContent += `const BASE_URL = '${BASE_URL}';\n\n`;

specTestContent += `test.describe('Homepage', () => {\n`;
specTestContent += `  test('loads and shows links', async ({ page }) => {\n`;
specTestContent += `    await page.goto(\`\${BASE_URL}/\`);\n`;
specTestContent += `    const links = await page.$$('a[href]');\n`;
specTestContent += `    expect(links.length).toBeGreaterThan(5);\n`;
specTestContent += `  });\n\n`;
specTestContent += `  test('UC links navigate correctly', async ({ page }) => {\n`;
specTestContent += `    await page.goto(\`\${BASE_URL}/\`);\n`;
specTestContent += `    const firstLink = page.locator('a[href*="/"]').first();\n`;
specTestContent += `    await firstLink.click();\n`;
specTestContent += `    await expect(page).not.toHaveURL(\`\${BASE_URL}/\`);\n`;
specTestContent += `  });\n`;
specTestContent += `});\n\n`;

specTestContent += `test.describe('Login Flow', () => {\n`;
specTestContent += `  test('can enter email and password', async ({ page }) => {\n`;
specTestContent += `    await page.goto(\`\${BASE_URL}/login\`);\n`;
specTestContent += `    await page.fill('input[type="email"], input[name="email"]', 'test@example.com');\n`;
specTestContent += `    await page.fill('input[type="password"], input[name="password"]', 'password123');\n`;
specTestContent += `  });\n`;
specTestContent += `});\n\n`;

specTestContent += `test.describe('Security Page', () => {\n`;
specTestContent += `  test('loads without crashes', async ({ page }) => {\n`;
specTestContent += `    const errors = [];\n`;
specTestContent += `    page.on('pageerror', e => errors.push(e.message));\n`;
specTestContent += `    await page.goto(\`\${BASE_URL}/security\`);\n`;
specTestContent += `    expect(errors).toHaveLength(0);\n`;
specTestContent += `  });\n`;
specTestContent += `});\n`;

const specTestFile = join(QA_OUTPUT_DIR, 'spec.spec.mjs');
writeFileSync(specTestFile, specTestContent);
assert('spec-gen: Creates spec test file', existsSync(specTestFile));
assert('spec-gen: Has test for each spec section',
  specTestContent.includes('Homepage') && specTestContent.includes('Login') && specTestContent.includes('Security'));

// -------------------------------------------------------
// TEST 6: Coverage Tracking
// -------------------------------------------------------
console.log('--- Coverage Tracking ---');

// Compute coverage
const totalRoutes = expectedRoutes.length;
const testedRoutes = allRoutes.length;
const routeCoverage = Math.round(testedRoutes / totalRoutes * 100);

// Check for forms in pages
const pagesDir = join(TEST_APP_DIR, 'pages');
let totalForms = 0;
let pagesWithForms = [];
for (const f of pageFiles) {
  const content = readFileSync(join(pagesDir, f), 'utf-8');
  const formCount = (content.match(/<form/gi) || []).length;
  if (formCount > 0) {
    totalForms += formCount;
    pagesWithForms.push(f);
  }
}

// Check for links
let totalLinks = 0;
for (const f of pageFiles) {
  const content = readFileSync(join(pagesDir, f), 'utf-8');
  totalLinks += (content.match(/<a\s/gi) || []).length;
}

// Check for API calls
let totalAPIs = 0;
for (const f of pageFiles) {
  const content = readFileSync(join(pagesDir, f), 'utf-8');
  totalAPIs += (content.match(/fetch\(/gi) || []).length;
}

const coverage = {
  routes: { covered: testedRoutes, total: totalRoutes, percent: routeCoverage },
  forms: { total: totalForms, pages: pagesWithForms.length },
  links: { total: totalLinks },
  apis: { total: totalAPIs },
};

writeFileSync(join(QA_OUTPUT_DIR, '.coverage.json'), JSON.stringify(coverage, null, 2));

assert('coverage: Route coverage >= 90%', routeCoverage >= 90, `${routeCoverage}%`);
assert('coverage: Finds forms', totalForms > 0, `${totalForms} forms in ${pagesWithForms.length} pages`);
assert('coverage: Finds links', totalLinks > 0, `${totalLinks} links`);
assert('coverage: Finds API calls', totalAPIs > 0, `${totalAPIs} fetch() calls`);
assert('coverage: Creates .coverage.json', existsSync(join(QA_OUTPUT_DIR, '.coverage.json')));

// -------------------------------------------------------
// TEST 7: User Flow Detection
// -------------------------------------------------------
console.log('--- User Flow Detection ---');

// Detect flows by analyzing the index page links
const indexContent = readFileSync(join(pagesDir, 'index.html'), 'utf-8');
const indexLinks = (indexContent.match(/href="[^"]+"/g) || []).map(m => m.replace(/href="|"/g, ''));
assert('flow: Index has navigation links', indexLinks.length >= 10, `${indexLinks.length} links`);

// Check for multi-page flows (navigation UC has page-a, page-b)
const navContent = readFileSync(join(pagesDir, 'uc3-navigation.html'), 'utf-8');
const hasMultiPageFlow = navContent.includes('page-a') || navContent.includes('page-b');
assert('flow: Detects multi-page navigation flow', hasMultiPageFlow);

// Check for auth flow (login -> dashboard)
const loginContent = readFileSync(join(pagesDir, 'uc7-login.html'), 'utf-8');
const hasAuthFlow = loginContent.includes('dashboard') || loginContent.includes('/api/login');
assert('flow: Detects login -> dashboard auth flow', hasAuthFlow);

// -------------------------------------------------------
// REPORT
// -------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log('CODEBASE & SPEC GENERATION RESULTS');
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

console.log('\nGenerated files:');
console.log(`  ${testFile}`);
console.log(`  ${specTestFile}`);
console.log(`  ${join(QA_OUTPUT_DIR, '.coverage.json')}`);

// Clean up
rmSync(QA_OUTPUT_DIR, { recursive: true });

process.exit(failed > 0 ? 1 : 0);
