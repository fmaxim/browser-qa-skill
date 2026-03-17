/**
 * Test Web App Server
 *
 * A local web server with intentional bugs for browser automation tool testing.
 * Each route covers a specific use case (UC-1 through UC-14).
 *
 * Usage: node tests/test-app/server.js
 * Default port: 3099
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.TEST_PORT || 3099;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Simple session store (in-memory)
const sessions = new Map();

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    cookies[name] = rest.join('=');
  });
  return cookies;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS headers (intentionally too permissive for UC-8)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  // Intentionally MISSING Content-Security-Policy for UC-8

  // --- API Routes ---

  // UC-5: BI Events endpoint
  if (path === '/api/track') {
    const body = await collectBody(req);
    const event = JSON.parse(body || '{}');
    console.log(`[TRACK] ${event.event_name || 'unknown'}:`, JSON.stringify(event));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', received: event }));
    return;
  }

  // UC-5: Pixel endpoint (GET-based tracking)
  if (path === '/pixel.gif') {
    console.log(`[PIXEL] params:`, url.searchParams.toString());
    // Return 1x1 transparent GIF
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif' });
    res.end(gif);
    return;
  }

  // UC-4: Slow image endpoint
  if (path === '/api/slow-image') {
    await new Promise(r => setTimeout(r, 5000));
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif' });
    res.end(gif);
    return;
  }

  // UC-4: Malformed JSON endpoint
  if (path === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"items": [{"id": 1, "name": "Test"'); // Intentionally malformed
    return;
  }

  // UC-4: Working API endpoint
  if (path === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      products: [
        { id: 1, name: 'Widget A', price: 29.99 },
        { id: 2, name: 'Widget B', price: 49.99 },
      ]
    }));
    return;
  }

  // UC-6: Debug info endpoint
  if (path === '/api/debug-info') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Debug-Info': 'cache=MISS;db_time=342ms;error=null_user_segment',
      'X-Request-Id': 'req-' + Date.now(),
    });
    res.end(JSON.stringify({
      debug: {
        user_segment: null, // Intentional bug: should be set
        experiment_variant: 'control', // Bug: user should be in "treatment"
        feature_flags: { new_checkout: true, dark_mode: false },
        server_time: new Date().toISOString(),
        cache_hit: false,
      }
    }));
    return;
  }

  // UC-7: Login endpoint
  if (path === '/api/login' && req.method === 'POST') {
    const body = await collectBody(req);
    const { email, password } = JSON.parse(body || '{}');

    // Intentional bug: accepts empty password
    if (email) {
      const sessionId = generateSessionId();
      sessions.set(sessionId, { email, loggedIn: true });

      // Intentional bugs: missing HttpOnly and Secure flags
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionId}; Path=/; SameSite=Lax`, // Missing HttpOnly, Secure
      });
      res.end(JSON.stringify({ success: true, token: sessionId, redirect: `/dashboard?token=${sessionId}` }));
      // Bug: token in URL query parameter
      return;
    }

    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
    return;
  }

  // UC-7: Protected dashboard API
  if (path === '/api/user') {
    const cookies = parseCookies(req.headers.cookie);
    const session = sessions.get(cookies.session);
    // Intentional bug: this endpoint works WITHOUT auth too (returns default data)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: session ? { email: session.email, role: 'admin' } : { email: 'anonymous', role: 'guest' },
      authenticated: !!session,
    }));
    return;
  }

  // UC-8: Open redirect
  if (path === '/redirect') {
    const target = url.searchParams.get('url');
    if (target) {
      res.writeHead(302, { Location: target }); // Bug: no validation
      res.end();
      return;
    }
  }

  // UC-8: Error endpoint that leaks stack trace
  if (path === '/api/error') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      stack: 'Error: DB connection failed\n    at connectDB (/app/src/db.js:42:11)\n    at processRequest (/app/src/server.js:156:5)',
      dbHost: 'prod-db.internal:5432',
      dbUser: 'app_admin',
    }));
    return;
  }

  // UC-9: Performance - render-blocking CSS
  if (path === '/slow-styles.css') {
    await new Promise(r => setTimeout(r, 3000)); // 3s delay
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end('body { font-family: Arial, sans-serif; } .delayed-section { background: #f0f0f0; padding: 20px; }');
    return;
  }

  // --- Static file serving ---

  // Serve pages directory
  if (path === '/' || path === '/index.html') {
    return serveFile(res, join(__dirname, 'pages', 'index.html'));
  }

  // Map page routes to HTML files
  const pageRoutes = {
    '/ui': 'uc1-ui-integrity.html',
    '/js-errors': 'uc2-js-errors.html',
    '/navigation': 'uc3-navigation.html',
    '/navigation/page-a': 'uc3-page-a.html',
    '/navigation/page-b': 'uc3-page-b.html',
    '/network': 'uc4-network.html',
    '/tracking': 'uc5-tracking.html',
    '/debug': 'uc6-debug.html',
    '/login': 'uc7-login.html',
    '/dashboard': 'uc7-dashboard.html',
    '/security': 'uc8-security.html',
    '/performance': 'uc9-performance.html',
    '/memory': 'uc10-memory.html',
    '/responsive': 'uc11-responsive.html',
    '/slow-network': 'uc12-slow-network.html',
    '/accessibility': 'uc13-accessibility.html',
    '/bad-ecommerce': 'uc14-bad-ecommerce.html',
    '/bad-dashboard': 'uc14-bad-dashboard.html',
    '/bad-landing': 'uc14-bad-landing.html',
  };

  if (pageRoutes[path]) {
    return serveFile(res, join(__dirname, 'pages', pageRoutes[path]));
  }

  // Serve static assets
  if (path.startsWith('/static/')) {
    return serveFile(res, join(__dirname, path));
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<html><body><h1>404 Not Found</h1><p>The page you requested does not exist.</p></body></html>');
});

async function serveFile(res, filepath) {
  try {
    const content = await readFile(filepath);
    const ext = extname(filepath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/html' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>404</h1></body></html>');
  }
}

function collectBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

server.listen(PORT, () => {
  console.log(`Test app running at http://localhost:${PORT}`);
  console.log('Pages:');
  console.log('  /           - Index (all use cases)');
  console.log('  /ui         - UC-1: Visual & UI Integrity');
  console.log('  /js-errors  - UC-2: JavaScript Errors');
  console.log('  /navigation - UC-3: Navigation & User Flows');
  console.log('  /network    - UC-4: Network & Resource Loading');
  console.log('  /tracking   - UC-5: BI Events & Pixel Tracking');
  console.log('  /debug      - UC-6: Debug Console Logging');
  console.log('  /login      - UC-7: Authentication Flow');
  console.log('  /security   - UC-8: Security Testing');
  console.log('  /performance- UC-9: Performance & Web Vitals');
  console.log('  /memory     - UC-10: CPU & Memory');
  console.log('  /responsive - UC-11: Device Emulation');
  console.log('  /slow-network - UC-12: Network Conditions');
  console.log('  /accessibility - UC-13: Accessibility');
});
