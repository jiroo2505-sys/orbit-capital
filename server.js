const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'orbit-capital-secret-change-this-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'honda12345';
const USERS_FILE = path.join(__dirname, 'users.json');
const ACTIVITY_FILE = path.join(__dirname, 'activity.json');

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
}

// Ensure files exist
if (!fs.existsSync(USERS_FILE)) {
  saveUsers([]);
}
if (!fs.existsSync(ACTIVITY_FILE)) {
  saveActivity([]);
}

// ---- Auth middleware ----
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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
app.post('/api/heartbeat', authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.id);
    if (user) {
      user.lastSeen = new Date().toISOString();
      saveUsers(users);
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
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    if (password !== ADMIN_PASSWORD) {
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

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  try {
    const now = Date.now();
    const ACTIVE_MS = 20 * 1000; // 20 seconds
    const users = loadUsers().map(u => {
      const lastSeenMs = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
      const isActive = lastSeenMs > 0 && (now - lastSeenMs) < ACTIVE_MS;
      return {
        id: u.id,
        email: u.email,
        balance: typeof u.balance === 'number' ? u.balance : 0,
        createdAt: u.createdAt || null,
        lastLogin: u.lastLogin || null,
        lastSeen: u.lastSeen || null,
        invitationCode: u.invitationCode || null,
        isActive
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

// Delete user (admin)
app.delete('/api/admin/users/:id', adminMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    let users = loadUsers();
    const target = users.find(u => u.id === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    users = users.filter(u => u.id !== id);
    saveUsers(users);
    logActivity('admin_delete_user', target.email, { deletedId: id });
    res.json({ success: true, message: 'User deleted', total: users.length });
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
    const dayMs = 24 * 60 * 60 * 1000;
    const loginsToday = activity.filter(
      a => a.type === 'login' && now - new Date(a.time).getTime() < dayMs
    ).length;
    const registersToday = activity.filter(
      a => a.type === 'register' && now - new Date(a.time).getTime() < dayMs
    ).length;
    // Active = users with heartbeat in last 20 seconds
    const ACTIVE_MS = 20 * 1000;
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
  console.log(`   GET  /api/admin/users`);
  console.log(`   GET  /api/admin/stats`);
  console.log(`   GET  /api/admin/activity`);
  console.log(`   POST /api/admin/users/:id/password\n`);
});
