// BrainrotX — сервер промокодов. Без зависимостей, нужен Node.js 18+.
// Запуск: BOT_TOKEN=123:ABC ORIGIN=https://ТВОЙ_НИК.github.io node server.js
const http = require('http'), crypto = require('crypto'), fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;                       // токен бота от @BotFather
const PARTNERS = (process.env.PARTNERS || '8158983520').split(',').map(Number); // ID партнёров
const ORIGIN = process.env.ORIGIN || '*';                      // адрес сайта, напр. https://ник.github.io
const PORT = process.env.PORT || 3000;
const FILE = process.env.DB_FILE || './promos.json';           // файл базы промокодов

if (!BOT_TOKEN) { console.error('Задай BOT_TOKEN'); process.exit(1); }

let DB = {};
try { DB = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
const saveDB = () => fs.writeFileSync(FILE, JSON.stringify(DB));

// Проверка подписи Telegram: убеждаемся, что запрос реально из Mini App и ID не подделан
function verify(initData) {
  try {
    const p = new URLSearchParams(initData), hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
    if (calc !== hash) return null;
    if (Date.now() / 1000 - Number(p.get('auth_date')) > 3 * 86400) return null; // не старше 3 дней
    return JSON.parse(p.get('user'));
  } catch (e) { return null; }
}

// ===== Заявки на пополнение =====
const ADMIN = Number(process.env.ADMIN || 8158983520);          // только этот ID видит заявки
const TFILE = process.env.TOPUP_FILE || './topups.json';
let TP = [];
try { TP = JSON.parse(fs.readFileSync(TFILE, 'utf8')); } catch (e) {}
const saveTP = () => fs.writeFileSync(TFILE, JSON.stringify(TP));
const clip = (v, n) => String(v || '').slice(0, n);

// уведомление админу в Telegram (нужно один раз нажать /start у бота)
function notify(r) {
  const text = '📥 Новая заявка на пополнение\n' + r.nick + (r.username ? ' (@' + r.username + ')' : '') +
    '\n' + r.items.map(i => i.name + ' ×' + i.n).join(', ') + '\nИтого: ' + r.total +
    (r.promo ? '\nПромокод: ' + r.promo : '') + (r.note ? '\nБафы: ' + r.note : '');
  fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN, text })
  }).catch(() => {});
}

const CODE_RE = /^[A-Z0-9А-ЯЁ_-]{3,20}$/;

const routes = {
  '/promo/create': (uid, b) => {
    if (!PARTNERS.includes(uid)) return { err: 'Ты не партнёр' };
    const code = String(b.code || '').toUpperCase(), n = Math.floor(+b.n), amt = Math.floor(+b.amt);
    if (!CODE_RE.test(code)) return { err: 'Неверный код' };
    if (!(n >= 1 && n <= 1000) || !(amt >= 1 && amt <= 1e6)) return { err: 'Неверные числа' };
    if (DB[code]) return { err: 'Такой код уже существует' };
    DB[code] = { n, left: n, amt, by: uid, used: [] };
    saveDB();
    return { ok: 1 };
  },
  '/promo/redeem': (uid, b) => {
    const p = DB[String(b.code || '').toUpperCase()];
    if (!p) return { err: 'Код не найден' };
    if (p.used.includes(uid)) return { err: 'Ты уже активировал этот код' };
    if (p.left <= 0) return { err: 'Активации закончились' };
    p.left--; p.used.push(uid); saveDB();
    return { ok: 1, amt: p.amt };
  },
  '/promo/list': (uid) => {
    if (!PARTNERS.includes(uid)) return { err: 'Ты не партнёр' };
    return { list: Object.keys(DB).filter(k => DB[k].by === uid).map(k => ({ code: k, n: DB[k].n, left: DB[k].left, amt: DB[k].amt })) };
  }
};

routes['/topup/create'] = (uid, b, u) => {
  if (TP.filter(x => x.uid === uid && x.status === 'new').length >= 5) return { err: 'Слишком много заявок на проверке' };
  const nick = clip(b.nick, 30).trim();
  if (nick.length < 3) return { err: 'Введи ник Roblox' };
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(i => ({
    name: clip(i.name, 40), n: Math.min(99, Math.max(1, Math.floor(+i.n) || 1)), price: Math.max(0, Math.floor(+i.price) || 0)
  })).filter(i => i.price >= 99);
  if (!items.length) return { err: 'Выбери брейнротов' };
  const r = { id: crypto.randomBytes(5).toString('hex'), uid, username: u.username || '', nick,
    promo: clip(b.promo, 20), note: clip(b.note, 120), items,
    total: items.reduce((a, i) => a + i.n * i.price, 0), status: 'new', ts: Date.now(), claimed: 0 };
  TP.unshift(r); TP = TP.slice(0, 2000); saveTP(); notify(r);
  return { ok: 1 };
};
routes['/topup/mine'] = (uid) => ({ list: TP.filter(x => x.uid === uid).slice(0, 20).map(x => ({ id: x.id, total: x.total, status: x.status, ts: x.ts })) });
routes['/topup/claim'] = (uid) => {
  let amt = 0;
  TP.forEach(x => { if (x.uid === uid && x.status === 'approved' && !x.claimed) { x.claimed = 1; amt += x.total; } });
  if (amt) saveTP();
  return { amt };
};
routes['/topup/list'] = (uid) => uid === ADMIN ? { list: TP.slice(0, 200) } : { err: 'Нет доступа' };
routes['/topup/resolve'] = (uid, b) => {
  if (uid !== ADMIN) return { err: 'Нет доступа' };
  const x = TP.find(r => r.id === b.id);
  if (!x || x.status !== 'new' || !['approved', 'rejected'].includes(b.status)) return { err: 'Заявка уже обработана' };
  x.status = b.status; saveTP();
  return { ok: 1 };
};

http.createServer((req, res) => {
  const h = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  const send = (c, o) => { res.writeHead(c, h); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') return send(204, {});
  if (req.method === 'GET') return send(200, { ok: 1 }); // проверка, что сервер жив
  const route = routes[req.url];
  if (req.method !== 'POST' || !route) return send(404, { err: 'Not found' });
  let body = '';
  req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    let b; try { b = JSON.parse(body); } catch (e) { return send(400, { err: 'Bad request' }); }
    const user = verify(b.initData);
    if (!user) return send(401, { err: 'Открой сайт через Telegram' });
    send(200, route(user.id, b, user));
  });
}).listen(PORT, () => console.log('Сервер на порту ' + PORT));
