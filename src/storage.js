import fs from 'node:fs';
import path from 'node:path';

const GIST_FILE = 'turboaz-bot-db.json';
const GIST_DEBOUNCE_MS = 5 * 60 * 1000; // adi yenilənmələrdə 5 dəqiqədən bir buluda yaz

const DEFAULTS = {
  owners: [],        // ALLOWED_USER_IDS boşdursa, /start yazan ilk istifadəçi bura düşür
  offset: 0,         // Telegram getUpdates offset
  nextId: 1,         // növbəti filtr nömrəsi
  globalMaxId: 0,    // turbo.az-da gördüyümüz ən böyük elan ID-si
  filters: [],
};

export class Store {
  constructor(file, { githubToken = '', gistId = '' } = {}) {
    this.file = file;
    this.githubToken = githubToken.trim();
    this.gistId = gistId.trim();
    this.loadedFromDisk = false;
    this.syncTimer = null;
    this.syncing = null;
    this.data = structuredClone(DEFAULTS);
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
      this.loadedFromDisk = true;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[store] Fayl oxunmadı:', e.message);
    }
  }

  async gh(url, options = {}) {
    const res = await fetch(`https://api.github.com${url}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.githubToken}`,
        'User-Agent': 'turboaz-telegram-bot',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`GitHub HTTP ${res.status}${txt ? `: ${txt.slice(0, 120)}` : ''}`);
    }
    return res.json();
  }

  async init() {
    if (!this.githubToken) return;
    try {
      if (!this.gistId) {
        const list = await this.gh('/gists?per_page=100');
        const found = Array.isArray(list) && list.find((g) => g?.files?.[GIST_FILE]);
        if (found) this.gistId = found.id;
      }

      if (this.gistId) {
        if (!this.loadedFromDisk) {
          const gist = await this.gh(`/gists/${this.gistId}`);
          const raw = gist?.files?.[GIST_FILE]?.content;
          if (raw) {
            this.data = { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
            this.writeLocal();
            console.log(`☁️ Bulud yaddaşından (Gist ${this.gistId}) ${this.data.filters.length} filtr bərpa olundu.`);
          }
        } else {
          console.log(`☁️ Bulud yaddaşı aktivdir (Gist ${this.gistId}).`);
        }
      } else {
        const created = await this.gh('/gists', {
          method: 'POST',
          body: JSON.stringify({
            description: 'turboaz-bot melumat bazasi (silmeyin)',
            public: false,
            files: { [GIST_FILE]: { content: JSON.stringify(this.data, null, 1) } },
          }),
        });
        this.gistId = created.id;
        console.log(`☁️ Yeni gizli GitHub Gist yaradıldı: ${this.gistId}`);
      }
    } catch (e) {
      console.warn('[store] Bulud yaddaşı (GitHub Gist) qoşulmadı, lokal fayldan istifadə olunur:', e.message);
    }
  }

  writeLocal() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const json = JSON.stringify(this.data, null, 1);
      const tmp = `${this.file}.tmp`;
      try {
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, this.file);
      } catch {
        fs.writeFileSync(this.file, json);
      }
    } catch (e) {
      console.error('[store] Yadda saxlanmadı:', e.message);
    }
  }

  save({ urgent = false } = {}) {
    this.writeLocal();
    if (!this.githubToken || !this.gistId) return;

    const delay = urgent ? 1000 : GIST_DEBOUNCE_MS;
    if (urgent && this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (!this.syncTimer) {
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.pushRemote().catch((e) => console.warn('[store] Gist yenilənmədi:', e.message));
      }, delay);
      this.syncTimer.unref?.();
    }
  }

  async pushRemote() {
    if (!this.githubToken || !this.gistId) return;
    if (this.syncing) await this.syncing.catch(() => {});
    this.syncing = this.gh(`/gists/${this.gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify(this.data, null, 1) } },
      }),
    });
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  async flush() {
    this.writeLocal();
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    await this.pushRemote().catch((e) => console.warn('[store] Son Gist sinxronizasiyası alınmadı:', e.message));
  }
}
