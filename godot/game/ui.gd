# The HUD, toolbar, speed buttons, guide, status line, room card and sheets, ported from
# src/ui.js and index.html. Built in code from a theme made from the palette, so light and
# dark switch by rebuilding the theme. main.gd owns the state; this only shows it and
# reports taps through signals.
extends Control

signal tool_chosen(id: String)
signal draft_cancelled
signal speed_chosen(index: int)
signal stars_tapped
signal menu_action(action: String)
signal guide_closed
signal toolbar_toggled(collapsed: bool)

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const Palette = preload("res://game/palette.gd")

const ICON_FILES := {
	"lobby": "icon-lobby.png", "stairs": "icon-stairs.png", "elevator": "icon-lift.png", "car": "icon-lift.png",
	"express": "icon-express.png", "office": "icon-office.png", "shop": "icon-shop.png", "flat": "icon-flat.png",
	"security": "icon-security.png", "food": "icon-food.png", "escalator": "icon-escalator.png", "floor": "icon-floor.png",
	"inspect": "icon-inspect.png", "hotel": "icon-hotel.png", "housekeeping": "icon-housekeeping.png", "hall": "icon-hall.png",
	"parking": "icon-parking.png", "transit": "icon-transit.png", "servicelift": "icon-service-lift.png",
	"clinic": "icon-clinic.png", "plant": "icon-plant.png", "demolish": "icon-demolish.png", "landmark": "icon-landmark.png",
}
const TOOL_META := {
	"car": {"label": "Add car", "cost": C.LIFT_CAR_COST}, "dig": {"label": "Dig", "cost": C.DIG_COST},
	"inspect": {"label": "Inspect", "hint": "details"}, "demolish": {"label": "Demolish", "hint": "half back"},
}
const TOOL_BREAK := {"escalator": "Esca-\nlator", "housekeeping": "House-\nkeeping"}
const WEATHER_WORD := {"clear": "Clear", "rain": "Rain", "wind": "Windy", "fog": "Fog", "snow": "Snow"}
const TOOL_H := 66
const PER_ROW := 5
const MAX_ROWS := 3

var pal: Dictionary = Palette.colours(false)
var dark := false
var font: FontFile
var symbol_font: FontFile
var collapsed := false
var current_tool := "office"

# Nodes.
var stage: Control                       # holds the tower view and the overlays
var hud_panel: PanelContainer
var bottom_panel: PanelContainer
var hud_cash: Label
var hud_pop: Label
var hud_stars: Button
var hud_net: Label
var hud_clock: Label
var menu_btn: Button
var toolbar_scroll: ScrollContainer
var toolbar: GridContainer
var tool_buttons := {}
var toggle_btn: Button
var draft_bar: PanelContainer
var draft_label: Label
var speed_box: VBoxContainer
var speed_buttons := []
var status_panel: PanelContainer
var status_label: Label
var status_until := 0.0
var guide_panel: PanelContainer
var guide_label: Label
var card: PanelContainer
var card_title: Label
var card_rows: GridContainer
var card_actions: HFlowContainer
var card_close: Button
var card_edit: LineEdit
var sheet_dim: ColorRect
var sheet: PanelContainer
var sheet_box: VBoxContainer
var sheet_kind := ""
var menu_panel: PanelContainer
var menu_box: VBoxContainer

var shown_cash := 0.0
var shown_pop := 0.0
var target_cash := 0.0
var target_pop := 0.0
var editing := false
var arm_until := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	symbol_font = load("res://assets/fonts/DejaVuSans.ttf")
	font = ThemeDB.fallback_font.duplicate() if ThemeDB.fallback_font is FontFile else FontFile.new()
	font.fallbacks = [symbol_font]
	_build()
	apply_theme(false)


# ---- Theme ------------------------------------------------------------------

func _box(bg: Color, radius: int = 12, border: Color = Color(0, 0, 0, 0), pad: int = 8) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = bg
	b.set_corner_radius_all(radius)
	b.border_color = border
	if border.a > 0:
		b.set_border_width_all(1)
	b.content_margin_left = pad
	b.content_margin_right = pad
	b.content_margin_top = pad * 0.6
	b.content_margin_bottom = pad * 0.6
	return b


func apply_theme(on: bool) -> void:
	dark = on
	pal = Palette.colours(on)
	var th := Theme.new()
	th.default_font = font
	th.default_font_size = 13
	var btn := _box(pal.panel, 12, pal["panel-border"], 6)
	var hover := _box(pal["panel-2"], 12, pal["panel-border"], 6)
	var pressed := _box(pal.accent, 12, pal.accent, 6)
	var disabled := _box(pal["panel-2"], 12, pal["panel-border"], 6)
	for k in ["normal", "focus"]:
		th.set_stylebox(k, "Button", btn)
	th.set_stylebox("hover", "Button", hover)
	th.set_stylebox("pressed", "Button", pressed)
	th.set_stylebox("hover_pressed", "Button", pressed)
	th.set_stylebox("disabled", "Button", disabled)
	for k in ["font_color", "font_focus_color", "font_hover_color"]:
		th.set_color(k, "Button", pal.fg)
	th.set_color("font_pressed_color", "Button", pal["accent-fg"])
	th.set_color("font_hover_pressed_color", "Button", pal["accent-fg"])
	th.set_color("font_disabled_color", "Button", pal.muted)
	th.set_color("font_color", "Label", pal.fg)
	th.set_stylebox("panel", "PanelContainer", _box(pal.panel, 14, pal["panel-border"], 12))
	th.set_stylebox("normal", "LineEdit", _box(pal["panel-2"], 8, pal["panel-border"], 6))
	th.set_stylebox("focus", "LineEdit", _box(pal["panel-2"], 8, pal.accent, 6))
	th.set_color("font_color", "LineEdit", pal.fg)
	th.set_stylebox("panel", "ScrollContainer", StyleBoxEmpty.new())
	theme = th
	RenderingServer.set_default_clear_color(pal.bg)
	if hud_cash:
		hud_panel.add_theme_stylebox_override("panel", _box(pal.bg, 0, Color(0, 0, 0, 0), 8))
		bottom_panel.add_theme_stylebox_override("panel", _box(pal.bg, 0, Color(0, 0, 0, 0), 8))
		hud_net.add_theme_color_override("font_color", pal.good)
		hud_clock.add_theme_color_override("font_color", pal.muted)
		hud_stars.add_theme_color_override("font_color", Color.html("#d97706"))
		hud_stars.add_theme_color_override("font_hover_color", Color.html("#d97706"))
		draft_bar.add_theme_stylebox_override("panel", _box(pal["accent-soft"].blend(Color(pal.panel, 0.6)), 12, pal["accent-soft"], 10))
		status_panel.add_theme_stylebox_override("panel", _box(Color(pal.panel, 0.94), 10, pal["panel-border"], 10))
		guide_panel.add_theme_stylebox_override("panel", _box(Color(pal.panel, 0.96), 12, pal["panel-border"], 10))
		sheet_dim.color = Color(0, 0, 0, 0.35)
		set_tool(current_tool)


# ---- Build ------------------------------------------------------------------

func _label(text: String = "", size: int = 13) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	return l


func _button(text: String, size: int = 13) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", size)
	return b


func _build() -> void:
	var col := VBoxContainer.new()
	col.name = "Column"
	col.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	col.add_theme_constant_override("separation", 0)
	add_child(col)

	# HUD: cash, people, stars, net on the first line; the clock under them; the menu button.
	var hud := PanelContainer.new()
	hud.name = "Hud"
	hud_panel = hud
	col.add_child(hud)
	var hrow := HBoxContainer.new()
	hud.add_child(hrow)
	var stats := VBoxContainer.new()
	stats.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stats.add_theme_constant_override("separation", 0)
	hrow.add_child(stats)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 10)
	stats.add_child(line)
	hud_cash = _label("$0", 18)
	hud_pop = _label("0 ppl", 18)
	hud_stars = _button("★☆☆☆☆", 16)
	hud_stars.flat = true
	hud_stars.pressed.connect(func(): stars_tapped.emit())
	hud_net = _label("+$0/h", 13)
	for n in [hud_cash, hud_pop, hud_stars, hud_net]:
		line.add_child(n)
	hud_clock = _label("Day 1 Mon 00:00 · Clear", 13)
	stats.add_child(hud_clock)
	menu_btn = _button("☰", 20)
	menu_btn.custom_minimum_size = Vector2(44, 44)
	menu_btn.pressed.connect(_toggle_menu)
	hrow.add_child(menu_btn)

	# Stage: the tower view (main.gd adds it at index 0) and its overlays.
	stage = Control.new()
	stage.name = "Stage"
	stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stage.clip_contents = true
	stage.mouse_filter = Control.MOUSE_FILTER_PASS
	col.add_child(stage)

	guide_panel = PanelContainer.new()
	guide_panel.set_anchors_preset(Control.PRESET_TOP_WIDE)
	guide_panel.offset_left = 8
	guide_panel.offset_right = -64
	guide_panel.offset_top = 8
	var grow := HBoxContainer.new()
	guide_panel.add_child(grow)
	guide_label = _label("", 13)
	guide_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	guide_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grow.add_child(guide_label)
	var gclose := _button("×", 16)
	gclose.custom_minimum_size = Vector2(32, 32)
	gclose.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	gclose.pressed.connect(func(): guide_panel.hide(); guide_closed.emit())
	grow.add_child(gclose)
	guide_panel.hide()
	stage.add_child(guide_panel)

	speed_box = VBoxContainer.new()
	speed_box.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	speed_box.offset_left = -52
	speed_box.offset_right = -8
	speed_box.offset_top = 8
	speed_box.add_theme_constant_override("separation", 4)
	stage.add_child(speed_box)
	for i in C.SPEEDS.size():
		var b := _button("❚❚" if C.SPEEDS[i] == 0 else "%d×" % C.SPEEDS[i], 13)
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(44, 36)
		b.pressed.connect(func(): speed_chosen.emit(i))
		speed_box.add_child(b)
		speed_buttons.append(b)

	status_panel = PanelContainer.new()
	status_panel.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	status_panel.offset_left = 8
	status_panel.offset_right = -8
	status_panel.offset_bottom = -8
	status_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	status_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	status_label = _label("", 13)
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status_label.max_lines_visible = 2
	status_panel.add_child(status_label)
	status_panel.hide()
	stage.add_child(status_panel)

	card = PanelContainer.new()
	card.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	card.offset_left = 8
	card.offset_right = -8
	card.offset_bottom = -8
	card.grow_vertical = Control.GROW_DIRECTION_BEGIN
	var cbox := VBoxContainer.new()
	card.add_child(cbox)
	var chead := HBoxContainer.new()
	cbox.add_child(chead)
	card_title = _label("", 15)
	card_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card_title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	chead.add_child(card_title)
	card_edit = LineEdit.new()
	card_edit.max_length = C.NAME_MAX
	card_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card_edit.hide()
	chead.add_child(card_edit)
	card_close = _button("×", 16)
	card_close.custom_minimum_size = Vector2(32, 32)
	card_close.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	card_close.pressed.connect(hide_card)
	chead.add_child(card_close)
	card_rows = GridContainer.new()
	card_rows.columns = 2
	card_rows.add_theme_constant_override("h_separation", 12)
	cbox.add_child(card_rows)
	card_actions = HFlowContainer.new()
	card_actions.add_theme_constant_override("h_separation", 8)
	cbox.add_child(card_actions)
	card.hide()
	stage.add_child(card)

	# Toolbar: tools in rows of five, at most three rows tall before it scrolls.
	var bottom := PanelContainer.new()
	bottom.name = "Bottom"
	bottom_panel = bottom
	col.add_child(bottom)
	var bcol := VBoxContainer.new()
	bottom.add_child(bcol)
	draft_bar = PanelContainer.new()
	var drow := HBoxContainer.new()
	draft_bar.add_child(drow)
	draft_label = _label("", 14)
	draft_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	drow.add_child(draft_label)
	var dcancel := _button("Cancel", 13)
	dcancel.custom_minimum_size = Vector2(64, 36)
	dcancel.pressed.connect(func(): draft_cancelled.emit())
	drow.add_child(dcancel)
	draft_bar.hide()
	bcol.add_child(draft_bar)
	toolbar_scroll = ScrollContainer.new()
	toolbar_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	toolbar_scroll.custom_minimum_size = Vector2(0, MAX_ROWS * (TOOL_H + 6))
	bcol.add_child(toolbar_scroll)
	toolbar = GridContainer.new()
	toolbar.columns = PER_ROW
	toolbar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	toolbar.add_theme_constant_override("h_separation", 6)
	toolbar.add_theme_constant_override("v_separation", 6)
	toolbar_scroll.add_child(toolbar)
	toggle_btn = _button("⌄", 22)
	toggle_btn.custom_minimum_size = Vector2(0, TOOL_H)
	toggle_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	toggle_btn.pressed.connect(func(): set_collapsed(not collapsed); toolbar_toggled.emit(collapsed))
	toolbar.add_child(toggle_btn)
	for id in C.TOOL_ORDER + ["inspect", "demolish"]:
		toolbar.add_child(_tool_button(id))

	# Sheets: one modal panel, refilled per use.
	sheet_dim = ColorRect.new()
	sheet_dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	sheet_dim.mouse_filter = Control.MOUSE_FILTER_STOP
	sheet_dim.gui_input.connect(func(e):
		if (e is InputEventMouseButton and e.pressed) and _dismissable():
			hide_sheet())
	sheet_dim.hide()
	add_child(sheet_dim)
	sheet = PanelContainer.new()
	sheet.set_anchors_preset(Control.PRESET_CENTER)
	sheet.hide()
	add_child(sheet)
	var sscroll := ScrollContainer.new()
	sscroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sscroll.custom_minimum_size = Vector2(300, 0)
	sheet.add_child(sscroll)
	sheet_box = VBoxContainer.new()
	sheet_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sheet_box.add_theme_constant_override("separation", 6)
	sscroll.add_child(sheet_box)

	menu_panel = PanelContainer.new()
	menu_panel.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	menu_panel.offset_left = -220
	menu_panel.offset_right = -8
	menu_panel.offset_top = 60
	menu_box = VBoxContainer.new()
	menu_panel.add_child(menu_box)
	# The logo is drawn for a dark slate badge (styles.css .menu-logo).
	var badge := PanelContainer.new()
	badge.add_theme_stylebox_override("panel", _box(Color.html("#4b5563"), 12, Color(0, 0, 0, 0), 10))
	var logo := TextureRect.new()
	logo.texture = load("res://assets/art/logo-skyrise.png")
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(170, 40)
	badge.add_child(logo)
	menu_box.add_child(badge)
	for a in [["save", "Save now"], ["tower", "Tower"], ["towers", "Towers (save slots)"], ["pause", "Pause"], ["theme", "Theme: auto"],
			["sound", "Sound: on"], ["recenter", "Recenter view"], ["new", "New tower"]]:
		var b := _button(a[1], 14)
		b.name = a[0]
		b.custom_minimum_size = Vector2(0, 40)
		b.pressed.connect(func(): menu_panel.hide(); menu_action.emit(a[0]))
		if a[0] == "new":
			b.add_theme_color_override("font_color", Color.html("#b4350a"))
		menu_box.add_child(b)
	menu_panel.hide()
	add_child(menu_panel)


func _tool_button(id: String) -> Button:
	var t: Dictionary = C.TYPES.get(id, TOOL_META.get(id, {}))
	var b := Button.new()
	b.name = id
	b.focus_mode = Control.FOCUS_NONE
	b.toggle_mode = true
	b.custom_minimum_size = Vector2(0, TOOL_H)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.clip_contents = true
	b.tooltip_text = t.label
	var v := VBoxContainer.new()
	v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 0)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	if ICON_FILES.has(id):
		var icon := TextureRect.new()
		icon.texture = load("res://assets/art/" + ICON_FILES[id])
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.custom_minimum_size = Vector2(0, 20)
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		icon.name = "Icon"
		v.add_child(icon)
	else:
		var g := _label("DIG", 10)
		g.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(g)
	# Fixed line breaks, never autowrap: a wrapping label inside the grid re-lays the
	# toolbar out every frame (its height follows its width, which follows the grid).
	var text: String = TOOL_BREAK.get(id, t.label)
	if text == t.label and text.length() > 8 and text.contains(" "):
		text = text.replace(" ", "\n")
	var name_l := _label(text, 11)
	name_l.name = "Name"
	name_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_l.clip_text = true
	name_l.custom_minimum_size = Vector2(10, 0)
	name_l.add_theme_constant_override("line_spacing", -3)
	v.add_child(name_l)
	var cost: int = t.get("cost", 0)
	var price := _label(("$%dk" % (cost / 1000)) if cost >= 100000 else ("$" + _thousands(cost) if cost else t.get("hint", "")), 11)
	price.name = "Price"
	price.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	price.clip_text = true
	price.custom_minimum_size = Vector2(10, 0)
	v.add_child(price)
	for n in [name_l, price]:
		n.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if C.UNLOCK_AT.has(id):
		var pill := _label("★%d" % C.UNLOCK_AT[id], 10)
		pill.name = "Pill"
		pill.position = Vector2(4, 3)
		pill.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(pill)
		var lock := TextureRect.new()
		lock.name = "Lock"
		lock.texture = load("res://assets/art/icon-lock.png")
		lock.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		lock.size = Vector2(13, 13)
		lock.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		lock.position = Vector2(-17, 4)
		lock.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(lock)
	b.pressed.connect(func(): tool_chosen.emit(id))
	tool_buttons[id] = b
	return b


static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


static func money(n: float) -> String:
	return ("-$" if n < 0 else "$") + _thousands(absi(roundi(n)))


# ---- Updates ------------------------------------------------------------------

func set_tool(id: String) -> void:
	current_tool = id
	for k in tool_buttons:
		var b: Button = tool_buttons[k]
		b.button_pressed = k == id
		b.visible = not collapsed or k == id
	_tool_colours()


func _tool_colours() -> void:
	for k in tool_buttons:
		var b: Button = tool_buttons[k]
		var on: bool = b.button_pressed
		var locked: bool = b.has_meta("locked") and b.get_meta("locked")
		for n in ["Name", "Price"]:
			var l: Label = b.find_child(n, true, false)
			l.add_theme_color_override("font_color", pal["accent-fg"] if on else (pal.muted if locked or n == "Price" else pal.fg))
		var icon = b.find_child("Icon", true, false)
		if icon:
			icon.modulate = Color(1, 1, 1, 0.4 if locked else 1.0)
		var pill = b.find_child("Pill", false, false)
		if pill:
			pill.visible = locked
			pill.add_theme_color_override("font_color", pal.warn)
		var lock = b.find_child("Lock", false, false)
		if lock:
			lock.visible = locked


func set_locks(rating: int) -> void:
	for id in C.UNLOCK_AT:
		var b: Button = tool_buttons[id]
		b.set_meta("locked", C.UNLOCK_AT[id] > rating)
	_tool_colours()


func set_collapsed(on: bool) -> void:
	collapsed = on
	toggle_btn.text = "⌃" if on else "⌄"
	toolbar_scroll.custom_minimum_size = Vector2(0, (TOOL_H + 6) * (1 if on else MAX_ROWS))
	set_tool(current_tool)


func draft(text: Variant) -> void:
	draft_bar.visible = text != null
	if text != null:
		draft_label.text = text


func update(state: Dictionary, paused: bool, speed: int, weather: String, theme_name: String, sound_on: bool) -> void:
	set_locks(state.rating)
	target_cash = state.cash
	target_pop = state.population
	var net: int = state.lastNet
	hud_net.text = ("+" if net >= 0 else "") + money(net) + "/h"
	hud_net.add_theme_color_override("font_color", pal.good if net >= 0 else pal.danger)
	hud_stars.text = "★".repeat(state.rating) + "☆".repeat(5 - state.rating) + (" ♛" if state.wonAt != null else "")
	var day: int = state.tick / C.HOURS_PER_DAY + 1
	var hour: int = state.tick % C.HOURS_PER_DAY
	hud_clock.text = "Day %d %s %02d:00 · %s%s" % [day, C.DAY_NAMES[(day - 1) % C.DAYS_PER_WEEK], hour, WEATHER_WORD.get(weather, "Clear"), " · paused" if paused else ""]
	for i in speed_buttons.size():
		speed_buttons[i].button_pressed = i == speed
	menu_box.get_node("pause").text = "Resume" if paused else "Pause"
	menu_box.get_node("theme").text = "Theme: " + (theme_name if theme_name != "" else "auto")
	menu_box.get_node("sound").text = "Sound: " + ("on" if sound_on else "off")


func _process(delta: float) -> void:
	# HUD counters ease toward their targets.
	var k := 1 - pow(0.5, delta * 1000 / 110.0)
	shown_cash = target_cash if absf(target_cash - shown_cash) < 0.5 else shown_cash + (target_cash - shown_cash) * k
	shown_pop = target_pop if absf(target_pop - shown_pop) < 0.5 else shown_pop + (target_pop - shown_pop) * k
	# Set text only when it changes: a Label re-shapes its text on every assignment.
	var cash_text := money(shown_cash)
	if hud_cash.text != cash_text:
		hud_cash.text = cash_text
		hud_cash.add_theme_color_override("font_color", pal.danger if shown_cash < 0 else pal.fg)
	var pop_text := "%d ppl" % roundi(shown_pop)
	if hud_pop.text != pop_text:
		hud_pop.text = pop_text
	if status_panel.visible and status_until > 0 and Time.get_ticks_msec() > status_until:
		status_panel.hide()
	# The status line sits above an open card.
	var bottom := -(card.size.y + 16) if card.visible else -8.0
	if status_panel.offset_bottom != bottom:
		status_panel.offset_bottom = bottom


func status(msg: String, sticky: bool = false) -> void:
	status_label.text = msg
	status_panel.visible = msg != ""
	status_until = 0.0 if sticky else Time.get_ticks_msec() + 4000.0


func guide(text: Variant) -> void:
	guide_panel.visible = text != null
	if text != null:
		guide_label.text = text


# ---- Card ------------------------------------------------------------------------

## rows: [[label, value, cls], ...]; actions: [{label, danger, arm_ms, on_click}].
func show_card(title: String, rows: Array, actions: Array) -> void:
	editing = false
	card_edit.hide()
	card_title.show()
	card_title.text = title
	for c in card_rows.get_children():
		c.queue_free()
	for c in card_actions.get_children():
		c.queue_free()
	for r in rows:
		var l := _label(r[0], 12)
		l.add_theme_color_override("font_color", pal.muted)
		var v := _label(r[1], 13)
		var cls: String = r[2] if r.size() > 2 else ""
		if cls in ["good", "fair", "poor"]:
			v.add_theme_color_override("font_color", {"good": pal.good, "fair": pal.warn, "poor": pal.danger}[cls])
		v.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.custom_minimum_size = Vector2(170, 0)
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card_rows.add_child(l)
		card_rows.add_child(v)
	arm_until = 0.0
	for a in actions:
		var b := _button(a.label, 13)
		b.custom_minimum_size = Vector2(0, 40)
		if a.get("danger", false):
			b.add_theme_stylebox_override("normal", _box(pal.danger, 12, pal.danger, 8))
			b.add_theme_stylebox_override("hover", _box(pal.danger.darkened(0.1), 12, pal.danger, 8))
			b.add_theme_color_override("font_color", Color.WHITE)
			b.add_theme_color_override("font_hover_color", Color.WHITE)
		var arm: float = a.get("arm_ms", 0)
		if arm > 0:
			arm_until = Time.get_ticks_msec() + arm
		var cb: Callable = a.on_click
		b.pressed.connect(func():
			if a.get("arm_ms", 0) > 0 and Time.get_ticks_msec() < arm_until:
				return
			cb.call())
		card_actions.add_child(b)
	card.show()


func hide_card() -> void:
	editing = false
	card.hide()


## Swap the title for a text field; Enter saves, Escape or Cancel goes back.
func edit_title(current: String, on_save: Callable, on_cancel: Callable) -> void:
	editing = true
	card_title.hide()
	card_edit.show()
	card_edit.text = current
	card_edit.grab_focus()
	card_edit.select_all()
	for c in card_actions.get_children():
		c.queue_free()
	var save := _button("Save", 13)
	save.custom_minimum_size = Vector2(0, 40)
	save.pressed.connect(func(): editing = false; on_save.call(card_edit.text))
	var cancel := _button("Cancel", 13)
	cancel.custom_minimum_size = Vector2(0, 40)
	cancel.pressed.connect(func(): editing = false; on_cancel.call())
	card_actions.add_child(save)
	card_actions.add_child(cancel)
	if not card_edit.text_submitted.is_connected(_submit_edit):
		card_edit.text_submitted.connect(_submit_edit)
	card_edit.set_meta("save", on_save)


func _submit_edit(text: String) -> void:
	if editing:
		editing = false
		(card_edit.get_meta("save") as Callable).call(text)


# ---- Sheets ------------------------------------------------------------------------

## Sheets that need an answer (game over, a yes/no question) stay until one is given.
func _dismissable() -> bool:
	return sheet_kind not in ["over", "confirm"]


func sheet_open() -> bool:
	return sheet.visible


func hide_sheet() -> void:
	sheet.hide()
	sheet_dim.hide()
	sheet_kind = ""


## A modal sheet: a title, then parts: ["rows", [[label, value, cls]]], ["text", s],
## ["needs", title, [{label, met}]], ["slots", [...]], ["buttons", [{label, danger, on_click}]].
func show_sheet(kind: String, title: String, parts: Array) -> void:
	sheet_kind = kind
	for c in sheet_box.get_children():
		c.queue_free()
	var t := _label(title, 18)
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sheet_box.add_child(t)
	for p in parts:
		match p[0]:
			"rows":
				var g := GridContainer.new()
				g.columns = 2
				g.add_theme_constant_override("h_separation", 16)
				for r in p[1]:
					var l := _label(r[0], 13)
					l.add_theme_color_override("font_color", pal.muted)
					var v := _label(r[1], 13)
					v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
					v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
					v.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
					v.custom_minimum_size = Vector2(150, 0)
					var cls: String = r[2] if r.size() > 2 else ""
					if cls in ["good", "fair", "poor"]:
						v.add_theme_color_override("font_color", {"good": pal.good, "fair": pal.warn, "poor": pal.danger}[cls])
					if cls == "total":
						l.add_theme_color_override("font_color", pal.fg)
					g.add_child(l)
					g.add_child(v)
				sheet_box.add_child(g)
			"text":
				var l := _label(p[1], 14)
				l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				l.custom_minimum_size = Vector2(290, 0)
				sheet_box.add_child(l)
			"needs":
				sheet_box.add_child(_label(p[1], 15))
				for n in p[2]:
					var l := _label(("✓ " if n.met else "✗ ") + n.label, 13)
					l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
					l.custom_minimum_size = Vector2(290, 0)
					l.add_theme_color_override("font_color", pal.good if n.met else pal.danger)
					sheet_box.add_child(l)
			"slots":
				for s in p[1]:
					var box := VBoxContainer.new()
					box.add_child(_label(s.title, 14))
					var d := _label(s.detail, 12)
					d.add_theme_color_override("font_color", pal.muted)
					box.add_child(d)
					var row := HBoxContainer.new()
					for a in s.actions:
						var b := _button(a.label, 13)
						b.disabled = a.get("disabled", false)
						b.custom_minimum_size = Vector2(0, 36)
						if a.get("danger", false):
							b.add_theme_color_override("font_color", pal.danger)
						b.pressed.connect(a.on_click)
						row.add_child(b)
					box.add_child(row)
					sheet_box.add_child(box)
			"buttons":
				var row := HBoxContainer.new()
				row.alignment = BoxContainer.ALIGNMENT_CENTER
				for a in p[1]:
					var b := _button(a.label, 14)
					b.custom_minimum_size = Vector2(0, 42)
					b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
					if a.get("primary", false):
						b.add_theme_stylebox_override("normal", _box(pal.accent, 12, pal.accent, 8))
						b.add_theme_color_override("font_color", pal["accent-fg"])
					if a.get("danger", false):
						b.add_theme_color_override("font_color", pal.danger)
					b.pressed.connect(a.on_click)
					row.add_child(b)
				sheet_box.add_child(row)
			"map":
				sheet_box.add_child(p[1])
	sheet_dim.show()
	sheet.show()
	# Fit the sheet to the viewport: at most 92% tall, centred.
	await get_tree().process_frame
	var vp := get_viewport_rect().size
	var want := minf(sheet_box.get_combined_minimum_size().y + 28, vp.y * 0.9)
	var w := minf(340, vp.x - 20)
	sheet.get_child(0).custom_minimum_size = Vector2(w - 24, want - 24)
	sheet.size = Vector2(w, want)
	sheet.position = (vp - sheet.size) / 2


func _toggle_menu() -> void:
	menu_panel.visible = not menu_panel.visible


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		if sheet.visible and _dismissable():
			hide_sheet()
		elif menu_panel.visible:
			menu_panel.hide()
		elif draft_bar.visible:
			draft_cancelled.emit()
