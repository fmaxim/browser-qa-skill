# User Flow Generation

Build a navigation graph from the codebase and generate end-to-end flow tests.

## Building the Flow Graph

### Step 1: Discover entry points

Start from the homepage (`/`) and any pages linked from the main navigation.

### Step 2: Build edges

For each page, identify:
- **Navigation links** → `<a href>`, `<Link to>`, `router.push()`, `navigate()`
- **Form submissions** → where the form `action` points, or the `fetch()` endpoint
- **Auth redirects** → login redirects, auth guards that redirect to `/login`
- **API-triggered navigation** → `window.location` changes after API calls

### Step 3: Identify distinct flows

A flow is a path through the graph that represents a real user journey:

```
Flow types:
1. Happy path    — main conversion funnel (browse → select → purchase)
2. Auth flow     — login/signup → authenticated area → logout
3. Error flow    — invalid input → error state → recovery
4. Search flow   — search → results → detail page
5. Settings flow — dashboard → settings → save → confirmation
```

## Flow Test Template

```typescript
import { test, expect } from '@playwright/test';

test.describe('Flow: Browse to Purchase', () => {
  test('user can browse products and reach checkout', async ({ page }) => {
    // Step 1: Homepage
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);

    // Step 2: Navigate to products
    await page.getByRole('link', { name: /products|shop|browse/i }).click();
    await expect(page).toHaveURL(/.*products/);

    // Step 3: Select a product
    await page.locator('.product-card').first().click();
    await expect(page).toHaveURL(/.*product\//);

    // Step 4: Add to cart
    await page.getByRole('button', { name: /add to cart/i }).click();

    // Step 5: Go to checkout
    await page.getByRole('link', { name: /cart|checkout/i }).click();
    await expect(page).toHaveURL(/.*cart|.*checkout/);
  });
});
```

## Flow Assertions

Each flow step should verify:

| Check | Assertion | Why |
|-------|-----------|-----|
| URL changed | `expect(page).toHaveURL(...)` | Navigation actually happened |
| Content visible | `expect(locator).toBeVisible()` | Page rendered correctly |
| No console errors | Check error count didn't increase | No JS crashes |
| Expected API calls | Monitor network for expected endpoints | Backend integration works |
| Timing | Each step completes in <5s | No performance regression |

## Error Flow Pattern

```typescript
test('invalid login shows error and allows retry', async ({ page }) => {
  // Step 1: Go to login
  await page.goto('/login');

  // Step 2: Submit invalid credentials
  await page.getByLabel('Email').fill('wrong@example.com');
  await page.getByLabel('Password').fill('wrongpassword');
  await page.getByRole('button', { name: /login|sign in/i }).click();

  // Step 3: Error is shown
  await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible();

  // Step 4: User can retry (form is still accessible)
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: /login|sign in/i })).toBeEnabled();
});
```

## Generating Flows Automatically

The codebase scanner identifies flows by:

1. **Entry point detection** — pages with no incoming links (homepage, landing pages)
2. **Exit point detection** — pages with no outgoing links (confirmation, thank you)
3. **Path enumeration** — BFS from entry to exit, keeping paths under 10 steps
4. **Priority** — rank by number of shared edges (popular paths first)

Output: one test file per flow in `tests/qa/flows/`.
