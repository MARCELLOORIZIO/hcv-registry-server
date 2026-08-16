const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

for (const token of [
  "const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'DN9W7Z3HCZ';",
  "url.pathname === '/.well-known/apple-app-site-association'",
  "url.pathname === '/apple-app-site-association'",
  "webcredentials:",
  "paths: ['/verify/*', '/v/*']",
  "'Content-Type': 'application/json'",
]) {
  if (!source.includes(token)) {
    throw new Error(`Missing Apple associated-domain contract token: ${token}`);
  }
}

console.log('Apple associated-domain contract OK');
