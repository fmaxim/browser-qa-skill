# Codebase-Driven Route Discovery

Framework-agnostic strategies for discovering routes in any web project. The skill tries all strategies and uses whichever matches.

## Strategy 1: File-Based Routing

Most modern frameworks use file-based routing. Glob for page files:

```bash
# Next.js (App Router)
app/**/page.{tsx,jsx,ts,js}
app/**/layout.{tsx,jsx,ts,js}

# Next.js (Pages Router)
pages/**/*.{tsx,jsx,ts,js}

# Astro
src/pages/**/*.{astro,md,mdx}

# SvelteKit
src/routes/**/+page.{svelte,ts,js}

# Nuxt
pages/**/*.vue

# Remix
app/routes/**/*.{tsx,jsx,ts,js}

# Plain HTML
**/*.html
pages/**/*.html
public/**/*.html

# Generic (catches most frameworks)
pages/**/*.{html,tsx,jsx,vue,svelte,astro}
src/pages/**/*
src/routes/**/*
```

### Mapping file paths to URL routes

| Framework | File Path | Route |
|-----------|-----------|-------|
| Next.js App | `app/about/page.tsx` | `/about` |
| Next.js Pages | `pages/about.tsx` | `/about` |
| Astro | `src/pages/about.astro` | `/about` |
| SvelteKit | `src/routes/about/+page.svelte` | `/about` |
| Nuxt | `pages/about.vue` | `/about` |
| Plain HTML | `about.html` or `about/index.html` | `/about` |

**Dynamic segments:** `[id]`, `[...slug]`, `{param}` → skip these for basic testing, or use sample values.

## Strategy 2: Config-Based Routing

Some apps define routes in code rather than files:

```bash
# React Router
grep -r "Route\|createBrowserRouter\|path:" src/ --include="*.{tsx,jsx,ts,js}" | grep -o 'path[=:]\s*["'"'"'][^"'"'"']*["'"'"']'

# Vue Router
grep -r "path:" src/router/ --include="*.{ts,js}" | grep -o "path:\s*'[^']*'"

# Express routes (API)
grep -r "app\.\(get\|post\|put\|delete\)\|router\.\(get\|post\|put\|delete\)" --include="*.{ts,js}" | grep -o "'[^']*'"
```

## Strategy 3: Sitemap / Link Crawling

If a dev server is running, crawl from the root:

```javascript
// Playwright crawl script pattern
const visited = new Set();
const toVisit = ['/'];
const routes = [];

while (toVisit.length > 0) {
  const path = toVisit.shift();
  if (visited.has(path)) continue;
  visited.add(path);

  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  routes.push({ path, title: await page.title(), status: 'ok' });

  // Extract all internal links
  const links = await page.$$eval('a[href]', anchors =>
    anchors
      .map(a => new URL(a.href, window.location.origin).pathname)
      .filter(href => href.startsWith('/') && !href.includes('.'))
  );

  for (const link of new Set(links)) {
    if (!visited.has(link)) toVisit.push(link);
  }
}
```

Also check for `sitemap.xml`:
```bash
curl -s "${BASE_URL}/sitemap.xml" 2>/dev/null | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g'
```

## Extracting Page Components

For each discovered page, read the source file and identify:

### Forms
```bash
grep -n '<form\|<input\|<textarea\|<select\|onSubmit\|handleSubmit\|action=' "$file"
```

### Links
```bash
grep -n '<a\s\|<Link\s\|href=\|to=\|navigate(' "$file"
```

### API Calls
```bash
grep -n 'fetch(\|axios\.\|useSWR\|useQuery\|\.get(\|\.post(' "$file"
```

### Interactive Elements
```bash
grep -n 'onClick\|onPress\|modal\|dropdown\|tab\|accordion\|dialog\|popover' "$file"
```

## Test Generation Template

For each discovered page, generate:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Page: /about', () => {
  test('loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('/about');
    await page.waitForLoadState('domcontentloaded');
    expect(errors).toHaveLength(0);
  });

  test('all resources load (no 404s)', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', res => { if (res.status() >= 400) failed.push(`${res.status()}: ${res.url()}`); });
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    expect(failed).toHaveLength(0);
  });

  // Generated per-form test
  test('contact form is fillable and submittable', async ({ page }) => {
    await page.goto('/about');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Message').fill('QA test message');
    await page.getByRole('button', { name: /submit|send/i }).click();
    // Verify no error after submit
    await expect(page.locator('.error')).not.toBeVisible();
  });
});
```
