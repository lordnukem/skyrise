# The toolbar as one control: every tool button drawn in a single _draw, grouped by texture
# (all backgrounds, then all icons from one atlas, then all text) so Godot batches the
# whole toolbar into a few draw calls. A grid of Button nodes cost about 75 draw calls and
# kept software-rendered and low-end GPUs below 60 fps. Same look and behaviour as the
# JS toolbar: rows of five (more on wide screens), at most three rows before it scrolls,
# a chevron that collapses it to the selected tool, padlocks and star pills on locked tools.
extends Control

signal tool_chosen(id: String)
signal toggled(collapsed: bool)

const C = preload("res://sim/constants.gd")

const TOOL_H := 66.0
const GAP := 6.0
const MAX_ROWS := 3
const CELL_PX := 72.0
const ICON := 40                          # atlas cell, px
const ICON_FILES := {
	"lobby": "icon-lobby.png", "stairs": "icon-stairs.png", "elevator": "icon-lift.png", "car": "icon-lift.png",
	"express": "icon-express.png", "office": "icon-office.png", "shop": "icon-shop.png", "flat": "icon-flat.png",
	"security": "icon-security.png", "food": "icon-food.png", "escalator": "icon-escalator.png", "floor": "icon-floor.png",
	"inspect": "icon-inspect.png", "hotel": "icon-hotel.png", "housekeeping": "icon-housekeeping.png", "hall": "icon-hall.png",
	"parking": "icon-parking.png", "transit": "icon-transit.png", "servicelift": "icon-service-lift.png",
	"clinic": "icon-clinic.png", "plant": "icon-plant.png", "demolish": "icon-demolish.png", "landmark": "icon-landmark.png",
	"lock": "icon-lock.png",
}
const TOOL_META := {
	"car": {"label": "Add car", "cost": C.LIFT_CAR_COST}, "dig": {"label": "Dig", "cost": C.DIG_COST},
	"inspect": {"label": "Inspect", "hint": "details"}, "demolish": {"label": "Demolish", "hint": "half back"},
}
const TOOL_BREAK := {"escalator": "Esca-\nlator", "housekeeping": "House-\nkeeping"}

var ids: Array = ["toggle"] + C.TOOL_ORDER + ["inspect", "demolish"]
var labels := {}                          # id -> [line, line?]
var prices := {}
var current := "office"
var collapsed := false
var rating := 1
var pal: Dictionary = {}
var font: Font
var atlas: ImageTexture
var regions := {}                         # icon file -> Rect2 in the atlas
var box_tex: ImageTexture                 # a white rounded rectangle, drawn as a nine-patch
var scroll := 0.0
var press := Vector2.ZERO
var pressing := false
var dragged := false


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	for id in ids:
		if id == "toggle":
			continue
		var t: Dictionary = C.TYPES.get(id, TOOL_META.get(id, {}))
		var text: String = TOOL_BREAK.get(id, t.label)
		if text == t.label and text.length() > 8 and text.contains(" "):
			text = text.replace(" ", "\n")
		labels[id] = text.split("\n")
		var cost: int = t.get("cost", 0)
		prices[id] = ("$%dk" % (cost / 1000)) if cost >= 100000 else (("$" + _thousands(cost)) if cost else t.get("hint", ""))
	_build_atlas()
	_build_box()


func _build_atlas() -> void:
	var files := []
	for f in ICON_FILES.values():
		if not files.has(f):
			files.append(f)
	var cols := 6
	var img := Image.create(cols * ICON, ceili(files.size() / float(cols)) * ICON, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for i in files.size():
		var tex: Texture2D = load("res://assets/art/" + files[i])
		var src := tex.get_image()
		if src.is_compressed():
			src.decompress()
		src.convert(Image.FORMAT_RGBA8)
		src.resize(ICON, ICON, Image.INTERPOLATE_LANCZOS)
		var at := Vector2i((i % cols) * ICON, (i / cols) * ICON)
		img.blit_rect(src, Rect2i(0, 0, ICON, ICON), at)
		regions[files[i]] = Rect2(at, Vector2(ICON, ICON))
	atlas = ImageTexture.create_from_image(img)


func _build_box() -> void:
	var n := 32
	var r := 12.0
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			# Distance outside the rounded rectangle, for an antialiased edge.
			var px := clampf(x + 0.5, r, n - r)
			var py := clampf(y + 0.5, r, n - r)
			var d := Vector2(x + 0.5 - px, y + 0.5 - py).length() - r
			img.set_pixel(x, y, Color(1, 1, 1, clampf(0.5 - d, 0, 1)))
	box_tex = ImageTexture.create_from_image(img)


static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out


# ---- Layout -----------------------------------------------------------------

func per_row() -> int:
	return maxi(5, int(floor(size.x / CELL_PX)))


func _shown() -> Array:
	return ["toggle", current] if collapsed else ids


func rows() -> int:
	return ceili(_shown().size() / float(per_row()))


func visible_rows() -> int:
	return 1 if collapsed else mini(MAX_ROWS, rows())


func _cell_w() -> float:
	var n := per_row()
	return (size.x - (n - 1) * GAP) / n


func _rect(i: int) -> Rect2:
	var n := per_row()
	var w := _cell_w()
	return Rect2((i % n) * (w + GAP), (i / n) * (TOOL_H + GAP) - scroll, w, TOOL_H)


func _max_scroll() -> float:
	return maxf(0, rows() * (TOOL_H + GAP) - GAP - size.y)


func refresh() -> void:
	custom_minimum_size = Vector2(0, visible_rows() * (TOOL_H + GAP) - GAP)
	scroll = clampf(scroll, 0, _max_scroll())
	queue_redraw()


func set_tool(id: String) -> void:
	current = id
	refresh()


func set_collapsed(on: bool) -> void:
	collapsed = on
	scroll = 0.0
	refresh()


func set_rating(r: int) -> void:
	if r != rating:
		rating = r
		queue_redraw()


func locked(id: String) -> bool:
	return C.UNLOCK_AT.has(id) and C.UNLOCK_AT[id] > rating


# ---- Drawing ------------------------------------------------------------------

func _nine(r: Rect2, col: Color) -> void:
	# A nine-patch by hand: corners from the texture, edges and centre stretched.
	var m := 12.0
	var xs := [r.position.x, r.position.x + m, r.end.x - m, r.end.x]
	var ys := [r.position.y, r.position.y + m, r.end.y - m, r.end.y]
	var us := [0.0, 12.0, 20.0, 32.0]
	for j in 3:
		for i in 3:
			var dst := Rect2(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j])
			if dst.size.x <= 0 or dst.size.y <= 0:
				continue
			draw_texture_rect_region(box_tex, dst, Rect2(us[i], us[j], us[i + 1] - us[i], us[j + 1] - us[j]), col)


func _draw() -> void:
	if pal.is_empty():
		return
	var shown := _shown()
	var cells := []
	for i in shown.size():
		var r := _rect(i)
		if r.end.y < 0 or r.position.y > size.y:
			continue
		cells.append([shown[i], r])
	# 1. Backgrounds: a border box with the fill box inset by a pixel, all from one texture.
	for c in cells:
		var on: bool = c[0] == current
		_nine(c[1], pal.accent if on else pal["panel-border"])
		_nine(c[1].grow(-1), pal.accent if on else pal.panel)
	# 2. Icons, from the atlas: a smaller icon above a two-line name.
	for c in cells:
		var id: String = c[0]
		var r: Rect2 = c[1]
		if ICON_FILES.has(id):
			var a := 0.4 if locked(id) else 1.0
			var two: bool = labels[id].size() > 1
			var s := 16.0 if two else 20.0
			draw_texture_rect_region(atlas, Rect2(r.get_center().x - s / 2, r.position.y + (4.0 if two else 7.0), s, s), regions[ICON_FILES[id]], Color(1, 1, 1, a))
		if locked(id):
			draw_texture_rect_region(atlas, Rect2(r.end.x - 17, r.position.y + 4, 13, 13), regions[ICON_FILES.lock], Color.WHITE)
	# 3. Text in the main font: names and prices.
	for c in cells:
		var id: String = c[0]
		var r: Rect2 = c[1]
		if id == "toggle":
			continue
		var on: bool = id == current
		var lines: Array = labels[id]
		var name_col: Color = pal["accent-fg"] if on else (pal.muted if locked(id) else pal.fg)
		var price_col: Color = pal["accent-fg"] if on else pal.muted
		if not ICON_FILES.has(id):
			_centred("DIG", Vector2(r.get_center().x, r.position.y + 19), 10, name_col)
		var top := r.position.y + (31.0 if lines.size() == 1 else 22.0)
		for k in lines.size():
			_centred(lines[k], Vector2(r.get_center().x, top + 11 + k * 11), 11, name_col, r.size.x - 4)
		_centred(prices[id], Vector2(r.get_center().x, r.end.y - 7), 11, price_col, r.size.x - 4)
	# 4. Symbols last: they come from the fallback font's own glyph texture, and drawing
	# them between the names would break the text into one batch per button.
	for c in cells:
		var id: String = c[0]
		var r: Rect2 = c[1]
		if id == "toggle":
			_centred("⌃" if collapsed else "⌄", Vector2(r.get_center().x, r.get_center().y + 7), 22, pal.fg)
		elif locked(id):
			draw_string(font, Vector2(r.position.x + 5, r.position.y + 14), "★%d" % C.UNLOCK_AT[id], HORIZONTAL_ALIGNMENT_LEFT, -1, 10, pal.warn)


func _centred(text: String, baseline_mid: Vector2, fs: int, col: Color, max_w: float = -1) -> void:
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	if max_w > 0 and w > max_w:            # trim to fit, measured once here rather than clipped per draw
		while text.length() > 1 and font.get_string_size(text + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > max_w:
			text = text.substr(0, text.length() - 1)
		text += "…"
		w = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_string(font, Vector2(baseline_mid.x - w / 2, baseline_mid.y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


# ---- Input ----------------------------------------------------------------------

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
			scroll = clampf(scroll + 40, 0, _max_scroll())
			queue_redraw()
		elif e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
			scroll = clampf(scroll - 40, 0, _max_scroll())
			queue_redraw()
		elif e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				pressing = true
				dragged = false
				press = e.position
			elif pressing:
				pressing = false
				if not dragged:
					_tap(e.position)
		accept_event()
	elif e is InputEventMouseMotion and pressing:
		if not dragged and e.position.distance_to(press) > C.TAP_SLOP_PX:
			dragged = true
		if dragged:
			scroll = clampf(scroll - e.relative.y, 0, _max_scroll())
			queue_redraw()
		accept_event()


func _tap(p: Vector2) -> void:
	var shown := _shown()
	for i in shown.size():
		if _rect(i).has_point(p):
			if shown[i] == "toggle":
				set_collapsed(not collapsed)
				toggled.emit(collapsed)
			else:
				tool_chosen.emit(shown[i])
			return


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		refresh()
