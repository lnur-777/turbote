// Telegram olmadan yoxlama: node scripts/try.js "<turbo.az axtarış linki>"
import { normalizeSearchUrl, fetchListings } from '../src/turbo.js';

const input = process.argv[2] || 'https://turbo.az/autos';
const url = normalizeSearchUrl(input);
if (!url) {
  console.error('❌ Yanlış link:', input);
  process.exit(1);
}
const r = await fetchListings(url);
console.log('Link :', url);
console.log('Başlıq:', r.title, '| Cəmi:', r.total, '| Səhifədə:', r.items.length);
console.table(r.items.slice(0, 15).map(({ id, name, price, attributes, datetime, vip }) => ({ id, name, price, attributes, datetime, vip })));
