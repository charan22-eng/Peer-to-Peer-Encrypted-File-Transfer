import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import url from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
if (process.env.NODE_ENV === 'production' && (!process.env.TURN_URL || !process.env.TURN_SECRET)) {
  throw new Error('TURN_URL and TURN_SECRET must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

const app = express();
const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.has(origin) ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.endsWith('.ngrok-free.dev') ||
      origin.endsWith('.ngrok-free.app') ||
      origin.endsWith('.ngrok.io') ||
      origin.includes('ngrok')
    ) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed'));
  }
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
const server = http.createServer(app);
// maxPayload: 64KB limit for signaling messages to prevent memory exhaustion/DoS
const wss = new WebSocketServer({ server, maxPayload: 65536 });

const PORT = process.env.PORT || 8080;
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '10', 10);
const RELAY_CHUNKS_PER_MINUTE = parseInt(process.env.RELAY_CHUNKS_PER_MINUTE || '10000', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000', 10);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Serve frontend static files
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

app.get('/auth/token', (req, res) => {
  if (!checkRateLimit(req.socket.remoteAddress || 'unknown', 'token', 30)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const peerId = crypto.randomUUID();
  const token = jwt.sign({ peerId, role: 'peer' }, JWT_SECRET, { expiresIn: '10m' });
  res.json({ token, peerId });
});

app.get('/turn-credentials', (req, res) => {
  const turnUrl = process.env.TURN_URL;
  const turnSecret = process.env.TURN_SECRET;
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  if (turnUrl && turnSecret) {
    const ttl = 60 * 60;
    const username = `${Math.floor(Date.now() / 1000) + ttl}:peerlink`;
    const password = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
    iceServers.push({ urls: turnUrl, username, credential: password });
  } else {
    // Public fallback for local development. Production deployments should set TURN_URL and TURN_SECRET.
    iceServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
  }

  res.json({
    iceServers
  });
});

app.get(/.*/, (req, res) => {
  const indexPath = path.join(clientDistPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Client build not found. Run npm run build in client.');
  }
  return res.sendFile(indexPath);
});

// Room state: roomCode -> Set<WebSocket>
const rooms = new Map();

// Rate limiting state: IP -> { count, resetTime }
const ipBuckets = new Map();

// 32-character alphabet (excludes visually ambiguous 0, O, 1, and I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 10;
// Code space: 32^10, approximately 50 bits of entropy.

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function checkRateLimit(ip, action = 'default', limit = RATE_LIMIT_PER_MINUTE) {
  const bucketKey = `${ip}:${action}`;
  const now = Date.now();
  let bucket = ipBuckets.get(bucketKey);

  if (!bucket || now > bucket.resetTime) {
    bucket = { count: 0, resetTime: now + 60000 };
    ipBuckets.set(bucketKey, bucket);
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count++;
  return true;
}

function isValidSignalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (payload.sdp) {
    return typeof payload.sdp === 'object'
      && (payload.sdp.type === 'offer' || payload.sdp.type === 'answer')
      && typeof payload.sdp.sdp === 'string'
      && payload.sdp.sdp.length <= 50000;
  }
  if (payload.candidate) {
    return typeof payload.candidate === 'object'
      && typeof payload.candidate.candidate === 'string'
      && payload.candidate.candidate.length <= 4096;
  }
  if (payload.type === 'public-key') {
    return payload.key && payload.key.kty === 'EC' && payload.key.crv === 'P-256'
      && typeof payload.key.x === 'string' && typeof payload.key.y === 'string'
      && payload.key.x.length <= 128 && payload.key.y.length <= 128;
  }
  if (payload.relayType === 'chunk') {
    return typeof payload.data === 'string' && payload.data.length <= 50000;
  }
  if (payload.relayType === 'app') {
    return payload.data && typeof payload.data === 'object'
      && typeof payload.data.type === 'string' && payload.data.type.length <= 64;
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const query = url.parse(req.url, true).query;
  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map(protocol => protocol.trim());
  const protocolToken = protocols.find(protocol => protocol.startsWith('peerlink.jwt.'));
  const token = protocolToken ? protocolToken.slice('peerlink.jwt.'.length) : query.token;

  if (!token || typeof token !== 'string') {
    ws.close(4001, 'Unauthorized: No token provided');
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ws.peerId = decoded.peerId;
  } catch (err) {
    ws.close(4001, 'Unauthorized: Invalid token');
    return;
  }

  ws.isAlive = true;
  ws.roomCode = null;
  ws.roomRole = null;

  const ip = req.socket.remoteAddress;

  const leaveCurrentRoom = () => {
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) {
        room.delete(ws);
        
        // Notify remaining peer if any
        for (const client of room) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer-left' }));
          }
        }

        // Clean up empty rooms
        if (room.size === 0) {
          rooms.delete(ws.roomCode);
          console.log(`[${new Date().toISOString()}] Room closed: ${ws.roomCode}`);
        }
      }
      ws.roomCode = null;
    }
  };

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      return; // Ignore malformed JSON
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) return;

    if (message.type === 'pong') {
      ws.isAlive = true;
      return;
    }

    switch (message.type) {
      case 'create-room': {
        if (!checkRateLimit(ip, 'create-room')) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
          return;
        }

        leaveCurrentRoom();

        const roomCode = generateRoomCode();
        rooms.set(roomCode, new Set([ws]));
        ws.roomCode = roomCode;
        ws.roomRole = 'owner';
        
        console.log(`[${new Date().toISOString()}] Room created: ${roomCode} by ${ws.peerId}`);
        ws.send(JSON.stringify({ type: 'room-created', roomCode, role: 'owner' }));
        break;
      }

      case 'join-room': {
        const { roomCode } = message;
        if (!checkRateLimit(ip, 'join-room', 30)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
          return;
        }
        // Validate the exact room-code alphabet and length.
        if (!roomCode || typeof roomCode !== 'string' || !/^[A-HJ-NP-Z2-9]{10}$/.test(roomCode.toUpperCase())) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
          return;
        }

        const room = rooms.get(roomCode.toUpperCase());

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }

        if (room.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room already full' }));
          return;
        }

        leaveCurrentRoom();

        room.add(ws);
        ws.roomCode = roomCode.toUpperCase();
        ws.roomRole = 'member';
        
        console.log(`[${new Date().toISOString()}] Peer ${ws.peerId} joined room: ${ws.roomCode}`);
        ws.send(JSON.stringify({ type: 'room-joined', roomCode: ws.roomCode, role: 'member' }));

        // Notify the OTHER peer
        for (const client of room) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer-joined' }));
          }
        }
        break;
      }

      case 'signal': {
        const { payload } = message;
        const signalLimit = payload?.relayType === 'chunk' ? RELAY_CHUNKS_PER_MINUTE : 600;
        if (!checkRateLimit(ip, 'signal', signalLimit)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Signal rate limit exceeded' }));
          return;
        }
        // Enforce basic object validation to prevent injection or crashes
        if (!ws.roomCode || !isValidSignalPayload(payload)) return;

        const room = rooms.get(ws.roomCode);
        if (!room) return;

        // Relay to the OTHER peer
        for (const client of room) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'signal', payload }));
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom();
  });
});

// Heartbeat cleanup
const interval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of ipBuckets) {
    if (bucket.resetTime <= now) ipBuckets.delete(key);
  }
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`[${new Date().toISOString()}] Terminating dead connection`);
      return ws.terminate();
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.isAlive = false;
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`);
});
