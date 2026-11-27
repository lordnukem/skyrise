# Saves and per-device settings, ported from src/storage.js. Towers live in three slots
# (user://save.1.json ... .3) in the same JSON as the browser build, so a tower file
# exported from either build imports into the other. On the web, user:// is IndexedDB.
# Every access is guarded: a missing or corrupt file reads as empty, never as a crash.
extends RefCounted

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")

const SETTINGS := "user://settings.json"


static func _slot_path(n: int) -> String:
	return "user://save.%d.json" % n


static func _valid(n: int) -> bool:
	return n >= 1 and n <= C.SLOT_COUNT


static func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		return null
	return JSON.parse_string(text)


static func _write(path: String, text: String) -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(text)
	f.close()
	return true


# ---- Settings (theme, sound, guide, toolbar, slot) --------------------------

static func settings() -> Dictionary:
	var d = _read_json(SETTINGS)
	return d if typeof(d) == TYPE_DICTIONARY else {}


static func get_setting(key: String, fallback: Variant = null) -> Variant:
	return settings().get(key, fallback)


static func set_setting(key: String, value: Variant) -> void:
	var d := settings()
	if value == null:
		d.erase(key)
	else:
		d[key] = value
	_write(SETTINGS, JSON.stringify(d))


static func active_slot() -> int:
	var n = get_setting("slot", 1)
	return int(n) if (typeof(n) == TYPE_INT or typeof(n) == TYPE_FLOAT) and _valid(int(n)) else 1


static func set_active_slot(n: int) -> void:
	if _valid(n):
		set_setting("slot", n)


# ---- Towers -----------------------------------------------------------------

static func save_game(state: Dictionary, slot: int = -1) -> bool:
	var n := slot if slot > 0 else active_slot()
	if not _valid(n):
		return false
	return _write(_slot_path(n), export_tower(state))


static func load_game(slot: int = -1) -> Variant:
	var n := slot if slot > 0 else active_slot()
	if not _valid(n):
		return null
	return Sim.deserialize(_read_json(_slot_path(n)))


static func clear_game(slot: int = -1) -> void:
	var n := slot if slot > 0 else active_slot()
	if _valid(n) and FileAccess.file_exists(_slot_path(n)):
		DirAccess.remove_absolute(_slot_path(n))


## What the Towers sheet lists for a slot: {rating, day, cash, savedAt}, or {} when empty or unreadable.
static func slot_info(slot: int) -> Dictionary:
	if not _valid(slot):
		return {}
	var blob = _read_json(_slot_path(slot))
	var s = Sim.deserialize(blob)
	if s == null:
		return {}
	var saved = blob.get("savedAt", 0)
	return {"rating": s.rating, "day": Sim.day_of(s.tick) + 1, "cash": s.cash, "savedAt": saved if typeof(saved) in [TYPE_INT, TYPE_FLOAT] else 0}


static func export_tower(state: Dictionary) -> String:
	return JSON.stringify(Sim.serialize(state), "", false, true)


## A tower from a file's text, or null: the file is untrusted.
static func import_tower(text: String) -> Variant:
	return Sim.deserialize(JSON.parse_string(text))
