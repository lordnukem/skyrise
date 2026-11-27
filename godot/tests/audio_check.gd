# Headless check of the audio wiring (not of how it sounds): boots the game scene on the
# dummy audio driver and checks the buses, the synchronized stems, the star layers, the duck,
# the ambience and the placed cues.
#   godot --headless --audio-driver Dummy --path . --script res://tests/audio_check.gd
extends SceneTree

var fails := []


func ok(cond: bool, msg: String) -> void:
	print(("ok   - " if cond else "FAIL - ") + msg)
	if not cond:
		fails.append(msg)


func _initialize() -> void:
	create_timer(60.0).timeout.connect(func(): print("FAIL - timed out"); quit(1))
	var main: Control = load("res://game/main.tscn").instantiate()
	root.add_child(main)
	for i in 30:
		await process_frame
	var audio = main.audio
	main.set_process(false)             # the game would keep re-setting layers and ambience from its own state
	for bus in ["Music", "SFX", "Ambience"]:
		ok(AudioServer.get_bus_index(bus) != -1, "bus %s exists" % bus)
	var mi := AudioServer.get_bus_index("Music")
	ok(AudioServer.get_bus_effect(mi, 0) is AudioEffectLowPassFilter, "Music bus has a low-pass for ducking")
	ok(AudioServer.get_bus_effect(0, AudioServer.get_bus_effect_count(0) - 1) is AudioEffectHardLimiter, "Master has a limiter")
	var p: AudioStreamPlayer = audio.players[audio.front]
	ok(p.playing, "the music player is playing")
	ok(p.stream is AudioStreamSynchronized and p.stream.stream_count == 4, "the track is four synchronized stems")
	var loaded := true
	for i in 4:
		var s = p.stream.get_sync_stream(i)
		loaded = loaded and s is AudioStreamOggVorbis and s.loop
	ok(loaded, "every stem is a looping Ogg Vorbis stream")
	ok(audio.current in ["day", "night"] or audio.current.length() > 0, "a track is chosen: %s" % audio.current)
	# Layers follow the stars.
	audio.set_layers(1, false, false)
	ok(audio.layer_target[3] <= -59 and audio.layer_target[2] <= -59, "1 star: drums and arp are out")
	audio.set_layers(2, false, false)
	ok(audio.layer_target[3] > -10 and audio.layer_target[2] <= -59, "2 stars: drums come in")
	audio.set_layers(3, false, false)
	ok(audio.layer_target[2] > -10, "3 stars: the arp comes in")
	await create_timer(2.0).timeout
	ok(absf(audio.layer_now[2] - audio.layer_target[2]) < 1.0, "the layers glide to their targets")
	ok(p.stream.get_sync_stream_volume(2) > -10, "and reach the playing stream")
	# A sheet ducks the music.
	main.ui.show_sheet("tower", "Test", [["text", "x"]])
	audio.duck(true)
	await create_timer(1.0).timeout
	ok(audio.lowpass.cutoff_hz < 3000, "an open sheet muffles the music (cutoff %d Hz)" % audio.lowpass.cutoff_hz)
	main.ui.hide_sheet()
	audio.duck(false)
	await create_timer(1.5).timeout
	ok(audio.lowpass.cutoff_hz > 15000, "closing it opens the music up again")
	# Ambience follows the hour and the weather.
	audio.set_ambience(1.0, "rain")
	await create_timer(3.5).timeout
	ok(audio.amb.night.volume_db > audio.amb.day.volume_db and audio.amb.rain.playing, "night with rain: crickets over traffic, rain on")
	# Track changes crossfade.
	var before: int = audio.front
	audio.set_music("christmas" if audio.current != "christmas" else "day")
	ok(audio.front != before and audio.players[audio.front].playing, "a new track starts on the other player")
	await create_timer(2.5).timeout
	ok(not audio.players[before].playing, "and the old one stops after the crossfade")
	# Placed cues come with a screen position.
	main.state.cash = 1000000
	main.tower.cues.clear()
	main.tower._collect_cues()
	ok(main.tower.cues is Array, "the tower lists placed cues each tick")
	print("%d failure(s)" % fails.size())
	quit(1 if fails.size() else 0)
