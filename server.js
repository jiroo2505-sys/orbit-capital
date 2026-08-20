const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'orbit-capital-secret-change-this-in-production';
const USERS_FILE = path.join(__dirname, 'users.json');

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve the frontend (public.html) so one URL works for both phone & laptop
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public.html'));
});
app.get('/index.html', (req, res) => {
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

// Ensure users.json exists
if (!fs.existsSync(USERS_FILE)) {
  saveUsers([]);
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
      invitationCode: invitationCode || null,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);

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

// Start server — listen on 0.0.0.0 so phone / other devices can connect
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Orbit Capital running!`);
  console.log(`   Local  : http://localhost:${PORT}`);
  console.log(`   Phone  : use the localtunnel / ngrok link`);
  console.log(`\n   API endpoints:`);
  console.log(`   POST /api/register`);
  console.log(`   POST /api/login`);
  console.log(`   POST /api/logout`);
  console.log(`   GET  /api/me\n`);
});
