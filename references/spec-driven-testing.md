# Spec-Driven Testing Reference

## The Pattern

1. **Spec phase**: Human writes requirements (SPEC.md, user story, PRD)
2. **Test generation**: AI generates Playwright tests from the spec
3. **Implementation**: Developer builds the feature
4. **Validation**: Run the pre-generated tests to verify implementation

## Generating Tests from Spec

When given a spec, extract each testable acceptance criterion and generate a test:

### Input: Spec Acceptance Criteria
```markdown
## User Login
- User can enter email and password
- Clicking "Login" with valid credentials redirects to /dashboard
- Clicking "Login" with invalid credentials shows error message
- Empty email field shows validation error
- Session persists across page refresh
```

### Output: Playwright Tests
```typescript
import { test, expect } from '@playwright/test';

test('login with valid credentials redirects to dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('valid@example.com');
  await page.getByLabel('Password').fill('validPassword123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/.*dashboard/);
});

test('login with invalid credentials shows error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('wrong@example.com');
  await page.getByLabel('Password').fill('wrongPassword');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText(/invalid|error|failed/i)).toBeVisible();
});

test('empty email shows validation error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByLabel('Email')).toBeFocused();
});
```

## Best Practices

- Use role-based locators (`getByRole`, `getByLabel`, `getByText`) not CSS selectors
- One assertion per test when possible
- Test both happy path and error paths
- Include network assertions for API-dependent features
- Add `test.describe()` blocks matching spec sections
- Save tests to `tests/qa/` directory with descriptive filenames

## Playwright Agents Integration

If Playwright Agents (v1.56+) are available:
```bash
npx playwright init-agents --loop=claude
```

This creates Planner/Generator/Healer agents that automate the spec-to-test workflow.
