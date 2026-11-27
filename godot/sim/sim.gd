# Pure simulation, ported line for line from src/sim.js: no nodes, no drawing, no timers.
# A state is a Dictionary with the same keys as the JS state, structures are Dictionaries
# with the same fields, and serialize() writes the same save format, so a tower file moves
# between the two builds. JS Sets become Dictionaries of key -> true, Maps become Dictionaries.
# `rng` is a Callable returning a float in [0, 1); tests and the parity check inject their own.
extends RefCounted

const C = preload("res://sim/constants.gd")
const H = preload("res://sim/hashing.gd")
const Tenants = preload("res://sim/tenants.gd")

const LOWEST_FLOOR := 1 - C.BASEMENT_LEVELS
const QUARTER_TICKS := C.DAYS_PER_QUARTER * C.HOURS_PER_DAY


static func _default_rng() -> float:
	return randf()


static func T(type: String) -> Dictionary:
	return C.TYPES[type]


# ---- State ---------------------------------------------------------------

static func new_game() -> Dictionary:
	var s := {
		"width": C.GRID_WIDTH, "maxFloors": C.MAX_FLOORS, "cash": C.START_CASH, "tick": 0,
		"nextId": 1, "structures": [],
		"dug": 0,
		"population": 0, "visitors": 0, "rating": 1, "strain": 0.0, "lastNet": 0,
		"service": {}, "facilities": {}, "noisy": {}, "diners": {}, "crowds": {}, "perks": {}, "cleaners": {},
		"transit": _new_transit(),
		"quarter": _new_quarter(1),
		"lastReport": null, "vip": null, "loan": null, "wonAt": null, "over": false,
	}
	var start := int((s.width - C.START_LOBBY_WIDTH) / 2)
	for i in C.START_LOBBY_WIDTH:
		_add_structure(s, "lobby", start + i, 1)
	_refresh_derived(s, reachable(s))
	return s


static func _new_quarter(stars_at: int) -> Dictionary:
	return {"income": {"office": 0, "shop": 0, "flat": 0, "food": 0, "hotel": 0, "hall": 0}, "upkeep": 0, "left": 0, "loan": 0, "starsAt": stars_at}


static func _add_structure(s: Dictionary, type: String, col: int, floor_: int) -> Dictionary:
	var st := {"id": s.nextId, "type": type, "col": col, "floor": floor_, "occupied": false, "happy": C.HAPPY_NEUTRAL, "unhappy": 0,
		"cars": 0, "sold": false, "rentLevel": "normal", "closed": false, "dirty": false, "tenant": 0, "name": null, "fire": 0, "burnt": false}
	s.nextId += 1
	s.structures.append(st)
	return st


static func is_lift(type: String) -> bool:
	return T(type).get("span", 0) > 0


static func is_lobby_floor(f: int) -> bool:
	return f == 1 or (f > 1 and (f - 1) % C.SKY_LOBBY_EVERY == 0)


static func is_unlocked(s: Dictionary, type: String) -> bool:
	return not (C.UNLOCK_AT.has(type) and C.UNLOCK_AT[type] > s.rating)


static func floor_cap(s: Dictionary) -> int:
	return mini(s.maxFloors, C.FLOORS_AT_STARS[s.rating - 1])


static func floor_name(f: int) -> String:
	return "floor %d" % f if f >= 1 else "B%d" % (1 - f)


# ---- Clock ---------------------------------------------------------------

static func hour_of(tick: int) -> int:
	return tick % C.HOURS_PER_DAY


static func day_of(tick: int) -> int:
	return int(floor(tick / float(C.HOURS_PER_DAY)))


static func weekday_of(tick: int) -> int:
	return day_of(tick) % C.DAYS_PER_WEEK


static func is_weekend(tick: int) -> bool:
	return C.WEEKEND_DAYS.has(weekday_of(tick))


static func quarter_of(tick: int) -> int:
	return int(floor(tick / float(QUARTER_TICKS))) + 1


static func demand_at(type: String, hour: int, weekend: bool) -> float:
	if not C.DEMAND.has(type):
		return 0.0
	return C.DEMAND[type]["weekend" if weekend else "weekday"][hour]


static func happy_band(h: float) -> String:
	return "good" if h >= C.HAPPY_GOOD else ("poor" if h < C.HAPPY_POOR else "fair")


static func cells_of(st: Dictionary) -> Array:
	var t := T(st.type)
	var out := []
	for dy in t.h:
		for dx in t.w:
			out.append(Vector2i(st.col + dx, st.floor + dy))
	return out


## Vector2i(col, floor) -> structure.
static func build_grid(s: Dictionary) -> Dictionary:
	var g := {}
	for st in s.structures:
		for c in cells_of(st):
			g[c] = st
	return g


static func structure_at(s: Dictionary, col: int, floor_: int, grid: Variant = null) -> Variant:
	var g: Dictionary = grid if grid != null else build_grid(s)
	return g.get(Vector2i(col, floor_))


static func _type_at(grid: Dictionary, col: int, floor_: int) -> String:
	var o = grid.get(Vector2i(col, floor_))
	return o.type if o != null else ""


static func _no(reason: String) -> Dictionary:
	return {"ok": false, "reason": reason}


# ---- Placement -------------------------------------------------------------

static func can_place(s: Dictionary, type: String, col: int, floor_: int, grid: Variant = null) -> Dictionary:
	if not C.TYPES.has(type):
		return _no("Unknown type")
	var g: Dictionary = grid if grid != null else build_grid(s)
	var t := T(type)
	if not is_unlocked(s, type):
		return _no("Unlocks at %d stars" % C.UNLOCK_AT[type])
	if col < 0 or col + t.w > s.width:
		return _no("Outside the plot")
	var top: int = floor_ + t.h - 1
	if floor_ < LOWEST_FLOOR or top > s.maxFloors:
		return _no("Outside the plot")
	if top > floor_cap(s):
		var at := 0
		for i in C.FLOORS_AT_STARS.size():
			if C.FLOORS_AT_STARS[i] >= top:
				at = i + 1
				break
		return _no("Floors above %d open at %d stars" % [floor_cap(s), at])
	var under: String = t.get("under", "")
	if floor_ < 1 and under == "":
		return _no("%s cannot go underground" % t.label)
	if under == "only" and top >= 1:
		return _no("%s goes in the basement" % t.label)
	if floor_ < 1 - s.dug:
		return _no("Dig this level first")
	if type == "lobby" and not is_lobby_floor(floor_):
		return _no("Lobby goes on floor 1 or every %dth floor" % C.SKY_LOBBY_EVERY)
	var lm = null
	for x in s.structures:
		if x.type == "landmark":
			lm = x
			break
	if type == "landmark":
		if lm != null:
			return _no("One %s per tower" % t.label)
		if floor_ < C.LANDMARK_MIN_FLOOR:
			return _no("%s goes on floor %d or higher" % [t.label, C.LANDMARK_MIN_FLOOR])
	if lm != null and floor_ > lm.floor and col < lm.col + T("landmark").w and col + t.w > lm.col:
		return _no("Nothing goes above the %s" % T("landmark").label)
	for dy in t.h:
		for dx in t.w:
			var there = g.get(Vector2i(col + dx, floor_ + dy))
			if there != null and not (type != "floor" and there.type == "floor"):
				if there.type == "lobby" and t.kind == "transport":
					return _no("Build the %s beside the lobby, not on it" % t.label.to_lower())
				return _no("Space is taken")
	if t.get("span", 0) > 0:
		var lo := floor_
		var hi := floor_
		while _type_at(g, col, lo - 1) == type:
			lo -= 1
		while _type_at(g, col, hi + 1) == type:
			hi += 1
		if hi - lo > t.span:
			return _no("%s shaft spans at most %d floors" % [t.label, t.span])
	if floor_ > 1:
		var beside: bool = type == "floor" and (g.has(Vector2i(col - 1, floor_)) or g.has(Vector2i(col + 1, floor_)))
		for dx in t.w:
			var slab: bool = type != "floor" and _type_at(g, col + dx, floor_) == "floor"
			if not g.has(Vector2i(col + dx, floor_ - 1)) and not slab and not beside:
				return _no("Needs a floor beneath it")
	if s.cash < t.cost:
		return _no("Need $%d" % t.cost)
	return {"ok": true}


static func _without_covered_slabs(structures: Array, type: String, col: int, floor_: int) -> Array:
	var covered := {}
	for c in cells_of({"type": type, "col": col, "floor": floor_}):
		covered[c] = true
	return structures.filter(func(x): return x.type != "floor" or not covered.has(Vector2i(x.col, x.floor)))


static func place(s: Dictionary, type: String, col: int, floor_: int) -> Dictionary:
	var res := can_place(s, type, col, floor_)
	if not res.ok:
		return res
	s.cash -= T(type).cost
	if type != "floor":
		s.structures = _without_covered_slabs(s.structures, type, col, floor_)
	var st := _add_structure(s, type, col, floor_)
	_refresh_derived(s, reachable(s))
	return {"ok": true, "structure": st}


## Would a new unit, lift or stairs here have a path to the lobby? The state is untouched.
static func connects_here(s: Dictionary, type: String, col: int, floor_: int) -> bool:
	var t: Dictionary = C.TYPES.get(type, {})
	if t.is_empty() or (t.kind != "unit" and t.kind != "transport") or t.get("staff", false):
		return true
	var structures := _without_covered_slabs(s.structures, type, col, floor_)
	structures.append({"id": -1, "type": type, "col": col, "floor": floor_, "closed": false})
	var probe := s.duplicate(false)
	probe.structures = structures
	return reachable(probe).has(-1)


static func can_demolish(s: Dictionary, st: Dictionary, grid: Variant = null) -> Dictionary:
	var g: Dictionary = grid if grid != null else build_grid(s)
	var t := T(st.type)
	var top: int = st.floor + t.h
	if top > 1:
		for dx in t.w:
			if g.has(Vector2i(st.col + dx, top)):
				return _no("Something is built on top")
	if st.type == "lobby" and st.floor == 1 and s.structures.filter(func(x): return x.type == "lobby" and x.floor == 1).size() == 1:
		return _no("A tower needs a lobby")
	if st.type == "landmark":
		return _no("The %s is the tower's crown and stays" % t.label)
	if st.fire:
		return _no("It is on fire")
	if is_lift(st.type) and _type_at(g, st.col, st.floor + 1) == st.type and _type_at(g, st.col, st.floor - 1) == st.type:
		return _no("Take a shaft down from its top or bottom")
	return {"ok": true}


static func refund_of(st: Dictionary) -> int:
	if (st.type == "flat" and st.sold) or st.burnt:
		return 0
	return H.js_round((T(st.type).cost + st.get("cars", 0) * C.LIFT_CAR_COST) * C.REFUND_RATIO)


static func repair_cost(st: Dictionary) -> int:
	return H.js_round(T(st.type).cost * C.REPAIR_RATIO)


static func find(s: Dictionary, id: int) -> Variant:
	for x in s.structures:
		if x.id == id:
			return x
	return null


static func repair(s: Dictionary, id: int) -> Dictionary:
	var st = find(s, id)
	if st == null or not st.burnt:
		return _no("Nothing to repair")
	var cost := repair_cost(st)
	if s.cash < cost:
		return _no("Need $%d" % cost)
	s.cash -= cost
	st.burnt = false
	_refresh_derived(s, reachable(s))
	return {"ok": true, "cost": cost}


static func start_fire(s: Dictionary, id: int) -> Dictionary:
	var st = find(s, id)
	if st == null or T(st.type).kind != "unit" or not st.occupied or st.fire:
		return _no("Nothing to burn")
	st.fire = 1
	return {"ok": true, "structure": st}


static func near(s: Dictionary, reach: Dictionary, type: String, st: Dictionary, range_: int) -> bool:
	for x in s.structures:
		if x.type == type and reach.has(x.id) and absi(x.floor - st.floor) <= range_:
			return true
	return false


static func preview_demolish(s: Dictionary, id: int) -> Dictionary:
	var st = find(s, id)
	if st == null:
		return _no("Nothing there")
	var res := can_demolish(s, st)
	if not res.ok:
		return res
	var t := T(st.type)
	var before := reachable(s)
	var probe := s.duplicate(false)
	probe.structures = s.structures.filter(func(x): return not is_same(x, st))
	var after := reachable(probe)
	var cut := []
	for x in s.structures:
		var k: String = T(x.type).kind
		if not is_same(x, st) and (k == "unit" or k == "service") and before.has(x.id) and not after.has(x.id):
			cut.append(x.id)
	var evicted: int = (t.get("people", 0) if t.get("people", 0) else t.get("guests", 0)) if st.occupied else 0
	return {"ok": true, "refund": refund_of(st), "evicted": evicted, "occupied": st.occupied, "cut": cut}


static func dig(s: Dictionary, floor_: int) -> Dictionary:
	var next: int = -s.dug
	if floor_ >= 1:
		return _no("Dig below the ground floor")
	if floor_ < LOWEST_FLOOR:
		return _no("The basement goes %d levels deep" % C.BASEMENT_LEVELS)
	if floor_ > next:
		return _no("Already dug")
	if floor_ < next:
		return _no("Dig the level above first")
	if s.cash < C.DIG_COST:
		return _no("Need $%d" % C.DIG_COST)
	s.cash -= C.DIG_COST
	s.dug += 1
	return {"ok": true, "level": s.dug}


static func _shaft_at(s: Dictionary, st: Dictionary) -> Dictionary:
	for x in shafts_of(s):
		if x.col == st.col and x.lo <= st.floor and st.floor <= x.hi:
			return x
	return {}


static func add_car(s: Dictionary, col: int, floor_: int) -> Dictionary:
	var st = structure_at(s, col, floor_)
	if st == null or not is_lift(st.type):
		return _no("Tap a lift shaft")
	var sh := _shaft_at(s, st)
	if sh.cars >= C.LIFT_MAX_CARS:
		return _no("A shaft holds at most %d cars" % C.LIFT_MAX_CARS)
	if s.cash < C.LIFT_CAR_COST:
		return _no("Need $%d" % C.LIFT_CAR_COST)
	s.cash -= C.LIFT_CAR_COST
	st.cars += 1
	_refresh_derived(s, reachable(s))
	return {"ok": true, "cars": sh.cars + 1}


static func toggle_stop(s: Dictionary, col: int, floor_: int) -> Dictionary:
	var st = structure_at(s, col, floor_)
	if st == null or not is_lift(st.type):
		return _no("Tap a lift shaft")
	var sh := _shaft_at(s, st)
	if st.floor == sh.lo and not st.closed:
		return _no("The bottom stop always stays open")
	if st.floor == 1 and not st.closed:
		return _no("The ground floor stop always stays open")
	st.closed = not st.closed
	_refresh_derived(s, reachable(s))
	return {"ok": true, "closed": st.closed}


static func cycle_rent(s: Dictionary, id: int) -> Dictionary:
	var st = find(s, id)
	if st == null or T(st.type).kind != "unit":
		return _no("Not a unit")
	st.rentLevel = C.RENT_ORDER[(C.RENT_ORDER.find(st.rentLevel) + 1) % C.RENT_ORDER.size()]
	return {"ok": true, "level": st.rentLevel}


static func demolish(s: Dictionary, id: int) -> Dictionary:
	var st = find(s, id)
	if st == null:
		return _no("Nothing there")
	var res := can_demolish(s, st)
	if not res.ok:
		return res
	var t := T(st.type)
	var evicted: int = (t.get("people", 0) if t.get("people", 0) else t.get("guests", 0)) if st.occupied else 0
	s.structures = s.structures.filter(func(x): return not is_same(x, st))
	var refund := refund_of(st)
	s.cash += refund
	_refresh_derived(s, reachable(s))
	return {"ok": true, "refund": refund, "evicted": evicted}


static func rename_unit(s: Dictionary, id: int, raw: Variant) -> Dictionary:
	var st = find(s, id)
	if st == null or T(st.type).kind != "unit":
		return _no("Not a unit")
	st.name = Tenants.clean_name(raw)
	return {"ok": true, "name": st.name}


# ---- Paths -----------------------------------------------------------------

static func lobby_floors_of(s: Dictionary) -> Dictionary:
	var out := {}
	for x in s.structures:
		if x.type == "lobby":
			out[x.floor] = true
	return out


static func _sealed(st: Dictionary, f: int, lobbies: Dictionary) -> bool:
	return (st.type == "express" and not lobbies.has(f)) or st.get("closed", false)


## BFS over cells from every ground-floor lobby cell. Returns a Dictionary of reachable ids.
static func reachable(s: Dictionary, grid: Variant = null) -> Dictionary:
	var g: Dictionary = grid if grid != null else build_grid(s)
	var seen := {}
	var ids := {}
	var queue: Array[Vector2i] = []
	var lobbies := lobby_floors_of(s)
	for st in s.structures:
		if st.type != "lobby" or st.floor != 1:
			continue
		for c in cells_of(st):
			queue.append(c)
			seen[c] = true
	var qi := 0
	while qi < queue.size():
		var cell: Vector2i = queue[qi]
		qi += 1
		var st: Dictionary = g[cell]
		ids[st.id] = true
		if not _sealed(st, cell.y, lobbies):
			for side in [Vector2i(cell.x - 1, cell.y), Vector2i(cell.x + 1, cell.y)]:
				var other = g.get(side)
				if other != null and not _sealed(other, side.y, lobbies) and not seen.has(side):
					seen[side] = true
					queue.append(side)
		for cc in cells_of(st):
			if not seen.has(cc) and g.has(cc):
				seen[cc] = true
				queue.append(cc)
		if is_lift(st.type) and not T(st.type).get("staff", false):
			for ff in [cell.y - 1, cell.y + 1]:
				var v := Vector2i(cell.x, ff)
				var other = g.get(v)
				if other != null and other.type == st.type and not seen.has(v):
					seen[v] = true
					queue.append(v)
	return ids


static func shop_visitors(population: int) -> int:
	return mini(C.SHOP_VISITOR_CAP, C.SHOP_WALKINS + int(floor(population * C.SHOP_VISITOR_RATIO)))


## Contiguous runs of one lift type in one column: [{col, lo, hi, type, cars, closed}].
static func shafts_of(s: Dictionary, grid: Variant = null) -> Array:
	var g: Dictionary = grid if grid != null else build_grid(s)
	var seen := {}
	var out := []
	for st in s.structures:
		if not is_lift(st.type) or seen.has(st.id):
			continue
		var lo: int = st.floor
		var hi: int = st.floor
		while _type_at(g, st.col, lo - 1) == st.type:
			lo -= 1
		while _type_at(g, st.col, hi + 1) == st.type:
			hi += 1
		var cars := 1
		var closed := []
		for f in range(lo, hi + 1):
			var c: Dictionary = g[Vector2i(st.col, f)]
			seen[c.id] = true
			cars += c.get("cars", 0)
			if c.get("closed", false):
				closed.append(f)
		out.append({"col": st.col, "lo": lo, "hi": hi, "type": st.type, "cars": mini(C.LIFT_MAX_CARS, cars), "closed": closed})
	return out


static func guest_shafts(s: Dictionary, grid: Variant = null) -> Array:
	return shafts_of(s, grid).filter(func(sh): return not T(sh.type).get("staff", false))


static func _serves(sh: Dictionary, f: int, lobbies: Dictionary) -> bool:
	return sh.lo <= f and f <= sh.hi and (sh.type != "express" or lobbies.has(f)) and not sh.closed.has(f)


static func _entry_of(sh: Dictionary) -> int:
	return sh.lo if sh.lo > 1 else (sh.hi if sh.hi < 1 else 1)


static func _feeders_of(shafts: Array, lobbies: Dictionary) -> Array:
	var out := []
	for i in shafts.size():
		var sh: Dictionary = shafts[i]
		var fs := []
		if sh.lo > 1:
			for j in shafts.size():
				var f: Dictionary = shafts[j]
				if j != i and f.lo <= 1 and f.hi >= 1 and _serves(f, sh.lo, lobbies):
					fs.append(j)
		out.append(fs)
	return out


## Walking cost from floor 1 to each floor: 1 per floor by stairs, ESCALATOR_WALK by escalator.
## Returns an Array indexed by f - LOWEST_FLOOR.
static func _climb_costs(s: Dictionary, reach: Dictionary) -> Array:
	var lo := LOWEST_FLOOR
	var n: int = s.maxFloors - lo + 2
	var step := []
	step.resize(n)
	step.fill(1.0)
	for st in s.structures:
		if st.type == "escalator" and reach.has(st.id):
			step[st.floor + 1 - lo] = C.ESCALATOR_WALK
	var out := []
	out.resize(n)
	out.fill(0.0)
	var f := 2
	while f - lo < n:
		out[f - lo] = out[f - 1 - lo] + step[f - lo]
		f += 1
	f = 0
	while f >= lo:
		out[f - lo] = out[f + 1 - lo] + step[f + 1 - lo]
		f -= 1
	return out


## What each reachable unit faces at this hour: {id: {wait, walk}}.
static func lift_service(s: Dictionary, reach: Dictionary, hour: int, weekend: bool, shafts: Variant = null) -> Dictionary:
	var sh_list: Array = shafts if shafts != null else guest_shafts(s)
	var loads := []
	loads.resize(sh_list.size())
	loads.fill(0.0)
	var cap := []
	for sh in sh_list:
		cap.append(float(T(sh.type).capacity * sh.cars))
	var lobbies := lobby_floors_of(s)
	var feeders := _feeders_of(sh_list, lobbies)
	var climb := _climb_costs(s, reach)
	var lo := LOWEST_FLOOR
	var serving := {}
	var units = s.structures.filter(func(u): return T(u.type).kind == "unit" and reach.has(u.id))
	for u in units:
		if u.floor == 1 or serving.has(u.floor):
			continue
		var idx := []
		for i in sh_list.size():
			if _serves(sh_list[i], u.floor, lobbies):
				idx.append(i)
		serving[u.floor] = idx
	for u in units:
		if u.floor == 1 or not u.occupied:
			continue
		var idx: Array = serving[u.floor]
		if idx.is_empty():
			continue
		var riders: float = T(u.type).people * demand_at(u.type, hour, weekend)
		for i in idx:
			loads[i] += riders / idx.size()
			for j in feeders[i]:
				loads[j] += riders / idx.size() / feeders[i].size()
	var leg := func(i: int) -> Dictionary:
		var fs: Array = feeders[i]
		if fs.is_empty():
			return {"wait": loads[i] / cap[i], "walk": climb[_entry_of(sh_list[i]) - lo]}
		var best: int = fs[0]
		for j in fs:
			if loads[j] / cap[j] < loads[best] / cap[best]:
				best = j
		return {"wait": loads[i] / cap[i] + loads[best] / cap[best], "walk": climb[_entry_of(sh_list[best]) - lo]}
	var out := {}
	for u in units:
		if u.floor == 1:
			out[u.id] = {"wait": 0.0, "walk": 0.0}
			continue
		var idx: Array = serving[u.floor]
		if idx.is_empty():
			out[u.id] = {"wait": 0.0, "walk": climb[u.floor - lo]}
			continue
		var best: Dictionary = leg.call(idx[0])
		for i in idx:
			var l: Dictionary = leg.call(i)
			if l.wait < best.wait:
				best = l
		out[u.id] = best
	return out


# ---- Derived numbers -------------------------------------------------------

static func _refresh_derived(s: Dictionary, reach: Dictionary, grid: Variant = null) -> void:
	var g: Dictionary = grid if grid != null else build_grid(s)
	var all := shafts_of(s, g)
	var shafts := all.filter(func(sh): return not T(sh.type).get("staff", false))
	s.service = lift_service(s, reach, hour_of(s.tick), is_weekend(s.tick), shafts)
	var peaks := {}
	var by_id := {}
	for x in s.structures:
		by_id[x.id] = x
	var ids: Array = s.service.keys()
	ids.sort()
	for id in ids:
		var u: Dictionary = by_id[id]
		var peak: int = C.DEMAND[u.type].peak if C.DEMAND.has(u.type) else C.DEMAND.office.peak
		if not peaks.has(peak):
			peaks[peak] = lift_service(s, reach, peak, false, shafts)
		s.service[id].peak = peaks[peak][id].wait
	var pop := 0
	var units = s.structures.filter(func(x): return T(x.type).kind == "unit")
	for u in units:
		if u.occupied:
			pop += T(u.type).people
	s.population = pop
	var fac := {}
	for x in s.structures:
		if T(x.type).kind == "service" and reach.has(x.id):
			fac[x.type] = true
	s.facilities = fac
	s.visitors = shop_visitors(pop) + (C.TRANSIT_VISITORS if fac.has("transit") else 0) + (C.LANDMARK_VISITORS if fac.has("landmark") else 0)
	var cars := 0
	for sh in shafts:
		cars += sh.cars
	var capacity: int = cars * C.ELEVATOR_CAPACITY if cars > 0 else C.STAIR_ONLY_CAPACITY
	s.strain = pop / float(capacity)
	var unreachable = units.filter(func(u): return not reach.has(u.id)).size()
	s.rating = compute_rating(pop, s.strain, unreachable / float(units.size()) if units.size() else 0.0, fac)
	if s.vip == null or s.vip.review != "good":
		s.rating = mini(s.rating, C.STAR_VIP - 1)
	if s.wonAt == null and s.rating == 5 and fac.has("landmark"):
		s.wonAt = s.tick
	s.noisy = _noisy_flats(s, g)
	s.diners = _diners_of(s, reach, hour_of(s.tick))
	s.crowds = _crowds_of(s, reach, hour_of(s.tick), is_weekend(s.tick))
	s.perks = _perks_of(s, reach)
	s.cleaners = _cleaners_of(s, reach, all)
	_sync_transit(s, reach, shafts)


static func _noisy_flats(s: Dictionary, grid: Dictionary) -> Dictionary:
	var out := {}
	for st in s.structures:
		if st.type == "flat" or st.type == "hotel":
			if C.NOISY_TYPES.has(_type_at(grid, st.col - 1, st.floor)) or C.NOISY_TYPES.has(_type_at(grid, st.col + T(st.type).w, st.floor)):
				out[st.id] = true
	return out


static func _crowds_of(s: Dictionary, reach: Dictionary, hour: int, weekend: bool) -> Dictionary:
	var out := {}
	if not C.HALL_EVENTS["weekend" if weekend else "weekday"].has(hour):
		return out
	var halls = s.structures.filter(func(x): return x.type == "hall" and x.occupied and reach.has(x.id))
	if halls.is_empty():
		return out
	var crowd := mini(C.HALL_SEATS * halls.size(), s.visitors + int(floor(s.population * C.HALL_POP_SHARE)))
	for h in halls:
		out[h.id] = int(floor(crowd / float(halls.size())))
	return out


static func _perks_of(s: Dictionary, reach: Dictionary) -> Dictionary:
	var out := {}
	var live := func(type: String) -> Array: return s.structures.filter(func(x): return x.type == type and reach.has(x.id))
	var spaces: int = live.call("parking").size() * T("parking").spaces
	var clinics: Array = live.call("clinic")
	var plants: Array = live.call("plant")
	for u in s.structures:
		if T(u.type).kind != "unit" or not reach.has(u.id):
			continue
		var got := []
		if spaces > 0 and u.occupied and C.PARKING_USERS.has(u.type):
			spaces -= 1
			got.append("parking")
		if clinics.any(func(x): return absi(x.floor - u.floor) <= C.CLINIC_RANGE):
			got.append("clinic")
		if plants.any(func(x): return absi(x.floor - u.floor) <= C.PLANT_RANGE):
			got.append("plant")
		if not got.is_empty():
			out[u.id] = got
	return out


static func perk_bonus(s: Dictionary, id: int) -> int:
	var n := 0
	for p in s.perks.get(id, []):
		n += C.PERK_BONUS[p]
	return n


static func _cleaners_of(s: Dictionary, reach: Dictionary, shafts: Array) -> Dictionary:
	var out := {}
	var offices = s.structures.filter(func(x): return x.type == "housekeeping" and reach.has(x.id))
	if offices.is_empty():
		return out
	var service := shafts.filter(func(sh): return T(sh.type).get("staff", false))
	for r in s.structures:
		if not T(r.type).get("nightly", 0) or not reach.has(r.id):
			continue
		var best = null
		for o in offices:
			var d := absi(o.floor - r.floor)
			if d > C.HOUSEKEEPING_RANGE:
				continue
			var a := mini(o.floor, r.floor)
			var b := maxi(o.floor, r.floor)
			var by_service := service.any(func(sh): return sh.lo <= a and b <= sh.hi)
			var guest_lift := d > 0 and not by_service
			if best == null or (best.guestLift and not guest_lift) or (best.guestLift == guest_lift and d < best.d):
				best = {"office": o.id, "guestLift": guest_lift, "d": d}
		if best != null:
			out[r.id] = {"office": best.office, "guestLift": best.guestLift}
	return out


static func _hotel_hour(s: Dictionary, reach: Dictionary, rng: Callable) -> int:
	var hour := hour_of(s.tick)
	var weekend := is_weekend(s.tick)
	var rooms = s.structures.filter(func(x): return T(x.type).get("nightly", 0) and reach.has(x.id))
	var paid := 0
	var cleaned := {}
	for r in rooms:
		if not r.dirty or not s.cleaners.has(r.id):
			continue
		var c: Dictionary = s.cleaners[r.id]
		if cleaned.get(c.office, 0) >= C.CLEAN_PER_HOUR:
			continue
		cleaned[c.office] = cleaned.get(c.office, 0) + 1
		r.dirty = false
	for r in rooms:
		if r.occupied:
			if hour >= C.HOTEL_CHECKOUT[0] and hour <= C.HOTEL_CHECKOUT[1] and (hour == C.HOTEL_CHECKOUT[1] or rng.call() < C.HOTEL_CHECKOUT_CHANCE):
				r.occupied = false
				r.dirty = true
				var p := nightly_of(r)
				paid += p
				s.quarter.income.hotel += p
		elif not r.dirty and hour >= C.HOTEL_CHECKIN[0] and hour <= C.HOTEL_CHECKIN[1]:
			var chance: float = C.HOTEL_CHECKIN_CHANCE * (C.HOTEL_WEEKEND_FILL if weekend else 1.0) * C.RENT_LEVELS[r.rentLevel].fill * r.happy / C.HAPPY_NEUTRAL
			if rng.call() < chance:
				r.occupied = true
	return paid


static func _diners_of(s: Dictionary, reach: Dictionary, hour: int) -> Dictionary:
	var out := {}
	if not C.MEALS.has(hour):
		return out
	var share: float = C.MEALS[hour]
	var courts = s.structures.filter(func(x): return x.type == "food" and x.occupied and reach.has(x.id))
	if courts.is_empty():
		return out
	for c in courts:
		out[c.id] = 0.0
	for u in s.structures:
		var people: int = T(u.type).get("people", 0)
		if not people or not u.occupied or not reach.has(u.id):
			continue
		var near_ = courts.filter(func(c): return absi(c.floor - u.floor) <= C.FOOD_RANGE)
		for c in near_:
			out[c.id] += people * share / near_.size()
	for id in out:
		out[id] = H.js_round(out[id])
	return out


static func compute_rating(population: int, strain: float, unreachable_ratio: float, facilities: Dictionary = {}) -> int:
	var stars := 1
	for p in C.STAR_POP:
		if population >= p:
			stars += 1
	if strain > 1:
		stars -= 1
	if unreachable_ratio > C.VACANCY_PENALTY_RATIO:
		stars -= 1
	for level in C.STAR_REQUIRES:
		for x in C.STAR_REQUIRES[level]:
			if not facilities.has(x):
				stars = mini(stars, level - 1)
				break
	return clampi(stars, 1, 5)


## What the next star needs: {next, needs: [{id, label, met}]}.
static func star_needs(s: Dictionary) -> Dictionary:
	var next = s.rating + 1 if s.rating < 5 else null
	if next == null:
		return {"next": null, "needs": []}
	var reach := reachable(s)
	var units = s.structures.filter(func(x): return T(x.type).kind == "unit")
	var cut: float = units.filter(func(u): return not reach.has(u.id)).size() / float(units.size()) if units.size() else 0.0
	var pop: int = C.STAR_POP[next - 2]
	var needs := [{"id": "pop", "label": "%d people (now %d)" % [pop, s.population], "met": s.population >= pop}]
	for level in C.STAR_REQUIRES:
		if level > next:
			continue
		for type in C.STAR_REQUIRES[level]:
			needs.append({"id": type, "label": "%s with a path to the lobby" % T(type).label, "met": s.facilities.has(type)})
	if next >= C.STAR_VIP:
		needs.append({"id": "vip", "label": "A good VIP review (a clean %s at Good happiness when the VIP calls, day %d of the quarter at %d:00)" % [T("hotel").label.to_lower(), C.VIP_DAY, C.VIP_HOUR],
			"met": s.vip != null and s.vip.review == "good"})
	needs.append({"id": "strain", "label": "Lifts keep up (load %d%% of 100%%)" % H.js_round(s.strain * 100), "met": s.strain <= 1})
	needs.append({"id": "reach", "label": "At most %d%% of units cut off (now %d%%)" % [int(C.VACANCY_PENALTY_RATIO * 100), H.js_round(cut * 100)], "met": cut <= C.VACANCY_PENALTY_RATIO})
	return {"next": next, "needs": needs}


## The first-run guide's three goals: [lift, offices, happy].
static func guide_goals(s: Dictionary) -> Array:
	var reach := reachable(s)
	var grid := build_grid(s)
	var lift := guest_shafts(s, grid).any(func(sh): return sh.lo <= 1 and sh.hi >= 2 and reach.has(grid[Vector2i(sh.col, 1)].id))
	var offices = s.structures.filter(func(x): return x.type == "office" and x.occupied).size() >= C.GUIDE_OFFICES
	var happy = s.structures.any(func(x): return T(x.type).kind == "unit" and x.occupied and x.happy >= C.HAPPY_GOOD)
	return [lift, offices, happy]


static func take_of(s: Dictionary, st: Dictionary) -> int:
	var t := T(st.type)
	var diners: float = t.get("perDiner", 0) * s.diners.get(st.id, 0) if t.get("perDiner", 0) else 0.0
	var guests: float = t.get("perGuest", 0) * s.crowds.get(st.id, 0) if t.get("perGuest", 0) else 0.0
	var visitors: float = t.get("perVisitor", 0) * s.visitors if t.get("perVisitor", 0) else 0.0
	return H.js_round((t.get("rent", 0) + visitors + diners + guests) * C.RENT_LEVELS[st.rentLevel].take * C.MOOD_TAKE[happy_band(st.happy)])


static func mood_counts(s: Dictionary) -> Dictionary:
	var n := {"good": 0, "fair": 0, "poor": 0}
	for st in s.structures:
		if T(st.type).kind != "unit" or not st.occupied or st.burnt or st.fire:
			continue
		n[happy_band(st.happy)] += 1
	return n


static func price_of(st: Dictionary) -> int:
	return H.js_round(T(st.type).price * C.RENT_LEVELS[st.rentLevel].take)


static func nightly_of(st: Dictionary) -> int:
	return H.js_round(T(st.type).nightly * C.RENT_LEVELS[st.rentLevel].take)


# ---- One game hour ---------------------------------------------------------

static func step_tick(s: Dictionary, rng: Callable = Callable()) -> Dictionary:
	if not rng.is_valid():
		rng = _default_rng
	if s.over:
		return {"income": 0, "upkeep": 0, "net": 0, "left": 0, "report": null, "fire": null, "vip": null}
	var grid := build_grid(s)
	var reach := reachable(s, grid)
	var income := 0
	var upkeep := 0
	var left := 0
	var sales := 0
	for st in s.structures:
		var t := T(st.type)
		if t.kind == "unit":
			if st.fire:
				if near(s, reach, "security", st, C.SECURITY_RANGE):
					if st.fire >= C.FIRE_OUT_TICKS:
						st.fire = 0
						st.happy = maxf(0, st.happy - C.FIRE_SCARE)
					else:
						st.fire += 1
				elif st.fire >= C.FIRE_BURN_TICKS:
					st.fire = 0
					st.burnt = true
					st.occupied = false
					st.unhappy = 0
					if not t.get("nightly", 0):
						st.name = null
				else:
					st.fire += 1
			elif not reach.has(st.id):
				if st.occupied and not t.get("nightly", 0):
					st.name = null
				st.occupied = false
				st.unhappy = 0
			elif st.burnt:
				pass
			elif t.get("nightly", 0):
				pass
			elif not st.occupied and rng.call() < C.FILL_CHANCE * C.RENT_LEVELS[st.rentLevel].fill * st.happy / C.HAPPY_NEUTRAL:
				st.occupied = true
				st.tenant += 1
				if t.get("price", 0) and not st.sold:
					st.sold = true
					var p := price_of(st)
					sales += p
					s.quarter.income[st.type] += p
		if t.get("upkeep", 0):
			upkeep += t.upkeep
	sales += _hotel_hour(s, reach, rng)
	var service := lift_service(s, reach, hour_of(s.tick), is_weekend(s.tick))
	for st in s.structures:
		if not service.has(st.id):
			continue
		var sv: Dictionary = service[st.id]
		var noise: int = C.NOISE_PENALTY if s.noisy.has(st.id) else 0
		var staff: int = C.STAFF_LIFT_PENALTY if s.cleaners.has(st.id) and s.cleaners[st.id].guestLift else 0
		var target := clampf(100 - C.WAIT_PENALTY * sv.wait - C.WALK_PENALTY_PER_FLOOR * sv.walk + C.RENT_LEVELS[st.rentLevel].happy
			- noise - staff + perk_bonus(s, st.id), 0, 100)
		st.happy += (target - st.happy) * (C.HAPPY_FALL if target < st.happy else C.HAPPY_RISE)
		if not st.occupied or st.fire:
			st.unhappy = 0
			continue
		st.unhappy = st.unhappy + 1 if st.happy < C.LEAVE_AT else 0
		if st.unhappy >= C.LEAVE_TICKS:
			st.occupied = false
			st.unhappy = 0
			left += 1
			if T(st.type).get("nightly", 0):
				st.dirty = true
			else:
				st.name = null
	var vip = null
	var vip_calls: bool = (s.vip != null and s.vip.review == "good") or s.structures.any(func(r): return T(r.type).get("nightly", 0))
	if vip_calls and hour_of(s.tick) == C.VIP_HOUR and int(floor((s.tick % QUARTER_TICKS) / float(C.HOURS_PER_DAY))) == C.VIP_DAY - 1:
		var best := -1.0
		for r in s.structures:
			if T(r.type).get("nightly", 0) and not r.dirty and not r.burnt and reach.has(r.id):
				best = maxf(best, r.happy)
		vip = "good" if best >= C.HAPPY_GOOD else "poor"
		s.vip = {"review": vip, "quarter": quarter_of(s.tick)}
	_refresh_derived(s, reach, grid)
	income += sales
	for st in s.structures:
		if T(st.type).kind != "unit" or not st.occupied or st.fire:
			continue
		var take := take_of(s, st)
		income += take
		s.quarter.income[st.type] += take
	s.quarter.upkeep += upkeep
	s.quarter.left += left
	s.lastNet = income - upkeep
	s.cash += s.lastNet
	if s.loan != null and s.lastNet > 0:
		var pay := mini(s.loan.owed, H.js_round(s.lastNet * C.LOAN_REPAY_SHARE))
		s.cash -= pay
		s.loan.owed -= pay
		s.quarter.loan += pay
		if s.loan.owed <= 0:
			s.loan = null
	s.tick += 1
	var report = null
	if s.tick % QUARTER_TICKS == 0:
		var q: Dictionary = s.quarter
		var total := 0
		for k in q.income:
			total += q.income[k]
		var borrowed := 0
		if s.cash < 0:
			if s.loan != null:
				s.over = true
			else:
				borrowed = C.LOAN_AMOUNT
				s.loan = {"owed": H.js_round(C.LOAN_AMOUNT * C.LOAN_INTEREST)}
				s.cash += borrowed
		report = {
			"quarter": quarter_of(s.tick - 1), "income": q.income.duplicate(), "upkeep": q.upkeep, "net": total - q.upkeep,
			"starsBefore": q.starsAt, "starsAfter": s.rating, "left": q.left,
			"loan": q.loan, "borrowed": borrowed, "owed": s.loan.owed if s.loan != null else 0, "over": s.over,
		}
		s.lastReport = report
		s.quarter = _new_quarter(s.rating)
	var fire = null
	if is_unlocked(s, "security"):
		var lets = s.structures.filter(func(x): return T(x.type).kind == "unit" and x.occupied and not x.fire and not x.burnt)
		if lets.size() >= C.FIRE_MIN_UNITS and rng.call() < C.FIRE_CHANCE:
			fire = lets[mini(lets.size() - 1, int(floor(rng.call() * lets.size())))]
			fire.fire = 1
	return {"income": income, "upkeep": upkeep, "net": s.lastNet, "left": left, "report": report, "fire": fire, "vip": vip}


# ---- People (agent model) --------------------------------------------------

static func _new_transit() -> Dictionary:
	return {
		"sig": "", "shafts": [], "feeders": [], "lobbies": {}, "serving": {}, "reach": {},
		"riding": [], "clock": 0, "spawned": -1, "done": 0, "active": {},
		"stats": {"trips": 0, "wait": 0.0, "gaveUp": 0},
	}


static func _sync_transit(s: Dictionary, reach: Dictionary, shafts: Array) -> void:
	var t: Dictionary = s.transit
	var lobbies := lobby_floors_of(s)
	var parts := []
	for sh in shafts:
		parts.append("%d:%d:%d:%s:%d:%s" % [sh.col, sh.lo, sh.hi, sh.type, sh.cars, ".".join(sh.closed.map(func(f): return str(f)))])
	var lf: Array = lobbies.keys()
	lf.sort()
	var sig: String = "|".join(parts) + "/" + ",".join(lf.map(func(f): return str(f)))
	t.reach = reach
	if sig != t.sig:
		t.sig = sig
		t.lobbies = lobbies
		t.feeders = _feeders_of(shafts, lobbies)
		t.serving = {}
		var recs := []
		for sh in shafts:
			var cap: float = T(sh.type).capacity * sh.cars
			var cars := []
			for k in sh.cars:
				cars.append({"prev": sh.lo, "at": sh.lo, "to": sh.lo, "n": 0})
			recs.append({"col": sh.col, "lo": sh.lo, "hi": sh.hi, "type": sh.type, "closed": sh.closed, "cap": cap, "perStep": cap / C.WALK_STEPS,
				"credit": 0.0, "next": 0, "queue": [], "cars": cars})
		t.shafts = recs
		t.riding = []
		t.active.clear()
		return
	var stale := false
	if not t.active.is_empty():
		var by_id := {}
		for x in s.structures:
			by_id[x.id] = x
		for id in t.active:
			var u = by_id.get(id)
			if u == null or not u.occupied or not reach.has(id):
				stale = true
				break
	if not stale:
		return
	var live := {}
	for x in s.structures:
		if x.occupied and reach.has(x.id):
			live[x.id] = true
	var keep := func(w: Dictionary) -> bool:
		if live.has(w.unit):
			return true
		_release(t, w)
		return false
	for sh in t.shafts:
		sh.queue = sh.queue.filter(keep)
	t.riding = t.riding.filter(keep)


static func _release(t: Dictionary, w: Dictionary) -> void:
	var n: int = t.active.get(w.unit, 1) - 1
	if n > 0:
		t.active[w.unit] = n
	else:
		t.active.erase(w.unit)


static func _finish(t: Dictionary, w: Dictionary) -> void:
	t.stats.trips += 1
	t.stats.wait += w.wait
	_release(t, w)


static func _serving_of(t: Dictionary, f: int) -> Array:
	if not t.serving.has(f):
		var idx := []
		for i in t.shafts.size():
			if _serves(t.shafts[i], f, t.lobbies):
				idx.append(i)
		t.serving[f] = idx
	return t.serving[f]


static func _route_for(t: Dictionary, idx: Array, f: int, inbound: bool) -> Array:
	var qload := func(i: int) -> float: return (t.shafts[i].queue.size() + 1) / t.shafts[i].cap
	var best: int = idx[0]
	var feeder := -1
	var cost := INF
	for i in idx:
		var fs: Array = t.feeders[i]
		var c: float = qload.call(i)
		var fi := -1
		for j in fs:
			if fi < 0 or qload.call(j) < qload.call(fi):
				fi = j
		if fi >= 0:
			c += qload.call(fi)
		if c < cost:
			cost = c
			best = i
			feeder = fi
	var lo := _entry_of(t.shafts[best])
	if feeder < 0:
		return [[best, lo, f]] if inbound else [[best, f, lo]]
	return [[feeder, 1, lo], [best, lo, f]] if inbound else [[best, f, lo], [feeder, lo, 1]]


static func _spawn_trips(s: Dictionary, t: Dictionary, rng: Callable) -> void:
	var hour := hour_of(s.tick)
	var weekend := is_weekend(s.tick)
	for u in s.structures:
		var people: int = T(u.type).get("people", 0)
		if not people or not u.occupied or u.floor == 1 or not t.reach.has(u.id):
			continue
		var x := people * demand_at(u.type, hour, weekend)
		var n := int(floor(x))
		if rng.call() < x - n:
			n += 1
		n = mini(n, people - t.active.get(u.id, 0))
		if n <= 0:
			continue
		var idx := _serving_of(t, u.floor)
		if idx.is_empty():
			continue
		var inbound: bool = (u.type == "office") == (hour < 12)
		for k in n:
			var legs := _route_for(t, idx, u.floor, inbound)
			t.shafts[legs[0][0]].queue.append({"unit": u.id, "legs": legs, "leg": 0, "joined": t.clock, "wait": 0.0, "stress": 0.0, "ride": false})
		t.active[u.id] = t.active.get(u.id, 0) + n


## One agent sub-step. Call WALK_STEPS times per tick, before step_tick.
static func step_walkers(s: Dictionary, rng: Callable = Callable()) -> void:
	if not rng.is_valid():
		rng = _default_rng
	var t: Dictionary = s.transit
	if t.spawned != s.tick:
		t.spawned = s.tick
		t.done = 0
		_spawn_trips(s, t, rng)
	var arrived: Array = t.riding
	t.riding = []
	for w in arrived:
		w.ride = false
		w.leg += 1
		if w.leg < w.legs.size():
			w.joined = t.clock
			t.shafts[w.legs[w.leg][0]].queue.append(w)
		else:
			_finish(t, w)
	var limit := C.GIVE_UP_HOURS * C.WALK_STEPS
	for sh in t.shafts:
		for c in sh.cars:
			c.prev = c.to
			c.at = c.to
			c.n = 0
		sh.credit += sh.perStep
		var n := mini(int(floor(sh.credit)), sh.queue.size())
		sh.credit -= n
		if n:
			var boarding: Array = sh.queue.slice(0, n)
			sh.queue = sh.queue.slice(n)
			var j := 0
			for w in boarding:
				w.wait += (t.clock - w.joined + (j + 0.5) / sh.perStep) / C.WALK_STEPS
				j += 1
				w.stress = minf(1.0, w.wait / C.GIVE_UP_HOURS)
				w.ride = true
				var car: Dictionary = sh.cars[sh.next]
				sh.next = (sh.next + 1) % sh.cars.size()
				if not car.n:
					car.at = w.legs[w.leg][1]
					car.to = w.legs[w.leg][2]
				car.n += 1
				t.riding.append(w)
		if sh.queue.is_empty():
			sh.credit -= floor(sh.credit)
		var k := 0
		while k < sh.queue.size() and t.clock - sh.queue[k].joined + 1 >= limit:
			k += 1
		if k:
			var gone: Array = sh.queue.slice(0, k)
			sh.queue = sh.queue.slice(k)
			for w in gone:
				w.wait += limit / float(C.WALK_STEPS)
				t.stats.gaveUp += 1
				_finish(t, w)
	t.clock += 1
	t.done += 1


static func walker_steps_done(s: Dictionary) -> int:
	return s.transit.done if s.transit.spawned == s.tick else 0


static func step_hour(s: Dictionary, rng: Callable = Callable()) -> Dictionary:
	while walker_steps_done(s) < C.WALK_STEPS:
		step_walkers(s, rng)
	return step_tick(s, rng)


static func in_transit(s: Dictionary) -> int:
	var t: Dictionary = s.transit
	var n: int = t.riding.size()
	for sh in t.shafts:
		n += sh.queue.size()
	return n


static func stress_of(s: Dictionary, w: Dictionary) -> float:
	if w.ride:
		return w.stress
	return minf(1.0, (w.wait + (s.transit.clock - w.joined) / float(C.WALK_STEPS)) / C.GIVE_UP_HOURS)


static func stress_band(x: float) -> String:
	return "stressed" if x >= C.STRESS_HIGH else ("tense" if x >= C.STRESS_TENSE else "calm")


# ---- Saves -----------------------------------------------------------------

static func serialize(s: Dictionary) -> Dictionary:
	var rows := []
	for st in s.structures:
		rows.append({"id": st.id, "type": st.type, "col": st.col, "floor": st.floor, "occupied": bool(st.occupied), "happy": st.happy,
			"unhappy": st.unhappy, "cars": st.cars, "sold": st.sold, "rentLevel": st.rentLevel, "closed": bool(st.closed),
			"dirty": bool(st.dirty), "tenant": st.tenant, "name": st.name, "fire": st.fire if st.fire else 0, "burnt": bool(st.burnt)})
	return {
		"version": C.SAVE_VERSION,
		"savedAt": int(Time.get_unix_time_from_system() * 1000),
		"state": {
			"width": s.width, "maxFloors": s.maxFloors, "cash": s.cash, "tick": s.tick, "nextId": s.nextId, "dug": s.dug,
			"structures": rows,
			"quarter": s.quarter.duplicate(true),
			"lastReport": s.lastReport.duplicate(true) if s.lastReport != null else null,
			"vip": s.vip.duplicate() if s.vip != null else null,
			"loan": s.loan.duplicate() if s.loan != null else null,
			"wonAt": s.wonAt, "over": bool(s.over),
		},
	}


static func _is_num(x: Variant) -> bool:
	return (typeof(x) == TYPE_INT or typeof(x) == TYPE_FLOAT) and is_finite(float(x))


## JSON numbers arrive as floats; this is JS Number.isInteger.
static func _is_int(x: Variant) -> bool:
	return _is_num(x) and float(x) == floor(float(x))


static func _num(x: Variant) -> Variant:
	# Keep whole numbers as ints (so cash stays an int after a JSON round trip).
	return int(x) if _is_int(x) else float(x)


## A fresh state, or null when the blob is not something we wrote. Imported files are
## untrusted: every field is checked, as in the JS build.
static func deserialize(blob: Variant) -> Variant:
	if typeof(blob) != TYPE_DICTIONARY or not _is_int(blob.get("version")) or not [1, 2, 3, 4, 5, 6, C.SAVE_VERSION].has(int(blob.version)):
		return null
	var version := int(blob.version)
	var d = blob.get("state")
	if typeof(d) != TYPE_DICTIONARY or typeof(d.get("structures")) != TYPE_ARRAY:
		return null
	if not _is_num(d.get("cash")) or not _is_int(d.get("tick")) or not _is_int(d.get("nextId")):
		return null
	var s := new_game()
	s.structures = []
	s.cash = _num(d.cash)
	s.tick = int(d.tick)
	s.nextId = int(d.nextId)
	if _is_int(d.get("width")):
		s.width = int(d.width)
	s.dug = clampi(int(d.dug), 0, C.BASEMENT_LEVELS) if _is_int(d.get("dug")) else 0
	for r in d.structures:
		if typeof(r) != TYPE_DICTIONARY or typeof(r.get("type")) != TYPE_STRING or not C.TYPES.has(r.type):
			return null
		if not _is_int(r.get("col")) or not _is_int(r.get("floor")) or not _is_int(r.get("id")):
			return null
		if int(r.floor) < 1 - s.dug:
			return null
		var burnt := bool(r.get("burnt", false))
		var nm = r.get("name")
		s.structures.append({
			"id": int(r.id), "type": r.type, "col": int(r.col), "floor": int(r.floor), "occupied": bool(r.get("occupied", false)) and not burnt,
			"happy": clampf(float(r.happy), 0, 100) if _is_num(r.get("happy")) else C.HAPPY_NEUTRAL,
			"unhappy": int(r.unhappy) if _is_int(r.get("unhappy")) else 0,
			"cars": int(r.cars) if _is_int(r.get("cars")) and r.cars > 0 else 0,
			"sold": bool(r.get("sold", false)),
			"rentLevel": r.rentLevel if typeof(r.get("rentLevel")) == TYPE_STRING and C.RENT_LEVELS.has(r.rentLevel) else "normal",
			"closed": bool(r.get("closed", false)),
			"dirty": bool(r.get("dirty", false)),
			"tenant": int(r.tenant) if _is_int(r.get("tenant")) and r.tenant >= 0 else 0,
			"name": Tenants.clean_name(nm) if typeof(nm) == TYPE_STRING and nm.length() <= C.NAME_MAX else null,
			"fire": clampi(int(r.fire), 0, C.FIRE_BURN_TICKS) if _is_int(r.get("fire")) and not burnt else 0,
			"burnt": burnt,
		})
	if not s.structures.any(func(x): return x.type == "lobby" and x.floor == 1):
		return null
	var q = d.get("quarter")
	if typeof(q) == TYPE_DICTIONARY and typeof(q.get("income")) == TYPE_DICTIONARY:
		s.quarter = _new_quarter(int(q.starsAt) if _is_int(q.get("starsAt")) else 1)
		for k in s.quarter.income:
			if _is_num(q.income.get(k)):
				s.quarter.income[k] = _num(q.income[k])
		if _is_num(q.get("upkeep")):
			s.quarter.upkeep = _num(q.upkeep)
		if _is_int(q.get("left")):
			s.quarter.left = int(q.left)
		if _is_num(q.get("loan")):
			s.quarter.loan = _num(q.loan)
	if typeof(d.get("lastReport")) == TYPE_DICTIONARY:
		s.lastReport = d.lastReport
	var v = d.get("vip")
	s.vip = {"review": v.review, "quarter": int(v.quarter)} if typeof(v) == TYPE_DICTIONARY and (v.get("review") == "good" or v.get("review") == "poor") and _is_int(v.get("quarter")) else null
	var loan = d.get("loan")
	s.loan = {"owed": _num(loan.owed)} if typeof(loan) == TYPE_DICTIONARY and _is_num(loan.get("owed")) and loan.owed > 0 else null
	s.wonAt = int(d.wonAt) if _is_int(d.get("wonAt")) else null
	s.over = bool(d.get("over", false))
	if version < 7:
		s.vip = {"review": "good", "quarter": quarter_of(s.tick)}
	_refresh_derived(s, reachable(s))
	if version < 7 and s.rating < C.STAR_VIP:
		s.vip = null
		_refresh_derived(s, reachable(s))
	if typeof(q) != TYPE_DICTIONARY:
		s.quarter.starsAt = s.rating
	return s
