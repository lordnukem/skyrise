extends SceneTree
const Sim = preload("res://sim/sim.gd")
func _initialize() -> void:
	var s := Sim.new_game()
	print(s.structures.size(), " ", s.rating, " ", s.cash)
	print(Sim.place(s, "elevator", 15, 1).ok, Sim.place(s, "elevator", 15, 2).ok, Sim.place(s, "office", 16, 2).ok)
	for h in 48:
		Sim.step_hour(s)
	print("cash ", s.cash, " pop ", s.population, " tick ", s.tick)
	print(JSON.stringify(Sim.serialize(s)).length())
	quit(0)
