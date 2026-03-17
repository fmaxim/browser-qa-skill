# Coverage Tracking

Track what percentage of the application's testable surface is covered by generated tests.

## Metrics

| Metric | Numerator | Denominator |
|--------|-----------|-------------|
| Route coverage | Pages with at least one test | Total discovered pages |
| Form coverage | Forms with fill+submit tests | Total forms found in codebase |
| Link coverage | Links verified by navigation tests | Total internal links |
| API coverage | API endpoints tested | Total API endpoints found |
| Flow coverage | User flows with E2E tests | Total identified flows |

## Collecting Counts

### Routes (denominator)
From codebase scanning — count all discovered page files/routes.

### Forms (denominator)
```bash
# Count forms across all page files
grep -rl '<form\|<Form\|handleSubmit\|onSubmit' src/ pages/ app/ --include="*.{tsx,jsx,vue,svelte,astro,html}" | wc -l
```

### Links (denominator)
```bash
# Count unique internal link targets
grep -roh 'href="\/[^"]*"' src/ pages/ app/ --include="*.{tsx,jsx,vue,svelte,astro,html}" | sort -u | wc -l
```

### API endpoints (denominator)
```bash
# Count unique fetch/axios endpoints
grep -roh "fetch(['\"]\/api\/[^'\"]*['\"])\|axios\.\w\+(['\"]\/api\/[^'\"]*['\"])" src/ --include="*.{tsx,jsx,ts,js}" | sort -u | wc -l
```

## Coverage Report Format

```
=== Browser QA Coverage Report ===

Route coverage:   12/15 pages have tests        (80%)
Form coverage:     3/4  forms tested             (75%)
Link coverage:    28/35 links verified           (80%)
API coverage:      5/8  endpoints tested         (63%)
Flow coverage:     4/6  user flows covered       (67%)

Overall coverage: 72%

Uncovered routes:
  - /admin/settings (no test)
  - /api/webhook (no test)
  - /checkout/confirm (no test)

Uncovered forms:
  - /contact (contact form not tested)

Uncovered APIs:
  - POST /api/payment
  - DELETE /api/account
  - PUT /api/settings
```

## Storing Coverage Data

Coverage data is saved to `tests/qa/.coverage.json`:

```json
{
  "timestamp": "2026-03-17T18:42:00Z",
  "routes": { "covered": 12, "total": 15, "uncovered": ["/admin/settings", "/api/webhook", "/checkout/confirm"] },
  "forms": { "covered": 3, "total": 4, "uncovered": ["/contact"] },
  "links": { "covered": 28, "total": 35 },
  "apis": { "covered": 5, "total": 8, "uncovered": ["POST /api/payment", "DELETE /api/account", "PUT /api/settings"] },
  "flows": { "covered": 4, "total": 6 },
  "overall": 72
}
```

## Improving Coverage

When coverage is low, the skill suggests:
1. Which uncovered pages are highest priority (most traffic, most complex)
2. Which forms handle user data (should be tested first)
3. Which API endpoints are write operations (highest risk)
