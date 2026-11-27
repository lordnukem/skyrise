# Seeded generator shared with tools/parity.mjs (mulberry32): same seed, same draws.
# Only tests and the parity check use it; the game itself uses randf().
extends RefCounted

const H = preload("res://sim/hashing.gd")

var a: int


func _init(seed_: int) -> void:
	a = seed_ & H.MASK


func next() -> float:
	a = (a + 0x6D2B79F5) & H.MASK
	var t := H.imul(a ^ (a >> 15), 1 | a)
	t = H.u32(H.i32(t + H.imul(H.u32(t) ^ H.ushr(t, 7), 61 | H.u32(t))) ^ H.u32(t))
	return float(H.u32(t ^ (t >> 14))) / 4294967296.0
