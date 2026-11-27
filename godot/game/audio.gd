# Sound: the chiptune stems, ambience and cues made by tools/chiptune/render.py, mixed live.
#
#   Music     each track's four stems (lead, bass, arp, drums) play in sync in one
#             AudioStreamSynchronized. The tower's growth brings layers in: drums from 2 stars,
#             the arp from 3; weekday rush hours lift the energy. Changing track (day, night, a
#             festival) crossfades over two seconds. A low-pass filter muffles the music while
#             a sheet is open.
#   Ambience  day traffic and birds, night crickets and rain, crossfaded by the hour and weather.
#   SFX       a small pool per cue; cues tied to a place in the tower (coins, lift dings, a
#             tenant moving in) play from an AudioStreamPlayer2D at that point on screen, so
#             they pan left and right.
# The on/off choice is per device. Every play is best-effort.
extends Node

const Storage = preload("res://game/storage.gd")
const DIR := "res://assets/chip/"
const STEMS := ["lead", "bass", "arp", "drums"]
const SFX_DB := -4.0
const MUSIC_DB := -8.0
const AMB_DB := -14.0
const POOL := 3
const FADE_S := 2.0
const SILENT := -60.0

var on := true
var current := ""
var players: Array[AudioStreamPlayer] = []       # two music players, for crossfades
var front := 0
var amb := {}                                     # name -> AudioStreamPlayer
var pools := {}
var spatial := []                                 # AudioStreamPlayer2D pool for placed cues
var layer_target := [0.0, 0.0, SILENT, SILENT]     # dB per stem
var layer_now := [0.0, 0.0, SILENT, SILENT]
var amb_target := {"day": SILENT, "night": SILENT, "rain": SILENT}
var duck_target := 20000.0
var lowpass: AudioEffectLowPassFilter
var music_bus := -1
var fade := 1.0                                   # 0..1 progress of the current crossfade


func _ready() -> void:
	on = Storage.get_setting("sound", "on") != "off"
	_buses()
	for i in 2:
		var p := AudioStreamPlayer.new()
		p.bus = "Music"
		p.volume_db = SILENT
		add_child(p)
		players.append(p)
	for name in ["day", "night", "rain"]:
		var p := AudioStreamPlayer.new()
		p.bus = "Ambience"
		p.volume_db = SILENT
		var s = _load("amb-%s.ogg" % name)
		if s:
			s.loop = true
			p.stream = s
		add_child(p)
		amb[name] = p
	for i in 6:
		var p := AudioStreamPlayer2D.new()
		p.bus = "SFX"
		p.max_distance = 4000
		p.attenuation = 0.4
		add_child(p)
		spatial.append(p)


## Music, SFX and Ambience buses under Master, a limiter on Master and a low-pass on Music.
func _buses() -> void:
	for name in ["Music", "SFX", "Ambience"]:
		if AudioServer.get_bus_index(name) == -1:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, name)
			AudioServer.set_bus_send(i, "Master")
	music_bus = AudioServer.get_bus_index("Music")
	lowpass = AudioEffectLowPassFilter.new()
	lowpass.cutoff_hz = 20000
	AudioServer.add_bus_effect(music_bus, lowpass)
	var limit := AudioEffectHardLimiter.new()
	limit.ceiling_db = -1.0
	AudioServer.add_bus_effect(0, limit)


func _load(file: String) -> Variant:
	var path := DIR + file
	return load(path) if ResourceLoader.exists(path) else null


func _track_stream(name: String) -> AudioStreamSynchronized:
	var sync := AudioStreamSynchronized.new()
	sync.stream_count = STEMS.size()
	for i in STEMS.size():
		var s = _load("music-%s-%s.ogg" % [name, STEMS[i]])
		if s:
			s.loop = true
			sync.set_sync_stream(i, s)
		sync.set_sync_stream_volume(i, layer_now[i])
	return sync


func set_music(name: String) -> void:
	if name == current:
		return
	current = name
	if not on:
		return
	# Crossfade: the back player starts the new track and fades in as the front fades out.
	front = 1 - front
	var p := players[front]
	p.stream = _track_stream(name)
	p.volume_db = SILENT
	p.play()
	fade = 0.0


## The layers follow the tower: stars bring in drums (2) and the arp (3); a rush hour lifts both.
func set_layers(stars: int, rush: bool, night: bool) -> void:
	layer_target[0] = 0.0
	layer_target[1] = 0.0
	layer_target[3] = (-2.0 if not night else -6.0) if stars >= 2 or rush else SILENT
	layer_target[2] = (-3.0 if not rush else 0.0) if stars >= 3 else (-10.0 if rush else SILENT)


func set_ambience(night: float, weather: String) -> void:
	var wet := weather == "rain" or weather == "snow"
	amb_target.day = linear_to_db(maxf(0.001, (1.0 - night) * (0.6 if wet else 1.0)))
	amb_target.night = linear_to_db(maxf(0.001, night * (0.6 if wet else 1.0)))
	amb_target.rain = 0.0 if weather == "rain" else SILENT


## Muffle the music behind a sheet (a report, the tower, the menu's sheets).
func duck(on_: bool) -> void:
	duck_target = 900.0 if on_ else 20000.0


func _process(delta: float) -> void:
	if not on:
		return
	# Crossfade the two music players.
	if fade < 1.0:
		fade = minf(1.0, fade + delta / FADE_S)
	var fp := players[front]
	var bp := players[1 - front]
	fp.volume_db = MUSIC_DB + linear_to_db(maxf(0.001, fade))
	bp.volume_db = MUSIC_DB + linear_to_db(maxf(0.001, 1.0 - fade))
	if fade >= 1.0 and bp.playing:
		bp.stop()
	# Layers glide toward their targets (about a second for a full swing).
	var sync = fp.stream
	for i in STEMS.size():
		layer_now[i] = move_toward(layer_now[i], layer_target[i], delta * 40.0)
		if sync is AudioStreamSynchronized:
			sync.set_sync_stream_volume(i, layer_now[i])
	for name in amb:
		var p: AudioStreamPlayer = amb[name]
		var target: float = AMB_DB + amb_target[name] if amb_target[name] > SILENT else SILENT
		p.volume_db = move_toward(p.volume_db, target, delta * 20.0)
		if p.volume_db > SILENT + 1 and not p.playing and p.stream:
			p.play()
		elif p.volume_db <= SILENT + 0.5 and p.playing:
			p.stop()
	lowpass.cutoff_hz = lerpf(lowpass.cutoff_hz, duck_target, minf(1.0, delta * 6.0))


func play(name: String, volume_db: float = 0.0) -> void:
	if not on:
		return
	var s = _load("sfx-%s.ogg" % name)
	if s == null:
		return
	var pool: Array = pools.get(name, [])
	var p: AudioStreamPlayer = null
	for q in pool:
		if not q.playing:
			p = q
			break
	if p == null and pool.size() < POOL:
		p = AudioStreamPlayer.new()
		p.stream = s
		p.bus = "SFX"
		add_child(p)
		pool.append(p)
		pools[name] = pool
	if p == null:
		p = pool[0]
	p.volume_db = SFX_DB + volume_db
	p.play()


## A cue from a point on screen: it pans with its position.
func play_at(name: String, pos: Vector2, volume_db: float = 0.0) -> void:
	if not on:
		return
	var s = _load("sfx-%s.ogg" % name)
	if s == null:
		return
	for p in spatial:
		if not p.playing:
			p.stream = s
			p.position = pos
			p.volume_db = SFX_DB + volume_db
			p.play()
			return


func toggle() -> bool:
	on = not on
	Storage.set_setting("sound", "on" if on else "off")
	if on:
		var name := current
		current = ""
		set_music(name)
	else:
		for p in players:
			p.stop()
		for p in amb.values():
			p.stop()
	return on
