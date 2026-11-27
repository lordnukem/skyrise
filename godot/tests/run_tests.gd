# Headless unit tests for the GDScript sim, ported from tests/run.js (the sim-level ones;
# tests/parity.gd checks whole runs against the JS build). From godot/:
#   godot --headless --path . --script res://tests/run_tests.gd
# Exit code 1 on any failure. A test ends with `return true`; one that a script error
# cuts short returns null and counts as failed, and a watchdog fails a hung run.
extends SceneTree

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")
const Draft = preload("res://sim/draft.gd")
const Tenants = preload("res://sim/tenants.gd")
const H = preload("res://sim/hashing.gd")
const Seasons = preload("res://sim/seasons.gd")
const Mulberry = preload("res://sim/mulberry.gd")

const LOBBY_LEFT := 16
const RIGHT := LOBBY_LEFT + C.START_LOBBY_WIDTH
const SKY := 1 + C.SKY_LOBBY_EVERY
const QT := C.DAYS_PER_QUARTER * C.HOURS_PER_DAY

var failures := []
var current := ""


func always() -> float:
	return 0.01


func never() -> float:
	return 1.0


func ok(cond: bool, msg: String = "") -> void:
	if not cond:
		failures.append("%s: %s" % [current, msg if msg != "" else "expected true"])


func eq(a: Variant, b: Variant, msg: String = "") -> void:
	var same: bool = a == b
	if typeof(a) in [TYPE_INT, TYPE_FLOAT] and typeof(b) in [TYPE_INT, TYPE_FLOAT]:
		same = is_equal_approx(float(a), float(b))
	if not same:
		failures.append("%s: %s (got %s, want %s)" % [current, msg, str(a), str(b)])


func must(res: Dictionary) -> Dictionary:
	if not res.ok:
		failures.append("%s: must failed: %s" % [current, res.get("reason", "?")])
	return res


func put(s: Dictionary, type: String, col: int, f: int) -> Dictionary:
	s.rating = 5
	return must(Sim.place(s, type, col, f))


func column(s: Dictionary, type: String, col: int, lo: int, hi: int) -> void:
	for f in range(lo, hi + 1):
		put(s, type, col, f)


func roundtrip(s: Dictionary) -> Variant:
	return Sim.deserialize(JSON.parse_string(JSON.stringify(Sim.serialize(s))))


func office_tower(shafts: int) -> Dictionary:
	var s := Sim.new_game()
	s.cash = 1000000
	for f in range(1, 12):
		must(Sim.place(s, "elevator", RIGHT, f))
		if shafts > 1:
			must(Sim.place(s, "elevator", RIGHT + 1 + 3, f))
		must(Sim.place(s, "office", RIGHT + 1, f))
	return s


func upper_offices(s: Dictionary) -> Array:
	return s.structures.filter(func(x): return x.type == "office" and x.floor > 1)


# ---- Tests -----------------------------------------------------------------

func t_new_game() -> bool:
	var s := Sim.new_game()
	eq(s.cash, C.START_CASH, "cash")
	eq(s.structures.size(), C.START_LOBBY_WIDTH, "lobby cells")
	eq(Sim.reachable(s).size(), C.START_LOBBY_WIDTH, "all reachable")
	return true


func t_support() -> bool:
	var s := Sim.new_game()
	eq(Sim.place(s, "office", LOBBY_LEFT, 3).ok, false, "floats")
	eq(Sim.place(s, "lobby", 0, 2).ok, false, "lobby on floor 2")
	must(Sim.place(s, "office", LOBBY_LEFT, 2))
	eq(Sim.place(s, "office", LOBBY_LEFT, 2).ok, false, "overlap")
	eq(Sim.place(s, "office", C.GRID_WIDTH - 1, 1).ok, false, "outside the plot")
	return true


func t_connectivity() -> bool:
	var s := Sim.new_game()
	var office: Dictionary = must(Sim.place(s, "office", LOBBY_LEFT, 2)).structure
	ok(not Sim.reachable(s).has(office.id), "no path yet")
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	ok(Sim.reachable(s).has(office.id), "stairs make a path")
	var s2 := Sim.new_game()
	for f in [1, 2, 3]:
		must(Sim.place(s2, "elevator", RIGHT, f))
	var flat2: Dictionary = must(Sim.place(s2, "flat", RIGHT - 2, 2)).structure
	var flat3: Dictionary = must(Sim.place(s2, "flat", RIGHT - 2, 3)).structure
	ok(Sim.reachable(s2).has(flat2.id) and Sim.reachable(s2).has(flat3.id), "both flats reached")
	must(Sim.demolish(s2, Sim.structure_at(s2, RIGHT, 3).id))
	must(Sim.demolish(s2, Sim.structure_at(s2, RIGHT, 2).id))
	ok(not Sim.reachable(s2).has(flat3.id), "a gap in the shaft breaks the path")
	return true


func t_unreachable_and_cut_off() -> bool:
	var s := Sim.new_game()
	var office: Dictionary = must(Sim.place(s, "office", LOBBY_LEFT, 2)).structure
	var before: int = s.cash
	var r := Sim.step_tick(s, always)
	ok(not office.occupied, "never fills")
	eq(r.income, 0, "no income")
	eq(s.cash, before, "cash unchanged")
	var s2 := Sim.new_game()
	var stairs: Dictionary = must(Sim.place(s2, "stairs", LOBBY_LEFT - 1, 1)).structure
	var o2: Dictionary = must(Sim.place(s2, "office", LOBBY_LEFT, 2)).structure
	Sim.step_tick(s2, always)
	ok(o2.occupied, "moves in")
	must(Sim.demolish(s2, stairs.id))
	Sim.step_tick(s2, always)
	ok(not o2.occupied, "leaves when the path goes")
	return true


func t_economy() -> bool:
	var s := Sim.new_game()
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	must(Sim.place(s, "office", LOBBY_LEFT, 2))
	must(Sim.place(s, "flat", LOBBY_LEFT + 3, 2))
	must(Sim.place(s, "shop", LOBBY_LEFT + 5, 2))
	must(Sim.place(s, "elevator", RIGHT, 1))
	var before: int = s.cash
	var r := Sim.step_tick(s, always)
	var pop: int = C.TYPES.office.people + C.TYPES.flat.people
	var visitors: int = C.SHOP_WALKINS + int(floor(pop * C.SHOP_VISITOR_RATIO))
	var income: int = C.TYPES.office.rent + C.TYPES.flat.price + C.TYPES.shop.perVisitor * visitors
	eq(s.population, pop, "population")
	eq(s.visitors, visitors, "visitors")
	eq(r.income, income, "income")
	eq(r.upkeep, C.TYPES.elevator.upkeep, "upkeep")
	eq(s.cash, before + income - C.TYPES.elevator.upkeep, "cash")
	eq(s.tick, 1, "tick")
	return true


func t_cash_and_demolish() -> bool:
	var s := Sim.new_game()
	var st: Dictionary = must(Sim.place(s, "flat", LOBBY_LEFT, 2)).structure
	eq(s.cash, C.START_CASH - C.TYPES.flat.cost, "spent")
	must(Sim.demolish(s, st.id))
	eq(s.cash, C.START_CASH - C.TYPES.flat.cost / 2, "half back")
	s.cash = 10
	eq(Sim.place(s, "flat", LOBBY_LEFT, 2).ok, false, "cannot afford")
	var s2 := Sim.new_game()
	must(Sim.place(s2, "flat", LOBBY_LEFT, 2))
	eq(Sim.demolish(s2, Sim.structure_at(s2, LOBBY_LEFT, 1).id).ok, false, "something on top")
	var s3 := Sim.new_game()
	for x in s3.structures.slice(1):
		must(Sim.demolish(s3, x.id))
	eq(Sim.demolish(s3, s3.structures[0].id).ok, false, "the last lobby stays")
	return true


func t_rating() -> bool:
	var all := {"security": true, "clinic": true, "plant": true, "transit": true}
	eq(Sim.compute_rating(0, 0, 0, all), 1)
	eq(Sim.compute_rating(C.STAR_POP[0], 0, 0, all), 2)
	eq(Sim.compute_rating(C.STAR_POP[3], 0, 0, all), 5)
	eq(Sim.compute_rating(C.STAR_POP[3], 1.5, 0, all), 4, "strain costs a star")
	eq(Sim.compute_rating(C.STAR_POP[3], 1.5, 0.5, all), 3, "vacancy costs another")
	eq(Sim.compute_rating(0, 2, 1, all), 1, "never below one")
	eq(Sim.compute_rating(C.STAR_POP[3], 0, 0, {}), 2, "no security caps at 2")
	return true


func t_save_roundtrip() -> bool:
	var s := office_tower(1)
	for i in 12:
		Sim.step_tick(s, always)
	s.tick = QT - 1
	var r := Sim.step_tick(s, always)
	ok(r.report != null and is_same(s.lastReport, r.report), "the quarter closed")
	eq(r.report.quarter, 1, "quarter 1")
	eq(s.quarter.upkeep, 0, "accumulator reset")
	Sim.step_tick(s, always)
	var back = roundtrip(s)
	ok(back != null, "loads")
	eq(back.cash, s.cash, "cash")
	eq(back.structures.map(func(x): return snappedf(x.happy, 1e-9)), s.structures.map(func(x): return snappedf(x.happy, 1e-9)), "happiness")
	eq(JSON.stringify(back.quarter), JSON.stringify(s.quarter), "quarter")
	eq(back.population, s.population, "derived recomputed")
	Sim.step_tick(s, always)
	Sim.step_tick(back, always)
	eq(back.cash, s.cash, "keeps simulating identically")
	return true


func t_corrupt_saves() -> bool:
	eq(Sim.deserialize(null), null, "null")
	eq(Sim.deserialize("garbage"), null, "string")
	eq(Sim.deserialize({"version": 99, "state": {}}), null, "future version")
	eq(Sim.deserialize({"version": 1, "state": {"cash": 1, "tick": 0, "nextId": 1, "structures": "nope"}}), null, "structures not a list")
	eq(Sim.deserialize({"version": 1, "state": {"cash": "rich", "tick": 0, "nextId": 1, "structures": []}}), null, "cash not a number")
	eq(Sim.deserialize({"version": 1, "state": {"cash": 1, "tick": 0, "nextId": 2, "structures": [{"id": 1, "type": "casino", "col": 0, "floor": 1}]}}), null, "unknown type")
	eq(Sim.deserialize({"version": 1, "state": {"cash": 1, "tick": 0, "nextId": 1, "structures": []}}), null, "no lobby")
	eq(Sim.deserialize({"version": 7, "state": {"cash": 1, "tick": 0.5, "nextId": 1, "structures": []}}), null, "fractional tick")
	return true


func t_old_saves() -> bool:
	var rows := []
	for i in C.START_LOBBY_WIDTH:
		rows.append({"id": i + 1, "type": "lobby", "col": LOBBY_LEFT + i, "floor": 1, "occupied": false})
	rows.append({"id": 9, "type": "stairs", "col": LOBBY_LEFT - 1, "floor": 1, "occupied": false})
	rows.append({"id": 10, "type": "office", "col": LOBBY_LEFT, "floor": 2, "occupied": true})
	var v1 = Sim.deserialize(JSON.parse_string(JSON.stringify({"version": 1, "savedAt": 0, "state": {"width": 40, "maxFloors": 30, "cash": 500, "tick": 40, "nextId": 11, "structures": rows}})))
	ok(v1 != null, "v1 loads")
	eq(v1.cash, 500, "cash")
	ok(typeof(v1.cash) == TYPE_INT, "cash stays an int after JSON")
	ok(v1.structures.all(func(x): return x.happy == C.HAPPY_NEUTRAL and x.unhappy == 0 and x.cars == 0 and x.rentLevel == "normal"), "defaults")
	eq(v1.quarter.starsAt, v1.rating, "starsAt from the rating")
	eq(v1.population, C.TYPES.office.people, "population")
	eq(v1.maxFloors, C.MAX_FLOORS, "maxFloors is always MAX_FLOORS")
	Sim.step_tick(v1, always)
	# A v6 save at 4 stars keeps them (VIP grandfathering); a small v6 tower gets no review.
	var small = Sim.deserialize({"version": 6, "state": {"cash": 500, "tick": 7, "nextId": 2, "structures": [{"id": 1, "type": "lobby", "col": LOBBY_LEFT, "floor": 1}]}})
	ok(small != null and small.vip == null, "a small v6 tower has no review")
	# Below the dug basement: refused.
	eq(Sim.deserialize({"version": 7, "state": {"cash": 1, "tick": 0, "nextId": 3, "dug": 0, "structures": [{"id": 1, "type": "lobby", "col": 16, "floor": 1}, {"id": 2, "type": "shop", "col": 16, "floor": 0}]}}), null, "below the dug level")
	return true


func t_span_and_cars() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	column(s, "elevator", RIGHT, 1, 1 + C.LIFT_MAX_SPAN)
	var r := Sim.place(s, "elevator", RIGHT, 2 + C.LIFT_MAX_SPAN)
	eq(r.ok, false, "too tall")
	ok(str(r.get("reason")).contains("spans at most"), "reason")
	eq(Sim.shafts_of(s).size(), 1, "one shaft")
	var before: int = s.cash
	must(Sim.add_car(s, RIGHT, 3))
	eq(s.cash, before - C.LIFT_CAR_COST, "a car costs")
	eq(Sim.shafts_of(s)[0].cars, 2, "two cars")
	for i in range(2, C.LIFT_MAX_CARS):
		must(Sim.add_car(s, RIGHT, 1))
	eq(Sim.add_car(s, RIGHT, 1).ok, false, "car cap")
	eq(Sim.add_car(s, LOBBY_LEFT, 1).ok, false, "not a lift")
	return true


func t_express_and_sky_lobby() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	column(s, "express", RIGHT, 1, SKY)
	for f in range(1, SKY):
		must(Sim.place(s, "office", RIGHT + 1, f))
	must(Sim.place(s, "lobby", RIGHT + 1, SKY))
	var flat: Dictionary = must(Sim.place(s, "flat", RIGHT + 2, SKY)).structure
	var r := Sim.reachable(s)
	ok(r.has(flat.id), "the sky-lobby floor is reached")
	ok(s.structures.filter(func(x): return x.type == "office" and x.floor > 1).all(func(o): return not r.has(o.id)), "the express opens only on lobby floors")
	must(Sim.demolish(s, s.structures.filter(func(x): return x.type == "lobby" and x.floor == SKY)[0].id))
	ok(not Sim.reachable(s).has(flat.id), "sealed without the sky lobby")
	return true


func t_star_gates() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	for c in [RIGHT, RIGHT + 1, RIGHT + 2]:
		column(s, "elevator", c, 1, 8)
	for f in range(1, 9):
		must(Sim.place(s, "office", RIGHT + 3, f))
		must(Sim.place(s, "office", RIGHT + 6, f))
	Sim.step_tick(s, always)
	ok(s.population >= C.STAR_POP[1], "population %d" % s.population)
	eq(s.rating, 2, "capped at 2 without security")
	must(Sim.place(s, "security", RIGHT + 9, 1))
	Sim.step_tick(s, always)
	ok(s.rating >= 3, "3 stars with security")
	var t := Sim.new_game()
	t.cash = 1000000
	var lr := Sim.place(t, "express", RIGHT, 1)
	eq(lr.reason, "Unlocks at %d stars" % C.UNLOCK_AT.express, "locked tool")
	return true


func t_flat_sale_and_rent() -> bool:
	var s := Sim.new_game()
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	var flat: Dictionary = must(Sim.place(s, "flat", LOBBY_LEFT, 2)).structure
	eq(Sim.step_tick(s, always).income, C.TYPES.flat.price, "the sale")
	eq(Sim.step_tick(s, always).income, 0, "no hourly rent after the sale")
	flat.occupied = false
	eq(Sim.step_tick(s, always).income, 0, "the resale goes to the old owner")
	var s2 := Sim.new_game()
	must(Sim.place(s2, "stairs", LOBBY_LEFT - 1, 1))
	var office: Dictionary = must(Sim.place(s2, "office", LOBBY_LEFT, 2)).structure
	must(Sim.cycle_rent(s2, office.id))
	eq(office.rentLevel, "high", "normal -> high")
	eq(Sim.step_tick(s2, always).income, H.js_round(C.TYPES.office.rent * C.RENT_LEVELS.high.take), "high rent")
	eq(roundtrip(s2).structures.filter(func(x): return x.id == office.id)[0].rentLevel, "high", "rent survives a save")
	return true


func t_lift_wait_by_hour() -> bool:
	var s := office_tower(1)
	Sim.step_tick(s, always)
	var top: Dictionary = upper_offices(s)[-1]
	var reach := Sim.reachable(s)
	ok(Sim.lift_service(s, reach, 8, false)[top.id].wait >= C.WAIT_BUSY, "busy at 08:00")
	ok(Sim.lift_service(s, reach, 3, false)[top.id].wait < C.WAIT_BUSY, "idle at 03:00")
	ok(Sim.lift_service(s, reach, 8, true)[top.id].wait < C.WAIT_BUSY, "quiet at weekends")
	var left := 0
	for i in 72:
		left += Sim.step_tick(s, always).left
	eq(left, 0, "one shaft does not evict within three days")
	ok(upper_offices(s).all(func(o): return Sim.happy_band(o.happy) == "fair"), "one shaft: fair")
	var s2 := office_tower(2)
	for i in 24:
		Sim.step_tick(s2, always)
	ok(upper_offices(s2).all(func(o): return Sim.happy_band(o.happy) == "good"), "two shafts: good")
	return true


func t_agents() -> bool:
	var s := office_tower(1)
	var g := Mulberry.new(1)
	var rng := func() -> float: return g.next()
	var most := 0
	for i in 48:
		Sim.step_hour(s, rng)
		most = maxi(most, Sim.in_transit(s))
		ok(Sim.in_transit(s) <= s.population, "in transit <= population")
	ok(s.transit.stats.trips > 100, "trips %d" % s.transit.stats.trips)
	# Queues form at the 08:00 rush on a weekday.
	s.tick = 7 * 24 + 8
	var q := 0
	for k in C.WALK_STEPS:
		Sim.step_walkers(s, rng)
		q = maxi(q, Sim.in_transit(s))
	ok(q > 0, "queue at 08:00")
	eq(Sim.stress_band(0.9), "stressed")
	eq(Sim.stress_band(0.5), "tense")
	eq(Sim.stress_band(0.1), "calm")
	return true


func t_hotel() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	var room: Dictionary = put(s, "hotel", LOBBY_LEFT, 2).structure
	s.tick = 17
	Sim.step_tick(s, always)
	ok(not room.occupied, "no check-in at 17:00")
	Sim.step_tick(s, always)
	ok(room.occupied, "checks in at 18:00")
	s.tick = 24 + 10
	var before: int = s.quarter.income.hotel
	Sim.step_tick(s, never)
	ok(not room.occupied and room.dirty, "out by 10:00 and dirty")
	eq(s.quarter.income.hotel - before, Sim.nightly_of(room), "paid at checkout")
	s.tick = 24 + 18
	Sim.step_tick(s, always)
	ok(not room.occupied, "a dirty room cannot be let")
	put(s, "housekeeping", LOBBY_LEFT + 2, 2)
	Sim.step_tick(s, always)
	ok(not room.dirty, "housekeeping cleans it")
	return true


func t_basement() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	eq(Sim.dig(s, -1).reason, "Dig the level above first")
	must(Sim.dig(s, 0))
	eq(Sim.dig(s, 0).reason, "Already dug")
	eq(Sim.dig(s, 1).reason, "Dig below the ground floor")
	ok(str(Sim.place(s, "office", LOBBY_LEFT, 0).reason).contains("cannot go underground"), "offices stay above ground")
	ok(str(Sim.place(s, "parking", RIGHT, 1).reason).contains("goes in the basement"), "car parks go below")
	put(s, "parking", LOBBY_LEFT, 0)
	eq(Sim.floor_name(0), "B1")
	eq(Sim.floor_name(-1), "B2")
	eq(Sim.floor_name(3), "floor 3")
	var back = roundtrip(s)
	eq(back.dug, 1, "dug survives a save")
	return true


func t_fire_and_repair() -> bool:
	var s := Sim.new_game()
	s.cash = 1000000
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	var o: Dictionary = must(Sim.place(s, "office", LOBBY_LEFT, 2)).structure
	Sim.step_tick(s, always)
	must(Sim.start_fire(s, o.id))
	eq(Sim.demolish(s, o.id).reason, "It is on fire")
	for i in C.FIRE_BURN_TICKS + 1:
		Sim.step_tick(s, never)
	ok(o.burnt and not o.occupied, "burns to a shell without security")
	eq(Sim.refund_of(o), 0, "a shell is worth nothing")
	var r := must(Sim.repair(s, o.id))
	eq(r.cost, Sim.repair_cost(o), "repair cost")
	ok(not o.burnt, "repaired")
	var t := Sim.new_game()
	t.cash = 1000000
	must(Sim.place(t, "stairs", LOBBY_LEFT - 1, 1))
	var o2: Dictionary = must(Sim.place(t, "office", LOBBY_LEFT, 2)).structure
	put(t, "security", RIGHT, 1)
	Sim.step_tick(t, always)
	var happy: float = o2.happy
	Sim.start_fire(t, o2.id)
	for i in C.FIRE_OUT_TICKS + 1:
		Sim.step_tick(t, never)
	ok(o2.fire == 0 and not o2.burnt, "security puts it out")
	ok(o2.happy < happy, "the tenants come back scared")
	return true


func t_vip() -> bool:
	var vip_tick := (C.VIP_DAY - 1) * 24 + C.VIP_HOUR
	var s := Sim.new_game()
	s.cash = 1000000
	var room: Dictionary = put(s, "hotel", RIGHT, 1).structure
	s.tick = vip_tick
	room.happy = C.HAPPY_GOOD - 5
	eq(Sim.step_tick(s, never).vip, "poor", "a fair room")
	s.tick = QT + vip_tick
	room.happy = C.HAPPY_GOOD
	eq(Sim.step_tick(s, never).vip, "good", "a good room")
	var t := Sim.new_game()
	t.tick = vip_tick
	eq(Sim.step_tick(t, never).vip, null, "no visit without rooms")
	t.vip = {"review": "good", "quarter": 1}
	t.tick = QT + vip_tick
	eq(Sim.step_tick(t, never).vip, "poor", "a good review is lost with the rooms")
	return true


func t_loan() -> bool:
	var s := Sim.new_game()
	s.cash = -500
	s.tick = QT - 1
	var r := Sim.step_tick(s, never)
	eq(r.report.borrowed, C.LOAN_AMOUNT, "borrowed")
	eq(s.loan.owed, H.js_round(C.LOAN_AMOUNT * C.LOAN_INTEREST), "owed")
	eq(s.cash, -500 + C.LOAN_AMOUNT, "cash")
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	must(Sim.place(s, "office", LOBBY_LEFT, 2))
	var before: int = s.cash
	Sim.step_tick(s, always)
	var pay := H.js_round(C.TYPES.office.rent * C.LOAN_REPAY_SHARE)
	eq(s.cash, before + C.TYPES.office.rent - pay, "repays a share")
	s.loan = {"owed": 1000}
	s.cash = -10000
	s.tick = 2 * QT - 1
	var o := Sim.step_tick(s, never)
	ok(s.over and o.report.over, "game over")
	var tick: int = s.tick
	eq(Sim.step_hour(s, always).net, 0, "the clock stops")
	eq(s.tick, tick, "no tick")
	ok(roundtrip(s).over, "over survives a save")
	return true


func t_landmark_five_stars() -> bool:
	var s := Sim.new_game()
	s.cash = 100000000
	ok(str(Sim.place(s, "landmark", 3, 1).reason).contains("Unlocks at 5 stars"), "locked")
	must(Sim.dig(s, 0))
	put(s, "stairs", RIGHT, 0)
	put(s, "transit", RIGHT + 1, 0)
	put(s, "floor", 1, 1)
	for f in range(1, 60, 2):
		put(s, "stairs", 2, f)
	for f in range(2, 59, 2):
		put(s, "stairs", 1, f)
	column(s, "elevator", 15, 1, 16)
	column(s, "elevator", RIGHT + 1, 1, 16)
	column(s, "elevator", RIGHT + 2, 1, 16)
	for c in [15, RIGHT + 1, RIGHT + 2]:
		for k in 3:
			must(Sim.add_car(s, c, 1))
	for f in range(1, 17):
		for c in [3, 6, 9, 12, RIGHT + 3, RIGHT + 6, RIGHT + 9]:
			put(s, "office", c, f)
	put(s, "security", RIGHT + 12, 1)
	put(s, "clinic", RIGHT + 14, 1)
	put(s, "plant", RIGHT + 12, 2)
	for f in range(17, 60):
		for c in range(3, 15):
			put(s, "floor", c, f)
	s.rating = 5
	ok(str(Sim.place(s, "landmark", 3, 30).reason).contains("floor 60 or higher"), "too low")
	s.vip = {"review": "good", "quarter": 1}
	Sim.step_tick(s, always)
	eq(s.rating, 5, "five stars")
	eq(s.wonAt, null, "not crowned yet")
	var visitors: int = s.visitors
	var lm: Dictionary = must(Sim.place(s, "landmark", 3, 60)).structure
	ok(Sim.reachable(s).has(lm.id), "reached by the stairs")
	eq(s.visitors, visitors + C.LANDMARK_VISITORS, "visitors")
	eq(s.wonAt, s.tick, "crowned")
	ok(str(Sim.place(s, "office", 10, 70).reason).contains("Nothing goes above"), "nothing above")
	ok(str(Sim.can_demolish(s, lm).reason).contains("crown"), "it stays")
	var back = roundtrip(s)
	eq(back.wonAt, s.wonAt, "crown survives a save")
	return true


func t_draft_and_paths() -> bool:
	var s := Sim.new_game()
	var d := Draft.draft_tap(s, null, "office", LOBBY_LEFT, 2)
	eq(d.place, false, "first tap drafts")
	eq(s.structures.size(), C.START_LOBBY_WIDTH, "a draft writes nothing")
	eq(Draft.draft_tap(s, d.draft, "office", LOBBY_LEFT, 2).place, true, "second tap places")
	eq(Draft.draft_tap(s, d.draft, "office", LOBBY_LEFT + 1, 2).place, false, "another cell moves the draft")
	eq(Draft.draft_tap(s, null, "office", LOBBY_LEFT, 3).reason, "Needs a floor beneath it", "invalid tap")
	must(Sim.place(s, "elevator", LOBBY_LEFT - 1, 1))
	eq(Draft.draft_tap(s, null, "elevator", LOBBY_LEFT - 1, 2).place, true, "a shaft extends on one tap")
	eq(Sim.place(s, "elevator", LOBBY_LEFT, 1).reason, "Build the lift beside the lobby, not on it", "lobby message")
	var t := Sim.new_game()
	ok(not Sim.connects_here(t, "elevator", LOBBY_LEFT, 2), "a lift on the lobby never reaches it")
	ok(Sim.connects_here(t, "elevator", LOBBY_LEFT - 1, 1), "beside the lobby")
	ok(Sim.connects_here(t, "floor", RIGHT + 5, 2), "slabs are never warned about")
	eq(t.structures.size(), C.START_LOBBY_WIDTH, "asking leaves the state alone")
	return true


func t_guide_and_needs() -> bool:
	var s := Sim.new_game()
	eq(Sim.guide_goals(s), [false, false, false], "nothing met")
	must(Sim.place(s, "elevator", RIGHT, 1))
	must(Sim.place(s, "elevator", RIGHT, 2))
	eq(Sim.guide_goals(s)[0], true, "the lift goal")
	var needs := Sim.star_needs(s)
	eq(needs.next, 2)
	ok(needs.needs.any(func(n): return n.id == "pop" and not n.met), "population missing")
	return true


func t_mood_counts() -> bool:
	var s := Sim.new_game()
	must(Sim.place(s, "stairs", LOBBY_LEFT - 1, 1))
	var a: Dictionary = must(Sim.place(s, "office", LOBBY_LEFT, 2)).structure
	var b: Dictionary = must(Sim.place(s, "flat", LOBBY_LEFT + 3, 2)).structure
	a.occupied = true
	a.happy = 80
	b.occupied = true
	b.happy = 20
	eq(Sim.mood_counts(s), {"good": 1, "fair": 0, "poor": 1})
	b.burnt = true
	eq(Sim.mood_counts(s).poor, 0, "burnt units are not counted")
	return true


func t_names_and_hash() -> bool:
	eq(H.hash01(0, 0), 0.21788, "matches the JS hash")
	eq(H.hash01(7, 3), -0.52027, "and its negative values")
	var shop := {"id": 5, "type": "shop", "tenant": 1, "col": 3, "floor": 2, "name": null}
	eq(Tenants.name_of(shop), Tenants.name_of(shop.duplicate()), "stable")
	var kinds := {}
	for i in 200:
		kinds[Tenants.tenant_of({"id": i, "type": "shop", "tenant": 1}).id] = true
	ok(kinds.size() >= 6, "200 shops give 6+ businesses")
	eq(Tenants.clean_name("  Kopi \u0007 Club  "), "Kopi Club")
	eq(Tenants.clean_name("   "), null)
	eq(Tenants.clean_name(42), null)
	eq(str(Tenants.clean_name("x".repeat(40))).length(), C.NAME_MAX)
	eq(Tenants.name_of({"id": 3, "type": "hotel", "tenant": 0, "col": 7, "floor": 12, "name": null}), "Room 1207")
	return true


func t_weather_and_festivals() -> bool:
	for tick in [0, 50, 400, 9999]:
		eq(Seasons.weather_at(tick), Seasons.weather_at(tick), "stable")
	var fog_ok := true
	for tick in 24 * 60:
		var w := Seasons.weather_at(tick)
		var h := tick % 24
		if w == "fog" and (h < C.FOG_HOURS[0] or h >= C.FOG_HOURS[1]):
			fog_ok = false
		if w == "snow":
			fog_ok = false
	ok(fog_ok, "fog only 04-10, no snow without Christmas")
	eq(Seasons.festivals_on(2026, 12, 25), ["christmas"])
	eq(Seasons.festivals_on(2027, 1, 1), ["newyear"])
	eq(Seasons.festivals_on(2026, 2, 17), ["cny"])
	eq(Seasons.festivals_on(2026, 8, 31), ["merdeka"])
	eq(Seasons.festivals_on(2026, 6, 3), [])
	eq(Seasons.track_for(["cny"], 12), "cny")
	eq(Seasons.track_for([], 20), "night")
	eq(Seasons.track_for([], 9), "day")
	return true


func t_performance() -> bool:
	var s := office_tower(2)
	for f in range(1, 12):
		must(Sim.place(s, "flat", RIGHT + 8, f))
	var t0 := Time.get_ticks_usec()
	for i in 200:
		Sim.step_hour(s, always)
	var per_ms := (Time.get_ticks_usec() - t0) / 1000.0 / 200.0
	print("      step_hour: %.2f ms per game hour (30 units, 2 shafts)" % per_ms)
	ok(per_ms < 25.0, "under 25 ms per game hour, got %.2f" % per_ms)
	return true


func _initialize() -> void:
	create_timer(120.0).timeout.connect(func():
		print("FAIL  timed out (look for a SCRIPT ERROR above)")
		quit(1))
	var names := []
	for m in get_script().get_script_method_list():
		if m.name.begins_with("t_"):
			names.append(m.name)
	var passed := 0
	for n in names:
		current = n
		var before := failures.size()
		var res = call(n)
		if res != true:
			failures.append("%s: did not finish (script error?)" % n)
		var ok_now := failures.size() == before
		if ok_now:
			passed += 1
		print(("ok   - " if ok_now else "FAIL - ") + n.substr(2).replace("_", " "))
	for f in failures:
		print("       " + f)
	print("\n%d/%d passed" % [passed, names.size()])
	quit(1 if failures.size() else 0)
