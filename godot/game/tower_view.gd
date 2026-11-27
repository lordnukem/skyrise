# The tower view: camera, touch and mouse input, and every pixel of the tower, ported from
# src/render.js and src/input.js. Everything is drawn in code each frame (no sprites except
# the far skyline and the Sky Garden), so a new room type needs no art.
#
# World: x grows right, y grows down; floor f sits between (maxFloors - f) * CELL_H and
# (maxFloors - f + 1) * CELL_H. The camera maps world to screen: (w - cam) * zoom.
extends Control

signal tapped(col: int, floor_: int)
signal long_pressed(col: int, floor_: int)

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const H = preload("res://sim/hashing.gd")
const Tenants = preload("res://sim/tenants.gd")
const Palette = preload("res://game/palette.gd")

const PLACE_MS := 180.0
const DUST_MS := 420.0
const FLOAT_MS := 1000.0
const FLOAT_RISE := 22.0
const SHIRTS := ["#e76f51", "#2a9d8f", "#e9c46a", "#8ecae6", "#cdb4db", "#f4a261"]
const MAX_FLOATS_PER_TICK := 8
const QUEUE_DRAWN := 10
const QUEUE_GAP := 6.0
const OFFICE_WINDOWS := {"grid": [3, 0.6, 6, 12], "tall": [2, 0.5, 4, 8], "band": [6, 0.92, 9, 18], "wide": [2, 0.8, 8, 16]}
const SMOKE_PUFFS := 4

var state: Dictionary = {}
var view: Dictionary = {}               # tool, selected, hover, draft, weather, festivals (owned by main.gd)
var cam := {"x": 0.0, "y": 0.0, "zoom": 1.0}
var pal: Dictionary = Palette.colours(false)
var dark := false
var reduced := false
var phase := 0.0                         # fraction of the current game hour that has passed

var tones := {}
var tone_key := ""
var win_tone: Array[Color] = []
var biz_tones := {}
var font: Font
var skyline_tex: Texture2D
var landmark_tex: Texture2D
var shirts: Array[Color] = []
var hash_memo := {}                      # Vector2i(a, b) -> |hash01(a, b)|, the same pairs every frame
# The static layer: sky, skyline, ground, basement, grid and every building, rendered into a
# texture only when its key changes (a tick, the camera, the layout, the light), the way the
# JS build caches its background canvas. Each frame then draws that one texture plus the live
# layer (lift cars, people, faces, fires, floats, the draft), which keeps software-rendered
# and low-end GPUs at full frame rate.
var ci: CanvasItem = self                # the canvas the draw helpers draw on
var static_vp: SubViewport
var static_canvas: Node2D
var static_key := ""
var ground_y_now := 0.0
var static_skip := {}                    # ids drawn live this frame (placing), left out of the cache
# The live layer draws everything from one generated texture so Godot batches it: polygons
# (draw_circle, draw_arc) are never batched, and textured quads that share a texture are.
var dot_tex: ImageTexture
const DOT_SQUARE := Rect2(1, 1, 2, 2)    # a white patch for rectangles
const DOT_DISC := Rect2(8, 0, 32, 32)    # an antialiased white disc for circles
var prof := {"draw_ms": 0.0, "static_ms": 0.0, "static_count": 0}   # timings for the ?debug hook

# Layout cache: grid, reachability and per-structure geometry, rebuilt when the tower changes.
var lay := {"sig": "", "grid": {}, "reach": {}, "info": {}, "shafts": []}
var walkers := {}                        # unit id -> walker list
var walker_list := []
var walker_sig := ""
var placing := {}                        # structure id -> start time (ms)
var dust := []
var floats := []
var float_cursor := 0
var now_ms := 0.0
var last_frame := 0.0
var park_left := 0

# Input.
var pointers := {}                       # index -> {pos, start}
var moved := false
var long_at := -1.0
var pinch_dist := 0.0
var mouse_down := false
var mouse_last := Vector2.ZERO
var mouse_start := Vector2.ZERO


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	font = ThemeDB.fallback_font
	skyline_tex = load("res://assets/art/skyline-far.png")
	landmark_tex = load("res://assets/art/landmark-rooftop.png")
	for s in SHIRTS:
		shirts.append(Color.html(s))
	for i in 96:
		dust.append({"on": false})
	for i in 48:
		floats.append({"on": false})
	var img := Image.create(40, 32, false, Image.FORMAT_RGBA8)
	img.fill(Color(1, 1, 1, 0))
	for y in 4:
		for x in 4:
			img.set_pixel(x, y, Color.WHITE)
	for y in 32:
		for x in 32:
			var d := Vector2(x + 0.5 - 16, y + 0.5 - 16).length()
			img.set_pixel(8 + x, y, Color(1, 1, 1, clampf(16 - d, 0, 1)))
	dot_tex = ImageTexture.create_from_image(img)
	static_vp = SubViewport.new()
	static_vp.disable_3d = true
	static_vp.transparent_bg = false
	static_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(static_vp)
	static_canvas = Node2D.new()
	static_canvas.draw.connect(_draw_static)
	static_vp.add_child(static_canvas)


## hash01(a, b), memoised: windows, rooftops, soil and the skyline ask for the same pairs
## every frame. Signed, as render.js uses it: a negative value is what puts a short building
## in the skyline or an aerial on a roof there, so taking the absolute changes the picture.
func _h(a: int, b: int) -> float:
	var k := Vector2i(a, b)
	var v = hash_memo.get(k)
	if v == null:
		v = H.hash01(a, b)
		hash_memo[k] = v
	return v


func set_theme_dark(on: bool) -> void:
	dark = on
	pal = Palette.colours(on)
	tone_key = ""


# ---- Camera -----------------------------------------------------------------

func world_h() -> float:
	return state.maxFloors * C.CELL_H


func world_w() -> float:
	return state.width * C.CELL_W


func clamp_cam() -> void:
	var margin := 4.0 * C.CELL_W
	var view_w: float = size.x / cam.zoom
	var view_h: float = size.y / cam.zoom
	var min_x := -margin
	var max_x := world_w() + margin - view_w
	cam.x = (min_x + max_x) / 2.0 if max_x < min_x else clampf(cam.x, min_x, max_x)
	var top := Sim.floor_cap(state)
	for st in state.structures:
		top = maxi(top, st.floor + C.TYPES[st.type].h - 1)
	var min_y: float = (state.maxFloors - top - 2) * C.CELL_H
	var max_y: float = world_h() + (C.BASEMENT_LEVELS + 2) * C.CELL_H - view_h
	cam.y = max_y if max_y < min_y else clampf(cam.y, min_y, max_y)


func recenter() -> void:
	cam.zoom = 1.2 if size.x < 500 else 1.5
	cam.x = world_w() / 2.0 - size.x / cam.zoom / 2.0
	cam.y = world_h() + C.CELL_H * 1.6 - size.y / cam.zoom
	clamp_cam()


func pan(dx: float, dy: float) -> void:
	cam.x -= dx / cam.zoom
	cam.y -= dy / cam.zoom
	clamp_cam()


func zoom_at(p: Vector2, factor: float) -> void:
	var next: float = clampf(cam.zoom * factor, C.ZOOM_MIN, C.ZOOM_MAX)
	var wx: float = p.x / cam.zoom + cam.x
	var wy: float = p.y / cam.zoom + cam.y
	cam.zoom = next
	cam.x = wx - p.x / cam.zoom
	cam.y = wy - p.y / cam.zoom
	clamp_cam()


func screen_to_cell(p: Vector2) -> Vector2i:
	var wx: float = p.x / cam.zoom + cam.x
	var wy: float = p.y / cam.zoom + cam.y
	return Vector2i(int(floor(wx / C.CELL_W)), state.maxFloors - int(floor(wy / C.CELL_H)))


func cell_centre(col: int, f: int) -> Vector2:
	return Vector2(sx((col + 0.5) * C.CELL_W), sy((state.maxFloors - f + 0.5) * C.CELL_H))


func sx(wx: float) -> float:
	return (wx - cam.x) * cam.zoom


func sy(wy: float) -> float:
	return (wy - cam.y) * cam.zoom


func rect_of(col: float, f: float, w: float, h: float) -> Rect2:
	return Rect2(sx(col * C.CELL_W), sy((state.maxFloors - f - h + 1) * C.CELL_H), w * C.CELL_W * cam.zoom, h * C.CELL_H * cam.zoom)


# ---- Input ------------------------------------------------------------------

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		_on_touch(event)
	elif event is InputEventScreenDrag:
		_on_drag(event)
	elif event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION:
		_on_mouse_button(event)
	elif event is InputEventMouseMotion and event.device != InputEvent.DEVICE_ID_EMULATION:
		_on_mouse_motion(event)
	accept_event()


func _on_touch(e: InputEventScreenTouch) -> void:
	if e.pressed:
		pointers[e.index] = {"pos": e.position, "start": e.position}
		if pointers.size() == 1:
			moved = false
			long_at = now_ms + C.LONG_PRESS_MS
		else:
			long_at = -1.0
			moved = true
			pinch_dist = _pinch_distance()
	else:
		if not pointers.has(e.index):
			return
		var p: Dictionary = pointers[e.index]
		pointers.erase(e.index)
		long_at = -1.0
		if pointers.is_empty() and not moved and not e.canceled:
			_tap(p.pos)
		if pointers.size() == 1:
			pinch_dist = 0.0


func _on_drag(e: InputEventScreenDrag) -> void:
	if not pointers.has(e.index):
		return
	var prev: Dictionary = pointers[e.index]
	var last: Vector2 = prev.pos
	prev.pos = e.position
	if pointers.size() == 1:
		if not moved and e.position.distance_to(prev.start) > C.TAP_SLOP_PX:
			moved = true
			long_at = -1.0
		if moved:
			pan(e.position.x - last.x, e.position.y - last.y)
	elif pointers.size() == 2:
		var d := _pinch_distance()
		if pinch_dist > 0 and d > 0:
			zoom_at(_pinch_centre(), d / pinch_dist)
		pinch_dist = d


func _pinch_distance() -> float:
	var ps := pointers.values()
	return ps[0].pos.distance_to(ps[1].pos) if ps.size() >= 2 else 0.0


func _pinch_centre() -> Vector2:
	var ps := pointers.values()
	return (ps[0].pos + ps[1].pos) / 2.0


func _on_mouse_button(e: InputEventMouseButton) -> void:
	if e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
		zoom_at(e.position, 1.1)
	elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
		zoom_at(e.position, 1 / 1.1)
	elif e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			mouse_down = true
			moved = false
			mouse_start = e.position
			mouse_last = e.position
			long_at = now_ms + C.LONG_PRESS_MS
		else:
			mouse_down = false
			long_at = -1.0
			if not moved:
				_tap(e.position)


func _on_mouse_motion(e: InputEventMouseMotion) -> void:
	if mouse_down:
		if not moved and e.position.distance_to(mouse_start) > C.TAP_SLOP_PX:
			moved = true
			long_at = -1.0
		if moved:
			pan(e.position.x - mouse_last.x, e.position.y - mouse_last.y)
		mouse_last = e.position
	else:
		var c := screen_to_cell(e.position)
		view.hover = {"col": c.x, "floor": c.y}


func _notification(what: int) -> void:
	if what == NOTIFICATION_MOUSE_EXIT and view.size():
		view.hover = null


func _tap(p: Vector2) -> void:
	var c := screen_to_cell(p)
	tapped.emit(c.x, c.y)


func _long_press() -> void:
	moved = true                          # swallow the tap that would follow on release
	var p: Vector2 = pointers.values()[0].pos if pointers.size() == 1 else mouse_start
	var c := screen_to_cell(p)
	long_pressed.emit(c.x, c.y)


# ---- Events from the game -------------------------------------------------------

func on_placed(st: Dictionary) -> void:
	var t: Dictionary = C.TYPES[st.type]
	placing[st.id] = now_ms
	_spawn_dust(st.col * C.CELL_W, (st.col + t.w) * C.CELL_W, (state.maxFloors - st.floor + 1) * C.CELL_H, 10, false)


func on_demolished(st: Dictionary) -> void:
	var t: Dictionary = C.TYPES[st.type]
	_spawn_dust(st.col * C.CELL_W, (st.col + t.w) * C.CELL_W, (state.maxFloors - st.floor + 1) * C.CELL_H, 14, true)
	placing.erase(st.id)


func _spawn_dust(x0: float, x1: float, y: float, n: int, heavy: bool) -> void:
	for i in n:
		var d = null
		for p in dust:
			if not p.on:
				d = p
				break
		if d == null:
			return
		var u := (i + 0.5) / n
		d.on = true
		d.x = lerpf(x0, x1, u)
		d.y = y - 1
		d.t0 = now_ms
		d.dur = DUST_MS + _h(i, n) * 160
		d.vx = (u - 0.5) * (40.0 if heavy else 22.0)
		d.vy = -(10 + _h(i, 7) * (26.0 if heavy else 14.0))
		d.r = 3 + _h(i, 3) * 3 if heavy else 2 + _h(i, 3) * 2
		d.warm = not heavy


## After each sim tick: income floats near units that earned, upkeep at the shafts.
func on_tick() -> void:
	_layout()
	var emitted := 0
	var idx := 0
	var n: int = state.structures.size()
	for k in n:
		if emitted >= MAX_FLOATS_PER_TICK:
			break
		var st: Dictionary = state.structures[(k + float_cursor) % n]
		var t: Dictionary = C.TYPES[st.type]
		if t.kind != "unit" or not st.occupied or st.fire or not lay.reach.has(st.id):
			continue
		var take := Sim.take_of(state, st)
		if take <= 0:
			continue
		_push_float((st.col + t.w / 2.0) * C.CELL_W, (state.maxFloors - st.floor) * C.CELL_H + 4, "+$%d" % take, false, idx)
		idx += 1
		emitted += 1
	float_cursor = (float_cursor + MAX_FLOATS_PER_TICK) % maxi(1, n)
	for sh in lay.shafts:
		var up: int = C.TYPES[sh.type].upkeep * (sh.hi - sh.lo + 1)
		_push_float((sh.col + 0.5) * C.CELL_W, (state.maxFloors - sh.hi) * C.CELL_H + 4, "-$%d" % up, true, idx)
		idx += 1


func _push_float(x: float, y: float, text: String, neg: bool, stagger: int) -> void:
	for f in floats:
		if not f.on:
			f.on = true
			f.x = x
			f.y = y
			f.text = text
			f.neg = neg
			f.t0 = now_ms + stagger * 40
			return


func reset() -> void:
	placing.clear()
	walkers.clear()
	walker_list.clear()
	walker_sig = ""
	for d in dust:
		d.on = false
	for f in floats:
		f.on = false
	lay.sig = ""


# ---- Layout -----------------------------------------------------------------

func _layout() -> void:
	var sig := "%d:%d:%d:%d" % [state.structures.size(), state.nextId, state.get("dug", 0), view.get("rev", 0)]
	if sig == lay.sig and is_same(lay.get("ref"), state.structures):
		return
	lay.sig = sig
	lay.ref = state.structures
	var g := Sim.build_grid(state)
	lay.grid = g
	lay.reach = Sim.reachable(state, g)
	var info := {}
	for st in state.structures:
		var t: Dictionary = C.TYPES[st.type]
		var top_mask := 0
		for dx in t.w:
			if not g.has(Vector2i(st.col + dx, st.floor + t.h)):
				top_mask |= 1 << dx
		var l: int = st.col
		var r: int = st.col + t.w - 1
		while g.has(Vector2i(l - 1, st.floor)):
			l -= 1
		while g.has(Vector2i(r + 1, st.floor)):
			r += 1
		info[st.id] = {"topMask": top_mask, "leftOpen": not g.has(Vector2i(st.col - 1, st.floor)),
			"rightOpen": not g.has(Vector2i(st.col + t.w, st.floor)), "corrL": l, "corrR": r}
	lay.info = info
	var shafts := []
	for sh in Sim.shafts_of(state, g):
		shafts.append({"col": sh.col, "lo": sh.lo, "hi": sh.hi, "type": sh.type})
	lay.shafts = shafts


# ---- Tones --------------------------------------------------------------------

func _daylight() -> float:
	var hour: float = (state.tick % C.HOURS_PER_DAY) + phase
	return 0.5 + 0.5 * cos(((hour - 13) / C.HOURS_PER_DAY) * TAU)


static func _smooth(e0: float, e1: float, x: float) -> float:
	var t := clampf((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)


func _update_tones(night: float, weather: String) -> void:
	var q := roundi(night * 48)
	var key := "%d|%s|%s" % [q, str(dark), weather]
	if key == tone_key:
		return
	tone_key = key
	var n := q / 48.0
	var dim := Color.html("#0b1026")
	biz_tones.clear()
	tones.skyTop = pal["sky-top"].lerp(pal["night-top"], n)
	tones.skyBottom = pal["sky-bottom"].lerp(pal["night-bottom"], n)
	var wd: float = C.WEATHER_DIM.get(weather, 0.0)
	if wd > 0:
		var grey := Color.html("#9aa3ad").lerp(Color.html("#1d2430"), n)
		tones.skyTop = tones.skyTop.lerp(grey, minf(1, wd * 1.6))
		tones.skyBottom = tones.skyBottom.lerp(grey, minf(1, wd * 1.4))
	tones.horizon = pal.horizon
	tones.dusk = 1 - absf(n - 0.5) * 2
	tones.ground = pal.ground.lerp(Color.html("#10140d"), n * 0.55)
	tones.groundDark = pal["ground-dark"].lerp(Color.html("#0a0c08"), n * 0.55)
	tones.kerb = pal.kerb.lerp(Color.html("#2a2f26"), n * 0.5)
	tones.skyline = pal.skyline.lerp(Color.html("#05081a"), n * 0.7)
	tones.wall = pal["wall-dark"].lerp(dim, n * 0.4)
	tones.glass = pal.glass.lerp(Color.html("#243357"), n * 0.75)
	for k in ["lobby", "office", "shop", "flat", "stairs", "shaft", "express", "security", "food", "escalator", "slab",
			"hotel", "hall", "housekeeping", "servicelift", "clinic", "plant"]:
		tones[k] = pal[k].lerp(dim, minf(1, n * 0.42 + wd * 0.35))
	tones.awning = Color.WHITE.lerp(dim, n * 0.5)
	tones.car = pal.car
	tones.person = pal.person
	tones.warm = _smooth(0.28, 0.7, n)
	win_tone.clear()
	for i in 9:
		win_tone.append(tones.glass.lerp(pal["window-lit"], i / 8.0))
	tones.lamp = pal["window-lit"]
	tones.night = n


func _win(lit: float) -> Color:
	return win_tone[roundi(clampf(lit, 0, 1) * 8)]


func _biz_tone(type: String, biz: Dictionary) -> Dictionary:
	var key: String = type + "." + biz.id
	if not biz_tones.has(key):
		var accent := Color.html(biz.accent)
		biz_tones[key] = {"tint": tones[type].lerp(accent, minf(biz.tint, C.FACADE_TINT_MAX)), "accent": accent.lerp(Color.html("#0b1026"), tones.night * 0.42)}
	return biz_tones[key]


# ---- Frame ------------------------------------------------------------------------

func _process(_delta: float) -> void:
	now_ms = Time.get_ticks_msec()
	if long_at > 0 and now_ms >= long_at and not moved and (pointers.size() == 1 or mouse_down):
		long_at = -1.0
		_long_press()
	if not state.is_empty():
		_update_tones(1.0 - _daylight(), view.get("weather", "clear"))
		_layout()
		ground_y_now = sy(world_h())
		static_skip.clear()
		for id in placing:
			static_skip[id] = true
		var scale := get_viewport().get_final_transform().get_scale().x
		var px := Vector2i(maxi(1, ceili(size.x * scale)), maxi(1, ceili(size.y * scale)))
		var key := "%s|%.2f|%.2f|%.3f|%s|%s|%d|%s|%s|%s" % [tone_key, cam.x, cam.y, cam.zoom, str(px), lay.sig, state.tick,
			view.get("tool") == "dig", str(static_skip.keys()), view.get("skip", "")]
		if key != static_key:
			static_key = key
			if static_vp.size != px:
				static_vp.size = px
			static_canvas.transform = Transform2D().scaled(Vector2(scale, scale))
			static_canvas.queue_redraw()
			static_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	queue_redraw()


## The cached layer: everything that changes only with the tick, the camera or the layout.
func _draw_static() -> void:
	if tones.is_empty() or state.is_empty():
		return                            # the node draws once on entering the tree, before the first frame's tones
	var t0 := Time.get_ticks_usec()
	ci = static_canvas
	var skip: String = view.get("skip", "")
	if not skip.contains("bg"):
		_draw_backdrop(ground_y_now)
	if not skip.contains("base"):
		_draw_basement()
	if not skip.contains("grid"):
		_draw_grid(ground_y_now)
	park_left = 0
	for v in state.perks.values():
		if v[0] == "parking":
			park_left += 1
	if not skip.contains("st"):
		for st in state.structures:
			if static_skip.has(st.id):
				continue
			var t: Dictionary = C.TYPES[st.type]
			var r := rect_of(st.col, st.floor, t.w, t.h)
			if r.position.x > size.x or r.end.x < 0 or r.position.y > size.y or r.end.y < 0:
				continue
			_draw_structure(st, r)
	ci = self
	prof.static_ms = (Time.get_ticks_usec() - t0) / 1000.0
	prof.static_count += 1


func _draw() -> void:
	if state.is_empty():
		return
	var t0 := Time.get_ticks_usec()
	ci = self
	var dt := minf(50.0, now_ms - last_frame) if last_frame > 0 else 16.0
	last_frame = now_ms
	var weather: String = view.get("weather", "clear")
	var skip: String = view.get("skip", "")
	draw_texture_rect(static_vp.get_texture(), Rect2(Vector2.ZERO, size), false)
	# Live per-unit overlays on top of the cached buildings: faces and fires animate.
	for st in state.structures:
		var t: Dictionary = C.TYPES[st.type]
		if t.kind != "unit" or (not st.occupied and not st.fire):
			continue
		var r := rect_of(st.col, st.floor, t.w, t.h)
		if r.position.x > size.x or r.end.x < 0 or r.position.y > size.y or r.end.y < 0:
			continue
		if st.occupied and not st.burnt and lay.reach.has(st.id) and not static_skip.has(st.id):
			_draw_mood(r, cam.zoom, Sim.happy_band(st.happy), st.id)
		if st.fire:
			_draw_fire(r, cam.zoom, st.id)
	# Rooms still growing in after a build are drawn live until the animation ends.
	for id in static_skip:
		var st = Sim.find(state, id)
		if st == null:
			placing.erase(id)
			continue
		var t: Dictionary = C.TYPES[st.type]
		var r := rect_of(st.col, st.floor, t.w, t.h)
		var p: float = (now_ms - placing[id]) / PLACE_MS
		if p >= 1 or reduced:
			placing.erase(id)
			continue
		var s := 0.6 + 0.4 * _ease_out_back(p)
		var pivot := Vector2(r.get_center().x, r.end.y)
		draw_set_transform(pivot * (1 - s), 0, Vector2(s, s))
		_draw_structure(st, r)
		draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
	var step_frac := 1.0 if reduced else clampf(phase * C.WALK_STEPS - (Sim.walker_steps_done(state) - 1), 0, 1)
	if not skip.contains("ppl"):
		_draw_lift_cars(step_frac)
		_draw_walkers(dt)
		_draw_queues()
	_draw_dust()
	var ground_y := ground_y_now
	if weather == "fog":
		draw_rect(Rect2(0, 0, size.x, minf(size.y, ground_y)), Color(0.85, 0.87, 0.9, C.FOG_ALPHA * (1 - tones.night * 0.5)))
	if not reduced and (weather == "rain" or weather == "snow"):
		_draw_precip(weather, ground_y)
	_draw_floats()
	if view.get("selected") != null:
		var st = Sim.find(state, view.selected)
		if st != null:
			var t: Dictionary = C.TYPES[st.type]
			_selection_box(rect_of(st.col, st.floor, t.w, t.h))
	var hover = view.get("hover")
	if hover != null and C.TYPES.has(view.get("tool", "")) and view.get("draft") == null:
		var t: Dictionary = C.TYPES[view.tool]
		var ok: bool = Sim.can_place(state, view.tool, hover.col, hover.floor, lay.grid).ok
		var r := rect_of(hover.col, hover.floor, t.w, t.h)
		draw_rect(r, pal["ghost-ok"] if ok else pal["ghost-bad"])
		draw_rect(r.grow(-1), pal.good if ok else pal.danger, false, 2.0)
	if view.get("draft") != null:
		_draw_draft(view.draft)
	prof.draw_ms = lerpf(prof.draw_ms, (Time.get_ticks_usec() - t0) / 1000.0, 0.1)


func _draw_grid(ground_y: float) -> void:
	var left := sx(0)
	var right := sx(world_w())
	var cap := Sim.floor_cap(state)
	var cap_y := roundf(sy((state.maxFloors - cap) * C.CELL_H)) + 0.5
	for f in range(1, state.maxFloors + 1):
		var y := roundf(sy((state.maxFloors - f) * C.CELL_H)) + 0.5
		if y < -2 or y > ground_y:
			continue
		ci.draw_line(Vector2(left, y), Vector2(right, y), pal["grid-line"], 1.0)
	var plot_top := maxf(0, cap_y)
	if ground_y > plot_top:
		ci.draw_dashed_line(Vector2(left + 0.5, plot_top), Vector2(left + 0.5, ground_y), pal["grid-line"], 1.0, 2.0)
		ci.draw_dashed_line(Vector2(right - 0.5, plot_top), Vector2(right - 0.5, ground_y), pal["grid-line"], 1.0, 2.0)
	if cap < state.maxFloors and cap_y > 0 and cap_y < size.y:
		ci.draw_dashed_line(Vector2(left, cap_y), Vector2(right, cap_y), pal.muted, 1.0, 6.0)
	if cam.zoom >= 0.8 and left > 18:
		var fs := roundi(10 * minf(1.4, cam.zoom))
		for f in range(5, state.maxFloors + 1, 5):
			var y := sy((state.maxFloors - f + 0.5) * C.CELL_H)
			if y < 0 or y > ground_y:
				continue
			_text_right(str(f), Vector2(left - 6, y), fs, pal.muted)
		for f in range(0, Sim.LOWEST_FLOOR - 1, -1):
			var y := sy((state.maxFloors - f + 0.5) * C.CELL_H)
			if y > 0 and y < size.y:
				_text_right("B%d" % (1 - f), Vector2(left - 6, y), fs, pal.muted)


func _text_right(text: String, at: Vector2, fs: int, col: Color) -> void:
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	ci.draw_string(font, Vector2(at.x - w, at.y + fs * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


func _text_centre(text: String, at: Vector2, fs: int, col: Color) -> void:
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	ci.draw_string(font, Vector2(at.x - w / 2, at.y + fs * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


func _draw_draft(d: Dictionary) -> void:
	var t: Dictionary = C.TYPES.get(d.tool, {})
	if t.is_empty():
		return
	var r := rect_of(d.col, d.floor, t.w, t.h)
	if r.position.x > size.x or r.end.x < 0 or r.position.y > size.y or r.end.y < 0:
		return
	var fill: Color = pal.get(d.tool, pal["ghost-ok"])
	ci.draw_rect(r, Color(fill, 0.5))
	_dashed_rect(r.grow(-1), pal.fg, 2.0, 5.0)
	var label := "$" + _thousands(d.cost)
	var fs := roundi(clampf(10 * cam.zoom, 9, 14))
	var c := Vector2(r.get_center().x, r.position.y + minf(r.size.y, C.CELL_H * cam.zoom) / 2)
	var tw := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 8
	ci.draw_rect(Rect2(c.x - tw / 2, c.y - 8, tw, 16), pal["float-bg"])
	_text_centre(label, c, fs, pal.fg)


func _dashed_rect(r: Rect2, col: Color, w: float, dash: float) -> void:
	var p := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]
	for i in 4:
		ci.draw_dashed_line(p[i], p[(i + 1) % 4], col, w, dash)


static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


# ---- Basement and background ------------------------------------------------------

func _draw_basement() -> void:
	var z: float = cam.zoom
	var left := sx(0)
	var w := world_w() * z
	var cw := C.CELL_W * z
	var ch := C.CELL_H * z
	for f in range(0, Sim.LOWEST_FLOOR - 1, -1):
		var y := sy((state.maxFloors - f) * C.CELL_H)
		if y > size.y or y + ch < 0:
			continue
		var dug: bool = f >= 1 - state.dug
		ci.draw_rect(Rect2(left, y, w, ch), pal.dug if dug else pal.soil)
		if dug:
			var c := Color(0, 0, 0, 0.16)
			ci.draw_rect(Rect2(left, y + ch - 3 * z, w, 3 * z), c)
			for col in range(0, state.width + 1, 4):
				ci.draw_rect(Rect2(left + col * cw - z, y, 2 * z, ch), c)
		elif z >= 0.7:
			for col in state.width:
				for k in 2:
					ci.draw_rect(Rect2(left + (col + _h(col, f * 7 + k)) * cw, y + (0.15 + 0.7 * _h(col, f * 7 + k + 3)) * ch, 2.5 * z, 2 * z), pal["soil-dark"])
	if view.get("tool") == "dig" and state.dug < C.BASEMENT_LEVELS:
		var y := sy((state.maxFloors + state.dug) * C.CELL_H)
		_dashed_rect(Rect2(left + 1, y + 1, w - 2, ch - 2), pal.good, 2.0, 6.0)


func _draw_backdrop(ground_y: float) -> void:
	var n: float = tones.night
	var gy := maxf(1, ground_y)
	var bottom := (tones.skyBottom as Color).lerp(tones.horizon, tones.dusk * 0.75)
	var y65 := minf(gy * 0.65, size.y)
	ci.draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(size.x, 0), Vector2(size.x, y65), Vector2(0, y65)]),
		PackedColorArray([tones.skyTop, tones.skyTop, tones.skyBottom, tones.skyBottom]))
	if y65 < size.y:
		ci.draw_polygon(PackedVector2Array([Vector2(0, y65), Vector2(size.x, y65), Vector2(size.x, gy), Vector2(0, gy)]),
			PackedColorArray([tones.skyBottom, tones.skyBottom, bottom, bottom]))
	if n > 0.3:
		var star := Color(1, 1, 1, minf(1, (n - 0.3) * 1.1))
		for i in 90:
			var s := 0.8 + _h(i, 3) * 1.4
			ci.draw_rect(Rect2(_h(i, 1) * size.x, _h(i, 2) * minf(size.y * 0.6, gy), s, s), star)
		var mx := size.x * 0.82
		var my := minf(gy * 0.22, 70)
		var a := _smooth(0.35, 0.7, n)
		ci.draw_circle(Vector2(mx, my), 24, Color(1, 0.957, 0.839, 0.07 * a))
		ci.draw_circle(Vector2(mx, my), 11, Color(1, 0.957, 0.839, a))
		var cut: Color = (tones.skyTop as Color).lerp(tones.skyBottom, minf(1, my / (gy * 0.65)))
		ci.draw_circle(Vector2(mx - 6, my - 4), 9.5, Color(cut, a))
	elif tones.dusk > 0.15 and n < 0.5:
		ci.draw_circle(Vector2(size.x * 0.2, gy - 30), 44, Color(1, 0.77, 0.47, 0.18 * tones.dusk * 0.9))
		ci.draw_circle(Vector2(size.x * 0.2, gy - 30), 13, Color(Color.html("#ffd9a0"), tones.dusk * 0.9))
	var par := roundf(cam.x * 0.25 * cam.zoom)
	if skyline_tex:
		var sh := size.x * skyline_tex.get_height() / skyline_tex.get_width()
		var p := fposmod(par * 0.3, size.x)
		var tint := Color(1, 1, 1, 0.9).lerp(Color(0.25, 0.3, 0.45, 0.9), n * 0.8)
		ci.draw_texture_rect(skyline_tex, Rect2(-p, gy - sh, size.x, sh), false, tint)
		ci.draw_texture_rect(skyline_tex, Rect2(-p + size.x, gy - sh, size.x, sh), false, tint)
	var x := -fposmod(par, 140.0) - 60
	var i := 0
	var lit := Color(1, 214 / 255.0, 140 / 255.0, 0.55 * _smooth(0.35, 0.7, n))
	while x < size.x + 60 and i < 80:
		var idx := int(floor((x + par) / 140.0)) * 7 + 101
		var bw := 26 + _h(idx, 4) * 40
		var bh := (30 + _h(idx, 5) * 110) * minf(1.3, cam.zoom)
		var top := gy - bh
		ci.draw_rect(Rect2(x, top, bw, bh + 2), tones.skyline)
		if _h(idx, 6) > 0.6:
			ci.draw_rect(Rect2(x + bw * 0.3, top - 6, bw * 0.4, 6), tones.skyline)
		if n > 0.35:
			var cols := int(bw / 7)
			var rows := int(bh / 9)
			for r in rows:
				for c in cols:
					if _h(idx * 131 + r * 17 + c, 9) > 0.55:
						ci.draw_rect(Rect2(x + 3 + c * 7, top + 4 + r * 9, 2.5, 3.5), lit)
		x += bw + 6 + _h(idx, 8) * 20
		i += 1
	var gh := maxf(0, size.y - gy)
	ci.draw_rect(Rect2(0, gy, size.x, gh), tones.ground)
	ci.draw_rect(Rect2(0, gy + 8 * cam.zoom, size.x, gh), tones.groundDark)
	ci.draw_rect(Rect2(0, gy - 1, size.x, 2), tones.kerb)
	if n > 0.3:
		var glow := _smooth(0.3, 0.6, n)
		for c in range(2, state.width, 6):
			var lx := sx(c * C.CELL_W)
			var top = gy - 14 * cam.zoom
			if lx < -20 or lx > size.x + 20:
				continue
			ci.draw_rect(Rect2(lx - 0.5 * cam.zoom, top, maxf(1, cam.zoom), 14 * cam.zoom), tones.kerb)
			ci.draw_circle(Vector2(lx, top), 1.8 * cam.zoom, Color(tones.lamp, glow * 0.9))
			ci.draw_circle(Vector2(lx, top), 9 * cam.zoom, Color(tones.lamp, glow * 0.12))


func _draw_precip(weather: String, ground_y: float) -> void:
	var limit := minf(size.y, ground_y)
	var t := now_ms / 1000.0
	if weather == "rain":
		var col := Color(0.75, 0.82, 0.92, 0.45)
		for i in 90:
			var x := fposmod(_h(i, 21) * size.x + t * 40, size.x)
			var y := fposmod(_h(i, 22) * limit + t * (420 + 160 * _h(i, 23)), limit)
			ci.draw_line(Vector2(x, y), Vector2(x - 1.5, y + 9), col, 1.0)
	else:
		for i in 60:
			var x := fposmod(_h(i, 31) * size.x + sin(t + i) * 12, size.x)
			var y := fposmod(_h(i, 32) * limit + t * (30 + 25 * _h(i, 33)), limit)
			ci.draw_circle(Vector2(x, y), 1.6, Color(1, 1, 1, 0.85))


# ---- Structures --------------------------------------------------------------------

func _poly(points: Array, col: Color) -> void:
	ci.draw_colored_polygon(PackedVector2Array(points), col)


func _draw_structure(st: Dictionary, r: Rect2) -> void:
	var t: Dictionary = C.TYPES[st.type]
	var z: float = cam.zoom
	var x := r.position.x
	var y := r.position.y
	var w := r.size.x
	var h := r.size.y
	var info: Dictionary = lay.info.get(st.id, {})
	var is_reachable: bool = lay.reach.has(st.id)
	var warm: float = tones.warm
	match st.type:
		"lobby":
			ci.draw_rect(r, tones.lobby)
			ci.draw_rect(Rect2(x + 3 * z, y + 7 * z, w - 6 * z, h - 7 * z), _win(warm * 0.95))
			ci.draw_rect(Rect2(x + w / 2 - 0.5 * z, y + 7 * z, maxf(1, z), h - 7 * z), tones.wall)
			ci.draw_rect(Rect2(x, y + 4 * z, w, 2.5 * z), tones.wall)
			ci.draw_rect(Rect2(x, y + 4 * z, w, z), Color(1, 1, 1, 0.25))
		"stairs":
			ci.draw_rect(r, tones.stairs)
			var x0 := x + 2 * z
			var x1 := x + w - 2 * z
			var sw := (x1 - x0) / 5.0
			var sh := (h / 2 - 3 * z) / 5.0
			for flight in [[x0, y + h - 2 * z, 1.0, Color(1, 1, 1, 0.42)], [x1, y + h / 2 - z, -1.0, Color(1, 1, 1, 0.3)]]:
				var pts := [Vector2(flight[0], flight[1])]
				for i in 5:
					pts.append(Vector2(flight[0] + flight[2] * i * sw, flight[1] - (i + 1) * sh))
					pts.append(Vector2(flight[0] + flight[2] * (i + 1) * sw, flight[1] - (i + 1) * sh))
				pts.append(Vector2(flight[0] + flight[2] * 5 * sw, flight[1]))
				_poly(pts, flight[3])
			ci.draw_rect(Rect2(x, y + h / 2 - 1.5 * z, w, 2 * z), Color(0, 0, 0, 0.25))
			ci.draw_rect(Rect2(x0, y + 3 * z, maxf(1, z), h / 2 - 4 * z), Color(0, 0, 0, 0.25))
		"elevator", "express", "servicelift":
			var base: Color = tones.express if st.type == "express" else (tones.servicelift if st.type == "servicelift" else tones.shaft)
			ci.draw_rect(r, base)
			ci.draw_rect(Rect2(x + w * 0.22, y, maxf(1, z), h), Color(1, 1, 1, 0.12))
			ci.draw_rect(Rect2(x + w * 0.78 - z, y, maxf(1, z), h), Color(1, 1, 1, 0.12))
			ci.draw_rect(Rect2(x + 2 * z, y + h - 2 * z, w - 4 * z, 1.5 * z), Color(1, 1, 1, 0.08))
			if st.type == "express":
				for dy in [0.0, 5 * z]:
					ci.draw_polyline(PackedVector2Array([Vector2(x + w * 0.3, y + h * 0.5 + dy), Vector2(x + w * 0.5, y + h * 0.5 + dy - 4 * z), Vector2(x + w * 0.7, y + h * 0.5 + dy)]), Color(1, 1, 1, 0.45), maxf(1, 1.5 * z))
			if st.type == "servicelift":
				for i in 3:
					ci.draw_rect(Rect2(x + 2 * z, y + h * (0.3 + i * 0.16), w - 4 * z, 2 * z), Color(246 / 255.0, 183 / 255.0, 60 / 255.0, 0.75))
			if st.closed:
				ci.draw_rect(Rect2(x + 2 * z, y + h * 0.45, w - 4 * z, 2 * z), Color(0, 0, 0, 0.5))
		"housekeeping", "clinic", "plant":
			ci.draw_rect(r, tones[st.type])
			ci.draw_rect(Rect2(x + 3 * z, y + 7 * z, w * 0.45 - 4 * z, h - 14 * z), _win(warm * 0.8))
			var bx := x + w * 0.74
			var by := y + h * 0.45
			var u := 3 * z
			if st.type == "clinic":
				var red := Color.html("#d64545")
				ci.draw_rect(Rect2(bx - u, by - u / 3, 2 * u, u * 0.7), red)
				ci.draw_rect(Rect2(bx - u / 3, by - u, u * 0.7, 2 * u), red)
			elif st.type == "plant":
				ci.draw_circle(Vector2(bx, by), u * 1.2, Color(1, 1, 1, 0.85))
				ci.draw_rect(Rect2(x + w * 0.5, by - z / 2, w * 0.45, maxf(1, z)), Color(1, 1, 1, 0.85))
				ci.draw_circle(Vector2(bx, by), u * 0.5, tones.plant)
			else:
				_poly([Vector2(bx - u, by - u / 2), Vector2(bx + u, by - u / 2), Vector2(bx + u * 0.7, by + u), Vector2(bx - u * 0.7, by + u)], Color(1, 1, 1, 0.85))
			if not is_reachable:
				_hatch(r)
		"parking":
			ci.draw_rect(r, pal.parking)
			var n: int = t.spaces
			var bw := w / n
			var cars: int = mini(n, park_left) if is_reachable else 0
			park_left -= cars
			for i in range(1, n):
				ci.draw_rect(Rect2(x + i * bw - 0.5 * z, y + h * 0.45, maxf(1, z), h * 0.5), Color(1, 1, 1, 0.55))
			for i in cars:
				var col: Color = shirts[(st.id + i) % shirts.size()]
				ci.draw_rect(Rect2(x + i * bw + bw * 0.15, y + h * 0.55, bw * 0.7, h * 0.28), col)
				ci.draw_rect(Rect2(x + i * bw + bw * 0.28, y + h * 0.42, bw * 0.44, h * 0.16), col)
			if not is_reachable:
				_hatch(r)
		"transit":
			ci.draw_rect(r, pal.transit)
			ci.draw_rect(Rect2(x, y + h - 6 * z, w, 4 * z), Color(0, 0, 0, 0.3))
			ci.draw_rect(Rect2(x + w * 0.12, y + h * 0.3, w * 0.7, h * 0.48), Color(1, 1, 1, 0.8))
			for i in 6:
				ci.draw_rect(Rect2(x + w * (0.16 + i * 0.11), y + h * 0.38, w * 0.07, h * 0.16), win_tone[8])
			if not is_reachable:
				_hatch(r)
		"security":
			ci.draw_rect(r, tones.security)
			ci.draw_rect(Rect2(x + 3 * z, y + 7 * z, w * 0.5 - 4 * z, h - 14 * z), _win(warm * 0.8))
			var bx := x + w * 0.72
			var by := y + h * 0.42
			var bw := 6 * z
			_poly([Vector2(bx - bw / 2, by - bw * 0.6), Vector2(bx + bw / 2, by - bw * 0.6), Vector2(bx + bw / 2, by + bw * 0.2), Vector2(bx, by + bw * 0.8), Vector2(bx - bw / 2, by + bw * 0.2)], Color(1, 1, 1, 0.85))
			if not is_reachable:
				_hatch(r)
		"escalator":
			ci.draw_rect(r, tones.escalator)
			var x0 := x + 3 * z
			var x1 := x + w - 3 * z
			var y0 := y + h - 3 * z
			var y1 := y + h / 2 - 3 * z
			ci.draw_line(Vector2(x0, y0), Vector2(x1, y1), Color(1, 1, 1, 0.5), maxf(2, 4 * z))
			for i in range(1, 8):
				var u := i / 8.0
				var px := lerpf(x0, x1, u)
				var py := lerpf(y0, y1, u)
				ci.draw_line(Vector2(px - 1.5 * z, py - 1.5 * z), Vector2(px + 1.5 * z, py + 1.5 * z), Color(0, 0, 0, 0.3), maxf(1, z))
			ci.draw_rect(Rect2(x, y + h / 2 - 1.5 * z, w * 0.3, 2 * z), Color(0, 0, 0, 0.25))
		"landmark":
			if landmark_tex:
				ci.draw_texture_rect(landmark_tex, r, false)
			if not is_reachable:
				_hatch(r)
			return
		"floor":
			ci.draw_rect(Rect2(x, y + h - 4 * z, w, 4 * z), tones.slab)
			_dashed_rect(Rect2(x + 1.5, y + 1.5, w - 3, h - 4 * z - 2), tones.slab, 1.0, 3.0)
			return
		"office", "shop", "flat", "food", "hotel", "hall":
			_draw_unit(st, t, r, is_reachable, warm)
	# Shared architecture: floor slab, ceiling highlight, exposed sides and roofs.
	ci.draw_rect(Rect2(x, y + h - 2 * z, w, 2 * z), Color(0, 0, 0, 0.28))
	ci.draw_rect(Rect2(x, y, w, maxf(1, z)), Color(1, 1, 1, 0.14))
	if not info.is_empty():
		if info.rightOpen:
			ci.draw_rect(Rect2(x + w - 2.5 * z, y, 2.5 * z, h), Color(0, 0, 0, 0.26))
		if info.leftOpen:
			ci.draw_rect(Rect2(x, y, 1.5 * z, h), Color(1, 1, 1, 0.14))
		if info.topMask:
			var cw := C.CELL_W * z
			for dx in t.w:
				if not (info.topMask & (1 << dx)):
					continue
				var px = x + dx * cw
				ci.draw_rect(Rect2(px, y - 2.5 * z, cw, 2.5 * z), tones.wall)
				ci.draw_rect(Rect2(px, y - 2.5 * z, cw, maxf(1, z)), Color(1, 1, 1, 0.3))
				var k := _h(st.col + dx, st.floor + 77)
				if k > 0.72:
					ci.draw_rect(Rect2(px + cw * 0.3, y - 8 * z, cw * 0.4, 5.5 * z), tones.wall)
					ci.draw_rect(Rect2(px + cw * 0.3, y - 8 * z, cw * 0.4, maxf(1, z)), Color(1, 1, 1, 0.22))
				elif k < 0.12:
					ci.draw_rect(Rect2(px + cw * 0.5, y - 10 * z, maxf(1, z), 7.5 * z), tones.wall)
	ci.draw_rect(Rect2(x + 0.5, y + 0.5, w - 1, h - 1), tones.wall, false, 1.0)


func _draw_unit(st: Dictionary, t: Dictionary, r: Rect2, is_reachable: bool, warm: float) -> void:
	var z: float = cam.zoom
	var x := r.position.x
	var y := r.position.y
	var w := r.size.x
	var h := r.size.y
	var vacant: bool = not st.occupied
	var biz: Dictionary = {} if vacant else Tenants.tenant_of(st)
	var bt: Dictionary = _biz_tone(st.type, biz) if not biz.is_empty() else {}
	ci.draw_rect(r, bt.tint if not bt.is_empty() else tones[st.type])
	match st.type:
		"office":
			var spec: Array = OFFICE_WINDOWS[biz.get("windows", "grid")]
			var n: int = t.w * spec[0]
			var ww := w / n
			var gx = (1 - spec[1]) / 2.0
			for i in n:
				var hh := _h(st.id, i) * 0.6
				var lit := 0.0 if vacant else _smooth(hh, hh + 0.25, warm)
				ci.draw_rect(Rect2(x + i * ww + ww * gx, y + spec[2] * z, ww * spec[1], h - spec[3] * z), _win(lit))
				ci.draw_rect(Rect2(x + i * ww + ww * gx, y + spec[2] * z, ww * spec[1], maxf(1, z)), Color(1, 1, 1, 0.22))
			if not biz.is_empty():
				_draw_glyph(biz.glyph, x + 8 * z, y + h - 10 * z, z, bt.accent)
				_draw_name(st, x + 3 * z, y + 3 * z, w - 12 * z, z)
		"shop":
			var lit := 0.0 if vacant else _smooth(0.1, 0.5, warm)
			ci.draw_rect(Rect2(x + 3 * z, y + 11 * z, w * 0.6, h - 13 * z), _win(lit))
			ci.draw_rect(Rect2(x + w * 0.7, y + 11 * z, w * 0.22, h - 11 * z), _win(lit))
			ci.draw_rect(Rect2(x + 3 * z, y + 7 * z, w - 6 * z, 3 * z), Color(0, 0, 0, 0.18))
			var awning: String = biz.get("awning", "stripe")
			if awning == "stripe":
				var sc: int = t.w * 4
				var sw := w / sc
				for i in sc:
					var col: Color = tones.awning if i % 2 else (bt.accent if not bt.is_empty() else tones.shop)
					ci.draw_rect(Rect2(x + i * sw, y + 2 * z, sw, 6 * z), col)
					ci.draw_circle(Vector2(x + (i + 0.5) * sw, y + 8 * z), sw / 2, col)
			elif awning == "flat":
				ci.draw_rect(Rect2(x, y + 2 * z, w, 6 * z), bt.accent)
				ci.draw_rect(Rect2(x, y + 7 * z, w, maxf(1, z)), Color(1, 1, 1, 0.3))
			elif awning == "noren":
				ci.draw_rect(Rect2(x + 2 * z, y + 2 * z, w - 4 * z, 1.5 * z), tones.wall)
				var pw := (w - 6 * z) / 4
				for i in 4:
					ci.draw_rect(Rect2(x + 3 * z + i * pw + 0.5 * z, y + 3.5 * z, pw - z, 9 * z), bt.accent)
			ci.draw_rect(Rect2(x, y + 2 * z, w, z), Color(0, 0, 0, 0.22))
			if not biz.is_empty():
				_draw_glyph(biz.glyph, x + 3 * z + w * 0.3, y + 22 * z, z, bt.accent)
				if z >= C.NAME_ZOOM:
					ci.draw_rect(Rect2(x + 2 * z, y + 12 * z, w - 4 * z, 5.5 * z), Color(0, 0, 0, 0.55))
					_draw_name(st, x + 3.5 * z, y + 14.8 * z, w - 7 * z, z, true)
		"food":
			var lit := 0.0 if vacant else _smooth(0.05, 0.45, warm)
			ci.draw_rect(Rect2(x + 3 * z, y + 6 * z, w - 6 * z, h * 0.32), _win(lit))
			ci.draw_rect(Rect2(x + 3 * z, y + 6 * z + h * 0.32, w - 6 * z, 2 * z), bt.accent if not bt.is_empty() else Color(0, 0, 0, 0.22))
			for i in 3:
				var tx := x + w * (0.2 + i * 0.3)
				var ty := y + h * 0.72
				ci.draw_rect(Rect2(tx - 4 * z, ty, 8 * z, 1.5 * z), tones.wall)
				ci.draw_rect(Rect2(tx - 0.5 * z, ty, maxf(1, z), h * 0.2), tones.wall)
			if not biz.is_empty():
				_draw_glyph(biz.glyph, x + w - 9 * z, y + 6 * z + h * 0.16, z, bt.accent)
				_draw_name(st, x + 3 * z, y + 3 * z, w - 10 * z, z)
		"hotel":
			var lit := 0.0 if vacant else _smooth(0.1, 0.5, warm)
			ci.draw_rect(Rect2(x + w * 0.08, y + 6 * z, w * 0.3, h * 0.45), _win(lit))
			ci.draw_rect(Rect2(x + w * 0.48, y + h * 0.6, w * 0.44, h * 0.18), biz.get("spread", Color(1, 1, 1, 0.7)))
			ci.draw_rect(Rect2(x + w * 0.46, y + h * 0.42, 2 * z, h * 0.4), tones.wall)
			if st.dirty:
				var stain := Color(120 / 255.0, 78 / 255.0, 32 / 255.0, 0.55)
				ci.draw_rect(Rect2(x + w * 0.55, y + h * 0.56, w * 0.2, h * 0.1), stain)
				ci.draw_circle(Vector2(x + w * 0.22, y + h * 0.8), 2.2 * z, stain)
		"hall":
			var on: bool = state.crowds.get(st.id, 0) > 0
			ci.draw_rect(Rect2(x + w * 0.25, y + 6 * z, w * 0.5, h * 0.5), _win(1.0 if on else (0.0 if vacant else 0.3 * warm)))
			var curtain: Color = biz.get("curtain", Color(150 / 255.0, 30 / 255.0, 40 / 255.0, 0.8))
			ci.draw_rect(Rect2(x + w * 0.2, y + 5 * z, w * 0.08, h * 0.55), curtain)
			ci.draw_rect(Rect2(x + w * 0.72, y + 5 * z, w * 0.08, h * 0.55), curtain)
			for i in 10:
				ci.draw_rect(Rect2(x + w * (0.06 + i * 0.09), y + h * 0.74, w * 0.05, h * 0.12), tones.wall)
			if not biz.is_empty():
				_draw_name(st, x + 3 * z, y + 2.6 * z, w - 10 * z, z)
		_:
			var ww := w * 0.22
			for i in 2:
				var hh := _h(st.id, i + 9) * 0.5
				var lit := 0.0 if vacant else _smooth(hh, hh + 0.3, warm)
				var wx := x + w * (0.1 + i * 0.5)
				ci.draw_rect(Rect2(wx, y + 6 * z, ww, h * 0.5), _win(lit))
				var curtain: Color = biz.get("curtain", Color(1, 1, 1, 0.45))
				ci.draw_rect(Rect2(wx, y + 6 * z, ww * 0.22, h * 0.5), curtain)
				ci.draw_rect(Rect2(wx + ww * 0.78, y + 6 * z, ww * 0.22, h * 0.5), curtain)
			var by := y + h * 0.62
			ci.draw_rect(Rect2(x + 2 * z, by, w - 4 * z, 1.5 * z), tones.wall)
			for i in 9:
				ci.draw_rect(Rect2(x + 2 * z + (w - 4 * z) * (i / 8.0) - 0.5 * z, by, maxf(1, z), h * 0.3), tones.wall)
			var extra: String = biz.get("extra", "none")
			if extra == "plant":
				ci.draw_rect(Rect2(x + w * 0.82, by - 2.5 * z, 3 * z, 2.5 * z), tones.wall)
				ci.draw_circle(Vector2(x + w * 0.82 + 1.5 * z, by - 4.5 * z), 2.6 * z, bt.accent)
			elif extra == "bike":
				var bx := x + w * 0.66
				ci.draw_arc(Vector2(bx, by - 2.6 * z), 2.2 * z, 0, TAU, 12, bt.accent, maxf(1, z))
				ci.draw_arc(Vector2(bx + 6.4 * z, by - 2.6 * z), 2.2 * z, 0, TAU, 12, bt.accent, maxf(1, z))
				ci.draw_polyline(PackedVector2Array([Vector2(bx, by - 2.6 * z), Vector2(bx + 3.2 * z, by - 5 * z), Vector2(bx + 6.4 * z, by - 2.6 * z)]), bt.accent, maxf(1, z))
			elif extra == "laundry":
				ci.draw_rect(Rect2(x + w * 0.36, y + 7 * z, w * 0.24, maxf(1, 0.6 * z)), tones.wall)
				for i in 3:
					ci.draw_rect(Rect2(x + w * (0.38 + i * 0.07), y + 7.5 * z, 2.2 * z, (3 + (i % 2) * 1.5) * z), bt.accent)
	if vacant:
		ci.draw_rect(r, Color(0, 0, 0, 0.16))
		ci.draw_rect(Rect2(x + w / 2 - 3 * z, y + h - 9 * z, 6 * z, 4 * z), Color(1, 1, 1, 0.75))
	if st.burnt:
		_draw_shell(r, z, st.id)
	if not is_reachable:
		_hatch(r)


func _draw_glyph(kind: String, cx: float, cy: float, u: float, col: Color) -> void:
	var plaque := Color(1, 1, 1, 0.88)
	ci.draw_circle(Vector2(cx, cy), 5 * u, plaque)
	var lw := maxf(1, 1.1 * u)
	match kind:
		"fish":
			_ellipse(Vector2(cx - 0.6 * u, cy), 2.6 * u, 1.5 * u, 0, col)
			_poly([Vector2(cx + 1.6 * u, cy), Vector2(cx + 3.4 * u, cy - 1.6 * u), Vector2(cx + 3.4 * u, cy + 1.6 * u)], col)
		"slice":
			_poly([Vector2(cx - 3 * u, cy - 2.2 * u), Vector2(cx + 3 * u, cy - 2.2 * u), Vector2(cx, cy + 3.2 * u)], col)
			ci.draw_circle(Vector2(cx - 0.9 * u, cy - 0.9 * u), 0.7 * u, plaque)
			ci.draw_circle(Vector2(cx + 0.9 * u, cy - 0.3 * u), 0.7 * u, plaque)
		"leaf":
			_ellipse(Vector2(cx, cy), 3.6 * u, 1.8 * u, -0.6, col)
			ci.draw_line(Vector2(cx - 2.6 * u, cy + 1.8 * u), Vector2(cx + 2.4 * u, cy - 1.6 * u), plaque, lw)
		"bowl":
			var pts := []
			for i in 13:
				var a := PI * i / 12.0
				pts.append(Vector2(cx + cos(a) * 3.2 * u, cy + sin(a) * 3.2 * u))
			_poly(pts, col)
			ci.draw_line(Vector2(cx - 0.5 * u, cy - 0.3 * u), Vector2(cx + 2.4 * u, cy - 3.6 * u), col, lw)
			ci.draw_line(Vector2(cx + 0.8 * u, cy - 0.3 * u), Vector2(cx + 3.4 * u, cy - 3 * u), col, lw)
		"cup":
			ci.draw_rect(Rect2(cx - 2.6 * u, cy - 2 * u, 4 * u, 4 * u), col)
			ci.draw_arc(Vector2(cx + 1.6 * u, cy), 1.4 * u, -PI / 2, PI / 2, 8, col, lw)
			ci.draw_rect(Rect2(cx - 3.4 * u, cy + 2.4 * u, 5.6 * u, maxf(1, 0.8 * u)), col)
		"dumbbell":
			ci.draw_rect(Rect2(cx - 2.6 * u, cy - 0.5 * u, 5.2 * u, u), col)
			ci.draw_rect(Rect2(cx - 3.6 * u, cy - 2.2 * u, 1.6 * u, 4.4 * u), col)
			ci.draw_rect(Rect2(cx + 2 * u, cy - 2.2 * u, 1.6 * u, 4.4 * u), col)
		"flower":
			for i in 5:
				var a := i * 1.2566
				ci.draw_circle(Vector2(cx + cos(a) * 2 * u, cy + sin(a) * 2 * u), 1.3 * u, col)
			ci.draw_circle(Vector2(cx, cy), 1.1 * u, Color.html("#f6b73c"))
		"book":
			ci.draw_rect(Rect2(cx - 3.4 * u, cy - 2.2 * u, 3 * u, 4.4 * u), col)
			ci.draw_rect(Rect2(cx + 0.4 * u, cy - 2.2 * u, 3 * u, 4.4 * u), col)
		"chip":
			ci.draw_rect(Rect2(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u), col)
			for d in [-1.2, 0.0, 1.2]:
				ci.draw_line(Vector2(cx - 3.4 * u, cy + d * u), Vector2(cx + 3.4 * u, cy + d * u), col, lw)
				ci.draw_line(Vector2(cx + d * u, cy - 3.4 * u), Vector2(cx + d * u, cy + 3.4 * u), col, lw)
		"scales":
			ci.draw_rect(Rect2(cx - 0.5 * u, cy - 3 * u, u, 6 * u), col)
			ci.draw_rect(Rect2(cx - 3.4 * u, cy - 2.4 * u, 6.8 * u, 0.9 * u), col)
			for sxv in [-2.6, 2.6]:
				var pts := []
				for i in 9:
					var a := PI * i / 8.0
					pts.append(Vector2(cx + sxv * u + cos(a) * 1.3 * u, cy + sin(a) * 1.3 * u))
				_poly(pts, col)
		"coin":
			ci.draw_circle(Vector2(cx, cy), 3.2 * u, col)
			ci.draw_rect(Rect2(cx - 0.5 * u, cy - 2 * u, u, 4 * u), plaque)
		"pen":
			ci.draw_line(Vector2(cx + 2.6 * u, cy - 2.6 * u), Vector2(cx - 1.4 * u, cy + 1.4 * u), col, maxf(1, 1.8 * u))
			_poly([Vector2(cx - 1.9 * u, cy + 0.6 * u), Vector2(cx - 0.6 * u, cy + 1.9 * u), Vector2(cx - 3 * u, cy + 3 * u)], col)


func _ellipse(c: Vector2, rx: float, ry: float, rot: float, col: Color) -> void:
	var pts := []
	for i in 16:
		var a := TAU * i / 16.0
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry).rotated(rot))
	_poly(pts, col)


func _draw_name(st: Dictionary, x: float, y: float, max_w: float, z: float, centred_y: bool = false) -> void:
	if z < C.NAME_ZOOM or max_w < 12:
		return
	var name := Tenants.name_of(st)
	if name == "":
		return
	var fs := maxi(6, roundi(4.2 * z))
	var text := name
	if font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > max_w:
		while text.length() > 1 and font.get_string_size(text + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > max_w:
			text = text.substr(0, text.length() - 1)
		text = text.strip_edges(false, true) + "…"
	ci.draw_string(font, Vector2(x, y + fs * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.95))


func _draw_mood(r: Rect2, z: float, band: String, seed: int) -> void:
	var cx := r.end.x - 5 * z
	var cy := r.position.y + 5 * z
	var bob := 0.0 if reduced or band != "good" else sin(now_ms / 520.0 + seed) * 0.6 * z
	var R := 3.2 * z
	var col: Color = pal.good if band == "good" else (pal.warn if band == "fair" else pal.danger)
	_ldisc(Vector2(cx, cy + bob), R, col)
	_lrect(Rect2(cx - 1.5 * z, cy + bob - 1.1 * z, 0.8 * z, 0.8 * z), Color.WHITE)
	_lrect(Rect2(cx + 0.7 * z, cy + bob - 1.1 * z, 0.8 * z, 0.8 * z), Color.WHITE)
	var lw := maxf(0.6, 0.45 * z)
	var my := cy + bob + 1.1 * z
	if band == "good":                     # a smile: a flat bottom with raised corners
		_lrect(Rect2(cx - 0.9 * z, my, 1.8 * z, lw), Color.WHITE)
		_lrect(Rect2(cx - 1.5 * z, my - 0.6 * z, 0.6 * z, lw), Color.WHITE)
		_lrect(Rect2(cx + 0.9 * z, my - 0.6 * z, 0.6 * z, lw), Color.WHITE)
	elif band == "fair":
		_lrect(Rect2(cx - 1.2 * z, my, 2.4 * z, lw), Color.WHITE)
	else:                                  # a frown: the same, turned down
		_lrect(Rect2(cx - 0.9 * z, my - 0.4 * z, 1.8 * z, lw), Color.WHITE)
		_lrect(Rect2(cx - 1.5 * z, my + 0.2 * z, 0.6 * z, lw), Color.WHITE)
		_lrect(Rect2(cx + 0.9 * z, my + 0.2 * z, 0.6 * z, lw), Color.WHITE)
		if not reduced:
			var p := fposmod(now_ms / 900.0 + seed * 0.37, 1.0)
			_ldisc(Vector2(cx + R + 0.6 * z, cy - R + p * 5 * z), 0.9 * z, Color(120 / 255.0, 190 / 255.0, 1, 1 - p))

func _draw_fire(r: Rect2, z: float, seed: int) -> void:
	var t := 0.0 if reduced else now_ms / 1000.0
	ci.draw_rect(r.grow(-z), Color(1, 120 / 255.0, 30 / 255.0, 0.28 + (0.0 if reduced else 0.08 * sin(now_ms / 110.0 + seed))))
	for i in 3:
		var fx := r.position.x + r.size.x * (0.22 + i * 0.28)
		var base := r.end.y - 3 * z
		var h := r.size.y * (0.42 + 0.1 * (i % 2)) * (1.0 if reduced else 0.85 + 0.15 * sin(now_ms / 95.0 + seed * 1.3 + i * 2.1))
		var w := 4.2 * z
		_poly([Vector2(fx - w, base), Vector2(fx - w * 0.6, base - h * 0.55), Vector2(fx, base - h), Vector2(fx + w * 0.6, base - h * 0.55), Vector2(fx + w, base)], Color.html("#ff7a1a"))
		_poly([Vector2(fx - w * 0.5, base), Vector2(fx - w * 0.2, base - h * 0.35), Vector2(fx, base - h * 0.6), Vector2(fx + w * 0.2, base - h * 0.35), Vector2(fx + w * 0.5, base)], Color.html("#ffd166"))
	for i in SMOKE_PUFFS:
		var p := (i + 0.5) / SMOKE_PUFFS if reduced else fposmod(t * 0.5 + float(i) / SMOKE_PUFFS + _h(seed, i), 1.0)
		var px := r.position.x + r.size.x * (0.3 + 0.4 * _h(seed, i + 11)) + (0.0 if reduced else sin(t * 2 + i) * 2 * z)
		var py := r.position.y - p * r.size.y * 0.9
		ci.draw_circle(Vector2(px, py), (2.5 + 3 * p) * z, Color(Color.html("#6b7280"), 0.38 * (1 - p)))


func _draw_shell(r: Rect2, z: float, seed: int) -> void:
	ci.draw_rect(r, Color(20 / 255.0, 16 / 255.0, 14 / 255.0, 0.72))
	for i in 3:
		var px := r.position.x + r.size.x * (0.18 + i * 0.3)
		var sw := r.size.x * (0.1 + 0.06 * _h(seed, i))
		_poly([Vector2(px - sw, r.position.y + r.size.y * 0.55), Vector2(px - sw * 0.5, r.position.y + 2 * z), Vector2(px + sw * 0.5, r.position.y + 2 * z), Vector2(px + sw, r.position.y + r.size.y * 0.55)], Color(0, 0, 0, 0.55))
	for dy in [0.62, 0.78]:
		ci.draw_line(Vector2(r.position.x + r.size.x * 0.36, r.position.y + r.size.y * dy), Vector2(r.position.x + r.size.x * 0.64, r.position.y + r.size.y * (dy + 0.08)), Color.html("#8b6b4a"), maxf(1, 1.5 * z))


## Batched primitives for the live layer (see dot_tex).
func _lrect(r: Rect2, col: Color) -> void:
	draw_texture_rect_region(dot_tex, r, DOT_SQUARE, col)


func _ldisc(c: Vector2, radius: float, col: Color) -> void:
	draw_texture_rect_region(dot_tex, Rect2(c.x - radius, c.y - radius, radius * 2, radius * 2), DOT_DISC, col)


## Diagonal hatching marks a room with no path from the lobby. Godot's canvas has no clip
## inside _draw, so each line is clipped to the rectangle here.
func _hatch(r: Rect2) -> void:
	var col: Color = pal.unreach
	var x := r.position.x - r.size.y
	while x < r.end.x:
		# The line runs from (x, bottom) to (x + h, top); keep the part inside x0..x1.
		var t0 := clampf((r.position.x - x) / r.size.y, 0, 1)
		var t1 := clampf((r.end.x - x) / r.size.y, 0, 1)
		if t1 > t0:
			ci.draw_line(Vector2(x + t0 * r.size.y, r.end.y - t0 * r.size.y), Vector2(x + t1 * r.size.y, r.end.y - t1 * r.size.y), col, 2.0)
		x += 9


func _selection_box(r: Rect2) -> void:
	var pulse := 1.0 if reduced else 0.6 + 0.4 * sin(now_ms / 200.0)
	ci.draw_rect(r.grow(2), Color(pal.accent, pulse), false, 2.0)


# ---- People, lifts, dust and floats ----------------------------------------------------

func _draw_lift_cars(frac: float) -> void:
	var z: float = cam.zoom
	for sh in state.transit.shafts:
		var top := sy((state.maxFloors - sh.hi) * C.CELL_H)
		var head := rect_of(sh.col, sh.hi, 1, 1)
		if head.position.x > size.x or head.end.x < 0:
			continue
		var ind: int = sh.lo
		for ci in sh.cars.size():
			var car: Dictionary = sh.cars[ci]
			var pos := lerpf(car.prev, car.at, frac * 2) if frac < 0.5 else lerpf(car.at, car.to, (frac - 0.5) * 2)
			if ci == 0:
				ind = roundi(pos)
			var r := rect_of(sh.col, pos, 1, 1)
			if ci == 0:
				_lrect(Rect2(r.get_center().x - 0.5 * z, top, maxf(1, z), maxf(0, r.position.y + 3 * z - top)), Color(1, 1, 1, 0.35))
				var span := maxf(1, sh.hi - sh.lo)
				var cw_y = top + ((pos - sh.lo) / span) * ((sh.hi - sh.lo) * C.CELL_H * z)
				_lrect(Rect2(r.position.x + r.size.x * 0.82, cw_y + 6 * z, 2 * z, 10 * z), Color(0, 0, 0, 0.35))
			var cx := r.position.x + 3 * z
			var cy := r.position.y + 3 * z
			var cw := r.size.x - 6 * z
			var chh := r.size.y - 6 * z
			_lrect(Rect2(cx, cy, cw, chh), tones.car)
			_lrect(Rect2(cx, cy, cw, maxf(1, 1.5 * z)), Color(1, 1, 1, 0.35))
			var open := clampf(1 - absf(frac - 0.5) * 6, 0, 1) if car.n else 0.0
			_lrect(Rect2(cx + cw * 0.2, cy + 3 * z, cw * 0.6, chh - 5 * z), Color(win_tone[8], 0.25 + 0.75 * open))
			for i in mini(3, car.n):
				_ldisc(Vector2(cx + cw * (0.3 + i * 0.2), cy + 6 * z), 1.4 * z, tones.person)
			var gap := cw * 0.3 * open
			_lrect(Rect2(cx + cw * 0.2, cy + 3 * z, maxf(0, cw * 0.3 - gap), chh - 5 * z), Color(0, 0, 0, 0.3))
			_lrect(Rect2(cx + cw * 0.5 + gap, cy + 3 * z, maxf(0, cw * 0.3 - gap), chh - 5 * z), Color(0, 0, 0, 0.3))
		for f in range(sh.lo, sh.hi + 1):
			var y := sy((state.maxFloors - f + 0.5) * C.CELL_H)
			var col: Color = tones.car if f == ind else (Color(0, 0, 0, 0.45) if sh.closed.has(f) else Color(1, 1, 1, 0.18))
			_lrect(Rect2(head.position.x + z, y - z, 1.5 * z, 2 * z), col)


func _stress_colour(band: String, shirt: Color) -> Color:
	return pal.danger if band == "stressed" else (pal.warn if band == "tense" else shirt)


func _draw_queues() -> void:
	var z: float = cam.zoom
	for sh in state.transit.shafts:
		if sh.queue.is_empty():
			continue
		var door_count := {}
		for w in sh.queue:
			var door: int = w.legs[w.leg][1]
			var i: int = door_count.get(door, 0)
			if i >= QUEUE_DRAWN:
				continue
			door_count[door] = i + 1
			var x := sx(sh.col * C.CELL_W - 4 - i * QUEUE_GAP)
			var y := sy((state.maxFloors - door + 1) * C.CELL_H) - 2 * z
			if x < -10 or x > size.x + 10 or y < -20 or y > size.y + 20:
				continue
			var band := Sim.stress_band(Sim.stress_of(state, w))
			var h := 7 * z
			var shake := 0.0
			if not reduced and band == "stressed":
				shake = sin(now_ms / 45.0 + i * 1.7) * 0.5 * z
			elif not reduced and band == "tense":
				shake = sin(now_ms / 260.0 + i) * 0.25 * z
			var px := x + shake
			_lrect(Rect2(px - 1.6 * z, y - 3 * z, 1.4 * z, 3 * z), tones.person)
			_lrect(Rect2(px + 0.2 * z, y - 3 * z, 1.4 * z, 3 * z), tones.person)
			_lrect(Rect2(px - 2 * z, y - 3 * z - h + 2 * z, 4 * z, h - 2 * z), _stress_colour(band, shirts[w.unit % shirts.size()]))
			_ldisc(Vector2(px, y - h - 2.2 * z), 2 * z, tones.person)
			if band == "stressed" and not reduced:
				var p := fposmod(now_ms / 700.0 + i * 0.31, 1.0)
				_ldisc(Vector2(px + 2.8 * z, y - h - 3 * z + p * 4 * z), 0.9 * z, Color(120 / 255.0, 190 / 255.0, 1, 1 - p))


func _draw_walkers(dt: float) -> void:
	var z: float = cam.zoom
	# Occupancy changes only on a tick or a build, so the walker list is rebuilt only then.
	var sig := "%d|%s" % [state.tick, lay.sig]
	if sig != walker_sig:
		walker_sig = sig
		var live := {}
		walker_list.clear()
		for st in state.structures:
			var t: Dictionary = C.TYPES[st.type]
			if t.kind != "unit" or not st.occupied:
				continue
			live[st.id] = true
			if not walkers.has(st.id):
				var n := maxi(1, roundi(max(t.get("people", 0), 2) / 2.0))
				var list := []
				for i in n:
					list.append({"floor": st.floor, "x": (st.col + (i + 0.5) * (t.w / float(n))) * C.CELL_W, "dir": -1.0 if i % 2 else 1.0,
						"speed": 11 + _h(st.id, i) * 9, "phase": _h(st.id, i + 3) * 6.28, "shirt": shirts[(st.id + i) % shirts.size()], "l": 0.0, "r": 0.0})
				walkers[st.id] = list
			var info: Dictionary = lay.info.get(st.id, {})
			for w in walkers[st.id]:
				if not info.is_empty():
					w.l = info.corrL * C.CELL_W + 3
					w.r = (info.corrR + 1) * C.CELL_W - 3
				walker_list.append(w)
		for id in walkers.keys():
			if not live.has(id):
				walkers.erase(id)
	if not reduced:
		var s := dt / 1000.0
		for w in walker_list:
			w.x += w.dir * w.speed * s
			w.phase += w.speed * 0.55 * s
			if w.x > w.r:
				w.x = w.r
				w.dir = -1.0
			elif w.x < w.l:
				w.x = w.l
				w.dir = 1.0
	for w in walker_list:
		var x := sx(w.x)
		var y := sy((state.maxFloors - w.floor + 1) * C.CELL_H) - 2 * z
		if x < -10 or x > size.x + 10 or y < -20 or y > size.y + 20:
			continue
		var bob := 0.0 if reduced else absf(sin(w.phase)) * 0.8 * z
		var swing := 0.0 if reduced else sin(w.phase) * 2.2 * z
		var h := 7 * z
		_lrect(Rect2(x - 0.8 * z + swing * 0.5, y - 3 * z, 1.6 * z, 3 * z), tones.person)
		_lrect(Rect2(x - 0.8 * z - swing * 0.5, y - 3 * z, 1.6 * z, 3 * z), tones.person)
		_lrect(Rect2(x - 1.8 * z, y - 3 * z - h + 2 * z - bob, 3.6 * z, h - 2 * z), w.shirt)
		_ldisc(Vector2(x, y - h - 2.2 * z - bob), 2 * z, tones.person)


func _draw_dust() -> void:
	var z: float = cam.zoom
	for d in dust:
		if not d.on:
			continue
		var p: float = (now_ms - d.t0) / d.dur
		if p >= 1 or reduced:
			d.on = false
			continue
		var k := 1 - pow(1 - p, 3)
		var col := Color.html("#ffe8a3") if d.warm else Color(200 / 255.0, 196 / 255.0, 186 / 255.0)
		_ldisc(Vector2(sx(d.x + d.vx * k), sy(d.y + d.vy * k + 14 * k * k)), d.r * z * (0.6 + 0.6 * k), Color(col, (1 - p) * 0.8))


func _draw_floats() -> void:
	var z := clampf(cam.zoom, 0.9, 1.6)
	var fs := roundi(11 * z)
	for f in floats:
		if not f.on:
			continue
		var age: float = now_ms - f.t0
		if age < 0:
			continue
		var p := age / FLOAT_MS
		if p >= 1:
			f.on = false
			continue
		var rise := 0.0 if reduced else FLOAT_RISE * (1 - pow(1 - p, 3)) * z
		var alpha := (1.0 if p < 0.75 else 0.0) if reduced else (1.0 if p < 0.6 else 1 - (p - 0.6) / 0.4)
		if alpha <= 0:
			continue
		var x := sx(f.x)
		var y := sy(f.y) - rise
		if x < -40 or x > size.x + 40 or y < -20 or y > size.y + 20:
			continue
		var tw := font.get_string_size(f.text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 8 * z
		ci.draw_rect(Rect2(x - tw / 2, y - 14 * z, tw, 15 * z), Color(pal["float-bg"], pal["float-bg"].a * alpha))
		_text_centre(f.text, Vector2(x, y - 7 * z), fs, Color(pal.danger if f.neg else pal.good, alpha))


static func _ease_out_back(t: float) -> float:
	t = clampf(t, 0, 1)
	var c := 1.70158
	return 1 + (c + 1) * pow(t - 1, 3) + c * pow(t - 1, 2)
