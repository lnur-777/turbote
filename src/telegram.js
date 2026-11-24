// Telegram Bot API üçün minimal klient (əlavə kitabxana lazım deyil)
export class Telegram {
  constructor(token) {
    this.base = `https://api.telegram.org/bot${token}/`;
  }

  async call(method, params = {}, timeoutMs = 30000) {
    let res;
    try {
      res = await fetch(this.base + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = new Error(`Telegram ${method}: şəbəkə xətası (${e.message})`);
      err.network = true;
      throw err;
    }
    const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}`, error_code: res.status }));
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description}`);
      err.code = data.error_code;
      err.retryAfter = data.parameters?.retry_after;
      throw err;
    }
    return data.result;
  }

  // 429 (çox sorğu) gələrsə gözləyib təkrar yoxlayır
  async callRetry(method, params, tries = 3) {
    for (let i = 0; ; i++) {
      try {
        return await this.call(method, params);
      } catch (e) {
        if (i >= tries) throw e;
        if (e.retryAfter) await sleep((e.retryAfter + 1) * 1000);
        else if (e.network) await sleep(3000);
        else throw e;
      }
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
