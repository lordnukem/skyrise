# Businesses and names for let units, ported from src/tenants.js. The pick follows
# (id, tenant) through the same hash, so a unit gets the same business and name here
# as in the JS build. Names are original and invented; none is a real brand.
extends RefCounted

const C = preload("res://sim/constants.gd")
const H = preload("res://sim/hashing.gd")

const BUSINESSES := {
	"shop": [
		{"id": "sushi", "label": "Sushi bar", "accent": "#b4350a", "tint": 0.12, "awning": "noren", "glyph": "fish", "names": ["Yen's Kitchen", "Ikan Sushi Bar", "Tanjung Maki", "Little Wasabi", "Koi & Rice", "Salmon Run", "Sakura Lane Sushi", "Ombak Omakase"]},
		{"id": "italian", "label": "Italian", "accent": "#2f8f4e", "tint": 0.1, "awning": "stripe", "glyph": "slice", "names": ["Nonna Mei Trattoria", "Basil & Brick", "Pasta Pasar", "Luigi Lim Pizzeria", "Olive Lane", "Forno Bangsar", "Little Napoli", "The Dough Room"]},
		{"id": "indian", "label": "Banana-leaf", "accent": "#3f8f3a", "tint": 0.12, "awning": "flat", "glyph": "leaf", "names": ["Kumar's Curry House", "Sri Pisang Leaf", "Anjali Banana Leaf", "Thali Corner", "Raju Rasam House", "Leaf & Ladle", "Meena Mess", "Spice Route Café"]},
		{"id": "noodle", "label": "Noodle house", "accent": "#d64545", "tint": 0.1, "awning": "noren", "glyph": "bowl", "names": ["Wong Wantan Mee", "Uncle Lee Noodles", "Slurp Station", "Pan Mee Paradise", "Golden Broth", "Mee Mama", "Red Bowl", "Long Life Noodles"]},
		{"id": "kopitiam", "label": "Kopitiam", "accent": "#8a5a2b", "tint": 0.15, "awning": "stripe", "glyph": "cup", "names": ["Kopi Kaw Kaw", "Ah Seng Kopitiam", "Teh Tarik Times", "Roti Bakar Corner", "Kaya & Co", "Morning Kopi", "Hainan House", "Kopi O Club"]},
		{"id": "gym", "label": "Gym & pilates", "accent": "#2563eb", "tint": 0.1, "awning": "flat", "glyph": "dumbbell", "names": ["Strong Viking Gym & Pilates", "Kuat Fitness", "Core & More", "Stretch Lab", "Iron Durian Gym", "Flex Studio", "Balance Pilates", "Lift Off Fitness"]},
		{"id": "florist", "label": "Florist", "accent": "#d4588f", "tint": 0.12, "awning": "stripe", "glyph": "flower", "names": ["Bunga Bunga", "Orchid & Ivy", "Petal Pusher", "Melati Florist", "Bloom Room", "Hibiscus Lane", "Stem & Sprig", "Kenanga Flowers"]},
		{"id": "books", "label": "Bookshop", "accent": "#7c4dbd", "tint": 0.1, "awning": "none", "glyph": "book", "names": ["Kedai Buku Siti", "Dog-Eared Pages", "Chapter Two", "The Reading Nook", "Pustaka Kecil", "Ink & Paper", "Second Shelf", "Bookmark Lane"]},
	],
	"office": [
		{"id": "tech", "label": "Tech studio", "accent": "#2a9d8f", "tint": 0.12, "windows": "grid", "glyph": "chip", "names": ["Pixel Padi Studio", "Byte Kampung", "Cloud Nine Labs", "Kodekita", "Lantern Logic", "Bitwise Bros", "Nasi Lemak Labs", "Orbit Apps"]},
		{"id": "law", "label": "Law firm", "accent": "#6b4f2a", "tint": 0.1, "windows": "tall", "glyph": "scales", "names": ["Rahman & Tan Advocates", "Lim Law Chambers", "Kaur & Co", "Fair Hearing LLP", "Ismail Partners", "Chong & Devi", "Justice Lane Law", "Ng Associates"]},
		{"id": "bank", "label": "Bank branch", "accent": "#c9a227", "tint": 0.12, "windows": "band", "glyph": "coin", "names": ["Bank Gemilang", "Ringgit Trust", "Harimau Savings", "Peak Capital", "Mutiara Bank", "Jade Finance", "Pinnacle Credit", "Bayu Bank"]},
		{"id": "design", "label": "Design agency", "accent": "#e76f51", "tint": 0.12, "windows": "wide", "glyph": "pen", "names": ["Batik Lab Design", "Studio Senja", "Kite & Co", "Bold Type", "Rumah Rekaan", "Hue Studio", "Paper Plane Agency", "Sketch Republic"]},
	],
	"flat": [
		{"id": "plant", "label": "Flat", "accent": "#2f8f4e", "tint": 0.08, "curtain": Color(214 / 255.0, 240 / 255.0, 214 / 255.0, 0.6), "extra": "plant"},
		{"id": "bike", "label": "Flat", "accent": "#2563eb", "tint": 0.08, "curtain": Color(200 / 255.0, 220 / 255.0, 250 / 255.0, 0.6), "extra": "bike"},
		{"id": "laundry", "label": "Flat", "accent": "#d4588f", "tint": 0.08, "curtain": Color(250 / 255.0, 210 / 255.0, 225 / 255.0, 0.6), "extra": "laundry"},
		{"id": "plain", "label": "Flat", "accent": "#c9a227", "tint": 0.08, "curtain": Color(1.0, 240 / 255.0, 200 / 255.0, 0.6), "extra": "none"},
	],
	"food": [
		{"id": "hawker", "label": "Hawker hall", "accent": "#d64545", "tint": 0.12, "glyph": "bowl"},
		{"id": "kopi", "label": "Kopi court", "accent": "#8a5a2b", "tint": 0.12, "glyph": "cup"},
		{"id": "pizza", "label": "Pizza court", "accent": "#2f8f4e", "tint": 0.1, "glyph": "slice"},
	],
	"hotel": [
		{"id": "classic", "label": "Hotel room", "accent": "#c9a227", "tint": 0.1, "spread": Color(240 / 255.0, 220 / 255.0, 170 / 255.0, 0.85)},
		{"id": "garden", "label": "Hotel room", "accent": "#2a9d8f", "tint": 0.1, "spread": Color(190 / 255.0, 230 / 255.0, 220 / 255.0, 0.85)},
	],
	"hall": [
		{"id": "velvet", "label": "Event hall", "accent": "#96202a", "tint": 0.1, "curtain": Color(150 / 255.0, 30 / 255.0, 40 / 255.0, 0.8)},
		{"id": "royal", "label": "Event hall", "accent": "#2a3f96", "tint": 0.1, "curtain": Color(40 / 255.0, 60 / 255.0, 150 / 255.0, 0.8)},
	],
}

const SURNAMES := ["Tan", "Lim", "Lee", "Wong", "Ng", "Chong", "Abdullah", "Rahman", "Ismail", "Hassan", "Yusof", "Aziz",
	"Kumar", "Raj", "Pillai", "Nair", "Singh", "Kaur", "Fernandez", "Gomez", "Chin", "Majimbun", "Smith", "Viking"]
const HALL_NAMES := ["Dewan Bintang", "The Grand Ballroom", "Hall of Lanterns", "Sky Pavilion"]


## Deterministic integer 0..99999 per (id, tenant).
static func hash_int(id: int, tenant: int) -> int:
	return absi(int(floor(H.hash01(id, tenant) * 100000.0)))


## The business of a unit's current tenant, or {} for a type with one look.
static func tenant_of(st: Dictionary) -> Dictionary:
	var list: Array = BUSINESSES.get(st.type, [])
	if list.is_empty():
		return {}
	return list[hash_int(st.id, st.get("tenant", 0)) % list.size()]


static func _floor_tag(f: int) -> String:
	return "B%d" % (1 - f) if f < 1 else str(f)


## The unit's custom name, else its generated one; "" for types with no names.
static func name_of(st: Dictionary) -> String:
	if st.get("name") != null and str(st.name) != "":
		return st.name
	var h := hash_int(st.id, st.get("tenant", 0)) >> 8
	var biz := tenant_of(st)
	if biz.has("names"):
		return biz.names[h % biz.names.size()]
	match st.type:
		"flat": return "The %s family" % SURNAMES[h % SURNAMES.size()]
		"food": return "Medan Selera %s" % _floor_tag(st.floor)
		"hotel": return "Room %s%s" % [_floor_tag(st.floor), str(st.col).pad_zeros(2)]
		"hall": return HALL_NAMES[h % HALL_NAMES.size()]
	return ""


## A typed name made safe to store: control characters stripped, whitespace collapsed,
## trimmed and cut to NAME_MAX. Empty (or not a string) gives null.
static func clean_name(raw: Variant) -> Variant:
	if typeof(raw) != TYPE_STRING:
		return null
	var out := ""
	for ch in raw:
		var c: int = ch.unicode_at(0)
		if c <= 0x1f or (c >= 0x7f and c <= 0x9f):
			continue
		out += ch
	var ws := RegEx.create_from_string("\\s+")
	out = ws.sub(out, " ", true).strip_edges().substr(0, C.NAME_MAX).strip_edges()
	return null if out == "" else out
