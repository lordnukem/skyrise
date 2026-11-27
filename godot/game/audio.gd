# Sound and music, ported from src/audio.js: the MP3s rendered by tools/audio. One looping
# music player follows the festival and the hour; cues play from a small pool so rapid taps
# overlap. The on/off choice is per device. Every play is best-effort.
extends Node

const Storage = preload("res://game/storage.gd")
const SFX_DB := -3.0
const MUSIC_DB := -9.0
const POOL := 3

var on := true
var current := ""
var music := AudioStreamPlayer.new()
var pools := {}


func _ready() -> void:
	on = Storage.get_setting("sound", "on") != "off"
	music.volume_db = MUSIC_DB
	add_child(music)


func set_music(name: String) -> void:
	if name == current:
		return
	current = name
	_start_music()


func _start_music() -> void:
	if not on or current == "":
		music.stop()
		return
	var path := "res://assets/audio/music-%s.mp3" % current
	if not ResourceLoader.exists(path):
		return
	var stream: AudioStreamMP3 = load(path)
	stream.loop = true
	music.stream = stream
	music.play()


func play(name: String) -> void:
	if not on:
		return
	var path := "res://assets/audio/sfx-%s.mp3" % name
	if not ResourceLoader.exists(path):
		return
	var pool: Array = pools.get(name, [])
	var p: AudioStreamPlayer = null
	for q in pool:
		if not q.playing:
			p = q
			break
	if p == null and pool.size() < POOL:
		p = AudioStreamPlayer.new()
		p.stream = load(path)
		p.volume_db = SFX_DB
		add_child(p)
		pool.append(p)
		pools[name] = pool
	if p == null:
		p = pool[0]
	p.play()


func toggle() -> bool:
	on = not on
	Storage.set_setting("sound", "on" if on else "off")
	if on:
		_start_music()
	else:
		music.stop()
	return on
