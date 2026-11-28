# Headless checks. From studio/godot-starter:
#   godot --headless --path . --script res://tests/run_tests.gd
# Exit code is 1 on any failure.
extends SceneTree

const Rules = preload("res://scripts/rules.gd")

var failures := 0


func check(name: String, ok: bool) -> void:
	print(("PASS  " if ok else "FAIL  ") + name)
	if not ok:
		failures += 1


func _initialize() -> void:
	# A script error aborts this coroutine before quit(), so fail on a timer.
	create_timer(10.0).timeout.connect(func():
		print("FAIL  timed out (look for a SCRIPT ERROR above)")
		quit(1))
	var r := Rules.new()
	check("round starts with full clock", r.time_left == Rules.ROUND_SECONDS and not r.over)
	check("spark out of reach is not collected", not r.try_collect(Vector2.ZERO, Vector2(100, 0)))
	check("spark in reach is collected", r.try_collect(Vector2.ZERO, Vector2(20, 0)) and r.score == 1)
	r.tick(10.0)
	check("tick counts down", is_equal_approx(r.time_left, Rules.ROUND_SECONDS - 10.0))
	r.tick(100.0)
	check("clock stops at zero and ends the round", r.time_left == 0.0 and r.over)
	check("no scoring after the round ends", not r.try_collect(Vector2.ZERO, Vector2.ZERO) and r.score == 1)
	var p := Rules.step_toward(Vector2.ZERO, Vector2(1000, 0), 1.0)
	check("movement is capped at SPEED per second", is_equal_approx(p.x, Rules.SPEED))
	check("movement stops at the target", Rules.step_toward(Vector2.ZERO, Vector2(5, 0), 1.0) == Vector2(5, 0))

	# Smoke test: the main scene loads and runs a few frames without errors.
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	for i in 5:
		await process_frame
	check("main scene script loaded", main.get_script() != null)
	check("main scene runs and starts a round", "rules" in main and main.rules != null and not main.rules.over)

	print("%d failure(s)" % failures)
	quit(1 if failures else 0)
