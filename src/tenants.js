// Businesses and names for let units. Pure data plus two pickers: no DOM, so the
// sim, the renderer and the tests share it. The pick follows (id, tenant), so a
// unit keeps its look and name until a new tenant moves in, and never flickers.
// Every business has the same economy; only the facade and the name differ.
// Names are original and invented; none is a real brand.

import { NAME_MAX, FACADE_TINT_MAX } from './constants.js';
import { hash01 } from './anim.js';

// `accent` tints the facade by `tint` (at most FACADE_TINT_MAX) and colours the
// awning and glyph; `awning` is stripe | flat | noren | none; `windows` is the
// office window pattern; `extra` is a flat's balcony item.
export const BUSINESSES = {
  shop: [
    { id: 'sushi', label: 'Sushi bar', accent: '#b4350a', tint: 0.12, awning: 'noren', glyph: 'fish', names: ["Yen's Kitchen", 'Ikan Sushi Bar', 'Tanjung Maki', 'Little Wasabi', 'Koi & Rice', 'Salmon Run', 'Sakura Lane Sushi', 'Ombak Omakase'] },
    { id: 'italian', label: 'Italian', accent: '#2f8f4e', tint: 0.1, awning: 'stripe', glyph: 'slice', names: ['Nonna Mei Trattoria', 'Basil & Brick', 'Pasta Pasar', 'Luigi Lim Pizzeria', 'Olive Lane', 'Forno Bangsar', 'Little Napoli', 'The Dough Room'] },
    { id: 'indian', label: 'Banana-leaf', accent: '#3f8f3a', tint: 0.12, awning: 'flat', glyph: 'leaf', names: ["Kumar's Curry House", 'Sri Pisang Leaf', 'Anjali Banana Leaf', 'Thali Corner', 'Raju Rasam House', 'Leaf & Ladle', 'Meena Mess', 'Spice Route Café'] },
    { id: 'noodle', label: 'Noodle house', accent: '#d64545', tint: 0.1, awning: 'noren', glyph: 'bowl', names: ['Wong Wantan Mee', 'Uncle Lee Noodles', 'Slurp Station', 'Pan Mee Paradise', 'Golden Broth', 'Mee Mama', 'Red Bowl', 'Long Life Noodles'] },
    { id: 'kopitiam', label: 'Kopitiam', accent: '#8a5a2b', tint: 0.15, awning: 'stripe', glyph: 'cup', names: ['Kopi Kaw Kaw', 'Ah Seng Kopitiam', 'Teh Tarik Times', 'Roti Bakar Corner', 'Kaya & Co', 'Morning Kopi', 'Hainan House', 'Kopi O Club'] },
    { id: 'gym', label: 'Gym & pilates', accent: '#2563eb', tint: 0.1, awning: 'flat', glyph: 'dumbbell', names: ['Strong Viking Gym & Pilates', 'Kuat Fitness', 'Core & More', 'Stretch Lab', 'Iron Durian Gym', 'Flex Studio', 'Balance Pilates', 'Lift Off Fitness'] },
    { id: 'florist', label: 'Florist', accent: '#d4588f', tint: 0.12, awning: 'stripe', glyph: 'flower', names: ['Bunga Bunga', 'Orchid & Ivy', 'Petal Pusher', 'Melati Florist', 'Bloom Room', 'Hibiscus Lane', 'Stem & Sprig', 'Kenanga Flowers'] },
    { id: 'books', label: 'Bookshop', accent: '#7c4dbd', tint: 0.1, awning: 'none', glyph: 'book', names: ['Kedai Buku Siti', 'Dog-Eared Pages', 'Chapter Two', 'The Reading Nook', 'Pustaka Kecil', 'Ink & Paper', 'Second Shelf', 'Bookmark Lane'] },
  ],
  office: [
    { id: 'tech', label: 'Tech studio', accent: '#2a9d8f', tint: 0.12, windows: 'grid', glyph: 'chip', names: ['Pixel Padi Studio', 'Byte Kampung', 'Cloud Nine Labs', 'Kodekita', 'Lantern Logic', 'Bitwise Bros', 'Nasi Lemak Labs', 'Orbit Apps'] },
    { id: 'law', label: 'Law firm', accent: '#6b4f2a', tint: 0.1, windows: 'tall', glyph: 'scales', names: ['Rahman & Tan Advocates', 'Lim Law Chambers', 'Kaur & Co', 'Fair Hearing LLP', 'Ismail Partners', 'Chong & Devi', 'Justice Lane Law', 'Ng Associates'] },
    { id: 'bank', label: 'Bank branch', accent: '#c9a227', tint: 0.12, windows: 'band', glyph: 'coin', names: ['Bank Gemilang', 'Ringgit Trust', 'Harimau Savings', 'Peak Capital', 'Mutiara Bank', 'Jade Finance', 'Pinnacle Credit', 'Bayu Bank'] },
    { id: 'design', label: 'Design agency', accent: '#e76f51', tint: 0.12, windows: 'wide', glyph: 'pen', names: ['Batik Lab Design', 'Studio Senja', 'Kite & Co', 'Bold Type', 'Rumah Rekaan', 'Hue Studio', 'Paper Plane Agency', 'Sketch Republic'] },
  ],
  flat: [
    { id: 'plant', label: 'Flat', accent: '#2f8f4e', tint: 0.08, curtain: 'rgba(214,240,214,0.6)', extra: 'plant' },
    { id: 'bike', label: 'Flat', accent: '#2563eb', tint: 0.08, curtain: 'rgba(200,220,250,0.6)', extra: 'bike' },
    { id: 'laundry', label: 'Flat', accent: '#d4588f', tint: 0.08, curtain: 'rgba(250,210,225,0.6)', extra: 'laundry' },
    { id: 'plain', label: 'Flat', accent: '#c9a227', tint: 0.08, curtain: 'rgba(255,240,200,0.6)', extra: 'none' },
  ],
  food: [
    { id: 'hawker', label: 'Hawker hall', accent: '#d64545', tint: 0.12, glyph: 'bowl' },
    { id: 'kopi', label: 'Kopi court', accent: '#8a5a2b', tint: 0.12, glyph: 'cup' },
    { id: 'pizza', label: 'Pizza court', accent: '#2f8f4e', tint: 0.1, glyph: 'slice' },
  ],
  hotel: [
    { id: 'classic', label: 'Hotel room', accent: '#c9a227', tint: 0.1, spread: 'rgba(240,220,170,0.85)' },
    { id: 'garden', label: 'Hotel room', accent: '#2a9d8f', tint: 0.1, spread: 'rgba(190,230,220,0.85)' },
  ],
  hall: [
    { id: 'velvet', label: 'Event hall', accent: '#96202a', tint: 0.1, curtain: 'rgba(150,30,40,0.8)' },
    { id: 'royal', label: 'Event hall', accent: '#2a3f96', tint: 0.1, curtain: 'rgba(40,60,150,0.8)' },
  ],
};
for (const type in BUSINESSES) for (const b of BUSINESSES[type]) {
  b.key = type + '.' + b.id;                      // unique across types
  b.tint = Math.min(b.tint, FACADE_TINT_MAX);
}

const SURNAMES = ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chong', 'Abdullah', 'Rahman', 'Ismail', 'Hassan', 'Yusof', 'Aziz',
  'Kumar', 'Raj', 'Pillai', 'Nair', 'Singh', 'Kaur', 'Fernandez', 'Gomez', 'Chin', 'Majimbun', 'Smith', 'Viking'];
const HALL_NAMES = ['Dewan Bintang', 'The Grand Ballroom', 'Hall of Lanterns', 'Sky Pavilion'];

// Deterministic integer 0..99999 per (id, tenant), from the renderer's window hash
// (which can come out negative, hence the abs).
export const hashInt = (id, tenant) => Math.abs(Math.floor(hash01(id, tenant) * 100000));

// The business of a unit's current tenant, or null for a type with one look.
export function tenantOf(st) {
  const list = BUSINESSES[st.type];
  return list ? list[hashInt(st.id, st.tenant || 0) % list.length] : null;
}

// The unit's custom name, else its generated one; null for types with no names.
export function nameOf(st) {
  if (st.name) return st.name;
  const h = hashInt(st.id, st.tenant || 0) >>> 8;
  const biz = tenantOf(st);
  if (biz && biz.names) return biz.names[h % biz.names.length];
  if (st.type === 'flat') return `The ${SURNAMES[h % SURNAMES.length]} family`;
  if (st.type === 'food') return `Medan Selera ${st.floor < 1 ? 'B' + (1 - st.floor) : st.floor}`;
  if (st.type === 'hotel') return `Room ${st.floor < 1 ? 'B' + (1 - st.floor) : st.floor}${String(st.col).padStart(2, '0')}`;
  if (st.type === 'hall') return HALL_NAMES[h % HALL_NAMES.length];
  return null;
}

// A typed name made safe to store: control characters stripped, whitespace
// collapsed, trimmed and cut to NAME_MAX. Empty (or not a string) gives null,
// which brings back the generated name.
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return s || null;
}
