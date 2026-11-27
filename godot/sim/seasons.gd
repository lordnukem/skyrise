# Weather and festivals, ported from src/seasons.js, plus the music-track choice from
# src/audio.js. Visual only: never saved and never read by the sim. Weather follows the
# game tick through the same hash as the JS build; festivals follow the device date.
extends RefCounted

const C = preload("res://sim/constants.gd")
const H = preload("res://sim/hashing.gd")

const FESTIVALS := ["newyear", "christmas", "cny", "raya", "deepavali", "merdeka"]
const FESTIVAL_TRACK := ["newyear", "cny", "raya", "deepavali", "christmas", "merdeka"]
# Lunar festival dates [month, day]. Raya and Deepavali are PROJECTED estimates, as in the JS build.
const LUNAR := {
	2026: {"cny": [2, 17], "raya": [3, 21], "deepavali": [11, 8]},
	2027: {"cny": [2, 6], "raya": [3, 10], "deepavali": [10, 28]},
	2028: {"cny": [1, 26], "raya": [2, 27], "deepavali": [10, 17]},
	2029: {"cny": [2, 13], "raya": [2, 15], "deepavali": [11, 5]},
	2030: {"cny": [2, 3], "raya": [2, 4], "deepavali": [10, 26]},
}
const LUNAR_WINDOW := {"cny": [-1, 4], "raya": [0, 2], "deepavali": [-1, 1]}
const GREETINGS := {
	"newyear": "Happy New Year!", "christmas": "Merry Christmas!", "cny": "Gong Xi Fa Cai!",
	"raya": "Selamat Hari Raya!", "deepavali": "Happy Deepavali!", "merdeka": "Selamat Hari Merdeka!",
}


static func _day_num(y: int, m: int, d: int) -> int:
	return int(floor(Time.get_unix_time_from_datetime_dict({"year": y, "month": m, "day": d, "hour": 0, "minute": 0, "second": 0}) / 86400.0))


## The festival ids active on a date, in FESTIVALS order.
static func festivals_on(y: int, m: int, d: int) -> Array:
	var today := _day_num(y, m, d)
	var out := []
	if (m == 12 and d == 31) or (m == 1 and d == 1):
		out.append("newyear")
	if m == 12 and d >= 20 and d <= 26:
		out.append("christmas")
	for id in ["cny", "raya", "deepavali"]:
		for yy in [y - 1, y, y + 1]:
			if not LUNAR.has(yy):
				continue
			var at: Array = LUNAR[yy][id]
			var off := today - _day_num(yy, at[0], at[1])
			if off >= LUNAR_WINDOW[id][0] and off <= LUNAR_WINDOW[id][1]:
				out.append(id)
				break
	if (m == 8 and (d == 30 or d == 31)) or (m == 9 and (d == 1 or d == 16)):
		out.append("merdeka")
	return out


## Does a festival's first fireworks night fall on this date?
static func fireworks_night(y: int, m: int, d: int, festivals: Array) -> bool:
	if festivals.has("newyear"):
		return true
	if festivals.has("merdeka") and m == 8 and d == 30:
		return true
	if festivals.has("cny") and LUNAR.has(y):
		var at: Array = LUNAR[y].cny
		return _day_num(y, m, d) == _day_num(y, at[0], at[1]) + LUNAR_WINDOW.cny[0]
	return false


static func front_of(day: int) -> String:
	var total := 0
	for k in C.WEATHER_WEIGHTS:
		total += C.WEATHER_WEIGHTS[k]
	var u := H.h01(day, 0x5eed) * total
	for k in C.WEATHER_WEIGHTS:
		u -= C.WEATHER_WEIGHTS[k]
		if u < 0:
			return k
	return C.WEATHER_WEIGHTS.keys()[-1]


## The weather at a tick: constant within each block; fog only in the morning block,
## snow only at Christmas in place of rain.
static func weather_at(tick: int, festivals: Array = []) -> String:
	var b := int(floor((tick - C.WEATHER_BLOCK_START) / float(C.WEATHER_BLOCK_HOURS)))
	var start := b * C.WEATHER_BLOCK_HOURS + C.WEATHER_BLOCK_START
	var day := int(floor(start / float(C.HOURS_PER_DAY)))
	var hour := ((start % C.HOURS_PER_DAY) + C.HOURS_PER_DAY) % C.HOURS_PER_DAY
	var front := front_of(day)
	if front == "clear" or H.h01(b, 0xb10c) >= C.WEATHER_FRONT_SHARE:
		return "clear"
	if front == "fog":
		return "fog" if hour >= C.FOG_HOURS[0] and hour + C.WEATHER_BLOCK_HOURS <= C.FOG_HOURS[1] else "clear"
	if front == "rain" and festivals.has("christmas"):
		return "snow"
	return front


## Which music loop plays: the first festival on the calendar, else night (19:00-06:00) or day.
static func track_for(festivals: Array, hour: int) -> String:
	for f in FESTIVAL_TRACK:
		if festivals.has(f):
			return f
	return "night" if hour >= 19 or hour < 6 else "day"
