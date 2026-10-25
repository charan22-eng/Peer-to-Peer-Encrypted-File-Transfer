import { WebSocket } from 'ws';
import assert from 'assert';
import http from 'http';
import { spawn } from 'child_process';

const SERVER_URL = 'ws://localhost:8080';
const HEALTH_URL = 'http://localhost:8080/health';
let serverProcess = null;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connectClient(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_URL}/?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function getToken() {
  const res = await new Promise((resolve, reject) => {
    let data = '';
    http.get('http://localhost:8080/auth/token', (res) => {
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  return res.token;
}

function healthCheck() {
  return new Promise((resolve) => {
    http.get(HEALTH_URL, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

async function ensureServer() {
  if (await healthCheck()) return;
  serverProcess = spawn(process.execPath, ['index.js'], { stdio: 'inherit' });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await healthCheck()) return;
    await delay(100);
  }
  throw new Error('Signaling server did not become ready');
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', data => resolve(JSON.parse(data.toString())));
  });
}

async function runTests() {
  try {
    await ensureServer();
    console.log('Testing GET /health...');
    const res = await new Promise((resolve, reject) => {
      http.get(HEALTH_URL, (res) => resolve(res)).on('error', reject);
    });
    assert.strictEqual(res.statusCode, 200, 'Health endpoint should return 200');
    console.log('✅ GET /health works');

    console.log('Testing GET /turn-credentials...');
    const turnRes = await new Promise((resolve, reject) => {
      let data = '';
      http.get('http://localhost:8080/turn-credentials', (res) => {
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });
    assert.strictEqual(turnRes.statusCode, 200, 'TURN endpoint should return 200');
    assert.ok(Array.isArray(turnRes.data.iceServers), 'Should return iceServers array');
    assert.ok(turnRes.data.iceServers.length >= 2, 'Should have STUN and TURN configs');
    const turnServer = turnRes.data.iceServers.find(server => String(server.urls).includes('turn:'));
    assert.ok(turnServer, 'Should include a TURN server');
    assert.ok(turnServer.username, 'TURN should have username');
    assert.ok(turnServer.credential, 'TURN should have credential');
    console.log('✅ GET /turn-credentials works and returns valid schema');

    console.log('Testing Room Creation and Join limit...');
    const t1 = await getToken();
    const ws1 = await connectClient(t1);
    ws1.send(JSON.stringify({ type: 'create-room' }));
    
    let msg = await nextMessage(ws1);
    assert.strictEqual(msg.type, 'room-created');
    const roomCode = msg.roomCode;
    assert.strictEqual(roomCode.length, 10, 'Room code should use the hardened length');
    console.log(`✅ Room created: ${roomCode}`);

    const t2 = await getToken();
    const ws2 = await connectClient(t2);
    ws2.send(JSON.stringify({ type: 'join-room', roomCode }));
    msg = await nextMessage(ws2);
    assert.strictEqual(msg.type, 'room-joined');
    console.log(`✅ Peer 2 joined`);
    
    // Check ws1 got peer-joined
    msg = await nextMessage(ws1);
    assert.strictEqual(msg.type, 'peer-joined');
    console.log(`✅ Peer 1 notified of join`);

    const t3 = await getToken();
    const ws3 = await connectClient(t3);
    ws3.send(JSON.stringify({ type: 'join-room', roomCode }));
    msg = await nextMessage(ws3);
    assert.strictEqual(msg.type, 'error');
    assert.strictEqual(msg.message, 'Room already full');
    console.log(`✅ Third join rejected`);
    ws3.close();

    console.log('Testing Disconnect Notification...');
    ws2.close();
    msg = await nextMessage(ws1);
    assert.strictEqual(msg.type, 'peer-left');
    console.log(`✅ Peer 1 notified of peer-left`);
    ws1.close();

    console.log('Testing Rate Limiting (10 creations per minute)...');
    const t4 = await getToken();
    const rateLimitWs = await connectClient(t4);
    let limitHit = false;
    for (let i = 0; i < 12; i++) {
      rateLimitWs.send(JSON.stringify({ type: 'create-room' }));
      const m = await nextMessage(rateLimitWs);
      if (m.type === 'error' && m.message === 'Rate limit exceeded') {
        limitHit = true;
        break;
      }
    }
    assert.strictEqual(limitHit, true, 'Rate limit should be hit after 10 requests');
    console.log(`✅ Rate limit enforced`);
    rateLimitWs.close();

    console.log('All tests passed!');
    stopServer();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    stopServer();
    process.exit(1);
  }
}

runTests();
