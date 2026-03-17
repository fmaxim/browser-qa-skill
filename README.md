# browser-qa

**A Claude Code skill that turns "check the page" into a real QA pass.**

## The Problem

AI coding agents are great at writing code but terrible at verifying it works in a real browser. The typical loop:

1. Agent writes code
2. Agent says "it should work"
3. You open the browser and find: console errors, a tracking pixel firing twice, a 404 on an image, an XSS vulnerability, invisible text, a form that accepts empty passwords

These aren't edge cases — they're the bugs that ship to production because **no one ran a real QA pass**.

Unit tests don't catch network failures, accessibility violations, security issues, or visual bugs. You need a browser. But knowing which tool to use, how to combine them, and how to interpret results is too much friction. Most developers skip it entirely.

**browser-qa** eliminates that friction. One command, four tools, 100% detection across 8 bug categories.

## What It Catches

Every category verified at **100% detection** against an 88-bug test app (99 automated assertions, all passing):

| Category | What It Detects |
|----------|----------------|
| **Network** | 404 images, 500 errors, slow responses (>3s), CORS failures, malformed JSON |
| **BI / Tracking** | Duplicate tracking pixels, missing required fields, empty payloads |
| **Console Logging** | [ERROR] and [WARN] app logs buried in noise, deprecation warnings |
| **JavaScript Errors** | TypeError, ReferenceError, unhandled promise rejections, memory leak indicators via CDP heap profiling |
| **Security** | XSS (eval + innerHTML on user input), secrets in HTML (API keys, Stripe keys, AWS keys, hardcoded passwords), open redirects, CORS wildcards on any response, missing CSP, auth tokens in URLs, cookie flags (HttpOnly, Secure), stack trace and credential leaks in API error responses |
| **Accessibility** | Missing alt text, placeholder-only inputs (not a valid label), WCAG AA contrast ratios (luminance-based, 4.5:1 / 3:1), unnamed buttons, keyboard-inaccessible `role="button"`, missing skip-to-content link, seizure-risk animations (`@keyframes blink`), focus traps in modals (no close button or Escape handler) |
| **Visual Quality** | Comic Sans / Papyrus / Impact, invisible text, low contrast, `cursor:default` on buttons, deprecated HTML (`<marquee>`, `<blink>`), stretched images (aspect ratio mismatch), `pointer-events:none` on interactive elements, `overflow:hidden` clipping content, negative `letter-spacing` causing character collision, sibling element overlap from `transform:scale` |
| **UI Integrity** | Missing CSS/font 404s, `pointer-events:none` on buttons, `overflow:hidden` clipping, z-index stacking bugs (modal behind overlay), stretched images |

## How It Works

Four phases, each using the best tool for the job:

| Phase | Tool | Time | What It Does |
|-------|------|------|-------------|
| 1. Smoke | agent-browser | ~3s | Opens the page, captures crashes and obvious errors |
| 2. Deep Scan | Playwright | ~5s | Console, network, security, accessibility, visual, interactive testing, CDP memory profiling |
| 3. WCAG | axe-core | ~5s | WCAG 2.1 AA compliance scan (auto-skipped if not installed) |
| 4. Performance | Lighthouse | ~15s | Core Web Vitals — FCP, LCP, TBT, CLS (auto-skipped if not installed) |

Works with **any** web framework — React, Next.js, Astro, Vue, Svelte, plain HTML, or anything that renders in a browser. No coupling to specific backends, databases, or CLIs.

## Prerequisites

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js 18+** | Runtime for Playwright scripts | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Playwright** | Core browser automation (Phase 2) | `npm install playwright` |
| **Chromium browser** | Headless browser for testing | `npx playwright install chromium` |

### Recommended

These tools add additional detection capabilities. The skill works without them but produces more thorough results with them.

| Tool | Purpose | Phase | Install |
|------|---------|-------|---------|
| **agent-browser** | Fast smoke testing (Phase 1) | 1 | `npm install -g agent-browser` |
| **@axe-core/cli** | WCAG 2.1 AA compliance scanning | 3 | `npm install -g @axe-core/cli` |
| **lighthouse** | Core Web Vitals performance audit | 4 | `npm install -g lighthouse` |

### One-line setup

```bash
# Install everything
npm install playwright && npx playwright install chromium
npm install -g agent-browser @axe-core/cli lighthouse
```

If you skip the recommended tools, the skill will note which phases were skipped in the report:
```
### Phase 3: WCAG Compliance (axe-core)
Skipped — @axe-core/cli not installed. Install with: npm install -g @axe-core/cli
```

## Install the Skill

### Plugin install (easiest)
```bash
/plugin install fmaxim/browser-qa-skill
```

### Symlink (recommended for contributing)
```bash
git clone https://github.com/fmaxim/browser-qa-skill.git ~/code/browser-qa
ln -s ~/code/browser-qa ~/.claude/skills/browser-qa
```

### Project-local
```bash
cp -r browser-qa .claude/skills/browser-qa
```

## Use Cases

### After deploying a change
You just pushed a feature. Before telling the team it's done:
```
/browser-qa http://localhost:3000
```
Full QA pass in ~15 seconds. Catches the 404 on the image you forgot to commit, the console error from a renamed function, the missing CORS header.

### Quick sanity check during development
You're iterating on a component and want a fast "does it break anything?":
```
/browser-qa http://localhost:3000 --quick
```
Smoke test only — ~3 seconds. Just errors and crashes, nothing fancy.

### Testing across devices
Your designer asks "does it work on mobile?":
```
/browser-qa http://localhost:3000 --responsive
```
Runs the full QA at 5 viewports (iPhone SE, iPhone 14, iPad, Desktop, Desktop HD). Catches horizontal overflow, touch targets too small, fonts unreadable on mobile.

### Security review before launch
Product wants a security check before going live:
```
/browser-qa https://staging.myapp.com
```
Checks secrets in HTML (API keys, Stripe keys, AWS keys), XSS vectors, open redirects, CORS wildcards on every response, missing CSP, auth tokens in URLs, cookie flags, stack trace and credential leaks in API error responses.

### Write acceptance tests before coding (TDD)
You have a spec and want tests first:
```
/browser-qa --spec SPEC.md --generate-tests
```
Reads your spec, extracts testable criteria, generates Playwright test files. After implementation, run them to verify everything works.

### Generate tests from an existing codebase
You inherited a project with no tests:
```
/browser-qa --codebase --generate-tests
```
Discovers routes (file-based routing, config parsing, or link crawling), finds forms and API calls, generates Playwright tests for each page. Shows coverage: "12/15 pages tested (80%), 3/4 forms tested (75%)".

### Automated verification in CI-like workflows
The `verify-change` skill needs a fast browser check:
```
/browser-qa http://localhost:3000 --from-verify
```
Returns structured JSON (`{pass: true/false, errors: [...], duration_ms: 4200}`) for machine consumption. Phase 1+2 only, completes in <5 seconds.

### Accessibility audit
An accessibility review is needed for compliance:
```
/browser-qa http://localhost:3000
```
Phase 2 runs WCAG AA contrast ratio checks (luminance-based, 4.5:1 threshold), placeholder-only input detection, `role="button"` keyboard accessibility, skip-to-content link checks, seizure-risk animation detection, and focus trap detection. Phase 3 adds axe-core for deeper WCAG scanning.

### Just tell Claude what you need
You don't have to remember the flags. Natural language works:
- "Check the page for errors"
- "Run QA on the site"
- "Test accessibility on the dashboard"
- "Are there any security issues?"
- "Generate tests for this project"

The skill triggers automatically when Claude detects browser testing intent.

## All Modes

```bash
/browser-qa <url>                           # Full QA pass (Phases 1-4)
/browser-qa <url> --quick                   # Smoke only (~3s)
/browser-qa <url> --responsive              # Full QA at 5 viewports
/browser-qa <url> --from-verify             # Lightweight JSON output for automation
/browser-qa --spec SPEC.md --generate-tests # Generate tests from requirements doc
/browser-qa --codebase --generate-tests     # Generate tests from existing code
/browser-qa --run-tests                     # Run previously generated tests
/browser-qa --coverage                      # Show test coverage report
```

## Testing

The test infrastructure ships with the skill. Every detection claim in this README is backed by an automated test you can run.

### Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start the test app (88 intentional bugs across 20 pages)
npm run test-app &

# 3. Run the full test suite (79 assertions)
npm test

# 4. Run the codebase/spec generation tests (20 assertions)
npm run test:codebase

# 5. Run everything
npm run test:all
```

### Test suites

| Suite | Assertions | What It Validates |
|-------|:----------:|-------------------|
| `test-suite.mjs` | 79 | All UC pages (security, a11y, visual, UI integrity, network, tracking, debug, JS errors), --from-verify, --interactive with CDP memory/focus trap, viewports, output format |
| `codebase-test.mjs` | 20 | Route discovery (3 strategies), test generation, spec parsing, coverage tracking, flow detection |
| **Total** | **99** | **100% pass rate** |

### Test app

`tests/test-app/` is a self-contained Node.js web server with intentional bugs across 20 pages:

| Route | What's Broken |
|-------|--------------|
| `/js-errors` | TypeError on load, unhandled promises, ReferenceError in click handler, deprecation warnings, memory leak (event listeners) |
| `/network` | 404 images, 500 errors, malformed JSON, slow responses (5s) |
| `/tracking` | Duplicate pixels, missing fields, empty payloads |
| `/debug` | null user_segment, wrong experiment variant |
| `/login` | Empty password accepted, cookies missing HttpOnly/Secure |
| `/security` | XSS (eval + innerHTML), secrets in HTML (API key, DB password, Stripe key), open redirect, CORS wildcard, stack trace leak in /api/error |
| `/performance` | Render-blocking CSS (3s delay), layout shift, no lazy loading |
| `/responsive` | Horizontal overflow, 20px hamburger button, 10px font, missing skip-to-content |
| `/accessibility` | Missing alt, placeholder-only inputs, low contrast (1.3:1), role=button without keyboard, focus trap modal, unnamed buttons |
| `/bad-ecommerce` | Comic Sans, invisible button text, low contrast footer, cursor:default buttons, deprecated `<marquee>` |
| `/bad-dashboard` | Invisible badge text, low contrast sidebar (2:1), small fonts |
| `/bad-landing` | Impact/Papyrus/Comic Sans (10 fonts), seizure-risk `@keyframes blink`, near-invisible footer (1.3:1), negative letter-spacing, transform:scale overlap |
| `/ui` | pointer-events:none button, overflow:hidden clipping, stretched image, z-index modal behind overlay, broken font/CSS 404s |

Plus 7 more pages covering navigation flows, auth, memory, and parallel execution.

### Evaluations

`evals/evals.json` contains 7 prompts for end-to-end skill evaluation via the Skill Creator framework:

| Eval | Tests |
|------|-------|
| JS errors page | TypeError detection, deprecation warnings |
| Security QA | Secrets, CORS, CSP detection (3+ issues) |
| Visual quality | Font problems, invisible text, actionable recommendations |
| `--quick` mode | agent-browser used, pass/fail reported, no Lighthouse |
| `--codebase` mode | Route discovery, test generation, coverage metrics |
| `--responsive` mode | Multi-viewport testing, responsive-specific issues |
| `--from-verify` mode | Structured JSON output, error identification |

```bash
/skill-creator eval browser-qa
```

### Contributing tests

Add a new test case in 4 steps:

1. Create an HTML page in `tests/test-app/pages/` with intentional bugs
2. Add the route to `tests/test-app/server.js`
3. Add assertions in `tests/test-suite.mjs`
4. Run `npm test`

## Framework Extensions

The core skill is framework-agnostic by design. For checks that need framework CLIs or backend access, create separate extension skills. See `references/extending.md` for the pattern:

- `browser-qa-nextjs` — SSR validation, API routes, middleware
- `browser-qa-astro` — Island hydration, content collections
- `browser-qa-cloudflare` — D1 logs, wrangler tail, KV/R2

## Project Structure

```
browser-qa/
├── SKILL.md                         # Skill definition (loaded by Claude Code)
├── package.json                     # npm test, test:codebase, test-app
├── scripts/
│   └── playwright-qa.mjs            # Playwright QA script (Phase 2)
├── references/
│   ├── codebase-scanning.md         # Route discovery strategies
│   ├── coverage-tracking.md         # Coverage metrics format
│   ├── extending.md                 # Framework extension guide
│   ├── responsive-devices.md        # Viewport presets
│   ├── spec-driven-testing.md       # Spec-to-test patterns
│   └── user-flows.md               # Flow graph generation
├── tests/
│   ├── test-suite.mjs              # 79 assertions
│   ├── codebase-test.mjs           # 20 assertions
│   └── test-app/                   # 20 pages, 88 bugs
├── evals/
│   └── evals.json                  # 7 eval prompts
├── .claude-plugin/
│   └── plugin.json
├── LICENSE
└── README.md
```

## Background

This skill came from a research project that cataloged and tested 37 browser automation tools available in the Claude Code ecosystem (March 2026). Key findings:

1. **No single tool covers everything.** agent-browser is fast but can't inspect DOM. Playwright catches network issues but not performance. Lighthouse measures Web Vitals but not security. You need to combine them.
2. **The consensus is "Playwright for the 80%, AI for the 20%."** Traditional automation handles reliable, repeatable checks. AI fills gaps for dynamic, context-dependent verification.
3. **Most Claude Code users don't run browser verification at all.** The tools exist, but the friction of knowing which tool to use and how to interpret results is too high.

The full research, tool comparison matrix, and raw test results are in the [browser-auto-agents](https://github.com/fmaxim/browser-auto-agents) companion repo.

## License

MIT
