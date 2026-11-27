# Draft placement, ported from src/draft.js: the first tap on a valid cell sets a draft,
# a second tap on the same cell builds it. Pure: nothing reaches the state until the
# caller acts on `place: true`.
extends RefCounted

const C = preload("res://sim/constants.gd")
const Sim = preload("res://sim/sim.gd")


static func _extends_shaft(grid: Dictionary, type: String, col: int, floor_: int) -> bool:
	return Sim._type_at(grid, col, floor_ - 1) == type or Sim._type_at(grid, col, floor_ + 1) == type


## draft: null or {tool, col, floor, cost}. Returns {draft, place, reason}.
static func draft_tap(s: Dictionary, draft: Variant, tool: String, col: int, floor_: int) -> Dictionary:
	if not C.TYPES.has(tool):
		return {"draft": null, "place": false, "reason": "Unknown type"}
	var t: Dictionary = C.TYPES[tool]
	var grid := Sim.build_grid(s)
	var res := Sim.can_place(s, tool, col, floor_, grid)
	if not res.ok:
		return {"draft": null, "place": false, "reason": res.reason}
	if draft != null and draft.tool == tool and draft.col == col and draft.floor == floor_:
		return {"draft": null, "place": true, "reason": null}
	if t.get("span", 0) > 0 and _extends_shaft(grid, tool, col, floor_):
		return {"draft": null, "place": true, "reason": null}
	return {"draft": {"tool": tool, "col": col, "floor": floor_, "cost": t.cost}, "place": false, "reason": null}
