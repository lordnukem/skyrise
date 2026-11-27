# The single tuning sheet, ported from src/constants.js. Same names, same numbers.
# Dictionaries declared const are read-only, which is what a tuning sheet wants.
extends RefCounted

const SAVE_VERSION := 7
const SLOT_COUNT := 3

# Clock: one tick is one game hour.
const TICK_MS := 1000
const HOURS_PER_DAY := 24
const AUTOSAVE_TICKS := 30
const DAYS_PER_WEEK := 7
const WEEKEND_DAYS := [5, 6]
const DAY_NAMES := ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAYS_PER_QUARTER := 7
const SPEEDS := [0, 1, 2, 4]

const DEMAND := {
	"office": {
		"peak": 8,
		"weekday": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.2, 0.6, 1.0, 0.5, 0.3, 0.4, 0.9, 0.6, 0.3, 0.3, 0.5, 1.0, 0.6, 0.3, 0.15, 0.05, 0.05, 0.05],
		"weekend": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
	},
	"flat": {
		"peak": 7,
		"weekday": [0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.4, 1.0, 0.6, 0.2, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 1.0, 0.5, 0.3, 0.15, 0.05],
		"weekend": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.3, 0.5, 0.6, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.6, 0.4, 0.3, 0.15, 0.05],
	},
}

# Grid.
const GRID_WIDTH := 40
const MAX_FLOORS := 100
const FLOORS_AT_STARS := [30, 30, 45, 60, 100]
const BASEMENT_LEVELS := 5
const DIG_COST := 3000
const START_LOBBY_WIDTH := 8
const START_CASH := 12000

# Cell size in world pixels at zoom 1.
const CELL_W := 24
const CELL_H := 32
const ZOOM_MIN := 0.5
const ZOOM_MAX := 3.0

# Input.
const LONG_PRESS_MS := 550
const TAP_SLOP_PX := 8
const CONFIRM_ARM_MS := 400

const NAME_MAX := 24
const NAME_ZOOM := 1.6
const FACADE_TINT_MAX := 0.15
const MINIMAP_CELL := 3
const GUIDE_OFFICES := 3

# Economy.
const FILL_CHANCE := 0.35
const REFUND_RATIO := 0.5
const SHOP_WALKINS := 2
const SHOP_VISITOR_RATIO := 0.25
const SHOP_VISITOR_CAP := 40

# Rating.
const STAR_POP := [20, 60, 150, 320]
const ELEVATOR_CAPACITY := 60
const STAIR_ONLY_CAPACITY := 24
const VACANCY_PENALTY_RATIO := 0.25
const STAR_REQUIRES := {3: ["security"], 4: ["clinic", "plant"], 5: ["transit"]}
const STAR_VIP := 4
const UNLOCK_AT := {
	"security": 2, "express": 3, "hotel": 2, "housekeeping": 2, "servicelift": 2, "hall": 3, "clinic": 3, "plant": 3, "transit": 4, "landmark": 5,
}

# Fires, VIP, landmark and loan.
const FIRE_CHANCE := 0.0015
const FIRE_MIN_UNITS := 8
const FIRE_OUT_TICKS := 2
const FIRE_BURN_TICKS := 12
const FIRE_SCARE := 15
const REPAIR_RATIO := 0.5
const VIP_DAY := 4
const VIP_HOUR := 20
const LANDMARK_COST := 120000
const LANDMARK_MIN_FLOOR := 60
const LANDMARK_VISITORS := 40
const LOAN_AMOUNT := 20000
const LOAN_INTEREST := 1.2
const LOAN_REPAY_SHARE := 0.25

# Lifts.
const LIFT_MAX_SPAN := 15
const LIFT_MAX_CARS := 4
const LIFT_CAR_COST := 900
const EXPRESS_MAX_SPAN := 30
const EXPRESS_RUSH_CAPACITY := 48
const SKY_LOBBY_EVERY := 15
const SECURITY_RANGE := 15

const FLAT_PRICE := 2600
const RENT_LEVELS := {
	"low": {"label": "Low", "take": 0.8, "happy": 10, "fill": 1.3},
	"normal": {"label": "Normal", "take": 1, "happy": 0, "fill": 1},
	"high": {"label": "High", "take": 1.3, "happy": -15, "fill": 0.7},
}
const RENT_ORDER := ["low", "normal", "high"]

# Happiness.
const SHAFT_RUSH_CAPACITY := 24
const WAIT_PENALTY := 40
const WALK_PENALTY_PER_FLOOR := 6
const WAIT_BUSY := 1
const HAPPY_NEUTRAL := 55
const HAPPY_GOOD := 70
const HAPPY_POOR := 40
const HAPPY_FALL := 0.5
const HAPPY_RISE := 0.10
const LEAVE_AT := 30
const LEAVE_TICKS := 24
const MOOD_TAKE := {"good": 1.1, "fair": 1, "poor": 0.75}

# People.
const WALK_STEPS := 12
const WAIT_PER_HOUR := 2
const GIVE_UP_HOURS := 1
const STRESS_TENSE := 0.4
const STRESS_HIGH := 0.75

# Food court, noise and escalators.
const FOOD_RANGE := 5
const FOOD_PER_DINER := 3
const MEALS := {12: 0.35, 13: 0.2, 18: 0.2, 19: 0.25}
const NOISE_PENALTY := 12
const NOISY_TYPES := ["shop", "food", "elevator", "express", "escalator", "servicelift", "hall"]
const ESCALATOR_WALK := 0.25

# Hotel rooms and housekeeping.
const HOTEL_CHECKIN := [18, 22]
const HOTEL_CHECKOUT := [7, 10]
const HOTEL_CHECKIN_CHANCE := 0.5
const HOTEL_CHECKOUT_CHANCE := 0.5
const HOTEL_WEEKEND_FILL := 1.4
const HOTEL_NIGHT := 160
const HOUSEKEEPING_RANGE := 10
const CLEAN_PER_HOUR := 2
const STAFF_LIFT_PENALTY := 10

# Event hall, parking, transit, clinic and plant room.
const HALL_EVENTS := {"weekday": [19], "weekend": [14, 19]}
const HALL_SEATS := 60
const HALL_POP_SHARE := 0.15
const HALL_PER_GUEST := 6
const PARKING_SPACES := 6
const PARKING_USERS := ["office", "flat"]
const PERK_BONUS := {"parking": 8, "clinic": 5, "plant": 5}
const CLINIC_RANGE := 10
const PLANT_RANGE := 15
const TRANSIT_VISITORS := 30

# Structure catalogue: same keys as the JS TYPES. Missing keys read as 0 / "" via .get().
const TYPES := {
	"lobby": {"label": "Lobby", "w": 1, "h": 1, "cost": 150, "kind": "core"},
	"stairs": {"label": "Stairs", "w": 1, "h": 2, "cost": 400, "kind": "transport", "under": "yes"},
	"elevator": {"label": "Lift", "w": 1, "h": 1, "cost": 700, "kind": "transport", "upkeep": 4, "span": LIFT_MAX_SPAN, "capacity": SHAFT_RUSH_CAPACITY, "under": "yes"},
	"express": {"label": "Express", "w": 1, "h": 1, "cost": 1400, "kind": "transport", "upkeep": 7, "span": EXPRESS_MAX_SPAN, "capacity": EXPRESS_RUSH_CAPACITY, "under": "yes"},
	"office": {"label": "Office", "w": 3, "h": 1, "cost": 2400, "kind": "unit", "rent": 36, "people": 4},
	"shop": {"label": "Shop", "w": 2, "h": 1, "cost": 1800, "kind": "unit", "rent": 0, "people": 0, "perVisitor": 5, "under": "yes"},
	"flat": {"label": "Flat", "w": 2, "h": 1, "cost": 2000, "kind": "unit", "rent": 0, "people": 2, "price": FLAT_PRICE},
	"security": {"label": "Security", "w": 2, "h": 1, "cost": 2200, "kind": "service", "upkeep": 6, "range": SECURITY_RANGE},
	"food": {"label": "Food court", "w": 3, "h": 1, "cost": 2600, "kind": "unit", "rent": 0, "people": 0, "perDiner": FOOD_PER_DINER, "under": "yes"},
	"escalator": {"label": "Escalator", "w": 2, "h": 2, "cost": 1200, "kind": "transport", "upkeep": 2, "under": "yes"},
	"floor": {"label": "Floor", "w": 1, "h": 1, "cost": 60, "kind": "slab"},
	"hotel": {"label": "Hotel room", "w": 2, "h": 1, "cost": 3000, "kind": "unit", "rent": 0, "people": 0, "guests": 2, "nightly": HOTEL_NIGHT},
	"housekeeping": {"label": "Housekeeping", "w": 2, "h": 1, "cost": 1800, "kind": "service", "upkeep": 5, "range": HOUSEKEEPING_RANGE},
	"servicelift": {"label": "Service lift", "w": 1, "h": 1, "cost": 800, "kind": "transport", "upkeep": 4, "span": LIFT_MAX_SPAN, "capacity": SHAFT_RUSH_CAPACITY, "staff": true, "under": "yes"},
	"hall": {"label": "Event hall", "w": 4, "h": 1, "cost": 5000, "kind": "unit", "rent": 0, "people": 0, "perGuest": HALL_PER_GUEST},
	"parking": {"label": "Car park", "w": 4, "h": 1, "cost": 2400, "kind": "service", "upkeep": 3, "spaces": PARKING_SPACES, "under": "only"},
	"transit": {"label": "Transit", "w": 6, "h": 1, "cost": 12000, "kind": "service", "upkeep": 20, "under": "only"},
	"clinic": {"label": "Clinic", "w": 2, "h": 1, "cost": 3200, "kind": "service", "upkeep": 8, "range": CLINIC_RANGE},
	"plant": {"label": "Plant room", "w": 3, "h": 1, "cost": 2800, "kind": "service", "upkeep": 6, "range": PLANT_RANGE, "under": "yes"},
	"landmark": {"label": "Sky Garden", "w": 12, "h": 6, "cost": LANDMARK_COST, "kind": "service", "upkeep": 30},
}

const TOOL_ORDER := ["lobby", "floor", "dig", "stairs", "escalator", "elevator", "car", "express", "servicelift",
	"office", "shop", "food", "flat", "hotel", "hall", "security", "housekeeping", "parking", "clinic", "plant", "transit", "landmark"]

# Weather: visual only.
const WEATHER_BLOCK_HOURS := 6
const WEATHER_BLOCK_START := 4
const WEATHER_WEIGHTS := {"clear": 50, "rain": 25, "wind": 13, "fog": 12}
const WEATHER_FRONT_SHARE := 0.65
const FOG_HOURS := [4, 10]
const WEATHER_DIM := {"clear": 0.0, "wind": 0.06, "rain": 0.3, "snow": 0.14, "fog": 0.22}
const FOG_ALPHA := 0.32
const FIREWORK_HOURS := [20, 1]
