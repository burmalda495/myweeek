const express = require('express'), cors = require('cors'), Database = require('better-sqlite3'), webpush = require('web-push'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, GATE = 3 * 3600e3;
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
const db = new Database(process.env.DB || 'myweek.db');
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT, token TEXT UNIQUE, code TEXT UNIQUE, in_gym INTEGER DEFAULT 0, since INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, PRIMARY KEY(a,b));
CREATE TABLE IF NOT EXISTS subs(user TEXT, endpoint TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS rem(user TEXT, id TEXT, at INTEGER, text TEXT, sent INTEGER DEFAULT 0, PRIMARY KEY(user,id));`);
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '200kb' }));
const rnd = n => crypto.randomBytes(n).toString('hex');
const mkCode = () => String(crypto.randomInt(100000, 1000000));
const regHits = new Map();
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const u = t && db.prepare('SELECT * FROM users WHERE token=?').get(t);
  if (!u) return res.status(401).json({ error: 'auth' });
  req.user = u; next();
}
async function pushTo(uid, payload) {
  for (const r of db.prepare('SELECT endpoint,json FROM subs WHERE user=?').all(uid)) {
    try { await webpush.sendNotification(JSON.parse(r.json), JSON.stringify(payload)); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM subs WHERE endpoint=?').run(r.endpoint); }
  }
}
app.post('/api/register', (req, res) => {
  const now = Date.now(), arr = (regHits.get(req.ip) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 10) return res.status(429).json({ error: 'rate' });
  arr.push(now); regHits.set(req.ip, arr);
  const name = String(req.body.name || '').trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: 'name' });
  let code; do { code = mkCode(); } while (db.prepare('SELECT 1 FROM users WHERE code=?').get(code));
  const u = { id: rnd(8), name, token: rnd(24), code };
  db.prepare('INSERT INTO users(id,name,token,code) VALUES(?,?,?,?)').run(u.id, u.name, u.token, u.code);
  res.json(u);
});
app.get('/api/push/key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC }));
app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body.sub; if (!sub || !sub.endpoint) return res.status(400).json({ error: 'sub' });
  db.prepare('INSERT OR REPLACE INTO subs(user,endpoint,json) VALUES(?,?,?)').run(req.user.id, sub.endpoint, JSON.stringify(sub));
  res.json({ ok: true });
});
app.post('/api/friends/add', auth, (req, res) => {
  const f = db.prepare('SELECT id FROM users WHERE code=?').get(String(req.body.code || '').replace(/\D/g, ''));
  if (!f || f.id === req.user.id) return res.status(404).json({ error: 'code' });
  const ins = db.prepare('INSERT OR IGNORE INTO friends(a,b) VALUES(?,?)');
  ins.run(req.user.id, f.id); ins.run(f.id, req.user.id);
  res.json({ ok: true });
});
app.get('/api/friends', auth, (req, res) => {
  const rows = db.prepare('SELECT u.id,u.name,u.in_gym,u.since FROM friends f JOIN users u ON u.id=f.b WHERE f.a=?').all(req.user.id);
  res.json({ friends: rows.map(r => ({ id: r.id, name: r.name, inGym: !!(r.in_gym && Date.now() - r.since < GATE), since: r.since })) });
});
app.post('/api/status', auth, (req, res) => {
  const u = req.user, on = req.body.inGym ? 1 : 0, was = u.in_gym && Date.now() - u.since < GATE;
  db.prepare('UPDATE users SET in_gym=?, since=? WHERE id=?').run(on, on ? Date.now() : 0, u.id);
  if (on && !was) for (const f of db.prepare('SELECT b FROM friends WHERE a=?').all(u.id))
    pushTo(f.b, { title: u.name + ' в зале', body: 'Твой друг ' + u.name + ' пришёл в зал', tag: 'gym-' + u.id });
  res.json({ ok: true });
});
app.post('/api/reminders/sync', auth, (req, res) => {
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 200).filter(i => i.id && i.at);
  const up = db.prepare('INSERT INTO rem(user,id,at,text) VALUES(?,?,?,?) ON CONFLICT(user,id) DO UPDATE SET at=excluded.at, text=excluded.text, sent=CASE WHEN rem.at=excluded.at THEN rem.sent ELSE 0 END');
  db.transaction(() => {
    db.prepare('DELETE FROM rem WHERE user=?' + (items.length ? ' AND id NOT IN (' + items.map(() => '?').join(',') + ')' : '')).run(req.user.id, ...items.map(i => String(i.id)));
    items.forEach(i => up.run(req.user.id, String(i.id), +i.at, String(i.text || '').slice(0, 120)));
  })();
  res.json({ ok: true });
});
setInterval(() => {
  const now = Date.now();
  for (const r of db.prepare('SELECT * FROM rem WHERE sent=0 AND at-7200000<=?').all(now)) {
    db.prepare('UPDATE rem SET sent=1 WHERE user=? AND id=?').run(r.user, r.id);
    if (r.at > now) pushTo(r.user, { title: 'Напоминание через 2 часа', body: r.text, tag: 'rem-' + r.id });
  }
}, 30000);
app.listen(PORT, () => console.log('MY WEEK server on :' + PORT));
