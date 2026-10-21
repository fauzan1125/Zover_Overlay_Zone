const http = require('http');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function killProcess(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${child.pid} >nul 2>nul`);
    } else {
      child.kill('SIGKILL');
    }
  } catch (_) {}
}

function makePostRequest(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${parsed.port}`,
        'Host': `127.0.0.1:${parsed.port}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 5000
    };

    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out (hang)'));
    });

    req.write(data);
    req.end();
  });
}

function makeGetRequest(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Host': `127.0.0.1:${parsed.port}`
      },
      timeout: 5000
    };

    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.end();
  });
}

async function run() {
  console.log('--- TEST 1: POST /api/upload?filename=%zz (Normal module state) ---');
  const server1 = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
  await sleep(1500);

  try {
    const res1 = await makePostRequest('http://127.0.0.1:8765/api/upload?filename=%zz', 'dummy data');
    console.log('[PROBE 1 RESULT] Status:', res1.statusCode);
    console.log('[PROBE 1 RESULT] Body:', res1.body);
    const parsed = JSON.parse(res1.body);
    if (parsed.status === 'ok' && parsed.url && parsed.url.includes('media_')) {
      console.log('[PROBE 1 PASS] Correctly fallback to media_ timestamp bin and responded JSON!');
    } else {
      console.error('[PROBE 1 FAIL] Unexpected body structure:', res1.body);
    }
  } catch (err) {
    console.error('[PROBE 1 ERROR]', err);
  } finally {
    killProcess(server1);
    await sleep(1000);
  }

  console.log('\n--- TEST 2: Missing tiktok-live-connector simulation ---');
  const originalDir = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector');
  const tempDir = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector_TEMP');

  let renamed = false;
  if (fs.existsSync(originalDir)) {
    fs.renameSync(originalDir, tempDir);
    renamed = true;
    console.log('[TEST 2 SETUP] Renamed tiktok-live-connector to temporary path');
  }

  let server2;
  try {
    server2 = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
    await sleep(1500);

    const res2 = await makeGetRequest('http://127.0.0.1:8765/api/config');
    console.log('[PROBE 2 RESULT] GET /api/config Status:', res2.statusCode);
    if (res2.statusCode === 200) {
      console.log('[PROBE 2 PASS] Server is alive and returned HTTP 200 without tiktok-live-connector!');
    } else {
      console.error('[PROBE 2 FAIL] Unexpected status:', res2.statusCode);
    }
  } catch (err) {
    console.error('[PROBE 2 ERROR]', err);
  } finally {
    killProcess(server2);
    await sleep(1000);
    if (renamed && fs.existsSync(tempDir)) {
      fs.renameSync(tempDir, originalDir);
      console.log('[TEST 2 TEARDOWN] Restored tiktok-live-connector to original path');
    }
  }

  console.log('\n--- TEST 3: Missing ws module simulation ---');
  const originalWsDir = path.join(__dirname, '..', 'node_modules', 'ws');
  const tempWsDir = path.join(__dirname, '..', 'node_modules', 'ws_TEMP');

  let renamedWs = false;
  if (fs.existsSync(originalWsDir)) {
    fs.renameSync(originalWsDir, tempWsDir);
    renamedWs = true;
    console.log('[TEST 3 SETUP] Renamed ws to temporary path');
  }

  let server3;
  try {
    server3 = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
    await sleep(1500);

    const res3 = await makeGetRequest('http://127.0.0.1:8765/api/config');
    console.log('[PROBE 3 RESULT] GET /api/config Status:', res3.statusCode);
    if (res3.statusCode === 200) {
      console.log('[PROBE 3 PASS] Server is alive and returned HTTP 200 without ws module!');
    } else {
      console.error('[PROBE 3 FAIL] Unexpected status:', res3.statusCode);
    }
  } catch (err) {
    console.error('[PROBE 3 ERROR]', err);
  } finally {
    killProcess(server3);
    await sleep(1000);
    if (renamedWs && fs.existsSync(tempWsDir)) {
      fs.renameSync(tempWsDir, originalWsDir);
      console.log('[TEST 3 TEARDOWN] Restored ws to original path');
    }
  }
}

run();
