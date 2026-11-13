const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8765;
const serverProcess = spawn('node', ['server.js'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'pipe'
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${urlPath}`, {
      headers: { 'Host': `127.0.0.1:${PORT}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function run() {
  console.log('Starting server.js for security tests...');
  // Wait up to 5s for server to listen
  let up = false;
  for (let i = 0; i < 20; i++) {
    await wait(250);
    try {
      const res = await request('/index.html');
      if (res.status === 200) {
        up = true;
        break;
      }
    } catch (_) {}
  }

  if (!up) {
    console.error('Failed to start server.js');
    serverProcess.kill();
    process.exit(1);
  }

  console.log('Server is up. Running security test cases...');

  const tests = [
    { name: 'Legitimate index.html should be served', path: '/index.html', expectBlocked: false },
    { name: 'Blocked config.json should be rejected', path: '/config.json', expectBlocked: true },
    { name: 'Windows 8.3 SFN CONFIG~1.JSO must NOT leak config.json', path: '/CONFIG~1.JSO', expectBlocked: true },
    { name: 'Windows 8.3 SFN lowercase config~1.jso must NOT leak config.json', path: '/config~1.jso', expectBlocked: true },
    { name: 'Windows 8.3 SFN node_modules access NODE_M~1 must be blocked', path: '/NODE_M~1/ws/package.json', expectBlocked: true },
    { name: 'Trailing dot config.json. must be rejected', path: '/config.json.', expectBlocked: true },
    { name: 'Trailing space config.json%20 must be rejected', path: '/config.json%20', expectBlocked: true },
    { name: 'Blocked script server.ps1 must be rejected', path: '/server.ps1', expectBlocked: true },
  ];

  let failed = 0;
  for (const t of tests) {
    try {
      const res = await request(t.path);
      const isBlocked = (res.status === 404 || res.status === 400 || res.status === 403);
      if (t.expectBlocked && !isBlocked) {
        console.error(`[FAIL] ${t.name} (Expected blocked, got status ${res.status}, length: ${res.data.length})`);
        failed++;
      } else if (!t.expectBlocked && isBlocked) {
        console.error(`[FAIL] ${t.name} (Expected 200 OK, got status ${res.status})`);
        failed++;
      } else {
        console.log(`[PASS] ${t.name} (Status: ${res.status})`);
      }
    } catch (err) {
      console.error(`[ERROR] ${t.name}:`, err.message);
      failed++;
    }
  }

  serverProcess.kill('SIGKILL');
  console.log(`\nTests finished: ${tests.length - failed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  serverProcess.kill();
  process.exit(1);
});
