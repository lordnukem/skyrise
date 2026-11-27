# 32-bit integer helpers that reproduce JavaScript's Math.imul, >>> and |0 exactly,
# so hashes (tenant looks, names, weather) and the parity RNG match the JS build.
extends RefCounted

const MASK := 0xFFFFFFFF


static func u32(x: int) -> int:
	return x & MASK


static func i32(x: int) -> int:
	x &= MASK
	return x - 0x100000000 if x >= 0x80000000 else x


## JS Math.imul: the low 32 bits of a * b, as a signed int32.
static func imul(a: int, b: int) -> int:
	a = a & MASK
	b = b & MASK
	var lo := (a & 0xFFFF) * (b & 0xFFFF)
	var mid := ((a >> 16) * (b & 0xFFFF) + (a & 0xFFFF) * (b >> 16)) & 0xFFFF
	return i32(lo + (mid << 16))


## JS (x >>> n) for a 32-bit value.
static func ushr(x: int, n: int) -> int:
	return (x & MASK) >> n


## anim.js hash01: deterministic, can come out negative (the last xor is signed in JS).
static func hash01(a: int, b: int = 0) -> float:
	var h := u32(imul(i32(a), i32(2654435761)) ^ imul(i32(b) + 0x9e37, 40503))
	h = h ^ (h >> 15)
	h = u32(imul(h, i32(2246822519)))
	h = i32(h ^ (h >> 13))
	return float(h % 100000) / 100000.0


## seasons.js h01: hash01 folded into 0..1.
static func h01(a: int, b: int) -> float:
	var u := hash01(a, b)
	return u + 1.0 if u < 0.0 else u


## JS Math.round: halves go toward +infinity (GDScript round() goes away from zero).
static func js_round(x: float) -> int:
	return int(floor(x + 0.5))


