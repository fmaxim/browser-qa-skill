#!/usr/bin/env node
/**
 * Browser QA - Playwright Test Script
 *
 * Comprehensive browser testing: errors, network, security, accessibility, visual quality,
 * interactive testing (click buttons, fill forms, follow links).
 * Outputs JSON results to stdout.
 *
 * Usage:
 *   node playwright-qa.mjs <url> [--screenshot <path>] [--viewport <WxH>] [--from-verify] [--interactive]
 *
 * Modes:
 *   default         Full deep scan (Phase 2) with all checks
 *   --from-verify   Errors + network only, structured JSON for verify-change
 *   --interactive   Enable interactive testing (click buttons, fill forms)
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find(a => a.startsWith('http')) || args[0];
const screenshotIdx = args.indexOf('--screenshot');
const screenshotPath = screenshotIdx > -1 ? args[screenshotIdx + 1] : '/tmp/browser-qa-screenshot.png';
const viewportIdx = args.indexOf('--viewport');
const viewportStr = viewportIdx > -1 ? args[viewportIdx + 1] : '1440x900';
const [vw, vh] = viewportStr.split('x').map(Number);
const fromVerify = args.includes('--from-verify');
const interactive = args.includes('--interactive');

if (!url) {
  console.error('Usage: node playwright-qa.mjs <url> [--screenshot <path>] [--viewport <WxH>] [--from-verify] [--interactive]');
  process.exit(1);
}

const startTime = Date.now();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await context.newPage();

  const issues = [];
  const networkRequests = [];
  const trackingCalls = [];
  const corsWildcardUrls = new Set();

  // === LISTENERS (set up BEFORE navigation) ===

  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') issues.push({ severity: 'ERROR', category: 'console', message: text });
    else if (type === 'warning') issues.push({ severity: 'WARNING', category: 'console', message: text });
    if (/\[ERROR\]/i.test(text)) issues.push({ severity: 'ERROR', category: 'app-log', message: text });
    if (/\[WARN\]/i.test(text)) issues.push({ severity: 'WARNING', category: 'app-log', message: text });
  });

  page.on('pageerror', err => {
    issues.push({ severity: 'CRITICAL', category: 'js-error', message: err.message });
  });

  page.on('requestfailed', req => {
    issues.push({ severity: 'ERROR', category: 'network', message: `Failed: ${req.url()} - ${req.failure()?.errorText || 'unknown'}` });
  });

  page.on('response', async res => {
    const reqUrl = res.url();
    const status = res.status();
    const method = res.request().method();
    networkRequests.push({ url: reqUrl, status, method });

    if (status >= 500) {
      issues.push({ severity: 'ERROR', category: 'network', message: `Server error ${status}: ${reqUrl}` });
      // Check 5xx response bodies for stack traces and credential leaks
      try {
        const body = await res.text();
        if (/at\s+\w+\s+\(.*:\d+:\d+\)/.test(body) || /Traceback\s+\(most recent/i.test(body)) {
          issues.push({ severity: 'SECURITY', category: 'security', message: `Stack trace leaked in error response: ${reqUrl}` });
        }
        if (/password|secret|credential|connection.?string|dbHost|dbUser/i.test(body)) {
          issues.push({ severity: 'SECURITY', category: 'security', message: `Credentials leaked in error response: ${reqUrl}` });
        }
      } catch { /* body may not be available */ }
    } else if (status >= 400) {
      issues.push({ severity: 'ERROR', category: 'network', message: `${status}: ${method} ${reqUrl}` });
    }

    // Check CORS headers on ALL responses
    try {
      const acao = res.headers()['access-control-allow-origin'];
      if (acao === '*' && !corsWildcardUrls.has(reqUrl)) {
        corsWildcardUrls.add(reqUrl);
        issues.push({ severity: 'SECURITY', category: 'security', message: `CORS wildcard (Access-Control-Allow-Origin: *) on: ${reqUrl}` });
      }
    } catch { /* headers may not be available */ }

    // Track BI events and pixels
    if (reqUrl.includes('/api/track') || reqUrl.includes('/pixel') || reqUrl.includes('/analytics') || reqUrl.includes('/collect') || reqUrl.includes('/events')) {
      trackingCalls.push({ url: reqUrl, status, method });
      issues.push({ severity: 'INFO', category: 'tracking', message: `${method} ${reqUrl} -> ${status}` });
    }
  });

  // === NAVIGATE ===
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    issues.push({ severity: 'CRITICAL', category: 'navigation', message: `Failed to load: ${err.message}` });
    const duration_ms = Date.now() - startTime;
    if (fromVerify) {
      console.log(JSON.stringify({
        pass: false,
        errors: issues.filter(i => ['CRITICAL', 'ERROR'].includes(i.severity)),
        warnings: issues.filter(i => i.severity === 'WARNING'),
        screenshot: screenshotPath,
        duration_ms,
      }));
    } else {
      console.log(JSON.stringify({ url, issues, error: true, duration_ms }));
    }
    await browser.close();
    return;
  }

  // Wait for delayed JS errors
  await page.waitForTimeout(2500);

  // === FROM-VERIFY MODE: skip security/visual/interactive, return early ===
  if (fromVerify) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const duration_ms = Date.now() - startTime;
    const errors = issues.filter(i => ['CRITICAL', 'ERROR'].includes(i.severity));
    const warnings = issues.filter(i => i.severity === 'WARNING');
    console.log(JSON.stringify({
      pass: errors.length === 0,
      errors,
      warnings,
      screenshot: screenshotPath,
      duration_ms,
    }));
    await browser.close();
    return;
  }

  // === ACCESSIBILITY, VISUAL, SECURITY CHECKS (DOM inspection) ===
  const domIssues = await page.evaluate(() => {
    const found = [];

    // --- Helper: WCAG contrast ratio ---
    function parseCSSColor(str) {
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : null;
    }
    function sRGBtoLinear(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    function luminance(rgb) {
      return 0.2126 * sRGBtoLinear(rgb[0]) + 0.7152 * sRGBtoLinear(rgb[1]) + 0.0722 * sRGBtoLinear(rgb[2]);
    }
    function contrastRatio(c1, c2) {
      const l1 = luminance(c1), l2 = luminance(c2);
      const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // === ACCESSIBILITY ===

    // Images without alt
    document.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('alt')) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: `Image missing alt: ${img.src?.substring(0, 80)}` });
      }
    });

    // Inputs without labels (placeholder alone is NOT a valid label)
    document.querySelectorAll('input:not([type=hidden]), textarea, select').forEach(input => {
      const id = input.id;
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      const closest = input.closest('label');
      if (!label && !closest && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: `Input without label (type=${input.type}${input.placeholder ? ', has placeholder only' : ''})` });
      }
    });

    // Buttons without accessible names
    document.querySelectorAll('button, [role=button]').forEach(btn => {
      if (!btn.textContent.trim() && !btn.getAttribute('aria-label') && !btn.getAttribute('title')) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: 'Button with no accessible name' });
      }
    });

    // role="button" elements missing keyboard accessibility
    document.querySelectorAll('[role=button]').forEach(el => {
      if (el.tagName !== 'BUTTON') {
        if (!el.hasAttribute('tabindex') || el.tabIndex < 0) {
          found.push({ severity: 'A11Y', category: 'accessibility', message: `role="button" on <${el.tagName.toLowerCase()}> not keyboard reachable (missing tabindex): "${el.textContent.trim().substring(0, 30)}"` });
        }
        if (!el.hasAttribute('onkeydown') && !el.hasAttribute('onkeypress') && !el.hasAttribute('onkeyup')) {
          found.push({ severity: 'A11Y', category: 'accessibility', message: `role="button" on <${el.tagName.toLowerCase()}> has no keyboard handler: "${el.textContent.trim().substring(0, 30)}"` });
        }
      }
    });

    // Touch targets too small
    document.querySelectorAll('button, a, [role=button], input[type=submit]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < 30 && rect.height < 30) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: `Touch target too small (${Math.round(rect.width)}x${Math.round(rect.height)}px): ${el.textContent?.trim()?.substring(0, 30) || el.tagName}` });
      }
    });

    // Missing skip-to-content link
    const allFocusable = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
    const firstFocusable = allFocusable[0];
    const hasSkipLink = firstFocusable && firstFocusable.tagName === 'A' && firstFocusable.getAttribute('href')?.startsWith('#');
    if (!hasSkipLink && document.querySelectorAll('nav, header').length > 0) {
      found.push({ severity: 'A11Y', category: 'accessibility', message: 'Missing skip-to-content link (WCAG 2.4.1)' });
    }

    // Color contrast ratio (WCAG AA requires 4.5:1 for normal text, 3:1 for large)
    const contrastChecked = new Set();
    document.querySelectorAll('p, span, div, li, td, th, button, a, h1, h2, h3, h4, label').forEach(el => {
      const text = el.textContent.trim();
      if (!text || text.length < 2) return;
      // Only check leaf-ish nodes to avoid double-counting
      if (el.children.length > 3) return;
      const style = getComputedStyle(el);
      const fg = parseCSSColor(style.color);
      const bg = parseCSSColor(style.backgroundColor);
      if (!fg || !bg) return;
      if (style.backgroundColor === 'rgba(0, 0, 0, 0)') return; // transparent bg
      const key = `${style.color}|${style.backgroundColor}`;
      if (contrastChecked.has(key)) return;
      contrastChecked.add(key);
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(style.fontSize);
      const isBold = parseInt(style.fontWeight) >= 700 || style.fontWeight === 'bold';
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
      const threshold = isLarge ? 3 : 4.5;
      if (ratio < threshold) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: `Low contrast ${ratio.toFixed(1)}:1 (need ${threshold}:1) — ${style.color} on ${style.backgroundColor}: "${text.substring(0, 30)}"` });
      }
    });

    // === VISUAL QUALITY ===

    // Font too small
    document.querySelectorAll('p, span, div, li, td, th, label').forEach(el => {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12 && el.textContent.trim().length > 10) {
        found.push({ severity: 'WARNING', category: 'visual', message: `Font too small (${size}px): "${el.textContent.trim().substring(0, 40)}"` });
      }
    });

    // Invisible text (same fg/bg color)
    document.querySelectorAll('button, .badge, span, a, div, p, h1, h2, h3').forEach(el => {
      const style = getComputedStyle(el);
      if (style.color === style.backgroundColor && el.textContent.trim() && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        found.push({ severity: 'WARNING', category: 'visual', message: `Invisible text (same color as bg) on ${el.tagName}: "${el.textContent.trim().substring(0, 30)}"` });
      }
    });

    // Horizontal overflow (page level)
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 5) {
      found.push({ severity: 'WARNING', category: 'layout', message: `Horizontal scroll detected (content ${document.documentElement.scrollWidth}px > viewport ${document.documentElement.clientWidth}px)` });
    }

    // Content clipped by overflow:hidden
    document.querySelectorAll('div, section, article, aside, main').forEach(el => {
      const style = getComputedStyle(el);
      if (style.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 10 && el.clientWidth > 0) {
        found.push({ severity: 'WARNING', category: 'layout', message: `Content clipped by overflow:hidden (${el.scrollWidth}px in ${el.clientWidth}px container)` });
      }
    });

    // Multiple / bad font families
    const fonts = new Set();
    document.querySelectorAll('h1,h2,h3,p,span,div,button,a').forEach(el => {
      const font = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      if (el.textContent.trim()) fonts.add(font);
    });
    if (fonts.size > 3) {
      found.push({ severity: 'WARNING', category: 'visual', message: `Too many font families (${fonts.size}): ${[...fonts].join(', ')}` });
    }
    const badFonts = ['Comic Sans MS', 'Papyrus', 'Impact'];
    fonts.forEach(f => {
      if (badFonts.includes(f)) found.push({ severity: 'WARNING', category: 'visual', message: `Unprofessional font "${f}"` });
    });

    // Interactive elements with pointer-events:none (looks clickable but isn't)
    document.querySelectorAll('button, a, [role=button], input[type=submit]').forEach(el => {
      if (getComputedStyle(el).pointerEvents === 'none') {
        found.push({ severity: 'WARNING', category: 'visual', message: `Interactive element has pointer-events:none: "${el.textContent?.trim()?.substring(0, 30) || el.tagName}"` });
      }
    });

    // Buttons with cursor:default (looks non-interactive)
    document.querySelectorAll('button, [role=button], input[type=submit]').forEach(el => {
      if (getComputedStyle(el).cursor === 'default') {
        found.push({ severity: 'WARNING', category: 'visual', message: `Button has cursor:default (looks unclickable): "${el.textContent?.trim()?.substring(0, 30) || el.tagName}"` });
      }
    });

    // Stretched images (aspect ratio mismatch)
    document.querySelectorAll('img').forEach(img => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0 && img.width > 0 && img.height > 0) {
        const naturalRatio = img.naturalWidth / img.naturalHeight;
        const displayRatio = img.width / img.height;
        if (Math.abs(naturalRatio - displayRatio) > 0.2) {
          found.push({ severity: 'WARNING', category: 'visual', message: `Stretched image (natural ${img.naturalWidth}x${img.naturalHeight}, displayed ${img.width}x${img.height}): ${img.src?.substring(0, 60)}` });
        }
      }
    });

    // Deprecated HTML elements
    const deprecatedTags = ['marquee', 'blink', 'center', 'font'];
    for (const tag of deprecatedTags) {
      const els = document.querySelectorAll(tag);
      if (els.length > 0) {
        found.push({ severity: 'WARNING', category: 'visual', message: `Deprecated HTML element <${tag}> used (${els.length} instance${els.length > 1 ? 's' : ''})` });
      }
    }

    // Seizure-risk animations (blink, rapid flash)
    const allStyles = [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules]; } catch { return []; }
    });
    for (const rule of allStyles) {
      if (rule.type === CSSRule.KEYFRAMES_RULE && /blink|flash/i.test(rule.name)) {
        found.push({ severity: 'A11Y', category: 'accessibility', message: `Seizure-risk animation detected: @keyframes ${rule.name}` });
      }
    }

    // Negative letter-spacing causing character collision
    document.querySelectorAll('h1, h2, h3, h4, p, span, a, button').forEach(el => {
      const ls = parseFloat(getComputedStyle(el).letterSpacing);
      if (ls < -1 && el.textContent.trim().length > 3) {
        found.push({ severity: 'WARNING', category: 'visual', message: `Negative letter-spacing (${ls}px) causes character collision: "${el.textContent.trim().substring(0, 30)}"` });
      }
    });

    // Sibling element overlap (e.g. transform:scale causing overlap)
    document.querySelectorAll('.pricing-card, .card, .product-card, [class*=card], [class*=pricing]').forEach(el => {
      const rect = el.getBoundingClientRect();
      const next = el.nextElementSibling;
      if (next) {
        const nextRect = next.getBoundingClientRect();
        if (rect.right > nextRect.left + 5 && rect.top < nextRect.bottom && rect.bottom > nextRect.top) {
          found.push({ severity: 'WARNING', category: 'layout', message: `Element overlaps sibling (${Math.round(rect.right - nextRect.left)}px overlap): "${el.textContent.trim().substring(0, 20)}"` });
        }
      }
    });

    // Z-index issues: modal/overlay stacking
    const overlays = document.querySelectorAll('[class*=overlay], [class*=backdrop], [class*=mask]');
    const modals = document.querySelectorAll('[class*=modal], [class*=dialog], [role=dialog]');
    overlays.forEach(overlay => {
      const overlayZ = parseInt(getComputedStyle(overlay).zIndex) || 0;
      modals.forEach(modal => {
        const modalZ = parseInt(getComputedStyle(modal).zIndex) || 0;
        if (overlayZ > 0 && modalZ > 0 && modalZ < overlayZ) {
          found.push({ severity: 'WARNING', category: 'layout', message: `Modal (z-index:${modalZ}) behind overlay (z-index:${overlayZ}) — modal content unreachable` });
        }
      });
    });

    // === SECURITY: Secrets in HTML ===
    const html = document.documentElement.innerHTML;

    const secretPatterns = [
      { re: /API_KEY\s*[=:]\s*["']?[\w-]{8,}/i, name: 'API_KEY' },
      { re: /DB_PASSWORD\s*[=:]\s*["']?[\w-]{3,}/i, name: 'DB_PASSWORD' },
      { re: /SECRET_KEY\s*[=:]\s*["']?[\w-]{8,}/i, name: 'SECRET_KEY' },
      { re: /sk-test[-_][\w-]{5,}/, name: 'Stripe test key' },
      { re: /sk-live[-_][\w-]{5,}/, name: 'Stripe live key' },
      { re: /AKIA[0-9A-Z]{16}/, name: 'AWS access key' },
      { re: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub token' },
      { re: /password\s*[=:]\s*["'][^"']{3,}["']/i, name: 'hardcoded password' },
    ];
    for (const { re, name } of secretPatterns) {
      if (re.test(html)) {
        found.push({ severity: 'SECURITY', category: 'security', message: `Secret found in HTML: ${name}` });
      }
    }

    // eval() on user input
    if (/eval\s*\(/.test(html) && /searchParams|location\.search|location\.hash|document\.referrer/.test(html)) {
      found.push({ severity: 'SECURITY', category: 'security', message: 'eval() on URL parameter detected (XSS risk)' });
    }

    // innerHTML with user input
    if (/innerHTML/.test(html) && /searchParams|location\.search|location\.hash|document\.referrer/.test(html)) {
      found.push({ severity: 'SECURITY', category: 'security', message: 'innerHTML with URL parameter (XSS risk)' });
    }

    // Open redirects
    const openRedirectPattern = /(?:redirect|return|next|url|goto|destination)\s*=\s*(?:(?:https?:\/\/)|(?:\/\/))/i;
    if (openRedirectPattern.test(window.location.search) || openRedirectPattern.test(html)) {
      found.push({ severity: 'SECURITY', category: 'security', message: 'Potential open redirect detected' });
    }

    // Auth tokens in URL query params
    const urlParams = new URLSearchParams(window.location.search);
    for (const [key] of urlParams) {
      if (/token|auth|session|api.?key|secret|password/i.test(key)) {
        found.push({ severity: 'SECURITY', category: 'security', message: `Auth-related parameter in URL: ${key}` });
      }
    }

    return found;
  });
  issues.push(...domIssues);

  // === MEMORY LEAK DETECTION (CDP heap comparison) ===
  if (interactive) {
    try {
      const cdp = await context.newCDPSession(page);
      // Force GC and measure heap before
      await cdp.send('HeapProfiler.collectGarbage');
      const metricsBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize);

      // Click buttons that might leak
      const leakButtons = await page.$$('button:visible');
      for (const btn of leakButtons.slice(0, 5)) {
        try {
          await btn.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(200);
        } catch { /* skip */ }
      }

      // Force GC and measure heap after
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(500);
      const metricsAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize);

      if (metricsBefore && metricsAfter) {
        const growth = metricsAfter - metricsBefore;
        const growthMB = (growth / 1024 / 1024).toFixed(1);
        // Flag if heap grew by more than 5MB after clicking a few buttons
        if (growth > 5 * 1024 * 1024) {
          issues.push({ severity: 'WARNING', category: 'performance', message: `Potential memory leak: heap grew ${growthMB}MB after clicking buttons` });
        }
      }

      // Check for accumulating event listeners via CDP
      const doc = await cdp.send('DOM.getDocument');
      const body = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'body' });
      if (body.nodeId) {
        const listeners = await cdp.send('DOMDebugger.getEventListeners', { objectId: (await cdp.send('DOM.resolveNode', { nodeId: body.nodeId })).object.objectId, depth: -1 });
        // Pages with >50 listeners on window/body are suspicious
        const windowListeners = listeners.listeners?.filter(l => l.type === 'resize' || l.type === 'scroll') || [];
        if (windowListeners.length > 10) {
          issues.push({ severity: 'WARNING', category: 'performance', message: `Possible event listener leak: ${windowListeners.length} resize/scroll listeners on body` });
        }
      }

      await cdp.detach();
    } catch { /* CDP memory detection is best-effort */ }
  }

  // === SECURITY: Response headers (main page) ===
  try {
    const headerResponse = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (headerResponse) {
      const headers = headerResponse.headers();
      if (!headers['content-security-policy']) {
        issues.push({ severity: 'SECURITY', category: 'security', message: 'Missing Content-Security-Policy header' });
      }
      if (headers['x-powered-by']) {
        issues.push({ severity: 'SECURITY', category: 'security', message: `Server leaks technology via X-Powered-By: ${headers['x-powered-by']}` });
      }
    }
  } catch { /* ignore header check navigation errors */ }

  // === SECURITY: Cookies ===
  const cookies = await context.cookies();
  for (const cookie of cookies) {
    if (cookie.name === 'session' || cookie.name.includes('auth') || cookie.name.includes('token') || cookie.name.includes('sid')) {
      if (!cookie.httpOnly) issues.push({ severity: 'SECURITY', category: 'security', message: `Cookie "${cookie.name}" missing HttpOnly flag` });
      if (!cookie.secure) issues.push({ severity: 'SECURITY', category: 'security', message: `Cookie "${cookie.name}" missing Secure flag` });
    }
  }

  // === TRACKING: Duplicate detection ===
  if (trackingCalls.length > 0) {
    const urls = trackingCalls.map(t => t.url);
    const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
    if (dupes.length > 0) {
      issues.push({ severity: 'WARNING', category: 'tracking', message: `Duplicate tracking call: ${dupes[0]}` });
    }
  }

  // === INTERACTIVE TESTING ===
  if (interactive) {
    // Click visible buttons (skip navigation links to avoid leaving page)
    const buttons = await page.$$('button:visible, [role=button]:visible');
    for (const button of buttons.slice(0, 10)) {
      try {
        const text = await button.textContent();
        const errCountBefore = issues.length;
        await button.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        if (issues.length > errCountBefore) {
          const newIssues = issues.slice(errCountBefore);
          for (const issue of newIssues) {
            issue.message = `[After clicking "${(text || '').trim().substring(0, 20)}"] ${issue.message}`;
          }
        }
      } catch { /* skip unclickable buttons */ }
    }

    // Fill forms with test data
    const forms = await page.$$('form');
    for (const form of forms.slice(0, 5)) {
      try {
        const inputs = await form.$$('input:visible, textarea:visible, select:visible');
        for (const input of inputs) {
          const type = await input.getAttribute('type') || 'text';
          const name = await input.getAttribute('name') || '';
          try {
            if (type === 'email' || name.includes('email')) {
              await input.fill('qa-test@example.com');
            } else if (type === 'password' || name.includes('password')) {
              await input.fill('TestPassword123!');
            } else if (type === 'number') {
              await input.fill('42');
            } else if (type === 'tel') {
              await input.fill('5551234567');
            } else if (type === 'url') {
              await input.fill('https://example.com');
            } else if (type === 'text' || type === 'search') {
              await input.fill('QA Test Input');
            }
          } catch { /* skip non-fillable inputs */ }
        }

        const submitBtn = await form.$('button[type=submit], input[type=submit]');
        if (submitBtn) {
          try {
            await submitBtn.click({ timeout: 3000 });
            await page.waitForTimeout(1000);
          } catch { /* submit might navigate away */ }
        }
      } catch { /* skip broken forms */ }
    }

    // Navigate back if we left the original page
    const currentUrl = page.url();
    if (currentUrl !== url) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch { /* ignore */ }
    }
  }

  // === FOCUS TRAP DETECTION (after interactive, modals may now be open) ===
  try {
    const visibleModals = await page.$$('[class*=modal]:visible, [role=dialog]:visible, [id*=modal]:visible');
    for (const modal of visibleModals) {
      const isVisible = await modal.isVisible();
      if (!isVisible) continue;
      const closeBtn = await modal.$('button[class*=close], button[aria-label*=close], button[aria-label*=Close], [class*=close]');
      const hasEscHandler = await modal.evaluate(el => {
        return el.hasAttribute('onkeydown') || el.hasAttribute('onkeyup') ||
          el.closest('[onkeydown]') !== null || el.closest('[onkeyup]') !== null;
      });
      if (!closeBtn && !hasEscHandler) {
        issues.push({ severity: 'A11Y', category: 'accessibility', message: 'Focus trap: modal/dialog has no close button and no Escape key handler' });
      }
    }

    // Also check hidden modals in DOM that have no escape mechanism
    const allModals = await page.$$('[class*=modal], [role=dialog], [id*=modal]');
    for (const modal of allModals) {
      const hasCloseBtn = await modal.$('button[class*=close], button[aria-label*=close], button[aria-label*=Close], [class*=close], button[title*=close]');
      const hasEsc = await modal.evaluate(el => {
        const html = el.innerHTML;
        return /keydown|keyup|Escape|escape/.test(html) || el.hasAttribute('onkeydown');
      });
      const hasFocusableInputs = await modal.$$('input, textarea, select, button');
      if (hasFocusableInputs.length > 1 && !hasCloseBtn && !hasEsc) {
        const alreadyReported = issues.some(i => i.message.includes('Focus trap'));
        if (!alreadyReported) {
          issues.push({ severity: 'A11Y', category: 'accessibility', message: 'Focus trap: modal/dialog has no close button and no Escape key handler' });
        }
      }
    }
  } catch { /* focus trap detection is best-effort */ }

  // === SCREENSHOT ===
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // === OUTPUT ===
  const duration_ms = Date.now() - startTime;
  const summary = {
    url,
    viewport: `${vw}x${vh}`,
    timestamp: new Date().toISOString(),
    duration_ms,
    issues,
    counts: {
      critical: issues.filter(i => i.severity === 'CRITICAL').length,
      error: issues.filter(i => i.severity === 'ERROR').length,
      warning: issues.filter(i => i.severity === 'WARNING').length,
      security: issues.filter(i => i.severity === 'SECURITY').length,
      a11y: issues.filter(i => i.severity === 'A11Y').length,
      info: issues.filter(i => i.severity === 'INFO').length,
    },
    networkRequests: networkRequests.length,
    trackingCalls: trackingCalls.length,
    failedRequests: networkRequests.filter(r => r.status >= 400).length,
    screenshot: screenshotPath,
  };

  console.log(JSON.stringify(summary));
  await browser.close();
})();
