# The canvas and UI colours, from the CSS tokens in styles.css (light and dark).
# The renderer mixes the day colours toward the night ones as the hours pass.
extends RefCounted

const LIGHT := {
	"bg": "#eef1f5", "fg": "#172033", "muted": "#4f5a6c", "panel": "#ffffff", "panel-2": "#f6f8fb", "panel-border": "#d4dae3",
	"accent": "#2563eb", "accent-fg": "#ffffff", "danger": "#b4350a", "warn": "#a04f04", "good": "#136d35",
	"sky-top": "#5ea8ff", "sky-bottom": "#d9ecff", "night-top": "#060a1e", "night-bottom": "#1b2650", "horizon": "#ffb070",
	"skyline": "#7b8db0", "ground": "#6f7f52", "ground-dark": "#55633f", "kerb": "#cfd6dd", "grid-line": Color(23 / 255.0, 32 / 255.0, 51 / 255.0, 0.09),
	"wall-dark": "#7d8898", "glass": "#b7dcf7", "window-lit": "#ffd784", "lobby": "#e9d3a0", "office": "#a6bedf", "shop": "#eeb09e",
	"flat": "#eedcb4", "stairs": "#8f98a8", "shaft": "#3a4250", "express": "#2f4a6e", "security": "#c9d5e3", "food": "#f2c38b",
	"escalator": "#9aa7b8", "slab": "#8a8f98", "hotel": "#d8c2e6", "hall": "#e0a8a0", "housekeeping": "#bfdccd", "servicelift": "#4d4636",
	"parking": "#7a828c", "transit": "#3f6f8f", "clinic": "#e8eef3", "plant": "#9a9c86", "soil": "#7a5f45", "soil-dark": "#5a4431",
	"dug": "#a39b8e", "car": "#f6b73c", "person": "#1f2937", "unreach": Color(194 / 255.0, 65 / 255.0, 12 / 255.0, 0.55),
	"ghost-ok": Color(21 / 255.0, 128 / 255.0, 61 / 255.0, 0.35), "ghost-bad": Color(194 / 255.0, 65 / 255.0, 12 / 255.0, 0.35),
	"float-bg": Color(1, 1, 1, 0.88), "accent-soft": Color(37 / 255.0, 99 / 255.0, 235 / 255.0, 0.14),
}

const DARK := {
	"bg": "#0f141c", "fg": "#e6ebf2", "muted": "#a3aec0", "panel": "#1a2230", "panel-2": "#202a3a", "panel-border": "#2e3a4c",
	"accent": "#60a5fa", "accent-fg": "#0b1220", "danger": "#fb923c", "warn": "#fbbf24", "good": "#4ade80",
	"sky-top": "#2b4a80", "sky-bottom": "#6b8fc4", "night-top": "#04071a", "night-bottom": "#141c3d", "horizon": "#e08a4a",
	"skyline": "#45557a", "ground": "#3f4a35", "ground-dark": "#2c3425", "kerb": "#6b7480", "grid-line": Color(230 / 255.0, 235 / 255.0, 242 / 255.0, 0.07),
	"wall-dark": "#39434f", "glass": "#6aa5d8", "window-lit": "#ffd784", "lobby": "#b58f4a", "office": "#4f6d99", "shop": "#a85f4e",
	"flat": "#9c8458", "stairs": "#5e6775", "shaft": "#171d27", "express": "#1c2f4a", "security": "#58697f", "food": "#a87543",
	"escalator": "#4d5868", "slab": "#6b717c", "hotel": "#6f5a80", "hall": "#7d4a46", "housekeeping": "#4f6e60", "servicelift": "#3a3528",
	"parking": "#444b55", "transit": "#24465c", "clinic": "#7f8c98", "plant": "#5c5e4e", "soil": "#3e3024", "soil-dark": "#2b2119",
	"dug": "#59544c", "car": "#f6b73c", "person": "#f3f4f6", "unreach": Color(251 / 255.0, 146 / 255.0, 60 / 255.0, 0.6),
	"ghost-ok": Color(74 / 255.0, 222 / 255.0, 128 / 255.0, 0.35), "ghost-bad": Color(251 / 255.0, 146 / 255.0, 60 / 255.0, 0.35),
	"float-bg": Color(15 / 255.0, 20 / 255.0, 28 / 255.0, 0.82), "accent-soft": Color(96 / 255.0, 165 / 255.0, 250 / 255.0, 0.18),
}


## Colours for a theme as Color values.
static func colours(dark: bool) -> Dictionary:
	var src: Dictionary = DARK if dark else LIGHT
	var out := {}
	for k in src:
		out[k] = src[k] if src[k] is Color else Color.html(src[k])
	return out
