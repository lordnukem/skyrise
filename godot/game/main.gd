# Wires the pure sim to the tower view, the UI and the audio, and runs the clock.
# Ported from src/main.js: the same tools, cards, sheets, messages and guide.
extends Control

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const Draft = preload("res://sim/draft.gd")
const Tenants = preload("res://sim/tenants.gd")
const Seasons = preload("res://sim/seasons.gd")
const Storage = preload("res://game/storage.gd")
const TowerView = preload("res://game/tower_view.gd")
const UI = preload("res://game/ui.gd")
const Audio = preload("res://game/audio.gd")

const GUIDE_TEXT := [
	"Goal 1 of 3: build a Lift beside the lobby, from floor 1 up to floor 2 or higher.",
	"Goal 2 of 3: let 3 offices beside the lift. Tenants need a path to the lobby.",
	"Goal 3 of 3: get one unit to a happy face (good happiness): short lift waits, quiet neighbours.",
]

var state: Dictionary
var view := {"rev": 0, "tool": "office", "selected": null, "hover": null, "draft": null, "festivals": [], "fireworks": false, "weather": "clear"}
var tower: TowerView
var ui: UI
var audio: Audio
var speed := 1
var run_speed := 1
var last_tick_at := 0.0
var card_mode := ""                      # "inspect" while an inspect card is open, "confirm" for demolish
var theme_name := ""                     # "" follows the OS
var guide_off := false
var win_shown := false
var over_shown := false
var poor_warned := false
var resumed := false
var debug := false
var debug_at := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme_name = str(Storage.get_setting("theme", ""))
	guide_off = Storage.get_setting("guide", "") == "done"
	var loaded = Storage.load_game()
	resumed = loaded != null
	state = loaded if loaded != null else Sim.new_game()
	audio = Audio.new()
	add_child(audio)
	ui = UI.new()
	add_child(ui)
	tower = TowerView.new()
	tower.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui.stage.add_child(tower)
	ui.stage.move_child(tower, 0)
	tower.state = state
	tower.view = view
	_apply_theme()
	ui.tool_chosen.connect(_on_tool)
	ui.draft_cancelled.connect(func(): _set_draft(null); ui.status("Draft cancelled."))
	ui.speed_chosen.connect(_set_speed)
	ui.stars_tapped.connect(_open_tower_sheet)
	ui.menu_action.connect(_on_menu)
	ui.guide_closed.connect(func(): guide_off = true; Storage.set_setting("guide", "done"))
	ui.toolbar_toggled.connect(func(c): Storage.set_setting("toolbar", "collapsed" if c else "expanded"))
	tower.tapped.connect(_on_tap)
	tower.long_pressed.connect(_on_long_press)
	var tb = Storage.get_setting("toolbar", "")
	ui.set_collapsed(tb == "collapsed" or (tb == "" and resumed and get_viewport_rect().size.x < 400))
	ui.set_tool(view.tool)
	win_shown = state.wonAt != null
	_refresh_season()
	last_tick_at = Time.get_ticks_msec()
	var search := str(JavaScriptBridge.eval("location.search", true)) if OS.has_feature("web") else ""
	debug = search.contains("debug")
	var m := RegEx.create_from_string("skip=([a-z,]+)").search(search)
	if m:
		view.skip = m.get_string(1)       # dev only: switch drawing layers off to find what costs
		if view.skip.contains("ui"):
			ui.visible = false
		if view.skip.contains("tb"):
			ui.bottom_panel.visible = false
		if view.skip.contains("ov"):
			for n in [ui.speed_box, ui.guide_panel, ui.status_panel]:
				n.visible = false
			ui.set_process(false)
	if OS.has_feature("web"):
		tower.reduced = bool(JavaScriptBridge.eval("matchMedia('(prefers-reduced-motion: reduce)').matches", true))
	if search.contains("demo=big"):
		state = _demo_tower()
		tower.state = state
	get_tree().root.size_changed.connect(func(): tower.clamp_cam())
	await get_tree().process_frame
	tower.recenter()
	_update_ui()
	_update_guide()
	var greeting := _greeting()
	ui.status((greeting + " " if greeting != "" else "") + ("Welcome back. Your tower was restored." if resumed else "Build stairs or a lift beside the lobby, then lease units above it."), true)
	_check_ends()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		if state:
			Storage.save_game(state)


# ---- Theme and seasons --------------------------------------------------------

func _is_dark() -> bool:
	if theme_name == "dark":
		return true
	if theme_name == "light":
		return false
	return DisplayServer.is_dark_mode_supported() and DisplayServer.is_dark_mode()


func _apply_theme() -> void:
	var d := _is_dark()
	ui.apply_theme(d)
	tower.set_theme_dark(d)


func _refresh_season() -> void:
	var t := Time.get_date_dict_from_system()
	view.festivals = Seasons.festivals_on(t.year, t.month, t.day)
	view.fireworks = Seasons.fireworks_night(t.year, t.month, t.day, view.festivals)


func _greeting() -> String:
	if view.festivals.is_empty():
		return ""
	var t := Time.get_date_dict_from_system()
	var day := "%04d-%02d-%02d" % [t.year, t.month, t.day]
	if Storage.get_setting("greeted", "") == day:
		return ""
	Storage.set_setting("greeted", day)
	return " ".join(view.festivals.map(func(f): return Seasons.GREETINGS[f]))


# ---- Clock ----------------------------------------------------------------------

func _paused() -> bool:
	return C.SPEEDS[speed] == 0


func _tick_ms() -> float:
	return C.TICK_MS / float(C.SPEEDS[speed]) if C.SPEEDS[speed] else 1e12


func _set_speed(i: int) -> void:
	speed = i
	if C.SPEEDS[i]:
		run_speed = i
	last_tick_at = Time.get_ticks_msec()
	_update_ui()


var advance_ms := 0.0


func _process(_delta: float) -> void:
	var now := float(Time.get_ticks_msec())
	var t0 := Time.get_ticks_usec()
	_advance(now)
	advance_ms = lerpf(advance_ms, (Time.get_ticks_usec() - t0) / 1000.0, 0.1)
	view.weather = Seasons.weather_at(state.tick, view.festivals)
	audio.set_ambience(tower.tones.get("night", 0.0), view.weather)
	audio.duck(ui.sheet_open())
	tower.phase = 0.0 if _paused() else minf(1, (now - last_tick_at) / _tick_ms())
	if debug and now - debug_at > 250:
		debug_at = now
		_publish_debug()


func _advance(now: float) -> void:
	audio.set_music(Seasons.track_for(view.festivals, Sim.hour_of(state.tick)))
	if _paused() or state.over:
		last_tick_at = now
		_check_ends()
		return
	var ms := _tick_ms()
	var n := 0
	var left := 0
	var report = null
	var fire = null
	var vip = null
	while now - last_tick_at >= ms and n < 5:
		last_tick_at += ms
		var r := Sim.step_hour(state)
		_tick_sounds()
		left += r.left
		if r.report != null:
			report = r.report
		if r.fire != null:
			fire = r.fire
		if r.vip != null:
			vip = r.vip
		tower.on_tick()
		n += 1
		if state.tick % C.AUTOSAVE_TICKS == 0:
			Storage.save_game(state)
	if now - last_tick_at >= ms:
		last_tick_at = now
	var due := mini(C.WALK_STEPS, 1 + int(floor((now - last_tick_at) / ms * C.WALK_STEPS)))
	while Sim.walker_steps_done(state) < due:
		Sim.step_walkers(state)
	if n:
		_update_ui()
		_update_guide()
		if ui.sheet_kind == "tower":
			_open_tower_sheet()
		var poor_now: int = Sim.mood_counts(state).poor
		if poor_now and not poor_warned:
			poor_warned = true
			ui.status("%d %s unhappy: the lifts are too busy. Tap a face to see why." % [poor_now, "units" if poor_now > 1 else "unit"])
		if not poor_now:
			poor_warned = false
	if left:
		ui.status("%d tenant%s moved out: unhappy with the lifts." % [left, "s" if left > 1 else ""])
	if vip != null:
		audio.play("vip")
		var rooms: bool = state.structures.any(func(x): return C.TYPES[x.type].get("nightly", 0))
		ui.status("The VIP left a good review." if vip == "good" else ("The VIP left a poor review: no clean room at Good happiness." if rooms else "The VIP left a poor review: no room to stay in."))
	if fire != null:
		audio.play("alarm")
		ui.status("Fire on %s!" % Sim.floor_name(fire.floor), true)
	if report != null:
		audio.play("loan" if report.borrowed else "quarter")
		Storage.save_game(state)
		_show_report(report)
		if report.borrowed:
			ui.status("The quarter ended below $0: a loan of $%s was taken out." % UI._thousands(C.LOAN_AMOUNT), true)
	_check_ends()
	if n and view.selected != null and card_mode == "inspect" and not ui.editing:
		var st = Sim.find(state, view.selected)
		if st != null and C.TYPES[st.type].kind == "unit" and state.service.has(st.id):
			_show_card(st)
		elif st != null and C.TYPES[st.type].get("span", 0):
			_show_lift_card(st)
		else:
			_close_card()


## The tower's layout changed: the view rebuilds its grid, paths and walkers.
func _bump() -> void:
	view.rev += 1


## After each hour: the music layers follow the tower, and placed cues play where they happen.
func _tick_sounds() -> void:
	var hour := Sim.hour_of(state.tick)
	var rush := not Sim.is_weekend(state.tick) and hour in [7, 8, 9, 12, 13, 17, 18]
	audio.set_layers(state.rating, rush and state.population > 0, tower.tones.get("night", 0.0) > 0.5)
	for c in tower.cues:
		audio.play_at(c.name, c.pos, {"coin": -10.0, "ding": -9.0, "movein": -5.0}.get(c.name, 0.0))


func _update_ui() -> void:
	ui.update(state, _paused(), speed, view.weather, theme_name, audio.on)


# ---- Tools ------------------------------------------------------------------------

func _set_draft(d: Variant) -> void:
	view.draft = d
	ui.draft("Tap again to build $%s" % UI._thousands(d.cost) if d != null else null)


func _close_card() -> void:
	view.selected = null
	card_mode = ""
	ui.hide_card()


func _on_tool(id: String) -> void:
	if id == view.tool and view.draft != null:
		_set_draft(null)
		ui.status("Draft cancelled.")
		ui.set_tool(id)
		return
	view.tool = id
	ui.set_tool(id)
	_set_draft(null)
	_close_card()
	_describe_tool(id)


func _describe_tool(id: String) -> void:
	var t: Dictionary = C.TYPES.get(id, {})
	if id == "car":
		ui.status("Add car: tap a lift shaft, $%s. Each car raises the shaft's capacity." % UI._thousands(C.LIFT_CAR_COST))
		return
	if id == "dig":
		return ui.status("Dig: all %d basement levels are dug." % C.BASEMENT_LEVELS if state.dug >= C.BASEMENT_LEVELS
			else "Dig: tap %s below the ground, $%s a level. Each level needs the one above it." % [Sim.floor_name(-state.dug), UI._thousands(C.DIG_COST)])
	if id == "demolish":
		ui.status("Demolish: tap a structure to see its refund, then confirm. Half the cost back; a sold flat gives none.")
		return
	if t.is_empty():
		ui.status("Inspect: tap any room to see how it is doing.")
		return
	if not Sim.is_unlocked(state, id):
		ui.status("%s: unlocks at %d stars." % [t.label, C.UNLOCK_AT[id]])
		return
	var extra := ""
	if t.kind == "unit":
		if t.get("price", 0):
			extra = ", sells for $%s" % UI._thousands(t.price)
		elif t.get("rent", 0):
			extra = ", $%d/hour when let" % t.rent
		elif t.get("nightly", 0):
			extra = ", $%d a night" % t.nightly
		elif t.get("perGuest", 0):
			extra = ", earns per guest"
		elif t.get("perDiner", 0):
			extra = ", earns per diner"
		else:
			extra = ", earns per visitor"
	elif t.get("upkeep", 0):
		extra = ", $%d/hour upkeep" % t.upkeep
	var note := ""
	match id:
		"express": note = " Stops only at lobbies."
		"security": note = " Needed for 3 stars."
		"food": note = " Feeds lunch and dinner crowds from %d floors around it." % C.FOOD_RANGE
		"escalator": note = " Joins two floors; climbing it costs %d%% of a flight of stairs." % int(C.ESCALATOR_WALK * 100)
		"floor": note = " A bare slab: build on it later. It may hang beside a building to span a gap."
		"hotel": note = " Guests check in %d-%dh, pay at checkout %02d-%dh and leave it dirty." % [C.HOTEL_CHECKIN[0], C.HOTEL_CHECKIN[1], C.HOTEL_CHECKOUT[0], C.HOTEL_CHECKOUT[1]]
		"housekeeping": note = " Cleans hotel rooms within %d floors; give it a service lift." % t.range
		"servicelift": note = " Staff only: keeps housekeeping out of the guest lifts."
		"hall": note = " Events on weekday evenings and weekend afternoons."
		"parking": note = " Basement only. %d spaces: offices and flats with one are happier." % t.spaces
		"transit": note = " Basement only. Brings %d visitors; needed for 5 stars." % C.TRANSIT_VISITORS
		"clinic", "plant": note = " Lifts happiness within %d floors; needed for 4 stars." % t.range
		"landmark": note = " One per tower, on floor %d or higher with support under all %d columns; brings %d visitors and crowns a five-star tower." % [C.LANDMARK_MIN_FLOOR, t.w, C.LANDMARK_VISITORS]
		_:
			if t.get("span", 0):
				note = " Climbs up to %d floors. Inspect a stop to close it." % t.span
	ui.status("%s: %dx%d, $%s%s.%s" % [t.label, t.w, t.h, UI._thousands(t.cost), extra, note])


func _on_tap(col: int, f: int) -> void:
	ui.menu_panel.hide()
	if ui.sheet_open():
		return
	var tool: String = view.tool
	if tool == "inspect":
		var st = Sim.structure_at(state, col, f)
		view.selected = st.id if st != null else null
		if st != null and C.TYPES[st.type].kind == "unit" and state.service.has(st.id):
			return _show_card(st)
		if st != null and C.TYPES[st.type].get("span", 0):
			return _show_lift_card(st)
		card_mode = ""
		ui.hide_card()
		ui.status(_describe(st) if st != null else "Empty cell on %s." % Sim.floor_name(f), st != null)
		return
	if tool == "demolish":
		var st = Sim.structure_at(state, col, f)
		if st != null:
			return _open_confirm(st)
		_close_card()
		ui.status("Dug levels stay dug." if f < 1 and f >= 1 - state.dug else "Nothing to demolish here.")
		return
	if tool == "dig":
		var res := Sim.dig(state, f)
		_bump()
		audio.play("build" if res.ok else "error")
		ui.status("Dug %s for $%s." % [Sim.floor_name(f), UI._thousands(C.DIG_COST)] if res.ok else res.reason + ".")
		_update_ui()
		return
	if tool == "car":
		var res := Sim.add_car(state, col, f)
		_bump()
		audio.play("lift" if res.ok else "error")
		ui.status("Added a car: this shaft now runs %d." % res.cars if res.ok else res.reason + ".")
		_update_ui()
		return
	var d := Draft.draft_tap(state, view.draft, tool, col, f)
	_set_draft(d.draft)
	if not d.place:
		audio.play("error" if d.reason != null else "tap")
		if d.reason != null:
			ui.status(d.reason + ".")
		elif not Sim.connects_here(state, tool, col, f):
			ui.status("No path to the lobby from here. Tap again to build anyway.")
		else:
			ui.status("%s on %s: tap again to build for $%s." % [C.TYPES[tool].label, Sim.floor_name(f), UI._thousands(d.draft.cost)])
		return
	var res := Sim.place(state, tool, col, f)
	_bump()
	if res.ok:
		var t: Dictionary = C.TYPES[tool]
		tower.on_placed(res.structure)
		audio.play("lift" if t.get("span", 0) else "build")
		var cut: bool = (t.kind == "unit" or t.kind == "transport") and not t.get("staff", false) and not Sim.reachable(state).has(res.structure.id)
		ui.status("Built %s on %s for $%s.%s" % [t.label, Sim.floor_name(f), UI._thousands(t.cost), " It has no path to the lobby yet." if cut else ""])
	else:
		audio.play("error")
		ui.status(res.reason + ".")
	_update_ui()
	_update_guide()
	_check_ends()


func _on_long_press(col: int, f: int) -> void:
	if ui.sheet_open():
		return
	var st = Sim.structure_at(state, col, f)
	if st == null:
		ui.status("Nothing to demolish here.")
		return
	_set_draft(null)
	_open_confirm(st)


# ---- Cards ------------------------------------------------------------------------

func _describe(st: Dictionary) -> String:
	var t: Dictionary = C.TYPES[st.type]
	var reach := Sim.reachable(state).has(st.id)
	var path := "" if reach else " (no path to lobby)"
	if t.get("range", 0):
		return "%s on %s: covers %s to %s%s." % [t.label, Sim.floor_name(st.floor), Sim.floor_name(maxi(Sim.LOWEST_FLOOR, st.floor - t.range)), Sim.floor_name(mini(state.maxFloors, st.floor + t.range)), path]
	if t.get("spaces", 0):
		var used := 0
		for v in state.perks.values():
			if v[0] == "parking":
				used += 1
		var r := Sim.reachable(state)
		var parks: int = state.structures.filter(func(x): return x.type == "parking" and r.has(x.id)).size()
		return "%s on %s: %d spaces; %d of %d taken across the tower%s." % [t.label, Sim.floor_name(st.floor), t.spaces, used, parks * t.spaces, path]
	if t.kind != "unit":
		return "%s on %s%s." % [t.label, Sim.floor_name(st.floor), path]
	if not reach:
		return "%s, %s: no path to the lobby, so nobody comes." % [t.label, Sim.floor_name(st.floor)]
	if not st.occupied:
		return "%s, %s: vacant, waiting for a tenant." % [t.label, Sim.floor_name(st.floor)]
	return "%s, %s: let, %d people, $%d/hour." % [t.label, Sim.floor_name(st.floor), t.people, Sim.take_of(state, st)]


func _show_card(st: Dictionary) -> void:
	var t: Dictionary = C.TYPES[st.type]
	var sv: Dictionary = state.service[st.id]
	var band := Sim.happy_band(st.happy)
	var peak: int = C.DEMAND[st.type].peak if C.DEMAND.has(st.type) else C.DEMAND.office.peak
	var walk := roundf(sv.walk * 10) / 10.0
	var cleaner = state.cleaners.get(st.id)
	var why := ""
	if sv.walk > 0:
		why = "%s floor%s by stairs" % [str(walk).trim_suffix(".0"), "" if walk == 1 else "s"]
	elif sv.peak >= C.WAIT_BUSY:
		why = "Lift busy at %02d:00" % peak
	elif state.noisy.has(st.id):
		why = "Noisy neighbours"
	elif cleaner != null and cleaner.guestLift:
		why = "Staff use the guest lift"
	else:
		why = "Lift keeps up"
	var money: Array
	if t.get("price", 0):
		money = ["Sale", ("sold $%s" if st.sold else "asking $%s") % UI._thousands(Sim.price_of(st))]
	elif t.get("nightly", 0):
		money = ["Per night", "$%d" % Sim.nightly_of(st)]
	else:
		money = ["Takings" if t.get("perVisitor", 0) or t.get("perDiner", 0) or t.get("perGuest", 0) else "Rent", "$%d/h" % Sim.take_of(state, st) if st.occupied else "vacant"]
	var rows := [["Happiness", "%s · %d" % [band.capitalize(), roundi(st.happy)], band], ["Why", why], money]
	if t.get("nightly", 0):
		rows.append(["Room", "guests in" if st.occupied else ("dirty" if st.dirty else "clean"), "poor" if st.dirty else ""])
		if st.dirty and cleaner == null:
			rows.append(["Cleaner", "none within %d floors" % C.TYPES.housekeeping.range, "poor"])
		rows.append(["Guests", str(t.guests) if st.occupied else "0"])
	else:
		rows.append(["People", str(t.people) if st.occupied else "0"])
	var perks = state.perks.get(st.id)
	if perks != null:
		rows.append(["Extras", ", ".join(perks.map(func(p): return "parking space" if p == "parking" else ("plant room" if p == "plant" else p)))])
	if st.fire:
		rows.insert(1, ["Fire", "burning %d h%s" % [st.fire, "" if state.facilities.has("security") else ", burnt out after %d" % C.FIRE_BURN_TICKS], "poor"])
	if st.burnt:
		rows.insert(1, ["Burnt out", "a shell: repair it to let it again", "poor"])
	var named: bool = st.occupied or t.get("nightly", 0)
	var biz := Tenants.tenant_of(st)
	rows.push_front(["%s, %s" % [t.label, Sim.floor_name(st.floor)], biz.label if named and not biz.is_empty() and not t.get("nightly", 0) and st.type != "flat" else ""])
	var actions := []
	if st.burnt:
		actions.append({"label": "Repair $%s" % UI._thousands(Sim.repair_cost(st)), "on_click": func():
			var res := Sim.repair(state, st.id)
			audio.play("repair" if res.ok else "error")
			ui.status("Repaired %s on %s for $%s." % [t.label, Sim.floor_name(st.floor), UI._thousands(res.cost)] if res.ok else res.reason + ".")
			_update_ui()
			_show_card(st)})
	else:
		actions.append({"label": "Rent: %s" % C.RENT_LEVELS[st.rentLevel].label, "on_click": func(): Sim.cycle_rent(state, st.id); _show_card(st)})
	if named and not st.burnt:
		actions.append({"label": "Rename", "on_click": func(): _rename_card(st)})
	card_mode = "inspect"
	var title := ("Burnt %s" % t.label.to_lower()) if st.burnt else (Tenants.name_of(st) if named else "%s to let" % t.label)
	ui.show_card(title, rows, actions)


func _rename_card(st: Dictionary) -> void:
	ui.edit_title(st.name if st.name != null else Tenants.name_of(st), func(text: String):
		var res := Sim.rename_unit(state, st.id, text)
		_bump()
		if res.ok:
			Storage.save_game(state)
			ui.status("Renamed to %s." % res.name if res.name != null else "Name reset.")
		_show_card(st), func(): _show_card(st))


func _name_for(st: Dictionary) -> String:
	var t: Dictionary = C.TYPES[st.type]
	if t.kind == "unit" and (st.occupied or t.get("nightly", 0)):
		return Tenants.name_of(st)
	return "%s on %s" % [t.label, Sim.floor_name(st.floor)]


func _open_confirm(st: Dictionary) -> void:
	var pre := Sim.preview_demolish(state, st.id)
	if not pre.ok:
		ui.status(pre.reason + ".")
		return
	var t: Dictionary = C.TYPES[st.type]
	var who := "nobody"
	if pre.evicted:
		who = "%d %s%s" % [pre.evicted, "guest" if t.get("guests", 0) else "people", "s" if t.get("guests", 0) and pre.evicted > 1 else ""]
	elif pre.occupied:
		who = "the tenant"
	var rows := [["Refund", "$%s" % UI._thousands(pre.refund), "" if pre.refund else "poor"], ["Moving out", who, "fair" if pre.occupied else ""]]
	if st.type == "flat" and st.sold:
		rows.append(["Sold flat", "the owner paid for it: no refund"])
	if pre.cut.size():
		rows.append(["Cut off", "%d unit%s lose%s their path to the lobby" % [pre.cut.size(), "s" if pre.cut.size() > 1 else "", "" if pre.cut.size() > 1 else "s"], "poor"])
	view.selected = st.id
	card_mode = "confirm"
	ui.show_card("Demolish %s?" % _name_for(st), rows, [
		{"label": "Demolish", "danger": true, "arm_ms": C.CONFIRM_ARM_MS, "on_click": func(): _do_demolish(st)},
		{"label": "Keep", "on_click": _close_card},
	])


func _do_demolish(st: Dictionary) -> void:
	var label := _name_for(st)
	var res := Sim.demolish(state, st.id)
	_bump()
	if res.ok:
		tower.on_demolished(st)
		audio.play("demolish")
		var moved: String = (" %d %s moved out." % [res.evicted, "people" if res.evicted > 1 else "person"]) if res.evicted else ""
		ui.status("Demolished %s, refunded $%s.%s" % [label, UI._thousands(res.refund), moved])
	else:
		ui.status(res.reason + ".")
	_close_card()
	_update_ui()


func _show_lift_card(st: Dictionary) -> void:
	var t: Dictionary = C.TYPES[st.type]
	var sh := Sim._shaft_at(state, st)
	var waiting := 0
	for x in state.transit.shafts:
		if x.col == sh.col and x.lo == sh.lo:
			waiting = x.queue.size()
	card_mode = "inspect"
	var span: String = ("%s to %d" % [Sim.floor_name(sh.lo), sh.hi]) if sh.lo < 1 else ("floors %d-%d" % [sh.lo, sh.hi])
	ui.show_card("%s shaft, %s" % [t.label, span], [
		["Cars", str(sh.cars)],
		["Waiting", str(waiting)],
		["Stop %s" % (Sim.floor_name(st.floor) if st.floor < 1 else str(st.floor)), "closed" if st.closed else "open", "poor" if st.closed else ""],
	], [
		{"label": "Open this stop" if st.closed else "Close this stop", "on_click": func():
			var res := Sim.toggle_stop(state, st.col, st.floor)
			_bump()
			if not res.ok:
				ui.status(res.reason + ".")
			_show_lift_card(st)},
	])


# ---- Sheets -------------------------------------------------------------------------

func _stars(n: int) -> String:
	return "★".repeat(n) + "☆".repeat(5 - n)


func _show_report(r: Dictionary) -> void:
	var rows := []
	for k in [["office", "Office rent"], ["shop", "Shop takings"], ["flat", "Flat sales"], ["food", "Food court takings"], ["hotel", "Hotel rooms"], ["hall", "Event hall"]]:
		rows.append([k[1], UI.money(r.income[k[0]])])
	rows.append(["Upkeep", UI.money(-r.upkeep)])
	rows.append(["Net", UI.money(r.net), "total"])
	rows.append(["Moved out", str(r.left)])
	rows.append(["Stars", "%s → %s" % [_stars(r.starsBefore), _stars(r.starsAfter)]])
	if r.loan:
		rows.append(["Loan repaid", UI.money(r.loan)])
	if r.borrowed:
		rows.append(["Loan taken", UI.money(r.borrowed), "poor"])
	if r.owed:
		rows.append(["Still owed", UI.money(r.owed), "fair"])
	ui.show_sheet("report", "Quarter %d report" % r.quarter, [["rows", rows], ["buttons", [{"label": "Continue", "primary": true, "on_click": ui.hide_sheet}]]])


func _open_tower_sheet() -> void:
	var reach := Sim.reachable(state)
	var rows := [["Population", "%d people" % state.population, "total"]]
	var mood := Sim.mood_counts(state)
	rows.append(["Mood", "%d good, %d fair, %d poor" % [mood.good, mood.fair, mood.poor]])
	for type in C.TYPES:
		var t: Dictionary = C.TYPES[type]
		if t.kind != "unit":
			continue
		var all: Array = state.structures.filter(func(x): return x.type == type)
		if all.is_empty():
			continue
		var let_: int = all.filter(func(x): return x.occupied).size()
		var people: int = let_ * t.get("people", 0)
		var cut: bool = all.any(func(x): return not reach.has(x.id))
		rows.append([t.label, "%d of %d %s%s%s" % [let_, all.size(), "full" if t.get("nightly", 0) else "let", " · %d ppl" % people if people else "", " · some cut off" if cut else ""]])
	rows.append(["Visitors", str(state.visitors)])
	var needs := Sim.star_needs(state)
	var map := _minimap()
	ui.show_sheet("tower", "Your tower " + _stars(state.rating), [["rows", rows],
		["needs", "For %d stars" % needs.next if needs.next != null else "Five stars: every need is met", needs.needs],
		["map", map],
		["buttons", [{"label": "Close", "primary": true, "on_click": ui.hide_sheet}]]])


## The tower sheet's mini map: one small rect per structure, in the type colours.
func _minimap() -> Control:
	var m := Control.new()
	var top := 1
	for st in state.structures:
		top = maxi(top, st.floor + C.TYPES[st.type].h - 1)
	var floors: int = top - (1 - state.dug) + 1
	var cell := clampf(110.0 / floors, 2.0, float(C.MINIMAP_CELL))
	m.custom_minimum_size = Vector2(state.width * cell, floors * cell)
	var pal: Dictionary = tower.pal
	var s: Dictionary = state
	m.draw.connect(func():
		m.draw_rect(Rect2(Vector2.ZERO, m.custom_minimum_size), Color(pal.bg, 0.6))
		var reach := Sim.reachable(s)
		for st in s.structures:
			var t: Dictionary = C.TYPES[st.type]
			var key: String = {"elevator": "shaft", "floor": "slab", "landmark": "plant"}.get(st.type, st.type)
			var col: Color = pal.get(key, pal.muted)
			if not reach.has(st.id):
				col = pal.unreach
			m.draw_rect(Rect2(st.col * cell, (top - st.floor - t.h + 1) * cell, t.w * cell - 0.5, t.h * cell - 0.5), col))
	return m


func _open_towers_sheet() -> void:
	var active := Storage.active_slot()
	Storage.save_game(state)
	var slots := []
	for n in range(1, C.SLOT_COUNT + 1):
		var info := Storage.slot_info(n)
		var detail := "Empty"
		if not info.is_empty():
			detail = "%s · Day %d · %s" % [_stars(info.rating), info.day, UI.money(info.cash)]
			if info.savedAt:
				detail += " · " + Time.get_datetime_string_from_unix_time(int(info.savedAt / 1000), true).substr(0, 16)
		var actions := []
		if n != active:
			actions.append({"label": "Load", "disabled": info.is_empty(), "on_click": func():
				var next = Storage.load_game(n)
				if next == null:
					ui.status("That slot could not be read.")
					return
				Storage.save_game(state)
				Storage.set_active_slot(n)
				_switch_to(next)
				ui.hide_sheet()
				ui.status("Loaded the tower in slot %d." % n)})
			actions.append({"label": "Save here", "on_click": func():
				if not info.is_empty():
					_confirm("Replace the tower in slot %d with this one?" % n, func():
						Storage.save_game(state, n)
						Storage.set_active_slot(n)
						ui.status("Saved to slot %d; it is now the active slot." % n)
						_open_towers_sheet())
					return
				Storage.save_game(state, n)
				Storage.set_active_slot(n)
				ui.status("Saved to slot %d; it is now the active slot." % n)
				_open_towers_sheet()})
			if not info.is_empty():
				actions.append({"label": "Delete", "danger": true, "on_click": func():
					_confirm("Delete the tower in slot %d? This cannot be undone." % n, func():
						Storage.clear_game(n)
						_open_towers_sheet())})
		slots.append({"title": "Slot %d%s" % [n, " · playing" if n == active else ""], "detail": detail, "actions": actions})
	var buttons := [{"label": "Export file", "on_click": _export}, {"label": "Close", "primary": true, "on_click": func(): ui.hide_sheet(); _check_ends()}]
	if OS.has_feature("web"):
		buttons.insert(1, {"label": "Import file", "on_click": _import})
	ui.show_sheet("towers", "Towers", [["slots", slots], ["buttons", buttons]])


func _confirm(question: String, yes: Callable) -> void:
	ui.show_sheet("confirm", question, [["buttons", [{"label": "Yes", "danger": true, "on_click": func(): ui.hide_sheet(); yes.call()},
		{"label": "No", "primary": true, "on_click": ui.hide_sheet}]]])


func _export() -> void:
	var t := Time.get_date_dict_from_system()
	var name := "skyrise-%04d-%02d-%02d.json" % [t.year, t.month, t.day]
	var text := Storage.export_tower(state)
	if OS.has_feature("web"):
		JavaScriptBridge.download_buffer(text.to_utf8_buffer(), name, "application/json")
	else:
		var f := FileAccess.open("user://" + name, FileAccess.WRITE)
		if f:
			f.store_string(text)
			f.close()
		name = ProjectSettings.globalize_path("user://" + name)
	ui.status("Exported %s." % name)


var _import_cb: JavaScriptObject


func _import() -> void:
	# A hidden file input; its text comes back through a callback.
	_import_cb = JavaScriptBridge.create_callback(func(args):
		var next = Storage.import_tower(str(args[0]))
		if next == null:
			ui.status("Not a Skyrise tower file.")
			return
		_switch_to(next)
		Storage.save_game(state)
		ui.hide_sheet()
		ui.status("Imported the tower into slot %d." % Storage.active_slot()))
	JavaScriptBridge.get_interface("window").skyriseImport = _import_cb
	JavaScriptBridge.eval("""(() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
		i.onchange = async () => { const f = i.files && i.files[0]; if (f) window.skyriseImport(await f.text()); }; i.click(); })()""", true)


# ---- Ends, guide, menu ----------------------------------------------------------------

func _check_ends() -> void:
	if state.wonAt != null and not win_shown:
		win_shown = true
		audio.play("win")
		Storage.save_game(state)
		ui.show_sheet("win", "♛ Your tower is crowned", [["text", "The %s crowns a five-star tower. %d people live and work here, and %d visitors come every hour. The tower keeps running: build on, or start another in the Towers sheet." % [C.TYPES.landmark.label, state.population, state.visitors]],
			["buttons", [{"label": "Keep building", "primary": true, "on_click": ui.hide_sheet}]]])
	if state.over and not ui.sheet_open():
		if not over_shown:
			Storage.save_game(state)
			audio.play("gameover")
		over_shown = true
		var owed: String = (" ($%s owed)" % UI._thousands(roundi(state.loan.owed))) if state.loan != null else ""
		ui.show_sheet("over", "Game over", [["text", "The quarter ended below $0 with a loan still open%s. The clock has stopped. Load another tower, or start a new one." % owed],
			["buttons", [{"label": "Load a tower", "on_click": _open_towers_sheet}, {"label": "New tower", "danger": true, "on_click": func(): ui.hide_sheet(); _new_tower()}]]])


func _update_guide() -> void:
	if guide_off:
		return ui.guide(null)
	var goals := Sim.guide_goals(state)
	var i := goals.find(false)
	if i < 0:
		guide_off = true
		Storage.set_setting("guide", "done")
		ui.guide(null)
		ui.status("Guide done: chase the stars. Tap them to see what the next one needs.")
		return
	ui.guide(GUIDE_TEXT[i])


func _switch_to(next: Dictionary) -> void:
	state = next
	tower.state = state
	_bump()
	win_shown = state.wonAt != null
	over_shown = false
	_set_draft(null)
	_close_card()
	tower.reset()
	tower.recenter()
	_update_ui()
	_update_guide()


func _new_tower() -> void:
	Storage.clear_game()
	_switch_to(Sim.new_game())
	ui.status("New plot. Build stairs or a lift beside the lobby, then lease units above it.", true)


func _on_menu(action: String) -> void:
	match action:
		"save": ui.status("Saved to slot %d." % Storage.active_slot() if Storage.save_game(state) else "Could not save: storage unavailable.")
		"tower": _open_tower_sheet()
		"towers": _open_towers_sheet()
		"pause": _set_speed(run_speed if _paused() else 0)
		"theme":
			theme_name = "light" if theme_name == "" else ("dark" if theme_name == "light" else "")
			Storage.set_setting("theme", theme_name)
			_apply_theme()
			_update_ui()
		"sound":
			audio.toggle()
			_update_ui()
			ui.status("Sound on." if audio.on else "Sound off.")
		"recenter": tower.recenter()
		"new": _confirm("Start a new tower? The current one is erased.", _new_tower)


## Test hook (web builds with ?debug in the URL): a JSON summary on window.__skyrise,
## so the Playwright checks can read the game without scraping pixels.
func _publish_debug() -> void:
	var d := {
		"cash": state.cash, "tick": state.tick, "rating": state.rating, "population": state.population,
		"structures": state.structures.size(), "occupied": state.structures.filter(func(x): return x.occupied).size(),
		"status": ui.status_label.text if ui.status_panel.visible else "", "guide": ui.guide_label.text if ui.guide_panel.visible else "",
		"card": ui.card_title.text if ui.card.visible else "", "sheet": ui.sheet_kind, "tool": view.tool, "draft": view.draft,
		"cam": tower.cam, "cell": [tower.ART_W, tower.ART_H], "stage": [ui.stage.global_position.x, ui.stage.global_position.y], "maxFloors": state.maxFloors,
		"lobbyLeft": state.structures.filter(func(x): return x.type == "lobby").map(func(x): return x.col).min(),
		"scale": get_tree().root.content_scale_factor, "fps": Engine.get_frames_per_second(),
		"frameMs": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"drawMs": tower.prof.draw_ms, "staticMs": tower.prof.static_ms, "staticCount": tower.prof.static_count, "advanceMs": advance_ms,
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"toolbar": [ui.tools.global_position.x, ui.tools.global_position.y], "dark": ui.dark, "theme": theme_name,
		"viewport": [get_viewport_rect().size.x, get_viewport_rect().size.y], "window": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y],
		"screenScale": DisplayServer.screen_get_scale(),
	}
	JavaScriptBridge.eval("window.__skyrise = " + JSON.stringify(d) + ";", true)


## Dev override (?demo=big): the five-star tower from the tests, with 112 offices around
## three 4-car shafts, for checking frame rate on a full tower. Never saved over a slot
## unless the player saves it.
func _demo_tower() -> Dictionary:
	var s := Sim.new_game()
	s.cash = 100000000
	var put := func(type: String, col: int, f: int) -> void:
		s.rating = 5
		Sim.place(s, type, col, f)
	Sim.dig(s, 0)
	put.call("stairs", 24, 0)
	put.call("transit", 25, 0)
	put.call("floor", 1, 1)
	for f in range(1, 60, 2):
		put.call("stairs", 2, f)
	for f in range(2, 59, 2):
		put.call("stairs", 1, f)
	for c in [15, 25, 26]:
		for f in range(1, 17):
			put.call("elevator", c, f)
		for k in 3:
			Sim.add_car(s, c, 1)
	for f in range(1, 17):
		for c in [3, 6, 9, 12, 27, 30, 33]:
			put.call("office", c, f)
	put.call("security", 36, 1)
	put.call("clinic", 38, 1)
	put.call("plant", 36, 2)
	s.vip = {"review": "good", "quarter": 1}
	for i in 30:
		Sim.step_hour(s)
	return s

