# Starter round: tap (or use the arrow keys) to steer the orb onto sparks
# before the clock runs out. Everything is drawn in code; no art assets yet.
extends Node2D

const Rules = preload("res://scripts/rules.gd")
const BG := Color("#14161c")
const PLAYER_COLOR := Color("#ff8a3d")
const SPARK_COLOR := Color("#7ee0c3")
const MARGIN := 32.0
const HUD_HEIGHT := 72.0

var rules: Rules
var player_pos := Vector2.ZERO
var target := Vector2.ZERO
var spark := Vector2.ZERO
var rng := RandomNumberGenerator.new()
var label := Label.new()


func _ready() -> void:
	rng.randomize()
	var hud := CanvasLayer.new()
	label.position = Vector2(16, 16)
	label.add_theme_font_size_override("font_size", 22)
	hud.add_child(label)
	add_child(hud)
	new_round()


func new_round() -> void:
	rules = Rules.new()
	player_pos = get_viewport_rect().size / 2
	target = player_pos
	spark = random_spot()


func random_spot() -> Vector2:
	var size := get_viewport_rect().size
	return Vector2(
		rng.randf_range(MARGIN, size.x - MARGIN),
		rng.randf_range(HUD_HEIGHT + MARGIN, size.y - MARGIN))


func _unhandled_input(event: InputEvent) -> void:
	var pressed: bool = event is InputEventScreenTouch and event.pressed
	if pressed and rules.over:
		new_round()
	elif pressed or event is InputEventScreenDrag:
		target = event.position


func _process(delta: float) -> void:
	var keys := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if keys != Vector2.ZERO:
		target = player_pos + keys * 100.0
	rules.tick(delta)
	if not rules.over:
		player_pos = Rules.step_toward(player_pos, target, delta)
		if rules.try_collect(player_pos, spark):
			spark = random_spot()
	if rules.over:
		label.text = "Time! Score %d\nTap to play again" % rules.score
	else:
		label.text = "Score %d   0:%02d" % [rules.score, ceili(rules.time_left)]
	queue_redraw()


func _draw() -> void:
	draw_rect(get_viewport_rect(), BG)
	draw_circle(spark, 10.0, SPARK_COLOR)
	draw_circle(player_pos, 18.0, PLAYER_COLOR)
