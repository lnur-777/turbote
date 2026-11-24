import * as cheerio from 'cheerio';

export const BASE = 'https://turbo.az';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Mətndən turbo.az linkini tapır (https:// olmadan yazılsa da). */
export function extractUrl(text = '') {
  const m = text.match(/(?:https?:\/\/)?(?:[\w-]+\.)*turbo\.az\/\S+/i);
  if (!m) return null;
  const raw = m[0].replace(/[)\].,>]+$/, '');
  return { raw: m[0], url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` };
}

/**
 * İstifadəçinin göndərdiyi axtarış linkini yoxlayır və normallaşdırır.
 * Bütün filtrlər (q[...]) olduğu kimi saxlanılır, yalnız sıralama "tarixə görə" edilir
 * və səhifə nömrəsi silinir. Uyğun deyilsə null qaytarır.
 */
export function normalizeSearchUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/(^|\.)turbo\.az$/i.test(u.hostname)) return null;
  if (!/\/autos(\/|$)/.test(u.pathname)) return null;
  if (/\/autos\/\d+/.test(u.pathname)) return null; // tək elanın linki — axtarış deyil
  u.protocol = 'https:';
  u.hostname = 'turbo.az';
  u.hash = '';
  u.searchParams.delete('page');
  u.searchParams.set('q[sort]', 'date');
  return u.toString();
}

/** Axtarış səhifəsini yükləyib elanları qaytarır. */
export async function fetchListings(url, page = 1) {
  const u = new URL(url);
  if (page > 1) u.searchParams.set('page', String(page));
  const res = await fetch(u, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'az,en;q=0.8,ru;q=0.6',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = new Error(`turbo.az HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parseListings(await res.text());
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** HTML-dən elan kartlarını çıxarır. */
export function parseListings(html) {
  const $ = cheerio.load(html);
  const title = clean($('.main-search__title h1').first().text());
  const totalText = clean($('.main-search__title span').first().text());
  const total = /\d/.test(totalText) ? parseInt(totalText.replace(/\D/g, ''), 10) : null;

  const items = [];
  const ids = new Set();
  $('.products-i[data-ad-id]').each((_, el) => {
    const $el = $(el);
    const id = Number($el.attr('data-ad-id'));
    const href = $el.find('a.products-i__link').attr('href') || '';
    if (!id || ids.has(id) || !/^\/autos\/\d+/.test(href)) return;
    ids.add(id);
    const cls = ($el.attr('class') || '').split(/\s+/);
    const $img = $el.find('.products-i__top img').first();
    const img = $img.attr('src') || $img.attr('data-src') || null;
    items.push({
      id,
      url: BASE + href,
      name: clean($el.find('.products-i__name').text()),
      price: clean($el.find('.products-i__price').text()),
      attributes: clean($el.find('.products-i__attributes').text()),
      datetime: clean($el.find('.products-i__datetime').text()),
      image: img && /^https?:\/\//.test(img) ? img : null,
      labels: $el.find('.products-i__label').map((_, l) => clean($(l).text())).get().filter(Boolean),
      barter: $el.find('.products-i__icon--barter').length > 0,
      loan: $el.find('.products-i__icon--loan').length > 0,
      vip: cls.includes('vipped'),
      featured: cls.includes('featured'),
      salon: cls.includes('salon'),
    });
  });

  return { title, total, items };
}
