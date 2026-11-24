import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './storage.js';
import { Telegram, sleep } from './telegram.js';
import { normalizeSearchUrl, fetchListings, extractUrl, BASE } from './turbo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* .env yoxdursa, mühit dəyişənlərindən istifadə olunur (Docker/VPS) */
}

const cfg = {
  token: (process.env.BOT_TOKEN || '').trim(),
  allowed: (process.env.ALLOWED_USER_IDS || '').split(/[,\s]+/).filter(Boolean).map(Number),
  interval: Math.max(30, Number(process.env.CHECK_INTERVAL_SEC) || 60),
  dataFile: process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(ROOT, 'data', 'db.json'),
  newOnly: (process.env.NEW_ONLY ?? 'true').toLowerCase() !== 'false',
  idSlack: Number(process.env.ID_SLACK) || 3000,
  maxFilters: Number(process.env.MAX_FILTERS) || 30,
  maxPerCheck: 10, // bir yoxlamada bir filtr üçün maksimum bildiriş
  port: Number(process.env.PORT) || 0,
  keepAliveUrl: (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, ''),
  githubToken: process.env.GITHUB_TOKEN || '',
  gistId: process.env.GIST_ID || '',
};

if (!cfg.token || cfg.token.includes('BURAYA')) {
  console.error('❌ BOT_TOKEN təyin edilməyib. ".env.example" faylını ".env" adı ilə kopyala və tokeni yaz.');
  process.exit(1);
}

const store = new Store(cfg.dataFile, { githubToken: cfg.githubToken, gistId: cfg.gistId });
const tg = new Telegram(cfg.token);
const startedAt = Date.now();
let wakeChecker = null;
let failStreak = 0;
let failAlerted = false;
let lastGlobalRefresh = 0;

// ---------- köməkçilər ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString('az-AZ', { timeZone: 'Asia/Baku', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : '—';

function isAllowed(userId) {
  if (cfg.allowed.length) return cfg.allowed.includes(userId);
  return store.data.owners.includes(userId);
}
const adminIds = () => (cfg.allowed.length ? cfg.allowed : store.data.owners);

function send(chatId, text, extra = {}) {
  return tg.callRetry('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

function updateGlobalMax(items) {
  for (const it of items) if (it.id > store.data.globalMaxId) store.data.globalMaxId = it.id;
}

function listingCaption(it, filterName) {
  const lines = [`🚗 <b>${esc(it.name || 'Elan')}</b>`];
  if (it.price) lines.push(`💰 <b>${esc(it.price)}</b>`);
  if (it.attributes) lines.push(`📋 ${esc(it.attributes)}`);
  if (it.datetime) lines.push(`📍 ${esc(it.datetime)}`);
  const tags = [...(it.labels || [])];
  if (it.barter) tags.push('Barter');
  if (it.loan) tags.push('Kredit');
  if (tags.length) lines.push(`🏷 ${esc(tags.join(' · '))}`);
  if (filterName) lines.push(`🔎 <i>${esc(filterName)}</i>`);
  return lines.join('\n');
}

async function sendListing(chatId, it, filterName) {
  const caption = listingCaption(it, filterName);
  const reply_markup = { inline_keyboard: [[{ text: '🔗 Elana bax', url: it.url }]] };
  if (it.image) {
    try {
      return await tg.callRetry('sendPhoto', { chat_id: chatId, photo: it.image, caption, parse_mode: 'HTML', reply_markup });
    } catch (e) {
      if (e.code === 403) throw e; // istifadəçi botu bloklayıb
      console.warn('[notify] Şəkil göndərilmədi, mətn göndərilir:', e.message);
    }
  }
  return send(chatId, caption, { reply_markup });
}

// ---------- filtrlər ----------
const chatFilters = (chatId) => store.data.filters.filter((f) => f.chatId === chatId);
const findFilter = (chatId, id) => store.data.filters.find((f) => f.chatId === chatId && f.id === Number(id));

function filterCard(f) {
  const text =
    `<b>#${f.id} ${esc(f.name)}</b> — ${f.paused ? '⏸ dayandırılıb' : '✅ aktiv'}\n` +
    `🔗 <a href="${esc(f.url)}">Turbo.az-da aç</a>\n` +
    `🕒 Son yoxlama: ${fmtTime(f.lastCheck)} · 📨 Göndərilib: ${f.sentCount || 0}` +
    (f.lastError ? `\n⚠️ Son xəta: ${esc(f.lastError)}` : '');
  const reply_markup = {
    inline_keyboard: [
      [
        f.paused ? { text: '▶️ Davam et', callback_data: `r:${f.id}` } : { text: '⏸ Dayandır', callback_data: `p:${f.id}` },
        { text: '👁 Son elan', callback_data: `l:${f.id}` },
        { text: '🗑 Sil', callback_data: `d:${f.id}` },
      ],
    ],
  };
  return { text, reply_markup };
}

async function addFilter(chatId, input, customName) {
  const url = normalizeSearchUrl(input);
  if (!url) {
    return send(
      chatId,
      '❌ Bu link uyğun deyil.\n\nturbo.az saytında filtrləri seçib <b>"Elanları göstər"</b> düyməsini bas, sonra ünvan sətrindəki linki göndər.\nNümunə: <code>https://turbo.az/autos?q[make][]=4...</code>'
    );
  }
  const existing = chatFilters(chatId).find((f) => f.url === url);
  if (existing) return send(chatId, `ℹ️ Bu filtr artıq var: <b>#${existing.id} ${esc(existing.name)}</b>`);
  if (chatFilters(chatId).length >= cfg.maxFilters) return send(chatId, `❌ Maksimum ${cfg.maxFilters} filtr ola bilər. Əvvəlcə birini sil (/list).`);

  await tg.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  let result;
  try {
    result = await fetchListings(url);
  } catch (e) {
    return send(chatId, `❌ turbo.az-dan məlumat alınmadı (${esc(e.message)}). Bir az sonra yenidən cəhd et.`);
  }
  updateGlobalMax(result.items);

  const ids = result.items.map((i) => i.id);
  const name = (customName || result.title.replace(/\s*almaq$/i, '') || 'Filtr').slice(0, 60);
  const f = {
    id: store.data.nextId++,
    chatId,
    url,
    name,
    paused: false,
    seen: ids,
    maxId: ids.length ? Math.max(...ids) : 0,
    sentCount: 0,
    createdAt: Date.now(),
    lastCheck: Date.now(),
    lastError: null,
  };
  store.data.filters.push(f);
  store.save({ urgent: true });

  const totalTxt = result.total != null ? `${result.total} elan` : `${result.items.length}+ elan`;
  return send(
    chatId,
    `✅ Filtr əlavə olundu: <b>#${f.id} ${esc(f.name)}</b>\n` +
      `📊 Hazırda bu filtrə uyğun: <b>${totalTxt}</b>\n\n` +
      `Bundan sonra yerləşdirilən hər yeni elan dərhal sənə göndəriləcək (yoxlama hər ~${cfg.interval} saniyədən bir).`,
    { reply_markup: { inline_keyboard: [[{ text: '👁 Son elanı göstər', callback_data: `l:${f.id}` }]] } }
  );
}

async function showLatest(chatId, f) {
  const r = await fetchListings(f.url);
  updateGlobalMax(r.items);
  if (!r.items.length) return send(chatId, `ℹ️ <b>${esc(f.name)}</b> filtrinə uyğun hazırda elan yoxdur.`);
  const newest = r.items.reduce((a, b) => (b.id > a.id ? b : a));
  return sendListing(chatId, newest, f.name);
}

// ---------- yoxlama dövrü ----------
async function checkFilter(f) {
  const threshold = cfg.newOnly ? Math.max(store.data.globalMaxId, f.maxId || 0) - cfg.idSlack : -Infinity;
  const seen = new Set(f.seen);
  const found = [];

  for (let page = 1; page <= 3; page++) {
    const r = await fetchListings(f.url, page);
    updateGlobalMax(r.items);
    const fresh = r.items.filter((it) => !seen.has(it.id));
    for (const it of fresh) {
      seen.add(it.id);
      if (it.id > threshold) found.push(it);
    }
    // Səhifədəki elanların hamısı yenidirsə (qısa müddətdə çox elan) — növbəti səhifəyə də bax
    if (!(r.items.length >= 10 && fresh.length === r.items.length)) break;
    await sleep(1500);
  }

  f.seen = [...seen].slice(-3000);
  f.lastCheck = Date.now();
  f.lastError = null;
  if (!found.length) return 0;

  found.sort((a, b) => a.id - b.id);
  f.maxId = Math.max(f.maxId || 0, found[found.length - 1].id);
  const toSend = found.slice(-cfg.maxPerCheck);
  for (const it of toSend) {
    try {
      await sendListing(f.chatId, it, f.name);
      f.sentCount = (f.sentCount || 0) + 1;
    } catch (e) {
      console.error(`[notify] #${f.id} göndərilmədi:`, e.message);
    }
    await sleep(400);
  }
  if (found.length > toSend.length) {
    await send(
      f.chatId,
      `➕ <b>${esc(f.name)}</b>: daha ${found.length - toSend.length} yeni elan var.`,
      { reply_markup: { inline_keyboard: [[{ text: '🔗 Hamısına bax', url: f.url }]] } }
    ).catch(() => {});
  }
  console.log(`[check] #${f.id} "${f.name}": ${found.length} yeni elan`);
  return found.length;
}

async function refreshGlobalMax() {
  if (!cfg.newOnly || Date.now() - lastGlobalRefresh < 10 * 60 * 1000) return;
  lastGlobalRefresh = Date.now();
  try {
    const r = await fetchListings(`${BASE}/autos?q%5Bsort%5D=date`);
    updateGlobalMax(r.items);
  } catch (e) {
    console.warn('[check] Ümumi siyahı yüklənmədi:', e.message);
  }
}

async function alertAdmins(text) {
  for (const id of adminIds()) await send(id, text).catch(() => {});
}

async function checkLoop() {
  let cycleFails = 0;
  while (true) {
    const started = Date.now();
    const active = store.data.filters.filter((f) => !f.paused);
    let ok = 0;
    let failed = 0;
    let lastErr = '';

    if (active.length) await refreshGlobalMax();
    for (const f of active) {
      if (!store.data.filters.includes(f) || f.paused) continue; // arada silinib/dayandırılıb
      try {
        await checkFilter(f);
        ok++;
      } catch (e) {
        failed++;
        lastErr = e.message;
        f.lastError = e.message;
        console.warn(`[check] #${f.id} xəta:`, e.message);
      }
      await sleep(1500 + Math.random() * 1500);
    }
    store.save();

    if (failed && !ok) {
      cycleFails++;
      failStreak++;
      if (failStreak >= 5 && !failAlerted) {
        failAlerted = true;
        await alertAdmins(`⚠️ turbo.az-a qoşulmaq alınmır (${esc(lastErr)}). Bot avtomatik yenidən cəhd edəcək.`);
      }
    } else if (ok) {
      cycleFails = 0;
      failStreak = 0;
      if (failAlerted) {
        failAlerted = false;
        await alertAdmins('✅ turbo.az ilə əlaqə bərpa olundu, izləmə davam edir.');
      }
    }

    const backoff = cycleFails ? Math.min(15 * 60, cfg.interval * 2 ** Math.min(cycleFails, 5)) : cfg.interval;
    const wait = Math.max(5000, backoff * 1000 - (Date.now() - started)) + Math.random() * 5000;
    await new Promise((resolve) => {
      const t = setTimeout(done, wait);
      function done() {
        clearTimeout(t);
        wakeChecker = null;
        resolve();
      }
      wakeChecker = done;
    });
  }
}

// ---------- Telegram əmrləri ----------
const HELP =
  '🚗 <b>Turbo.az bildiriş botu</b>\n\n' +
  '<b>Necə istifadə etməli:</b>\n' +
  '1️⃣ turbo.az saytında istədiyin bütün filtrləri seç (marka, model, qiymət, il, yürüş, şəhər, ban növü, rəng, sürətlər qutusu və s.) və <b>"Elanları göstər"</b> düyməsini bas.\n' +
  '2️⃣ Brauzerin ünvan sətrindəki linki kopyala.\n' +
  '3️⃣ Linki bura göndər — vəssalam! Filtrə uyğun yeni elan yerləşdiriləndə dərhal xəbər verəcəyəm.\n\n' +
  'İstənilən qədər filtr əlavə edə bilərsən.\n\n' +
  '<b>Əmrlər:</b>\n' +
  '/list — filtrlərim (dayandır / sil / son elan)\n' +
  '/add &lt;link&gt; [ad] — filtr əlavə et (sadəcə linki göndərmək də olar)\n' +
  '/rename &lt;nömrə&gt; &lt;ad&gt; — filtrin adını dəyiş\n' +
  '/delete &lt;nömrə&gt; — filtri sil\n' +
  '/pause &lt;nömrə&gt;, /resume &lt;nömrə&gt; — dayandır / davam et\n' +
  '/check — indi yoxla\n' +
  '/status — botun vəziyyəti\n' +
  '/myid — Telegram ID-n';

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || msg.caption || '').trim();
  if (!text) return;

  const m = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  const cmd = m ? m[1].toLowerCase() : null;
  const args = m ? m[2].trim() : text;

  if (cmd === 'myid') return send(chatId, `🆔 Sənin Telegram ID-n: <code>${userId}</code>`);

  if (!isAllowed(userId)) {
    if (cmd === 'start' && !cfg.allowed.length && store.data.owners.length === 0) {
      store.data.owners.push(userId);
      store.save({ urgent: true });
      console.log(`[auth] Bot sahibi təyin olundu: ${userId}`);
      await send(chatId, `🔐 Sən bu botun sahibi kimi qeyd olundun (ID: <code>${userId}</code>). Başqaları botdan istifadə edə bilməyəcək.`);
      return send(chatId, HELP);
    }
    return send(chatId, `⛔ Bu bot şəxsidir.\nSənin ID: <code>${userId}</code>`);
  }

  switch (cmd) {
    case 'start':
    case 'help':
      return send(chatId, HELP);

    case 'list': {
      const list = chatFilters(chatId);
      if (!list.length) return send(chatId, '📭 Hələ filtr yoxdur. turbo.az-dan axtarış linkini göndər.');
      for (const f of list) {
        const { text: t, reply_markup } = filterCard(f);
        await send(chatId, t, { reply_markup });
      }
      return;
    }

    case 'add': {
      const found = extractUrl(args);
      if (!found) return send(chatId, 'İstifadə: <code>/add https://turbo.az/autos?... [ad]</code>');
      return addFilter(chatId, found.url, args.replace(found.raw, '').trim());
    }

    case 'rename': {
      const [, id, name] = args.match(/^#?(\d+)\s+(.+)$/s) || [];
      const f = id && findFilter(chatId, id);
      if (!f) return send(chatId, 'İstifadə: <code>/rename 1 Yeni ad</code>');
      f.name = name.trim().slice(0, 60);
      store.save({ urgent: true });
      return send(chatId, `✏️ #${f.id} adı dəyişdi: <b>${esc(f.name)}</b>`);
    }

    case 'delete':
    case 'pause':
    case 'resume': {
      const f = findFilter(chatId, args.replace('#', ''));
      if (!f) return send(chatId, `İstifadə: <code>/${cmd} 1</code> (nömrələr üçün /list)`);
      if (cmd === 'delete') store.data.filters = store.data.filters.filter((x) => x !== f);
      else f.paused = cmd === 'pause';
      store.save({ urgent: true });
      return send(chatId, cmd === 'delete' ? `🗑 #${f.id} silindi.` : cmd === 'pause' ? `⏸ #${f.id} dayandırıldı.` : `▶️ #${f.id} yenidən aktivdir.`);
    }

    case 'check':
      wakeChecker?.();
      return send(chatId, '🔄 Yoxlama başladı. Yeni elan olsa, göndəriləcək.');

    case 'status': {
      const mine = chatFilters(chatId);
      const upMin = Math.floor((Date.now() - startedAt) / 60000);
      return send(
        chatId,
        `📊 <b>Vəziyyət</b>\n` +
          `Filtrlər: ${mine.length} (aktiv: ${mine.filter((f) => !f.paused).length})\n` +
          `Yoxlama intervalı: ${cfg.interval} san\n` +
          `Rejim: ${cfg.newOnly ? 'yalnız yeni yerləşdirilən elanlar' : 'yeni + irəli çəkilən elanlar'}\n` +
          `İşləmə müddəti: ${Math.floor(upMin / 60)} saat ${upMin % 60} dəq\n` +
          `turbo.az əlaqəsi: ${failStreak ? `⚠️ ${failStreak} uğursuz dövr` : '✅ normal'}`
      );
    }

    case null: {
      const found = extractUrl(text);
      if (found) return addFilter(chatId, found.url, text.replace(found.raw, '').trim());
      return send(chatId, 'turbo.az axtarış linkini göndər və ya /help yaz.');
    }

    default:
      return send(chatId, 'Naməlum əmr. /help yaz.');
  }
}

async function onCallback(q) {
  const chatId = q.message?.chat.id;
  const answer = (text) => tg.call('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
  if (!chatId || !isAllowed(q.from.id)) return answer('⛔ İcazə yoxdur');

  const [action, id] = String(q.data || '').split(':');
  const f = findFilter(chatId, id);
  if (!f) return answer('Filtr tapılmadı (silinib?)');

  const edit = (text, reply_markup) =>
    tg
      .call('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup })
      .catch(() => {});

  switch (action) {
    case 'p':
    case 'r': {
      f.paused = action === 'p';
      store.save({ urgent: true });
      const c = filterCard(f);
      await edit(c.text, c.reply_markup);
      return answer(f.paused ? 'Dayandırıldı' : 'Aktivdir');
    }
    case 'd':
      await edit(`🗑 <b>#${f.id} ${esc(f.name)}</b> silinsin?`, {
        inline_keyboard: [[{ text: '✅ Bəli, sil', callback_data: `dy:${f.id}` }, { text: '↩️ Xeyr', callback_data: `dn:${f.id}` }]],
      });
      return answer();
    case 'dy':
      store.data.filters = store.data.filters.filter((x) => x !== f);
      store.save({ urgent: true });
      await edit(`🗑 #${f.id} ${esc(f.name)} silindi.`);
      return answer('Silindi');
    case 'dn': {
      const c = filterCard(f);
      await edit(c.text, c.reply_markup);
      return answer();
    }
    case 'l':
      await answer('Yüklənir…');
      return showLatest(chatId, f).catch((e) => send(chatId, `❌ Alınmadı: ${esc(e.message)}`));
    default:
      return answer();
  }
}

async function pollLoop() {
  let offset = store.data.offset || 0;
  while (true) {
    try {
      const updates = await tg.call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65000);
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        } catch (e) {
          console.error('[bot] Mesaj emal olunmadı:', e.message);
        }
      }
      if (updates.length) {
        store.data.offset = offset;
        store.save();
      }
    } catch (e) {
      if (e.code === 401) {
        console.error('❌ BOT_TOKEN yanlışdır. @BotFather-dan tokeni yenidən yoxla.');
        process.exit(1);
      }
      if (e.code === 409) console.error('⚠️ Bu bot başqa yerdə də işləyir (eyni token ilə iki nüsxə). Birini söndür.');
      else console.error('[bot]', e.message);
      await sleep(5000);
    }
  }
}

// ---------- HTTP sağlamlıq serveri (Render / Koyeb kimi PaaS üçün) ----------
function startHealthServer(port) {
  if (!port) return null;
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/' || pathname === '/health') {
      const body = JSON.stringify({
        ok: true,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        filters: store.data.filters.length,
        activeFilters: store.data.filters.filter((f) => !f.paused).length,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 HTTP sağlamlıq serveri aktivdir: 0.0.0.0:${port} (/health)`);
  });

  if (cfg.keepAliveUrl) {
    const target = `${cfg.keepAliveUrl}/health`;
    const timer = setInterval(() => {
      fetch(target, { signal: AbortSignal.timeout(15000) }).catch(() => {});
    }, 10 * 60 * 1000);
    timer.unref?.();
    console.log(`⏰ Avtomatik oyadıcı aktivdir (hər 10 dəq): ${target}`);
  }
  return server;
}

// ---------- başlanğıc ----------
async function main() {
  const healthServer = startHealthServer(cfg.port);
  await store.init();

  let me;
  try {
    me = await tg.call('getMe');
  } catch (e) {
    console.error(e.code === 401 ? '❌ BOT_TOKEN yanlışdır.' : `❌ Telegram-a qoşulmaq olmadı: ${e.message}`);
    process.exit(1);
  }
  await tg.call('deleteWebhook').catch(() => {});
  await tg
    .call('setMyCommands', {
      commands: [
        { command: 'list', description: 'Filtrlərim' },
        { command: 'add', description: 'Filtr əlavə et (link)' },
        { command: 'check', description: 'İndi yoxla' },
        { command: 'status', description: 'Botun vəziyyəti' },
        { command: 'help', description: 'Kömək' },
      ],
    })
    .catch(() => {});

  console.log(`✅ Bot işə düşdü: @${me.username}`);
  console.log(`   Filtrlər: ${store.data.filters.length}, interval: ${cfg.interval} san, məlumat faylı: ${cfg.dataFile}`);
  if (!cfg.allowed.length && !store.data.owners.length) {
    console.log(`   👉 Telegram-da @${me.username} botuna /start yaz — sən sahib kimi qeyd olunacaqsan.`);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    healthServer?.close();
    await store.flush();
    console.log('Bot dayandırıldı.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  checkLoop().catch((e) => console.error('[check] Dövr dayandı:', e));
  await pollLoop();
}

main();
