const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'orbit-capital-secret-change-this-in-production';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2a$10$MfigfcUcx/Lh3Jl3gEza..U5RY32128wY1lkNvWPh/zk3jS.Ynmv6';
const USERS_FILE = path.join(__dirname, 'users.json');
const ACTIVITY_FILE = path.join(__dirname, 'activity.json');
const CHANNELS_FILE = path.join(__dirname, 'withdraw-channels.json');

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve the frontend (public.html) — main site + admin share the same file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public.html'));
});

// ---- Simple file-based user store ----
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading users:', err.message);
  }
  return [];
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadActivity() {
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading activity:', err.message);
  }
  return [];
}

function saveActivity(logs) {
  // keep last 500 events only
  const trimmed = logs.slice(-500);
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(trimmed, null, 2));
}

function logActivity(type, email, extra) {
  const logs = loadActivity();
  logs.push({
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    type,
    email: email || null,
    extra: extra || null,
    time: new Date().toISOString()
  });
  saveActivity(logs);
  // Push live update to open admin dashboards (SSE)
  notifyAdmins('update', { activityType: type, email: email || null });
}

// ---- Admin live updates (Server-Sent Events) ----
const adminSseClients = new Set();
let lastPresenceNotify = 0;

function notifyAdmins(eventType, payload) {
  if (!adminSseClients.size) return;
  const data = JSON.stringify({
    type: eventType,
    ...(payload || {}),
    at: Date.now()
  });
  const chunk = `event: ${eventType}\ndata: ${data}\n\n`;
  for (const client of [...adminSseClients]) {
    try {
      client.write(chunk);
    } catch (err) {
      adminSseClients.delete(client);
    }
  }
}

function notifyAdminsPresence() {
  // Throttle presence (heartbeat) so many online users don't flood admins
  const now = Date.now();
  if (now - lastPresenceNotify < 2500) return;
  lastPresenceNotify = now;
  notifyAdmins('presence', {});
}

function loadChannels() {
  try {
    if (fs.existsSync(CHANNELS_FILE)) {
      return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading channels:', err.message);
  }
  return null;
}

function saveChannels(channels) {
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
}

function defaultChannels() {
  // taxPercent: % fee on withdraw amount (0 = none)
  // minAmount / maxAmount: ₱ limits (maxAmount 0 = no max)
  const base = { enabled: false, taxPercent: 0, minAmount: 0, maxAmount: 0 };
  return [
    {
      id: 'gcash',
      name: 'GCash',
      type: 'ewallet',
      description: 'Mobile number + account name',
      sort: 1,
      ...base
    },
    {
      id: 'maya',
      name: 'Maya',
      type: 'ewallet',
      description: 'Mobile number + account name',
      sort: 2,
      ...base
    },
    {
      id: 'gotyme',
      name: 'GoTyme',
      type: 'bank',
      description: 'GoTyme Bank · account name + number',
      sort: 3,
      ...base
    },
    {
      id: 'cimb',
      name: 'CIMB',
      type: 'bank',
      description: 'CIMB Bank PH · account name + number',
      sort: 4,
      ...base
    },
    {
      id: 'seabank',
      name: 'SeaBank PH',
      type: 'bank',
      description: 'SeaBank · account name + number',
      sort: 5,
      ...base
    }
  ];
}

function ensureChannels() {
  let channels = loadChannels();
  if (!channels || !Array.isArray(channels) || !channels.length) {
    channels = defaultChannels();
    saveChannels(channels);
    return channels;
  }
  const defaults = defaultChannels();
  let changed = false;
  for (const d of defaults) {
    if (!channels.find(c => c.id === d.id)) {
      channels.push({ ...d });
      changed = true;
    }
  }
  // Backfill tax / min / max on older channel records
  for (const c of channels) {
    if (typeof c.taxPercent !== 'number' || Number.isNaN(c.taxPercent)) {
      c.taxPercent = 0;
      changed = true;
    }
    if (typeof c.minAmount !== 'number' || Number.isNaN(c.minAmount)) {
      c.minAmount = 0;
      changed = true;
    }
    if (typeof c.maxAmount !== 'number' || Number.isNaN(c.maxAmount)) {
      c.maxAmount = 0;
      changed = true;
    }
    // Clear previous seed defaults (100 / 50000) until admin sets real limits
    if (c.minAmount === 100 && c.maxAmount === 50000) {
      c.minAmount = 0;
      c.maxAmount = 0;
      changed = true;
    }
  }
  if (channels.some(c => ['gotyme', 'cimb', 'seabank'].includes(c.id))) {
    const before = channels.length;
    channels = channels.filter(c => c.id !== 'bank');
    if (channels.length !== before) changed = true;
  }
  if (changed) saveChannels(channels);
  return channels;
}

// Ensure files exist
if (!fs.existsSync(USERS_FILE)) {
  saveUsers([]);
}
if (!fs.existsSync(ACTIVITY_FILE)) {
  saveActivity([]);
}
ensureChannels();

// ---- Auth middleware ----
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // If account was banned after login, kick session on every protected call
    const users = loadUsers();
    const dbUser = users.find(u => u.id === decoded.id);
    if (!dbUser) {
      return res.status(401).json({ success: false, message: 'User not found', code: 'USER_GONE' });
    }
    if (dbUser.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact support.',
        code: 'BANNED'
      });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// ---- Routes ----

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Orbit Capital API is running' });
});

// REGISTER (Create Account)
app.post('/api/register', async (req, res) => {
  try {
    const { email, invitationCode, password, confirmPassword } = req.body;

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'Email, password, and confirm password are required' });
    }

    if (email.length > 11) {
      return res.status(400).json({ success: false, message: 'Email / Phone must be 11 characters or less' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    if (password.length > 25) {
      return res.status(400).json({ success: false, message: 'Password must be 25 characters or less' });
    }

    // Simple invitation code check (optional – change or remove as needed)
    // For demo: accept any non-empty code, or hardcode a few
    const validCodes = ['ORBIT2026', 'SPACEINVITE', 'LUNAR'];
    if (invitationCode && !validCodes.includes(invitationCode.toUpperCase())) {
      // Allow empty or any code for easy testing – comment out the next lines if you want strict codes
      // return res.status(400).json({ success: false, message: 'Invalid invitation code' });
    }

    const users = loadUsers();
    const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      email: email.toLowerCase().trim(),
      password: hashed,
      balance: 0,
      status: 'active',
      bannedAt: null,
      invitationCode: invitationCode || null,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    logActivity('register', newUser.email);

    const time = new Date().toLocaleString();
    console.log(`\n✅ [REGISTER] New account created`);
    console.log(`   Email : ${newUser.email}`);
    console.log(`   Time  : ${time}`);
    console.log(`   Total users now: ${users.length}\n`);

    // Auto-login after register
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: { id: newUser.id, email: newUser.email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    if (email.length > 11) {
      return res.status(400).json({ success: false, message: 'Email / Phone must be 11 characters or less' });
    }

    if (password.length > 25) {
      return res.status(400).json({ success: false, message: 'Password must be 25 characters or less' });
    }

    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());

    if (!user) {
      console.log(`\n❌ [LOGIN FAILED] Unknown email: ${email}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (user.status === 'banned') {
      console.log(`\n❌ [LOGIN FAILED] Banned account: ${email}`);
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log(`\n❌ [LOGIN FAILED] Wrong password for: ${email}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    user.lastLogin = new Date().toISOString();
    user.lastSeen = new Date().toISOString();
    saveUsers(users);
    logActivity('login', user.email);

    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const time = new Date().toLocaleString();
    console.log(`\n🟢 [LOGIN] User logged in`);
    console.log(`   Email : ${user.email}`);
    console.log(`   Time  : ${time}\n`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// LOGOUT (mostly client-side, but endpoint exists for completeness)
app.post('/api/logout', authMiddleware, (req, res) => {
  // Clear lastSeen so admin shows Inactive immediately
  try {
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.id);
    if (user) {
      user.lastSeen = null;
      saveUsers(users);
    }
  } catch (e) { /* ignore */ }
  logActivity('logout', req.user.email);
  const time = new Date().toLocaleString();
  console.log(`\n🔴 [LOGOUT] User logged out`);
  console.log(`   Email : ${req.user.email}`);
  console.log(`   Time  : ${time}\n`);

  res.json({ success: true, message: 'Logged out successfully' });
});

// GET current user (protected)
app.get('/api/me', authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  res.json({
    success: true,
    user: { id: user.id, email: user.email, createdAt: user.createdAt }
  });
});

// Heartbeat — client pings while app is open (for Active/Inactive status)
// Banned users are rejected by authMiddleware (code: BANNED) → client force-logout
app.post('/api/heartbeat', authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.id);
    if (user) {
      user.lastSeen = new Date().toISOString();
      saveUsers(users);
      notifyAdminsPresence();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Notification count (real-time; currently 0 until investment/news notifications exist)
app.get('/api/notifications/count', authMiddleware, (req, res) => {
  res.json({ success: true, count: 0 });
});

// ========== ADMIN ==========
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    const passwordMatches = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!passwordMatches) {
      logActivity('admin_login_failed', null);
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }
    const token = jwt.sign(
      { isAdmin: true, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    logActivity('admin_login', 'admin');
    res.json({ success: true, message: 'Admin login successful', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Live stream for admin dashboard (EventSource cannot set Authorization header → token query)
app.get('/api/admin/stream', (req, res) => {
  const token = (req.query.token || '').toString();
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx / proxies
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);
  adminSseClients.add(res);

  // Keep-alive comment so proxies don't close idle connections
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(keepAlive);
      adminSseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    adminSseClients.delete(res);
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  try {
    const now = Date.now();
    const ACTIVE_MS = 5 * 1000; // 5 seconds — inactive if no heartbeat / view
    const users = loadUsers().map(u => {
      const lastSeenMs = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
      const isActive = lastSeenMs > 0 && (now - lastSeenMs) < ACTIVE_MS;
      const status = u.status === 'banned' ? 'banned' : 'active';
      return {
        id: u.id,
        email: u.email,
        balance: typeof u.balance === 'number' ? u.balance : 0,
        status,
        bannedAt: u.bannedAt || null,
        createdAt: u.createdAt || null,
        lastLogin: u.lastLogin || null,
        lastSeen: u.lastSeen || null,
        invitationCode: u.invitationCode || null,
        isActive: status === 'banned' ? false : isActive
      };
    });
    // newest first
    users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ success: true, users, total: users.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Ban / deactivate user (soft — data kept)
app.post('/api/admin/users/:id/ban', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const users = loadUsers();
    const target = users.find(u => u.id === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    target.status = 'banned';
    target.bannedAt = new Date().toISOString();
    target.lastSeen = null; // force Inactive on admin + kill presence
    saveUsers(users);
    logActivity('admin_ban_user', target.email, { userId: id });
    res.json({ success: true, message: 'User deactivated', status: 'banned' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Unban / reactivate user
app.post('/api/admin/users/:id/unban', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const users = loadUsers();
    const target = users.find(u => u.id === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    target.status = 'active';
    target.bannedAt = null;
    saveUsers(users);
    logActivity('admin_unban_user', target.email, { userId: id });
    res.json({ success: true, message: 'User reactivated', status: 'active' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin: set / reset user password (cannot read old password — bcrypt hash only)
app.post('/api/admin/users/:id/password', adminMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'New password is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (password.length > 25) {
      return res.status(400).json({ success: false, message: 'Password must be 25 characters or less' });
    }
    const users = loadUsers();
    const user = users.find(u => u.id === id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    user.password = await bcrypt.hash(password, 10);
    if (typeof user.balance !== 'number') user.balance = 0;
    saveUsers(users);
    logActivity('admin_reset_password', user.email, { userId: id });
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const activity = loadActivity();
    const now = Date.now();
    // Calendar day in Asia/Manila (no "Philippine time" label in UI — display only)
    const phDayKey = (iso) => {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Manila',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(iso));
      } catch {
        return '';
      }
    };
    const todayPH = phDayKey(new Date());
    const loginsToday = activity.filter(
      a => a.type === 'login' && phDayKey(a.time) === todayPH
    ).length;
    const registersToday = activity.filter(
      a => a.type === 'register' && phDayKey(a.time) === todayPH
    ).length;
    // Active = users with heartbeat in last 5 seconds
    const ACTIVE_MS = 5 * 1000;
    const activeNow = users.filter(u => {
      if (!u.lastSeen) return false;
      return (now - new Date(u.lastSeen).getTime()) < ACTIVE_MS;
    }).length;

    // Financial placeholders (no real transactions yet → all 0)
    // Structure ready for future deposit/withdraw/earnings tracking
    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        activeSessions: activeNow,
        loginsToday,
        registersToday,
        earningsToday: 0,
        depositsToday: 0,
        withdrawalsToday: 0,
        balance: 0
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/activity', adminMiddleware, (req, res) => {
  try {
    const logs = loadActivity().slice().reverse().slice(0, 100);
    res.json({ success: true, activity: logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== WITHDRAW CHANNELS (admin-managed payment modes) ==========
// Public: only enabled channels (for future user withdraw UI)
app.get('/api/withdraw-channels', (req, res) => {
  try {
    const channels = ensureChannels()
      .filter(c => c.enabled)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/withdraw-channels', adminMiddleware, (req, res) => {
  try {
    const channels = ensureChannels().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    res.json({ success: true, channels });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/withdraw-channels', adminMiddleware, (req, res) => {
  try {
    const { name, type, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Channel name is required' });
    }
    const channels = ensureChannels();
    const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
    const channel = {
      id,
      name: String(name).trim(),
      type: type === 'bank' ? 'bank' : 'ewallet',
      description: (description && String(description).trim()) || (type === 'bank' ? 'Bank account details' : 'E-wallet details'),
      enabled: false,
      sort: channels.length + 1
    };
    channels.push(channel);
    saveChannels(channels);
    logActivity('admin_channel_add', 'admin', { channelId: id, name: channel.name });
    res.status(201).json({ success: true, channel, channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/withdraw-channels/:id/toggle', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const channels = ensureChannels();
    const ch = channels.find(c => c.id === id);
    if (!ch) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    ch.enabled = !ch.enabled;
    saveChannels(channels);
    logActivity('admin_channel_toggle', 'admin', { channelId: id, enabled: ch.enabled });
    res.json({ success: true, channel: ch, channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update tax % / min / max per channel
app.post('/api/admin/withdraw-channels/:id/settings', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const channels = ensureChannels();
    const ch = channels.find(c => c.id === id);
    if (!ch) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    const body = req.body || {};
    let tax = Number(body.taxPercent);
    let minA = Number(body.minAmount);
    let maxA = Number(body.maxAmount);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      return res.status(400).json({ success: false, message: 'Tax % must be 0–100' });
    }
    if (!Number.isFinite(minA) || minA < 0) {
      return res.status(400).json({ success: false, message: 'Min amount must be ≥ 0' });
    }
    if (!Number.isFinite(maxA) || maxA < 0) {
      return res.status(400).json({ success: false, message: 'Max amount must be ≥ 0 (0 = no max)' });
    }
    if (maxA > 0 && maxA < minA) {
      return res.status(400).json({ success: false, message: 'Max must be ≥ min (or 0 for no max)' });
    }
    ch.taxPercent = Math.round(tax * 100) / 100;
    ch.minAmount = Math.floor(minA);
    ch.maxAmount = Math.floor(maxA);
    saveChannels(channels);
    logActivity('admin_channel_settings', 'admin', {
      channelId: id,
      taxPercent: ch.taxPercent,
      minAmount: ch.minAmount,
      maxAmount: ch.maxAmount
    });
    res.json({ success: true, channel: ch, channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.delete('/api/admin/withdraw-channels/:id', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    let channels = ensureChannels();
    const before = channels.length;
    channels = channels.filter(c => c.id !== id);
    if (channels.length === before) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    saveChannels(channels);
    logActivity('admin_channel_delete', 'admin', { channelId: id });
    res.json({ success: true, channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Start server — listen on 0.0.0.0 so phone / other devices can connect
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Orbit Capital running!`);
  console.log(`   Local  : http://localhost:${PORT}`);
  console.log(`   Admin  : http://localhost:${PORT}/admin`);
  console.log(`   Phone  : use the localtunnel / ngrok link`);
  console.log(`\n   API endpoints:`);
  console.log(`   POST /api/register`);
  console.log(`   POST /api/login`);
  console.log(`   POST /api/logout`);
  console.log(`   GET  /api/me`);
  console.log(`   POST /api/admin/login`);
  console.log(`   GET  /api/admin/stream   ← live admin dashboard (SSE)`);
  console.log(`   GET  /api/admin/users`);
  console.log(`   GET  /api/admin/stats`);
  console.log(`   GET  /api/admin/activity`);
  console.log(`   GET  /api/admin/withdraw-channels`);
  console.log(`   POST /api/admin/users/:id/password\n`);
});