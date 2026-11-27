# Pure round rules: no nodes, no drawing, so tests/run_tests.gd can check them
# headless. Tuning numbers live here.
extends RefCounted

const ROUND_SECONDS := 30.0
const PICKUP_RADIUS := 28.0
const SPEED := 260.0

var score := 0
var time_left := ROUND_SECONDS
var over := false


func tick(delta: float) -> void:
	if over:
		return
	time_left = maxf(time_left - delta, 0.0)
	if time_left == 0.0:
		over = true


func try_collect(player: Vector2, spark: Vector2) -> bool:
	if over or player.distance_to(spark) > PICKUP_RADIUS:
		return false
	score += 1
	return true


static func step_toward(from: Vector2, to: Vector2, delta: float) -> Vector2:
	return from.move_toward(to, SPEED * delta)
