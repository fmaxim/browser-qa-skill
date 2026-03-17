---
name: browser-qa
description: Comprehensive browser QA testing for web applications. Runs automated tests covering JS errors, network failures, accessibility (WCAG), security issues, performance (Web Vitals), BI event tracking, responsive design, and visual quality. Use when verifying a web page works correctly, after deploying changes, when asked to "test the page", "check for errors", "run QA", "verify the site", "test accessibility", "check performance", or any request to validate a web application's health. Also use when implementing features to generate spec-driven acceptance tests BEFORE coding, then validate after. Triggers on: browser testing, QA check, smoke test, verify deploy, check accessibility, test responsive, validate tracking, check console errors, performance audit, visual regression, design review, spec-driven tests, generate tests from codebase, test coverage.
user-invocable: true
argument-hint: [url-or-path] [--quick|--responsive|--from-verify|--codebase --generate-tests|--run-tests|--coverage|--spec SPEC.md --generate-tests]
---

# Browser QA v2 — Universal Browser Testing

Framework-agnostic browser QA that works with **any** web application — React, Next.js, Astro, Vue, Svelte, plain HTML, or anything that renders in a browser. Combines agent-browser (fast smoke), Playwright (deep scan), axe-core (WCAG), and Lighthouse (performance) into a single test pass.

**Design principle:** Everything runs through the browser. No coupling to specific frameworks, databases, or backends. If it requires `wrangler`, `next`, `astro`, or any framework CLI — it belongs in a framework-specific extension, not here.

## Modes

```
/browser-qa <url>                           # Full QA pass (Phases 1-4)
/browser-qa <url> --quick                   # Phase 1 only (smoke, ~3s)
/browser-qa <url> --responsive              # Full QA at 5 viewports
/browser-qa --spec SPEC.md --generate-tests # Generate tests from spec document
/browser-qa --codebase --generate-tests     # Generate tests from existing codebase
/browser-qa --run-tests                     # Run previously generated tests
/browser-qa --coverage                      # Show test coverage report
/browser-qa <url> --from-verify             # Lightweight mode for verify-change (Phase 1+2 errors only)
```

## Phases (Full QA Pass) — All Browser-Only

### Phase 1: Quick Smoke (agent-browser) ~3s

Fast, low-token check that catches obvious crashes. Uses agent-browser CLI for snapshot-ref pattern.

```bash
# 1. Open and check
agent-browser open <URL>
agent-browser errors
agent-browser console
agent-browser requests

# 2. Annotated screenshot
agent-browser screenshot /tmp/browser-qa-smoke.png

# 3. Close
agent-browser close
```

**Reports:** pass/fail + error count. If `--quick` mode, stop here and report.

### Phase 2: Deep Scan (Playwright headless script) ~5s

Write a Playwright script to `/tmp/browser-qa-test.mjs` and execute it. The script handles:

**Console & JS errors:**
- Uncaught TypeErrors, ReferenceErrors
- Unhandled promise rejections
- `console.error` and `console.warn` output
- Application-level `[ERROR]` and `[WARN]` logs

**Network:**
- Failed requests (4xx, 5xx status codes)
- Slow responses (>3s)
- Missing resources (images, CSS, JS returning 404)
- CORS errors

**Tracking / BI events:**
- Validates payloads on tracking calls (/api/track, /pixel, /analytics, /collect)
- Detects duplicate tracking calls
- Checks required fields

**Security:**
- Secrets in HTML comments (API keys, passwords, tokens)
- XSS vectors (innerHTML with user input, eval() on URL params)
- Open redirects (unvalidated redirect URLs in links/forms)
- Permissive CORS headers (`Access-Control-Allow-Origin: *`)
- Missing Content-Security-Policy header
- Auth tokens exposed in URL query parameters
- Cookie security flags (HttpOnly, Secure, SameSite) on session/auth cookies
- Server error responses leaking stack traces or DB credentials

**Accessibility (DOM):**
- Images missing `alt` attributes
- Form inputs without associated `<label>` or `aria-label`
- Buttons with no accessible name
- Touch targets too small (<44px)
- Font sizes too small (<12px)

**Visual quality:**
- Multiple inconsistent font families (>3)
- Unprofessional fonts (Comic Sans, Papyrus, Impact)
- Invisible text (same foreground/background color)
- Horizontal overflow

**Interactive testing:**
- Click all visible buttons (one at a time), check for new errors after each
- Fill form inputs with test data, submit, check responses
- Follow links, verify navigation targets
- Track URL changes

**Template path:** Read `${CLAUDE_SKILL_DIR}/scripts/playwright-qa.mjs` for the complete script template. Copy it to `/tmp/`, replace the URL placeholder, and run with `node`.

### Phase 3: WCAG Compliance (axe-core CLI) ~5s

```bash
npx @axe-core/cli "$URL" --exit 2>/dev/null
```

Adds color contrast ratio checking that Playwright DOM inspection can't reliably detect. Structured violation report with fix guidance.

**Graceful degradation:** Skipped if `@axe-core/cli` is not installed. Report notes it was skipped.

### Phase 4: Performance (Lighthouse CLI) ~15s

```bash
npx lighthouse "$URL" \
  --output=json \
  --output-path=/tmp/browser-qa-lighthouse.json \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=performance,accessibility,best-practices \
  --quiet 2>/dev/null
```

Core Web Vitals: FCP, LCP, TBT, CLS. Identifies render-blocking resources, unoptimized images, missing lazy loading.

**Graceful degradation:** Skipped if `lighthouse` is not installed. Report notes it was skipped.

## Running Tests

### Step 1: Determine the target URL

If `$ARGUMENTS` contains a URL, use it. Otherwise, detect running dev servers:
```bash
for port in 3000 3001 4321 5173 8080 8788 8787; do
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port" 2>/dev/null | grep -q "200" && echo "Found: http://localhost:$port"
done
```

### Step 2: Parse mode from arguments

Check `$ARGUMENTS` for flags:
- `--quick` → Run Phase 1 only, report, done
- `--responsive` → Run all phases at each viewport (see Responsive Testing)
- `--from-verify` → Run Phase 1 + Phase 2 (errors/network only), output JSON
- `--spec <file> --generate-tests` → Switch to Spec-Driven Testing Mode
- `--codebase --generate-tests` → Switch to Codebase-Driven Test Generation Mode
- `--run-tests` → Run previously generated tests from `tests/qa/`
- `--coverage` → Show coverage report from last test run
- No flags → Full QA pass (Phases 1-4)

### Step 3: Execute phases

Run the appropriate phases based on mode. For full QA:

1. **Phase 1 (smoke):** Run agent-browser commands. If critical errors (page won't load), report and stop.
2. **Phase 2 (deep scan):** Copy `${CLAUDE_SKILL_DIR}/scripts/playwright-qa.mjs` to `/tmp/browser-qa-test.mjs`, replace URL, run with `node`. Parse JSON output.
3. **Phase 3 (axe-core):** Run `npx @axe-core/cli` if available.
4. **Phase 4 (Lighthouse):** Run `npx lighthouse` if available.

### Step 4: Report results

Format output as:

```
## Browser QA Report: [URL]

### Phase 1: Smoke Check
- Status: PASS/FAIL
- Console errors: N
- Network errors: N

### Phase 2: Deep Scan
- [CRITICAL] Page error: TypeError: Cannot read properties of undefined
- [ERROR] Network 404: /static/missing-image.png
- [SECURITY] Secrets in HTML comments: API_KEY found
- [A11Y] Image missing alt: /img/hero.png
- [WARNING] Font too small (10px): "Terms and conditions..."

### Phase 3: WCAG Compliance (axe-core)
- Violations: N
- color-contrast: 3 instances
- image-alt: 1 instance
(or: Skipped — @axe-core/cli not installed)

### Phase 4: Performance (Lighthouse)
- Performance: 45/100
- Accessibility: 72/100
- Best Practices: 85/100
- FCP: 2.1s | LCP: 4.5s | TBT: 350ms | CLS: 0.15
(or: Skipped — lighthouse not installed)

### Summary
- Critical: N | Errors: N | Warnings: N | Security: N | A11Y: N | Perf: N
- Screenshot: /tmp/browser-qa-screenshot.png
```

Classify each issue:
- **CRITICAL**: Page crashes, uncaught errors, data loss risks
- **ERROR**: Failed resources, broken functionality
- **WARNING**: Deprecation warnings, minor issues
- **SECURITY**: Vulnerabilities, exposed secrets
- **A11Y**: Accessibility violations
- **PERF**: Performance issues
- **INFO**: Tracking events (informational)

## --quick Mode

Runs Phase 1 only via agent-browser. Completes in ~3 seconds. Use for fast "does it load?" checks.

```bash
agent-browser open <URL>
agent-browser errors
agent-browser console
agent-browser screenshot /tmp/browser-qa-quick.png
agent-browser close
```

Report: pass/fail with error count and screenshot path.

## --from-verify Mode (verify-change integration)

Lightweight mode for consumption by the verify-change skill. Runs:
- Phase 1 (smoke)
- Phase 2 (errors + network only — skip security/visual/interactive)

Returns structured JSON to stdout:
```json
{
  "pass": false,
  "errors": [
    {"severity": "CRITICAL", "category": "js-error", "message": "TypeError: ..."},
    {"severity": "ERROR", "category": "network", "message": "404: /api/missing"}
  ],
  "warnings": [
    {"severity": "WARNING", "category": "console", "message": "Deprecation warning..."}
  ],
  "screenshot": "/tmp/browser-qa-verify.png",
  "duration_ms": 4200
}
```

Total time target: <5s.

## Responsive Testing

When `--responsive` is passed, run the full QA pass at each viewport:

| Device | Width | Height |
|--------|-------|--------|
| iPhone SE | 375 | 667 |
| iPhone 14 | 393 | 852 |
| iPad | 768 | 1024 |
| Desktop | 1440 | 900 |
| Desktop HD | 1920 | 1080 |

For each viewport, additionally check:
- Horizontal overflow (content wider than viewport)
- Font sizes (minimum 16px on mobile recommended)
- Touch targets (minimum 44x44px on mobile)
- Element visibility (nothing hidden by media query gaps)
- Navigation accessibility (hamburger menu if used)

Use the `--viewport` flag on playwright-qa.mjs for each size:
```bash
node /tmp/browser-qa-test.mjs <URL> --viewport 375x667
node /tmp/browser-qa-test.mjs <URL> --viewport 393x852
# ... etc
```

## Spec-Driven Testing Mode

When invoked with `--spec <file> --generate-tests`:

1. Read the spec file (SPEC.md, requirements doc, user story, PRD)
2. Extract each testable acceptance criterion
3. For each criterion, generate a Playwright test script using role-based locators:
   - Navigation assertions (correct URL after action)
   - Content assertions (expected text/elements visible)
   - Network assertions (correct API calls made)
   - Error assertions (no console errors during flow)
4. Save generated tests to `tests/qa/` directory
5. Report: "Generated N test scripts from spec. Run with: `npx playwright test tests/qa/`"

Reference: `${CLAUDE_SKILL_DIR}/references/spec-driven-testing.md`

## Codebase-Driven Test Generation Mode

When invoked with `--codebase --generate-tests`:

**Framework-agnostic route discovery** — tries all strategies, uses what matches:

```
Strategy 1: File-based routing (most frameworks)
  - pages/**/*.{html,tsx,jsx,vue,svelte,astro}
  - app/**/page.{tsx,jsx}
  - src/routes/**/*.{tsx,jsx,svelte}
  - src/pages/**/*

Strategy 2: Config-based routing
  - Read router config files if they exist (react-router, vue-router, etc.)
  - Parse route patterns from code

Strategy 3: Sitemap / link crawling
  - If a dev server is running, crawl from / and follow all internal links
  - Build route map from actual navigation
```

**For each discovered page:**
1. Read the source file (if available) to identify:
   - Forms (inputs, buttons, submission endpoints)
   - Links (navigation targets)
   - API calls (fetch, axios — extract endpoint URLs)
   - Interactive elements (modals, dropdowns, tabs)
2. Generate a Playwright test covering:
   - Page loads without console errors
   - All images/resources load (no 404s)
   - Forms are fillable and submittable
   - Links navigate to correct pages
   - Console output matches expected patterns

Save tests to `tests/qa/` and output a coverage report.

Reference: `${CLAUDE_SKILL_DIR}/references/codebase-scanning.md`

## User Flow Generation

When `--codebase --generate-tests` runs, it also generates user flow tests:

1. Start at the homepage (or entry point)
2. Identify all navigation links → build edges
3. For each page, identify where forms submit to, what API calls are made, where auth redirects go
4. Generate test scripts for each distinct path:

```
Flow 1: Homepage → Products → Product Detail → Add to Cart → Checkout
Flow 2: Homepage → Login → Dashboard → Settings → Logout
Flow 3: Homepage → Search → Results → Product Detail
Flow 4: Login (invalid) → Error → Login (valid) → Dashboard
```

Each flow test includes:
- **Navigation assertions** — correct URL after each step
- **Content assertions** — expected elements visible
- **Network assertions** — expected API calls with status checks
- **Console assertions** — no errors, expected debug logs present
- **Timing** — no step takes >5s

Reference: `${CLAUDE_SKILL_DIR}/references/user-flows.md`

## Coverage Tracking

After test generation or test runs, display coverage metrics:

```
Route coverage:  12/15 pages have tests (80%)
Form coverage:   3/4 forms tested (75%)
Link coverage:   28/35 links verified (80%)
API coverage:    5/8 endpoints tested (63%)
Overall:         72% coverage
```

Reference: `${CLAUDE_SKILL_DIR}/references/coverage-tracking.md`

## Interactive Testing Details

For pages with user interaction (login flows, multi-step forms), the Phase 2 script:

1. Finds all visible buttons and clickable elements
2. Clicks each one (one at a time), checks for new console errors after each click
3. Finds all form inputs, fills with appropriate test data:
   - Email fields → `qa-test@example.com`
   - Password fields → `TestPassword123!`
   - Text fields → `QA Test Input`
   - Number fields → `42`
4. Submits forms and verifies responses (no 5xx, no new errors)
5. Tracks URL changes and verifies navigation targets
6. Resets to original page state between tests

## Framework-Specific Extensions

The core skill is intentionally framework-agnostic. For framework-specific checks, create separate extension skills:

- **Next.js:** SSR validation, API route testing, middleware checks
- **Astro:** Island hydration, content collection validation
- **Cloudflare Workers:** D1 query logs, wrangler tail, KV/R2 checks
- **Vue/Nuxt:** Vuex store state, Nuxt modules, SSR hydration
- **Svelte/SvelteKit:** Store reactivity, load functions, SSR

Reference: `${CLAUDE_SKILL_DIR}/references/extending.md`

## When NOT to Use This Skill

- For backend-only changes (use unit tests instead)
- For API testing without a browser (use curl/httpie)
- For load/stress testing (use k6)
- For visual design review from mockups (use screenshot comparison)
- For framework-specific backend checks (use framework extensions)
