# Parity check, Godot side: runs tests/parity_scenarios.json against the GDScript sim with
# the same seeded mulberry32 RNG as tools/parity.mjs and writes the same JSON trace.
#   godot --headless --path godot --script res://tests/parity.gd -- /abs/path/out.json
extends SceneTree

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const Tenants = preload("res://sim/tenants.gd")
const H = preload("res://sim/hashing.gd")
const Draft = preload("res://sim/draft.gd")
const Mulberry = preload("res://sim/mulberry.gd")


static func _sorted_keys(d: Dictionary) -> Array:
	var k := d.keys()
	k.sort()
	return k


static func _by_id(d: Dictionary) -> Dictionary:
	var out := {}
	for k in _sorted_keys(d):
		out[str(k)] = d[k]
	return out


func snap(s: Dictionary, label: String) -> Dictionary:
	var t: Dictionary = s.transit
	var shafts := []
	for sh in t.shafts:
		shafts.append({"col": sh.col, "lo": sh.lo, "hi": sh.hi, "q": sh.queue.size(), "credit": sh.credit, "next": sh.next, "cars": sh.cars})
	var riding := []
	for w in t.riding:
		riding.append({"unit": w.unit, "leg": w.leg, "wait": w.wait, "stress": w.stress})
	var names := []
	for x in s.structures:
		var nm := Tenants.name_of(x)
		var biz := Tenants.tenant_of(x)
		names.append([x.id, nm if nm != "" else null, biz.id if not biz.is_empty() else null])
	# Deep-copied: the trace is written at the end, and live objects keep changing.
	return {
		"label": label,
		"state": Sim.serialize(s).state,
		"derived": {
			"population": s.population, "visitors": s.visitors, "rating": s.rating, "strain": s.strain, "lastNet": s.lastNet,
			"service": _by_id(s.service), "facilities": _sorted_keys(s.facilities), "noisy": _sorted_keys(s.noisy),
			"diners": _by_id(s.diners), "crowds": _by_id(s.crowds), "perks": _by_id(s.perks), "cleaners": _by_id(s.cleaners),
			"inTransit": Sim.in_transit(s), "stats": t.stats, "shafts": shafts, "riding": riding,
			"goals": Sim.guide_goals(s), "needs": Sim.star_needs(s), "mood": Sim.mood_counts(s), "names": names,
		},
	}.duplicate(true)


func run(sc: Dictionary) -> Array:
	var gen := Mulberry.new(int(sc.seed))
	var rng := func() -> float: return gen.next()
	var s := Sim.new_game()
	var out := []
	for op in sc.ops:
		var k: String = op[0]
		var a: Array = op.slice(1)
		var at = func(c, f): return Sim.structure_at(s, int(c), int(f))
		if k == "put" or k == "place":
			if k == "put":
				s.rating = 5
			var r := Sim.place(s, a[0], int(a[1]), int(a[2]))
			out.append({"op": op, "res": {"ok": r.ok, "reason": r.get("reason"), "id": r.structure.id if r.has("structure") else null}})
		elif k == "column":
			var res := []
			for f in range(int(a[2]), int(a[3]) + 1):
				s.rating = 5
				var r := Sim.place(s, a[0], int(a[1]), f)
				res.append("ok" if r.ok else r.reason)
			out.append({"op": op, "res": res})
		elif k == "hours":
			for h in range(1, int(a[0]) + 1):
				var r := Sim.step_hour(s, rng)
				if r.report != null or r.fire != null or r.vip != null or r.left:
					out.append({"op": ["tick", s.tick], "res": {"report": r.report.duplicate(true) if r.report != null else null, "fire": r.fire.id if r.fire != null else null, "vip": r.vip, "left": r.left, "income": r.income, "upkeep": r.upkeep}})
				if h % int(a[1]) == 0:
					out.append(snap(s, "%s@%d" % [sc.name, s.tick]))
		elif k == "car":
			out.append({"op": op, "res": Sim.add_car(s, int(a[0]), int(a[1]))}.duplicate(true))
		elif k == "stop":
			out.append({"op": op, "res": Sim.toggle_stop(s, int(a[0]), int(a[1]))})
		elif k == "rent":
			var x = at.call(a[0], a[1])
			out.append({"op": op, "res": Sim.cycle_rent(s, x.id) if x != null else null})
		elif k == "demolish":
			var x = at.call(a[0], a[1])
			out.append({"op": op, "res": {"preview": Sim.preview_demolish(s, x.id), "done": Sim.demolish(s, x.id)} if x != null else null})
		elif k == "dig":
			out.append({"op": op, "res": Sim.dig(s, int(a[0]))})
		elif k == "fire":
			var x = at.call(a[0], a[1])
			out.append({"op": op, "res": {"ok": Sim.start_fire(s, x.id).ok} if x != null else null})
		elif k == "repair":
			var x = at.call(a[0], a[1])
			out.append({"op": op, "res": Sim.repair(s, x.id) if x != null else null})
		elif k == "rename":
			var x = at.call(a[0], a[1])
			out.append({"op": op, "res": Sim.rename_unit(s, x.id, a[2]) if x != null else null})
		elif k == "cash":
			s.cash = int(a[0])
		elif k == "roundtrip":
			s = Sim.deserialize(JSON.parse_string(JSON.stringify(Sim.serialize(s), "", false, true)))
			out.append(snap(s, "%s:roundtrip" % sc.name))
		elif k == "probe":
			var x = at.call(a[1], a[2])
			var can := Sim.can_place(s, a[0], int(a[1]), int(a[2]))
			var d := Draft.draft_tap(s, null, a[0], int(a[1]), int(a[2]))
			out.append({"op": op, "res": {"can": {"ok": can.ok, "reason": can.get("reason")}, "connects": Sim.connects_here(s, a[0], int(a[1]), int(a[2])),
				"draft": {"place": d.place, "reason": d.reason, "draft": d.draft}, "preview": Sim.preview_demolish(s, x.id) if x != null else null}})
		else:
			push_error("unknown op " + k)
	out.append(snap(s, "%s:end" % sc.name))
	return out


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var spec = JSON.parse_string(FileAccess.get_file_as_string("res://tests/parity_scenarios.json"))
	var g := Mulberry.new(42)
	var rngs := []
	for i in 8:
		rngs.append(g.next())
	var hashes := []
	for p in [[0, 0], [1, 0], [7, 3], [123, 45], [99999, 7], [-5, 2], [2147483647, 1]]:
		hashes.append(H.hash01(p[0], p[1]))
	var cleans := []
	for raw in ["  Kopi \u0007 Club  ", "", "x".repeat(40), "a\tb\n  c", 42]:
		cleans.append(Tenants.clean_name(raw))
	var scen := []
	for sc in spec.scenarios:
		scen.append({"name": sc.name, "trace": run(sc)})
	var f := FileAccess.open(args[0], FileAccess.WRITE)
	f.store_string(JSON.stringify({"extras": {"rng": rngs, "hash": hashes, "clean": cleans}, "scenarios": scen}, "", false, true))
	f.close()
	quit(0)
