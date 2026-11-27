# Saves and per-device settings, ported from src/storage.js. On the web they live in
# localStorage under the JS build's own keys (skyrise.save.1 to .3, skyrise.slot,
# skyrise.theme, ...), in the same JSON, so both builds served from one site share their
# towers. localStorage is synchronous, so a save is on disk before the next line runs;
# Godot's user:// reaches IndexedDB asynchronously and a quick reload could lose it.
# Elsewhere, each key is a file in user://. Every access is guarded: a missing, blocked
# or corrupt store reads as empty, never as a crash.
extends RefCounted

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")

const SAVE_KEY := "skyrise.save"           # slots are skyrise.save.1 to .3, as in the JS build
const SLOT_KEY := "skyrise.slot"


static func _web() -> bool:
	return OS.has_feature("web")


static func _path(key: String) -> String:
	return "user://" + key + ".txt"


## The stored string for a key, or "" when there is none.
static func get_raw(key: String) -> String:
	if _web():
		var v = JavaScriptBridge.eval("(() => { try { return localStorage.getItem(%s) || ''; } catch (e) { return ''; } })()" % JSON.stringify(key), true)
		return str(v) if v != null else ""
	if not FileAccess.file_exists(_path(key)):
		return ""
	return FileAccess.get_file_as_string(_path(key))


## Store a string under a key; "" removes it. Returns false when the store refused.
static func set_raw(key: String, value: String) -> bool:
	if _web():
		var js := "(() => { try { %s; return true; } catch (e) { return false; } })()" % (
			("localStorage.removeItem(%s)" % JSON.stringify(key)) if value == "" else ("localStorage.setItem(%s, %s)" % [JSON.stringify(key), JSON.stringify(value)]))
		return bool(JavaScriptBridge.eval(js, true))
	if value == "":
		if FileAccess.file_exists(_path(key)):
			DirAccess.remove_absolute(_path(key))
		return true
	var f := FileAccess.open(_path(key), FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(value)
	f.close()
	return true


# ---- Settings (theme, sound, guide, toolbar, greeted): one key each, as in the JS build ----

static func get_setting(name: String, fallback: String = "") -> String:
	var v := get_raw("skyrise." + name)
	return v if v != "" else fallback


static func set_setting(name: String, value: String) -> void:
	set_raw("skyrise." + name, value)


static func _valid(n: int) -> bool:
	return n >= 1 and n <= C.SLOT_COUNT


static func active_slot() -> int:
	var n := get_raw(SLOT_KEY).to_int()
	return n if _valid(n) else 1


static func set_active_slot(n: int) -> void:
	if _valid(n):
		set_raw(SLOT_KEY, str(n))


# ---- Towers -----------------------------------------------------------------

static func _slot_key(n: int) -> String:
	return "%s.%d" % [SAVE_KEY, n]


static func save_game(state: Dictionary, slot: int = -1) -> bool:
	var n := slot if slot > 0 else active_slot()
	return _valid(n) and set_raw(_slot_key(n), export_tower(state))


static func load_game(slot: int = -1) -> Variant:
	var n := slot if slot > 0 else active_slot()
	if not _valid(n):
		return null
	var text := get_raw(_slot_key(n))
	return import_tower(text) if text != "" else null


static func clear_game(slot: int = -1) -> void:
	var n := slot if slot > 0 else active_slot()
	if _valid(n):
		set_raw(_slot_key(n), "")


## What the Towers sheet lists for a slot: {rating, day, cash, savedAt}, or {} when empty or unreadable.
static func slot_info(slot: int) -> Dictionary:
	if not _valid(slot):
		return {}
	var blob = JSON.parse_string(get_raw(_slot_key(slot)))
	var s = Sim.deserialize(blob)
	if s == null:
		return {}
	var saved = blob.get("savedAt", 0)
	return {"rating": s.rating, "day": Sim.day_of(s.tick) + 1, "cash": s.cash, "savedAt": saved if typeof(saved) in [TYPE_INT, TYPE_FLOAT] else 0}


static func export_tower(state: Dictionary) -> String:
	return JSON.stringify(Sim.serialize(state), "", false, true)


## A tower from a file's text, or null: the file is untrusted.
static func import_tower(text: String) -> Variant:
	return Sim.deserialize(JSON.parse_string(text)) if text != "" else null
