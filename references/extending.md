# Extending browser-qa with Framework-Specific Skills

The core `browser-qa` skill is intentionally framework-agnostic — it only uses the browser, Playwright, axe-core, and Lighthouse. For framework-specific checks, create a separate extension skill.

## When to Create an Extension

Create a framework extension when you need to:
- Query a framework-specific backend (D1, Prisma, Supabase)
- Use a framework CLI (`wrangler`, `next`, `astro`, `nuxt`)
- Check framework-specific runtime behavior (SSR hydration, island hydration, server components)
- Validate framework config files
- Read framework-specific logs

## Extension Skill Structure

```
~/.claude/skills/browser-qa-{framework}/
├── SKILL.md          # Extension skill definition
└── references/       # Framework-specific docs (optional)
```

## SKILL.md Template

```yaml
---
name: browser-qa-{framework}
description: "{Framework} extension for browser-qa. Adds {specific checks}. Use after /browser-qa for framework-specific validation."
user-invocable: true
argument-hint: [url]
---

# browser-qa-{framework}

Extends browser-qa with {Framework}-specific checks.

**Prerequisites:** Run `/browser-qa <url>` first for general QA. This extension adds checks that require {framework CLI/backend access}.

## Additional Checks

### Check 1: {Name}
{Description of what this checks and how}

### Check 2: {Name}
{Description}

## Usage

After running `/browser-qa <url>`, run this for framework-specific validation:
\```
/browser-qa-{framework} <url>
\```
```

## Example Extensions

### browser-qa-nextjs

Additional checks:
- **SSR validation:** Fetch page with `curl` (no JS) and compare content to Playwright render — detect hydration mismatches
- **API routes:** `curl` each `/api/*` endpoint, check responses
- **Middleware:** Test redirect/rewrite rules by requesting known paths
- **Server Components:** Check that server-only code doesn't leak to client bundle

### browser-qa-astro

Additional checks:
- **Island hydration:** Verify `client:*` directives work — interactive elements are clickable after hydration
- **Content collections:** Validate all collection entries render without errors
- **Build output:** Check `dist/` for expected files, no missing assets
- **View transitions:** Test navigation with view transitions enabled

### browser-qa-cloudflare

Additional checks:
- **D1 logs:** Query `system_logs` table for recent errors
- **Worker tail:** Run `wrangler tail` briefly to capture live errors
- **KV/R2:** Verify storage bindings are accessible
- **Cron triggers:** Check that scheduled triggers ran recently

### browser-qa-vue / browser-qa-nuxt

Additional checks:
- **Vuex/Pinia state:** Inspect store state after page load
- **Nuxt modules:** Verify module-injected features work
- **SSR hydration:** Compare server-rendered HTML to client hydration

### browser-qa-svelte / browser-qa-sveltekit

Additional checks:
- **Store reactivity:** Verify Svelte stores update UI correctly
- **Load functions:** Test SvelteKit `load()` data fetching
- **SSR:** Compare server-rendered output to client

## Integration Pattern

An extension skill can call the core `browser-qa` Playwright script and add its own checks:

```bash
# 1. Run core browser-qa first (if not already run)
# 2. Then run framework-specific checks:

# Example: Cloudflare D1 log check
npx wrangler d1 execute $DB_NAME --remote --json \
  --command "SELECT level, message FROM system_logs WHERE level = 'error' AND created_at > datetime('now', '-1 hour') LIMIT 20"

# Example: Next.js SSR check
curl -s "$URL" | diff - <(node -e "
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('$URL');
    console.log(await page.content());
    await browser.close();
  })()
")
```

## Keeping Extensions Framework-Agnostic-Compatible

Extensions should:
1. **Never modify the core skill** — extend, don't patch
2. **Report in the same format** — use the same severity levels (CRITICAL/ERROR/WARNING/SECURITY/A11Y/PERF)
3. **Be optional** — the core skill works without any extensions installed
4. **Document prerequisites** — what CLIs, access, or config the extension needs
