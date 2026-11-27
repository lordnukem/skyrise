# The tower view, in pixel art: camera, touch and mouse input, and every sprite of the tower.
# The world is measured in art pixels (a cell is 12x16) and shown at a whole-number zoom, so
# every art pixel is a crisp square on screen. Sprites come from one atlas
# (tools/pixelart/build.py), so most of the frame draws in a few batches.
#
# Layers, back to front:
#   sky        a ColorRect with sky.gdshader (banded, dithered, twinkling stars), every frame
#   back       cached: the far skyline, near buildings, street, trees and lamps
#   life       live: sun, moon, clouds, birds and traffic, behind the tower
#   tower      cached: the basement, the grid and every room (redrawn on a tick, a build,
#              a camera move or a change of light)
#   live       faces, fires, lift cars, people, queues, dust, weather, floats, the draft
extends Control

signal tapped(col: int, floor_: int)
signal long_pressed(col: int, floor_: int)

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const H = preload("res://sim/hashing.gd")
const Tenants = preload("res://sim/tenants.gd")
const Palette = preload("res://game/palette.gd")
const Pixel = preload("res://game/pixel.gd")

const ART_W := 12                        # a cell, in art pixels
const ART_H := 16
const ZOOM_STEPS := [1, 2, 3, 4]
const PLACE_MS := 260.0
const FLOAT_MS := 1100.0
const MAX_FLOATS_PER_TICK := 8
const QUEUE_DRAWN := 10
const SHIRTS := ["#e76f51", "#2a9d8f", "#e9c46a", "#8ecae6", "#cdb4db", "#f4a261", "#6bbf59", "#d4588f"]
const BIZ_TYPES := ["office", "shop", "flat", "food", "hotel", "hall"]

var state: Dictionary = {}
var view: Dictionary = {}
var cam := {"x": 0.0, "y": 0.0, "zoom": 2}
var pal: Dictionary = Palette.colours(false)
var dark := false
var reduced := false
var phase := 0.0
var prof := {"draw_ms": 0.0, "static_ms": 0.0, "static_count": 0}
var font: Font
var tex: Texture2D
var shirts: Array[Color] = []

var tones := {}
var tone_key := ""
var hash_memo := {}
var lay := {"sig": "", "grid": {}, "reach": {}, "info": {}, "shafts": []}
var walkers := {}
var walker_list := []
var walker_sig := ""
var placing := {}
var dust := []
var floats := []
var float_cursor := 0
var now_ms := 0.0
var last_frame := 0.0
var park_left := 0

var sky: ColorRect
var back_vp: SubViewport
var back_canvas: Node2D
var tower_vp: SubViewport
var tower_canvas: Node2D
var ci: CanvasItem = self
var static_key := ""
var back_key := ""
var ground_y_now := 0.0
var static_skip := {}
var traffic := []                        # street cars: {x, dir, kind, speed}
var cues := []                           # [{name, pos}] from the last tick, for placed sounds
var was_let := {}                        # unit ids let at the last tick, to hear move-ins
var flock := {"x": -999.0, "y": 0.0, "dir": 1.0, "n": 0, "next": 0.0}

# Input.
var pointers := {}
var moved := false
var long_at := -1.0
var pinch_start := 0.0
var pinch_zoom := 2
var mouse_down := false
var mouse_last := Vector2.ZERO
var mouse_start := Vector2.ZERO


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	font = Pixel.font()
	tex = Pixel.texture()
	for s in SHIRTS:
		shirts.append(Color.html(s))
	for i in 64:
		dust.append({"on": false})
	for i in 48:
		floats.append({"on": false})
	sky = ColorRect.new()
	sky.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	sky.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sky.show_behind_parent = true
	var mat := ShaderMaterial.new()
	mat.shader = load("res://game/sky.gdshader")
	sky.material = mat
	add_child(sky)
	back_vp = _make_layer()
	back_canvas = back_vp.get_child(0)
	back_canvas.draw.connect(_draw_back)
	tower_vp = _make_layer()
	tower_canvas = tower_vp.get_child(0)
	tower_canvas.draw.connect(_draw_tower)
	for i in 6:
		traffic.append({"x": randf() * 900.0, "dir": 1.0 if i % 2 else -1.0, "kind": i % 4, "speed": 14.0 + randf() * 10.0})


func _make_layer() -> SubViewport:
	var vp := SubViewport.new()
	vp.disable_3d = true
	vp.transparent_bg = true
	vp.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	var n := Node2D.new()
	vp.add_child(n)
	return vp


func set_theme_dark(on: bool) -> void:
	dark = on
	pal = Palette.colours(on)
	tone_key = ""


func _h(a: int, b: int) -> float:
	var k := Vector2i(a, b)
	var v = hash_memo.get(k)
	if v == null:
		v = H.hash01(a, b)
		hash_memo[k] = v
	return v


# ---- Camera -------------------------------------------------------------------------

func world_h() -> float:
	return state.maxFloors * ART_H


func world_w() -> float:
	return state.width * ART_W


func clamp_cam() -> void:
	var z: float = cam.zoom
	var margin := 4.0 * ART_W
	var view_w := size.x / z
	var view_h := size.y / z
	var min_x := -margin
	var max_x := world_w() + margin - view_w
	cam.x = (min_x + max_x) / 2.0 if max_x < min_x else clampf(cam.x, min_x, max_x)
	var top := Sim.floor_cap(state)
	for st in state.structures:
		top = maxi(top, st.floor + C.TYPES[st.type].h - 1)
	var min_y: float = (state.maxFloors - top - 2) * ART_H
	var max_y: float = world_h() + (C.BASEMENT_LEVELS + 2) * ART_H - view_h
	cam.y = max_y if max_y < min_y else clampf(cam.y, min_y, max_y)


func recenter() -> void:
	cam.zoom = 2 if size.x < 500 else 3
	cam.x = world_w() / 2.0 - size.x / cam.zoom / 2.0
	cam.y = world_h() + ART_H * 1.6 - size.y / cam.zoom
	clamp_cam()


func pan(dx: float, dy: float) -> void:
	cam.x -= dx / cam.zoom
	cam.y -= dy / cam.zoom
	clamp_cam()


## Zoom to a whole-number step, keeping the art pixel under `p` where it is.
func zoom_to(p: Vector2, z: int) -> void:
	z = clampi(z, ZOOM_STEPS[0], ZOOM_STEPS[-1])
	if z == cam.zoom:
		return
	var wx: float = p.x / cam.zoom + cam.x
	var wy: float = p.y / cam.zoom + cam.y
	cam.zoom = z
	cam.x = wx - p.x / z
	cam.y = wy - p.y / z
	clamp_cam()


func _cx() -> float:
	return roundf(cam.x)


func _cy() -> float:
	return roundf(cam.y)


func screen_to_cell(p: Vector2) -> Vector2i:
	var wx: float = p.x / cam.zoom + _cx()
	var wy: float = p.y / cam.zoom + _cy()
	return Vector2i(int(floor(wx / ART_W)), state.maxFloors - int(floor(wy / ART_H)))


func sx(wx: float) -> float:
	return (wx - _cx()) * cam.zoom


func sy(wy: float) -> float:
	return (wy - _cy()) * cam.zoom


func rect_of(col: float, f: float, w: float, h: float) -> Rect2:
	return Rect2(sx(col * ART_W), sy((state.maxFloors - f - h + 1) * ART_H), w * ART_W * cam.zoom, h * ART_H * cam.zoom)


# ---- Drawing helpers --------------------------------------------------------------------

## A sprite with its top-left at screen point `at`, scaled by the zoom.
func spr(name: String, at: Vector2, col: Color = Color.WHITE, flip: bool = false) -> void:
	var r := Pixel.rect(name)
	if r.size.x == 0:
		return
	var z: float = cam.zoom
	var dst := Rect2(at, r.size * z)
	if flip:
		dst = Rect2(at + Vector2(r.size.x * z, 0), Vector2(-r.size.x * z, r.size.y * z))
	ci.draw_texture_rect_region(tex, dst, r, col)


## A solid rect, in screen pixels, from the atlas's white patch (so it batches with sprites).
func box(r: Rect2, col: Color) -> void:
	ci.draw_texture_rect_region(tex, r, Rect2(Pixel.rect("white").position, Vector2(1, 1)), col)


func text(s: String, at: Vector2, scale: int, col: Color, centre: bool = false) -> void:
	var fs := Pixel.FONT_1X * scale
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var x := at.x - (roundf(w / 2.0) if centre else 0.0)
	ci.draw_string(font, Vector2(roundf(x), roundf(at.y) + 7 * scale), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


static func _smooth(e0: float, e1: float, x: float) -> float:
	var t := clampf((x - e0) / (e1 - e0), 0, 1)
	return t * t * (3 - 2 * t)


# ---- Input -----------------------------------------------------------------------------

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
			pinch_start = _pinch_distance()
			pinch_zoom = cam.zoom
	else:
		if not pointers.has(e.index):
			return
		var p: Dictionary = pointers[e.index]
		pointers.erase(e.index)
		long_at = -1.0
		if pointers.is_empty() and not moved and not e.canceled:
			_tap(p.pos)


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
	elif pointers.size() == 2 and pinch_start > 0:
		# Pinch snaps through whole zoom steps: one step per 40% change in finger spread.
		var ratio := _pinch_distance() / pinch_start
		var step := roundi(log(maxf(ratio, 0.01)) / log(1.4))
		zoom_to(_pinch_centre(), pinch_zoom + step)


func _pinch_distance() -> float:
	var ps := pointers.values()
	return ps[0].pos.distance_to(ps[1].pos) if ps.size() >= 2 else 0.0


func _pinch_centre() -> Vector2:
	var ps := pointers.values()
	return (ps[0].pos + ps[1].pos) / 2.0


func _on_mouse_button(e: InputEventMouseButton) -> void:
	if e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
		zoom_to(e.position, cam.zoom + 1)
	elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
		zoom_to(e.position, cam.zoom - 1)
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
	moved = true
	var p: Vector2 = pointers.values()[0].pos if pointers.size() == 1 else mouse_start
	var c := screen_to_cell(p)
	long_pressed.emit(c.x, c.y)


# ---- Events from the game ---------------------------------------------------------------

func on_placed(st: Dictionary) -> void:
	placing[st.id] = now_ms
	var t: Dictionary = C.TYPES[st.type]
	_spawn_dust(st.col * ART_W, (st.col + t.w) * ART_W, (state.maxFloors - st.floor + 1) * ART_H, 8)


func on_demolished(st: Dictionary) -> void:
	var t: Dictionary = C.TYPES[st.type]
	_spawn_dust(st.col * ART_W, (st.col + t.w) * ART_W, (state.maxFloors - st.floor + 1) * ART_H, 14)
	placing.erase(st.id)


func _spawn_dust(x0: float, x1: float, y: float, n: int) -> void:
	for i in n:
		for d in dust:
			if not d.on:
				var u := (i + 0.5) / n
				d.on = true
				d.x = lerpf(x0, x1, u)
				d.y = y - 2
				d.t0 = now_ms
				d.dur = 450.0 + absf(_h(i, n)) * 200
				d.vx = (u - 0.5) * 18
				d.vy = -(6 + absf(_h(i, 7)) * 10)
				break


func on_tick() -> void:
	_layout()
	_collect_cues()
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
		_push_float((st.col + t.w / 2.0) * ART_W, (state.maxFloors - st.floor) * ART_H + 2, "+$%d" % take, false, idx)
		idx += 1
		emitted += 1
	float_cursor = (float_cursor + MAX_FLOATS_PER_TICK) % maxi(1, n)
	for sh in lay.shafts:
		var up: int = C.TYPES[sh.type].upkeep * (sh.hi - sh.lo + 1)
		_push_float((sh.col + 0.5) * ART_W, (state.maxFloors - sh.hi) * ART_H + 2, "-$%d" % up, true, idx)
		idx += 1


## Sounds with a place: a coin from a let unit on screen, a ding from a lift carrying riders,
## a chime where a tenant just moved in. One of each per tick at most, so 4x stays calm.
func _collect_cues() -> void:
	cues.clear()
	var screen := Rect2(Vector2.ZERO, size)
	var coin := false
	var chime := false
	var now_let := {}
	for st in state.structures:
		var t: Dictionary = C.TYPES[st.type]
		if t.kind != "unit" or not st.occupied:
			continue
		now_let[st.id] = true
		var r := rect_of(st.col, st.floor, t.w, t.h)
		if not screen.intersects(r):
			continue
		if not chime and not was_let.has(st.id) and not was_let.is_empty():
			cues.append({"name": "movein", "pos": global_position + r.get_center()})
			chime = true
		elif not coin and Sim.take_of(state, st) > 0 and (state.tick + st.id) % 3 == 0:
			cues.append({"name": "coin", "pos": global_position + r.get_center()})
			coin = true
	was_let = now_let
	for sh in state.transit.shafts:
		var busy := false
		for car in sh.cars:
			if car.n > 0:
				busy = true
		var r := rect_of(sh.col, sh.lo, 1, sh.hi - sh.lo + 1)
		if busy and screen.intersects(r):
			cues.append({"name": "ding", "pos": global_position + r.get_center()})
			break


func _push_float(x: float, y: float, s: String, neg: bool, stagger: int) -> void:
	for f in floats:
		if not f.on:
			f.on = true
			f.x = x
			f.y = y
			f.text = s
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


# ---- Layout -------------------------------------------------------------------------------

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
		info[st.id] = {"topMask": top_mask, "corrL": l, "corrR": r}
	lay.info = info
	var shafts := []
	for sh in Sim.shafts_of(state, g):
		shafts.append({"col": sh.col, "lo": sh.lo, "hi": sh.hi, "type": sh.type})
	lay.shafts = shafts


# ---- Light ------------------------------------------------------------------------------------

func _daylight() -> float:
	var hour: float = (state.tick % C.HOURS_PER_DAY) + phase
	return 0.5 + 0.5 * cos(((hour - 13) / C.HOURS_PER_DAY) * TAU)


func _update_tones(night: float, weather: String) -> void:
	var q := roundi(night * 24)
	var key := "%d|%s|%s" % [q, str(dark), weather]
	if key == tone_key:
		return
	tone_key = key
	var n := q / 24.0
	tones.skyTop = pal["sky-top"].lerp(pal["night-top"], n)
	tones.skyBottom = pal["sky-bottom"].lerp(pal["night-bottom"], n)
	var wd: float = C.WEATHER_DIM.get(weather, 0.0)
	if wd > 0:
		var grey := Color.html("#9aa3ad").lerp(Color.html("#1d2430"), n)
		tones.skyTop = tones.skyTop.lerp(grey, minf(1, wd * 1.6))
		tones.skyBottom = tones.skyBottom.lerp(grey, minf(1, wd * 1.4))
	tones.dusk = 1 - absf(n - 0.5) * 2
	tones.night = n
	# The tower is lit by the sky: a cool shade at night, a warm one at dusk.
	var shade := Color(1, 1, 1).lerp(Color(0.42, 0.47, 0.68), n * 0.85)
	shade = shade.lerp(Color(1.0, 0.86, 0.74), tones.dusk * 0.18 * (1 - n))
	if wd > 0:
		shade = shade.lerp(Color(0.75, 0.78, 0.82), wd)
	tones.shade = shade
	tones.skyline = Color(pal.skyline).lerp(Color.html("#0b1026"), n * 0.6)
	tones.ground = pal.ground.lerp(Color.html("#10140d"), n * 0.55)
	tones.ground_dk = pal["ground-dark"].lerp(Color.html("#0a0c08"), n * 0.55)
	tones.warm = _smooth(0.28, 0.7, n)


# ---- Frame ------------------------------------------------------------------------------------

func _process(_delta: float) -> void:
	var prev := now_ms
	now_ms = Time.get_ticks_msec()
	if long_at > 0 and now_ms >= long_at and not moved and (pointers.size() == 1 or mouse_down):
		long_at = -1.0
		_long_press()
	if state.is_empty():
		return
	_update_tones(1.0 - _daylight(), view.get("weather", "clear"))
	_layout()
	ground_y_now = sy(world_h())
	_update_sky()
	_update_life((now_ms - prev) / 1000.0 if prev > 0 else 0.0)
	static_skip.clear()
	for id in placing:
		static_skip[id] = true
	var px := Vector2i(maxi(1, ceili(size.x)), maxi(1, ceili(size.y)))
	var bkey := "%s|%d|%d|%d|%s|%s" % [tone_key, _cx(), _cy(), cam.zoom, str(px), view.get("skip", "")]
	var key := "%s|%s|%d|%s|%s" % [bkey, lay.sig, state.tick, view.get("tool") == "dig", str(static_skip.keys())]
	if bkey != back_key:
		back_key = bkey
		back_vp.size = px
		back_canvas.queue_redraw()
		back_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	if key != static_key:
		static_key = key
		tower_vp.size = px
		tower_canvas.queue_redraw()
		tower_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	queue_redraw()


func _update_sky() -> void:
	var m: ShaderMaterial = sky.material
	m.set_shader_parameter("top_color", tones.skyTop)
	m.set_shader_parameter("bottom_color", tones.skyBottom)
	m.set_shader_parameter("horizon_color", pal.horizon)
	m.set_shader_parameter("dusk", tones.dusk)
	m.set_shader_parameter("night", tones.night)
	m.set_shader_parameter("zoom", float(cam.zoom))
	m.set_shader_parameter("ground", ground_y_now)
	m.set_shader_parameter("rect_size", size)
	m.set_shader_parameter("star_offset", Vector2(_cx() * 0.1, _cy() * 0.1))


## Birds cross by day, and cars drive the street behind the tower.
func _update_life(dt: float) -> void:
	if reduced or dt <= 0:
		return
	dt = minf(dt, 0.1)
	for car in traffic:
		car.x += car.dir * car.speed * dt
		var span := world_w() + 160
		if car.x > span:
			car.x = -40.0
		elif car.x < -40:
			car.x = span
	if flock.x < -900 and now_ms > flock.next and tones.get("night", 0.0) < 0.5:
		flock.dir = 1.0 if randf() < 0.5 else -1.0
		flock.x = _cx() - 20 if flock.dir > 0 else _cx() + size.x / cam.zoom + 20
		flock.y = _cy() + 20 + randf() * 60
		flock.n = 3 + randi() % 4
	if flock.x > -900:
		flock.x += flock.dir * 22 * dt
		if flock.x < _cx() - 60 or flock.x > _cx() + size.x / cam.zoom + 60:
			flock.x = -999.0
			flock.next = now_ms + 12000 + randf() * 20000


# ---- Back layer: skyline, street, trees, lamps ------------------------------------------------

func _draw_back() -> void:
	if tones.is_empty() or state.is_empty() or str(view.get("skip", "")).contains("bg"):
		return
	ci = back_canvas
	var z: float = cam.zoom
	var gy := ground_y_now
	var n: float = tones.night
	# The far skyline: the art's silhouette, tinted by the hour.
	var r := Pixel.rect("skyline")
	var par := fposmod(_cx() * 0.3, r.size.x)
	var sw := r.size.x * z
	var x := -par * z
	var sl: Color = tones.skyline
	while x < size.x:
		ci.draw_texture_rect_region(tex, Rect2(x, gy - r.size.y * z, sw, r.size.y * z), r, Color(sl, 0.85))
		x += sw
	# Near buildings: flat pixel blocks, with lit windows after dusk.
	var par2 := _cx() * 0.55
	var i := 0
	var bx := -fposmod(par2, 70.0) - 30
	var lit := Color(pal["window-lit"], 0.65 * _smooth(0.35, 0.7, n))
	var near_col := sl.lerp(Color.html("#0b1026"), 0.25)
	while bx < size.x / z + 30 and i < 40:
		var idx := int(floor((bx + par2) / 70.0)) * 7 + i
		var bw := 14 + int(absf(_h(idx, 4)) * 20)
		var bh := 16 + int(absf(_h(idx, 5)) * 46)
		var top := roundf(gy / z) - bh
		box(Rect2(roundf(bx) * z, top * z, bw * z, (bh + 1) * z), near_col)
		if absf(_h(idx, 6)) > 0.6:
			box(Rect2((roundf(bx) + 3) * z, (top - 3) * z, 4 * z, 3 * z), near_col)
		if lit.a > 0.01:
			for wy in range(3, bh - 2, 4):
				for wx in range(2, bw - 2, 3):
					if absf(_h(idx * 131 + wy * 17 + wx, 9)) > 0.55:
						box(Rect2((roundf(bx) + wx) * z, (top + wy) * z, z, z * 2), lit)
		bx += bw + 3 + int(absf(_h(idx, 8)) * 10)
		i += 1
	# Ground: pavement, kerb and the road.
	box(Rect2(0, gy, size.x, maxf(0, size.y - gy)), tones.ground)
	box(Rect2(0, gy + 4 * z, size.x, maxf(0, size.y - gy)), tones.ground_dk)
	box(Rect2(0, gy - z, size.x, z), Color(pal.kerb).lerp(Color.html("#2a2f26"), n * 0.5))
	# Trees beside the plot, lamps along it.
	var shade: Color = tones.shade
	for c in range(-7, state.width + 8, 3):
		if c >= -1 and c <= state.width:
			continue
		var tx := sx(c * ART_W + 3)
		if tx < -40 or tx > size.x + 40:
			continue
		spr("tree", Vector2(tx, gy - 14 * z), shade)
	for c in range(2, state.width, 6):
		var lx := sx(c * ART_W)
		if lx < -20 or lx > size.x + 20:
			continue
		spr("lamp", Vector2(lx, gy - 14 * z), shade)
		if n > 0.3:
			spr("glow", Vector2(lx - 5 * z, gy - 19 * z), Color(1, 1, 1, _smooth(0.3, 0.6, n)))
	ci = self


# ---- Tower layer -------------------------------------------------------------------------------------

func _draw_tower() -> void:
	if tones.is_empty() or state.is_empty():
		return
	var t0 := Time.get_ticks_usec()
	ci = tower_canvas
	var skip: String = str(view.get("skip", ""))
	if not skip.contains("base"):
		_draw_basement()
	if not skip.contains("grid"):
		_draw_grid()
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


func _draw_basement() -> void:
	var z: float = cam.zoom
	var left := sx(0)
	var w := world_w() * z
	var ch := ART_H * z
	var soil = Color(pal.soil) * tones.shade
	var soil_dk = Color(pal["soil-dark"]) * tones.shade
	var dug_col = Color(pal.dug) * tones.shade
	for f in range(0, Sim.LOWEST_FLOOR - 1, -1):
		var y := sy((state.maxFloors - f) * ART_H)
		if y > size.y or y + ch < 0:
			continue
		var dug: bool = f >= 1 - state.dug
		box(Rect2(left, y, w, ch), dug_col if dug else soil)
		if dug:
			box(Rect2(left, y + ch - 2 * z, w, 2 * z), Color(0, 0, 0, 0.2))
			for col in range(0, state.width + 1, 4):
				box(Rect2(left + col * ART_W * z - z, y, 2 * z, ch), Color(0, 0, 0, 0.18))
		else:
			for col in state.width:
				for k in 3:
					var hx := absf(_h(col, f * 7 + k))
					var hy := absf(_h(col, f * 7 + k + 3))
					box(Rect2(left + roundf((col + hx) * ART_W) * z, y + roundf((0.1 + 0.8 * hy) * ART_H) * z, 2 * z, z), soil_dk)
	if view.get("tool") == "dig" and state.dug < C.BASEMENT_LEVELS:
		var y := sy((state.maxFloors + state.dug) * ART_H)
		_dashed(Rect2(left, y, w, ch), pal.good)


func _dashed(r: Rect2, col: Color) -> void:
	var z: float = cam.zoom
	var step := 4 * z
	var x := r.position.x
	while x < r.end.x:
		box(Rect2(x, r.position.y, minf(2 * z, r.end.x - x), z), col)
		box(Rect2(x, r.end.y - z, minf(2 * z, r.end.x - x), z), col)
		x += step
	var y := r.position.y
	while y < r.end.y:
		box(Rect2(r.position.x, y, z, minf(2 * z, r.end.y - y)), col)
		box(Rect2(r.end.x - z, y, z, minf(2 * z, r.end.y - y)), col)
		y += step


func _draw_grid() -> void:
	var z: float = cam.zoom
	var left := sx(0)
	var right := sx(world_w())
	var gy := ground_y_now
	var line := Color(pal["grid-line"], pal["grid-line"].a * 0.8)
	for f in range(1, state.maxFloors + 1):
		var y := sy((state.maxFloors - f) * ART_H)
		if y < -2 or y > gy:
			continue
		box(Rect2(left, y, right - left, 1), line)
	var cap := Sim.floor_cap(state)
	var cap_y := sy((state.maxFloors - cap) * ART_H)
	if cap < state.maxFloors and cap_y > 0 and cap_y < size.y:
		var x := left
		while x < right:
			box(Rect2(x, cap_y, 3 * z, z), pal.muted)
			x += 6 * z
	if left > 16:
		for f in range(5, state.maxFloors + 1, 5):
			var y := sy((state.maxFloors - f + 0.5) * ART_H) - 4
			if y < 0 or y > gy:
				continue
			_text_right(str(f), Vector2(left - 4, y), pal.muted)
		for f in range(0, Sim.LOWEST_FLOOR - 1, -1):
			var y := sy((state.maxFloors - f + 0.5) * ART_H) - 4
			if y > 0 and y < size.y:
				_text_right("B%d" % (1 - f), Vector2(left - 4, y), pal.muted)


func _text_right(s: String, at: Vector2, col: Color) -> void:
	var w := font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, Pixel.FONT_1X).x
	ci.draw_string(font, Vector2(roundf(at.x - w), roundf(at.y) + 7), s, HORIZONTAL_ALIGNMENT_LEFT, -1, Pixel.FONT_1X, col)


## The sprite for a room: its business when let (vacant rooms keep the first look).
func _room_name(st: Dictionary) -> String:
	if st.type == "lobby":
		return "room.lobby.%d" % (st.col % 2)
	if not BIZ_TYPES.has(st.type):
		return "room." + st.type
	var biz := Tenants.tenant_of(st)
	var name := "room.%s.%s" % [st.type, biz.id if not biz.is_empty() else ""]
	if st.type == "hotel" and st.dirty:
		name += ".dirty"
	return name


func _draw_structure(st: Dictionary, r: Rect2) -> void:
	var t: Dictionary = C.TYPES[st.type]
	var z: float = cam.zoom
	var shade: Color = tones.shade
	var reach: bool = lay.reach.has(st.id)
	if Sim.is_lift(st.type):
		spr("shaft." + st.type, r.position, shade)
		if st.closed:
			spr("shaft.closed", r.position)
		return
	var name := _room_name(st)
	spr(name, r.position, shade)
	# Night: the windows light up, each room at its own moment.
	var vacant: bool = t.kind == "unit" and not st.occupied
	var lit_name := name.replace(".dirty", "") + ".lit"
	if Pixel.has(lit_name) and not st.burnt:
		var a := 0.0
		if st.type == "hall":
			a = 1.0 if state.crowds.get(st.id, 0) > 0 else (0.0 if vacant else 0.35 * tones.warm)
		elif t.kind != "unit" or not vacant:
			var at := 0.15 + 0.5 * absf(_h(st.id, 1))
			a = _smooth(at, at + 0.25, tones.warm)
		if a > 0.01:
			spr(lit_name, r.position, Color(1, 1, 1, a))
	if st.type == "parking":
		var cars: int = mini(t.spaces, park_left) if reach else 0
		park_left -= cars
		for i in cars:
			spr("parked", r.position + Vector2((1 + i * 8) * z, 8 * z), shirts[(st.id + i) % shirts.size()] * shade)
	if vacant and not st.burnt:
		box(r, Color(0.05, 0.06, 0.12, 0.35))
		spr("tolet", r.position + Vector2(roundf(r.size.x / z / 2 - 4) * z, 9 * z))
	if st.burnt:
		for dx in t.w:
			spr("burnt", r.position + Vector2(dx * ART_W * z, 0))
	if not reach and (t.kind == "unit" or t.kind == "service"):
		for dx in t.w:
			spr("hatch", r.position + Vector2(dx * ART_W * z, 0))
	# Roofs: a parapet on every exposed top, and now and then a tank or an aerial.
	var info: Dictionary = lay.info.get(st.id, {})
	if not info.is_empty() and info.topMask and st.type != "landmark":
		var wall := Color(pal["wall-dark"]) * shade
		for dx in t.w:
			if not (info.topMask & (1 << dx)):
				continue
			var px = r.position.x + dx * ART_W * z
			box(Rect2(px, r.position.y - 2 * z, ART_W * z, 2 * z), wall)
			box(Rect2(px, r.position.y - 2 * z, ART_W * z, z), Color(1, 1, 1, 0.25) * shade)
			var k := _h(st.col + dx, st.floor + 77)
			if k > 0.72:
				box(Rect2(px + 3 * z, r.position.y - 7 * z, 5 * z, 5 * z), wall)
				box(Rect2(px + 3 * z, r.position.y - 7 * z, 5 * z, z), Color(1, 1, 1, 0.3) * shade)
			elif k < 0.12:
				box(Rect2(px + 6 * z, r.position.y - 9 * z, z, 7 * z), wall)
				box(Rect2(px + 5 * z, r.position.y - 9 * z, 3 * z, z), wall)


# ---- Live layer -----------------------------------------------------------------------------

func _draw() -> void:
	if state.is_empty() or tones.is_empty():
		return                            # the first frame can draw before _process sets the light
	var t0 := Time.get_ticks_usec()
	ci = self
	var dt := minf(50.0, now_ms - last_frame) if last_frame > 0 else 16.0
	last_frame = now_ms
	var skip: String = str(view.get("skip", ""))
	var z: float = cam.zoom
	draw_texture_rect(back_vp.get_texture(), Rect2(Vector2.ZERO, size), false)
	if not skip.contains("life"):
		_draw_life()
	draw_texture_rect(tower_vp.get_texture(), Rect2(Vector2.ZERO, size), false)
	# Faces and fires on top of the cached rooms.
	for st in state.structures:
		var t: Dictionary = C.TYPES[st.type]
		if t.kind != "unit" or (not st.occupied and not st.fire):
			continue
		var r := rect_of(st.col, st.floor, t.w, t.h)
		if r.position.x > size.x or r.end.x < 0 or r.position.y > size.y or r.end.y < 0:
			continue
		if st.occupied and not st.burnt and lay.reach.has(st.id) and not static_skip.has(st.id):
			var band := Sim.happy_band(st.happy)
			var bob := 0.0 if reduced or band != "good" else roundf(sin(now_ms / 520.0 + st.id) * 0.6) * z
			spr("face." + band, Vector2(r.end.x - 8 * z, r.position.y + z + bob))
			if band == "poor" and not reduced:
				var p := fposmod(now_ms / 900.0 + st.id * 0.37, 1.0)
				spr("sweat", Vector2(r.end.x - z, r.position.y + roundf(p * 5) * z), Color(1, 1, 1, 1 - p))
		if st.fire:
			_draw_fire(st, r)
	# Rooms going up drop in from above, with dust.
	for id in static_skip:
		var st = Sim.find(state, id)
		if st == null or not placing.has(id):
			placing.erase(id)
			continue
		var t: Dictionary = C.TYPES[st.type]
		var p: float = (now_ms - placing[id]) / PLACE_MS
		if p >= 1 or reduced:
			placing.erase(id)
			continue
		var drop := roundf((1 - p) * (1 - p) * 8) * z
		var r := rect_of(st.col, st.floor, t.w, t.h)
		r.position.y -= drop
		_draw_structure(st, r)
	var step_frac := 1.0 if reduced else clampf(phase * C.WALK_STEPS - (Sim.walker_steps_done(state) - 1), 0, 1)
	if not skip.contains("ppl"):
		_draw_lift_cars(step_frac)
		_draw_walkers(dt)
		_draw_queues()
	_draw_dust()
	var weather: String = view.get("weather", "clear")
	if weather == "fog":
		box(Rect2(0, 0, size.x, minf(size.y, ground_y_now)), Color(0.85, 0.87, 0.9, C.FOG_ALPHA * (1 - tones.night * 0.5)))
	if not reduced and (weather == "rain" or weather == "snow"):
		_draw_precip(weather)
	_draw_floats()
	if view.get("selected") != null:
		var st = Sim.find(state, view.selected)
		if st != null:
			var t: Dictionary = C.TYPES[st.type]
			if reduced or int(now_ms / 300) % 2 == 0:
				_dashed(rect_of(st.col, st.floor, t.w, t.h).grow(z), pal.accent)
	var hover = view.get("hover")
	if hover != null and C.TYPES.has(view.get("tool", "")) and view.get("draft") == null:
		var t: Dictionary = C.TYPES[view.tool]
		var ok: bool = Sim.can_place(state, view.tool, hover.col, hover.floor, lay.grid).ok
		var r := rect_of(hover.col, hover.floor, t.w, t.h)
		box(r, pal["ghost-ok"] if ok else pal["ghost-bad"])
		_dashed(r, pal.good if ok else pal.danger)
	if view.get("draft") != null:
		_draw_draft(view.draft)
	prof.draw_ms = lerpf(prof.draw_ms, (Time.get_ticks_usec() - t0) / 1000.0, 0.1)


## Sun and moon on their arcs, clouds, a flock of birds by day, and street traffic.
func _draw_life() -> void:
	var z: float = cam.zoom
	var n: float = tones.night
	var gy := ground_y_now
	var hour: float = (state.tick % C.HOURS_PER_DAY) + phase
	var sky_h := minf(gy, size.y)
	for body in [["sun", 5.0, 1 - n], ["moon", 18.0, _smooth(0.3, 0.7, n)]]:
		if body[2] <= 0.02:
			continue
		var u := fposmod(hour - body[1], 24.0) / 14.0       # 0..1 across its 14 hours up
		if u > 1:
			continue
		var p := Vector2(size.x * (0.1 + 0.8 * u), sky_h * (0.55 - 0.45 * sin(u * PI)))
		spr(body[0], Vector2(roundf(p.x / z) * z, roundf(p.y / z) * z), Color(1, 1, 1, body[2]))
	var cloud_tint := Color(1, 1, 1, 0.9).lerp(Color(0.45, 0.5, 0.7, 0.75), n)
	var drift := now_ms / 1000.0 * (0.0 if reduced else 3.0)
	for i in 5:
		var name := "cloud.%d" % (i % 3)
		var cr := Pixel.rect(name)
		var span := size.x / z + cr.size.x + 40
		var cx := fposmod(absf(_h(i, 50)) * span + drift * (0.6 + 0.3 * i) - _cx() * 0.15, span) - cr.size.x - 20
		var cy := 8 + absf(_h(i, 51)) * minf(gy / z * 0.45, 140)
		spr(name, Vector2(roundf(cx) * z, roundf(cy) * z), cloud_tint)
	if flock.x > -900:
		for k in flock.n:
			var frame := int(now_ms / 180 + k) % 2
			spr("bird.%d" % frame, Vector2(sx(roundf(flock.x - flock.dir * k * 6)), sy(roundf(flock.y + (k % 2) * 3))), Color(1, 1, 1, 0.8))
	var shade: Color = tones.shade
	for car in traffic:
		var x := sx(roundf(car.x - 60))
		if x < -30 or x > size.x + 30:
			continue
		var frame := int(now_ms / 140) % 2
		spr("car.street.%d.%d" % [car.kind, frame], Vector2(x, gy - 6 * z), shade, car.dir < 0)
		if n > 0.4:
			var hx := x + (12 * z if car.dir > 0 else -3 * z)
			box(Rect2(hx, gy - 3 * z, 3 * z, z), Color(1, 0.95, 0.6, 0.7 * n))


func _draw_fire(st: Dictionary, r: Rect2) -> void:
	var z: float = cam.zoom
	var t: Dictionary = C.TYPES[st.type]
	box(r, Color(1, 0.47, 0.12, 0.22))
	for k in t.w:
		var frame := 0 if reduced else int(now_ms / 110 + k + st.id) % 3
		spr("fire.%d" % frame, r.position + Vector2((k * ART_W + 2) * z, 6 * z))
	for i in 3:
		var p := (i + 0.5) / 3.0 if reduced else fposmod(now_ms / 2000.0 + i / 3.0 + absf(_h(st.id, i)), 1.0)
		var r_i := 2 + mini(2, int(p * 3))
		var x := r.position.x + roundf(r.size.x / z * (0.3 + 0.4 * absf(_h(st.id, i + 11)))) * z
		var y := r.position.y - roundf(p * 14) * z
		spr("smoke.%d" % r_i, Vector2(x, y), Color(1, 1, 1, 0.7 * (1 - p)))


func _draw_lift_cars(frac: float) -> void:
	var z: float = cam.zoom
	for sh in state.transit.shafts:
		var head := rect_of(sh.col, sh.hi, 1, 1)
		if head.position.x > size.x or head.end.x < 0:
			continue
		var top := sy((state.maxFloors - sh.hi) * ART_H)
		var ind: int = sh.lo
		for k in sh.cars.size():
			var car: Dictionary = sh.cars[k]
			var pos := lerpf(car.prev, car.at, frac * 2) if frac < 0.5 else lerpf(car.at, car.to, (frac - 0.5) * 2)
			if k == 0:
				ind = roundi(pos)
			var y := sy(roundf((state.maxFloors - pos) * ART_H)) + z
			var x := head.position.x + z
			if k == 0:
				box(Rect2(head.position.x + 6 * z, top, z, maxf(0, y - top)), Color(1, 1, 1, 0.35))
			var open := clampf(1 - absf(frac - 0.5) * 6, 0, 1) if car.n else 0.0
			spr("car.%d" % mini(3, roundi(open * 3)), Vector2(x, y))
			for i in mini(3, car.n):
				spr("rider", Vector2(x + (1 + i * 3) * z, y + 3 * z))
		for f in range(sh.lo, sh.hi + 1):
			var y := sy((state.maxFloors - f + 0.5) * ART_H)
			var col: Color = pal.car if f == ind else (Color(0.8, 0.2, 0.2, 0.8) if sh.closed.has(f) else Color(1, 1, 1, 0.22))
			box(Rect2(head.position.x, y - z, z, 2 * z), col)


func _shirt(i: int) -> Color:
	return shirts[i % shirts.size()]


func _person(id: int, x: float, y: float, frame: int, shirt: Color, flip: bool) -> void:
	spr("person.%d%d.%d" % [id % 3, (id / 3) % 3, frame], Vector2(x, y), tones.shade, flip)
	spr("person.shirt.%d" % frame, Vector2(x, y), shirt * tones.shade, flip)


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
			var x := sx(sh.col * ART_W - 6 - i * 4)
			var y := sy((state.maxFloors - door + 1) * ART_H - 2 - 9)
			if x < -10 or x > size.x + 10 or y < -20 or y > size.y + 20:
				continue
			var band := Sim.stress_band(Sim.stress_of(state, w))
			var shirt: Color = pal.danger if band == "stressed" else (pal.warn if band == "tense" else _shirt(w.unit))
			var shake := 0.0
			if not reduced and band == "stressed":
				shake = roundf(sin(now_ms / 45.0 + i * 1.7) * 0.6) * z
			_person(w.unit + i, x + shake, y, 0, shirt, false)
			if band == "stressed" and not reduced:
				var p := fposmod(now_ms / 700.0 + i * 0.31, 1.0)
				spr("sweat", Vector2(x + 5 * z, y + roundf(p * 4 - 2) * z), Color(1, 1, 1, 1 - p))


func _draw_walkers(dt: float) -> void:
	var z: float = cam.zoom
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
				var n := maxi(1, roundi(maxi(t.get("people", 0), 2) / 2.0))
				var list := []
				for i in n:
					list.append({"id": st.id * 7 + i, "floor": st.floor, "x": (st.col + (i + 0.5) * (t.w / float(n))) * ART_W,
						"dir": -1.0 if i % 2 else 1.0, "speed": 6 + absf(_h(st.id, i)) * 5, "phase": absf(_h(st.id, i + 3)) * 6.28,
						"shirt": _shirt(st.id + i), "l": 0.0, "r": 0.0})
				walkers[st.id] = list
			var info: Dictionary = lay.info.get(st.id, {})
			for w in walkers[st.id]:
				if not info.is_empty():
					w.l = info.corrL * ART_W + 2
					w.r = (info.corrR + 1) * ART_W - 7
				walker_list.append(w)
		for id in walkers.keys():
			if not live.has(id):
				walkers.erase(id)
	if not reduced:
		var s := dt / 1000.0
		for w in walker_list:
			w.x += w.dir * w.speed * s
			w.phase += w.speed * 0.9 * s
			if w.x > w.r:
				w.x = w.r
				w.dir = -1.0
			elif w.x < w.l:
				w.x = w.l
				w.dir = 1.0
	for w in walker_list:
		var x := sx(roundf(w.x))
		var y := sy((state.maxFloors - w.floor + 1) * ART_H - 2 - 9)
		if x < -10 or x > size.x + 10 or y < -20 or y > size.y + 20:
			continue
		var frame := 0 if reduced else 1 + int(w.phase) % 2
		_person(w.id, x, y, frame, w.shirt, w.dir < 0)


func _draw_dust() -> void:
	for d in dust:
		if not d.on:
			continue
		var p: float = (now_ms - d.t0) / d.dur
		if p >= 1 or reduced:
			d.on = false
			continue
		var k := 1 - pow(1 - p, 3)
		spr("dust", Vector2(sx(roundf(d.x + d.vx * k)), sy(roundf(d.y + d.vy * k + 10 * k * k))), Color(1, 1, 1, (1 - p) * 0.9))


func _draw_precip(weather: String) -> void:
	var z: float = cam.zoom
	var limit := minf(size.y, ground_y_now)
	var t := now_ms / 1000.0
	if weather == "rain":
		for i in 70:
			var x := fposmod(absf(_h(i, 21)) * size.x + t * 30, size.x)
			var y := fposmod(absf(_h(i, 22)) * limit + t * (260 + 120 * absf(_h(i, 23))), limit)
			spr("rain", Vector2(roundf(x / z) * z, roundf(y / z) * z), Color(1, 1, 1, 0.7))
	else:
		for i in 50:
			var x := fposmod(absf(_h(i, 31)) * size.x + sin(t + i) * 10, size.x)
			var y := fposmod(absf(_h(i, 32)) * limit + t * (24 + 20 * absf(_h(i, 33))), limit)
			spr("snow", Vector2(roundf(x / z) * z, roundf(y / z) * z))


func _draw_floats() -> void:
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
		var rise := 0.0 if reduced else roundf(10 * (1 - pow(1 - p, 3)))
		var alpha := (1.0 if p < 0.75 else 0.0) if reduced else (1.0 if p < 0.6 else 1 - (p - 0.6) / 0.4)
		if alpha <= 0:
			continue
		var x := sx(f.x)
		var y := sy(f.y - rise)
		if x < -40 or x > size.x + 40 or y < -20 or y > size.y + 20:
			continue
		var w := font.get_string_size(f.text, HORIZONTAL_ALIGNMENT_LEFT, -1, Pixel.FONT_1X).x + 4
		box(Rect2(roundf(x - w / 2), y - 1, w, 11), Color(pal["float-bg"], pal["float-bg"].a * alpha))
		text(f.text, Vector2(x, y), 1, Color(pal.danger if f.neg else pal.good, alpha), true)


func _draw_draft(d: Dictionary) -> void:
	var t: Dictionary = C.TYPES.get(d.tool, {})
	if t.is_empty():
		return
	var r := rect_of(d.col, d.floor, t.w, t.h)
	if r.position.x > size.x or r.end.x < 0 or r.position.y > size.y or r.end.y < 0:
		return
	var preview := {"id": -1, "type": d.tool, "col": d.col, "floor": d.floor, "occupied": false, "closed": false, "burnt": false,
		"dirty": false, "tenant": 0, "fire": 0}
	var name = ("shaft." + d.tool) if Sim.is_lift(d.tool) else _room_name(preview)
	if Pixel.has(name):
		spr(name, r.position, Color(1, 1, 1, 0.6))
	else:
		box(r, Color(pal.get(d.tool, pal["ghost-ok"]), 0.5))
	_dashed(r, pal.fg)
	var label := "$" + _thousands(d.cost)
	var w := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, Pixel.FONT_1X).x + 6
	var c := Vector2(r.get_center().x, r.position.y + minf(r.size.y, ART_H * cam.zoom) / 2 - 5)
	box(Rect2(roundf(c.x - w / 2), roundf(c.y) - 1, w, 11), pal["float-bg"])
	text(label, c, 1, pal.fg, true)


static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out
