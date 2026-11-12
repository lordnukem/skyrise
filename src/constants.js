// The single tuning sheet. Every number that more than one module needs
// lives here so it can only ever drift in one place.

export const SAVE_VERSION = 6; // v6 adds each unit's tenant counter and name; v1-v5 still load
export const STORAGE_KEY = 'skyrise.save';  // the pre-slot autosave; slots are `${STORAGE_KEY}.1` to `.3`
export const SLOT_COUNT = 3;
export const SLOT_KEY = 'skyrise.slot';     // the active slot, per device
export const GUIDE_KEY = 'skyrise.guide';   // set once the first-run guide is dismissed or done

// Clock: one tick is one game hour.
export const TICK_MS = 1000;
export const HOURS_PER_DAY = 24;
export const AUTOSAVE_TICKS = 30;
export const DAYS_PER_WEEK = 7;
export const WEEKEND_DAYS = [5, 6];         // day-of-week indices (0 = Mon)
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAYS_PER_QUARTER = 7;          // one report every 7 game days
export const SPEEDS = [0, 1, 2, 4];         // ticks per TICK_MS; 0 is paused

// Lift demand: share of a unit's people riding in each hour (index = hour),
// one curve for weekdays and one for weekends. `peak` is the hour the inspect
// card names when a shaft is overloaded. Shops have no people, so no curve.
export const DEMAND = {
  office: {
    peak: 8,
    weekday: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.2, 0.6, 1.0, 0.5, 0.3, 0.4, 0.9, 0.6, 0.3, 0.3, 0.5, 1.0, 0.6, 0.3, 0.15, 0.05, 0.05, 0.05],
    weekend: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
  },
  flat: {
    peak: 7,
    weekday: [0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.4, 1.0, 0.6, 0.2, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 1.0, 0.5, 0.3, 0.15, 0.05],
    weekend: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.3, 0.5, 0.6, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.6, 0.4, 0.3, 0.15, 0.05],
  },
};

// Grid.
export const GRID_WIDTH = 40;
export const MAX_FLOORS = 100;              // world frame; the buildable height follows FLOORS_AT_STARS
export const FLOORS_AT_STARS = [30, 30, 45, 60, 100]; // highest floor you may build at 1..5 stars
export const BASEMENT_LEVELS = 5;           // floor 0 is B1, floor -4 is B5
export const DIG_COST = 3000;               // excavating one basement level across the plot
export const START_LOBBY_WIDTH = 8;
export const START_CASH = 12000;

// Cell size in world pixels at zoom 1 (renderer and input hit-testing).
export const CELL_W = 24;
export const CELL_H = 32;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;

// Input.
export const LONG_PRESS_MS = 550;
export const TAP_SLOP_PX = 8;
export const CONFIRM_ARM_MS = 400;          // a confirm button ignores taps this long after its card opens

// Facades and names (Sprint 5a).
export const NAME_MAX = 24;                 // characters in a unit name
export const NAME_ZOOM = 1.6;               // signs show names at this zoom and above
export const NAME_CACHE_MAX = 256;          // fitted sign texts kept by the renderer
export const FACADE_TINT_MAX = 0.15;        // most a business accent tints its unit
export const MINIMAP_CELL = 3;              // tower-sheet mini map: px per cell
export const GUIDE_OFFICES = 3;             // first-run goal 2: offices let

// Economy.
export const FILL_CHANCE = 0.35;      // per tick, per vacant reachable unit
export const REFUND_RATIO = 0.5;
export const SHOP_WALKINS = 2;        // street visitors even in an empty tower
export const SHOP_VISITOR_RATIO = 0.25;
export const SHOP_VISITOR_CAP = 40;

// Rating.
export const STAR_POP = [20, 60, 150, 320]; // population needed for 2..5 stars
export const ELEVATOR_CAPACITY = 60;        // people one shaft serves comfortably
export const STAIR_ONLY_CAPACITY = 24;      // people a stairs-only tower tolerates
export const VACANCY_PENALTY_RATIO = 0.25;  // share of unreachable units that costs a star
export const STAR_REQUIRES = { 3: ['security'], 4: ['clinic', 'plant'], 5: ['transit'] }; // star level -> service types it needs (reachable)
export const UNLOCK_AT = { // type -> stars needed to build it
  security: 2, express: 3, hotel: 2, housekeeping: 2, servicelift: 2, hall: 3, clinic: 3, plant: 3, transit: 4,
};

// Lifts. A shaft climbs at most MAX_SPAN floors (hi - lo); cars multiply its capacity.
export const LIFT_MAX_SPAN = 15;
export const LIFT_MAX_CARS = 4;
export const LIFT_CAR_COST = 900;
export const EXPRESS_MAX_SPAN = 30;
export const EXPRESS_RUSH_CAPACITY = 48;    // riders per hour per car; stops only at lobby floors
export const SKY_LOBBY_EVERY = 15;          // lobbies may go on floor 1 and every 15th floor above it
export const SECURITY_RANGE = 15;           // floors above and below that one office covers

// Flats sell once; rent levels trade income against happiness and fill rate.
export const FLAT_PRICE = 2600;
export const RENT_LEVELS = {
  low:    { label: 'Low',    take: 0.8, happy: 10,  fill: 1.3 },
  normal: { label: 'Normal', take: 1,   happy: 0,   fill: 1 },
  high:   { label: 'High',   take: 1.3, happy: -15, fill: 0.7 },
};
export const RENT_ORDER = ['low', 'normal', 'high'];

// Happiness. `wait` is a shaft's load ratio (riders this hour / capacity).
export const SHAFT_RUSH_CAPACITY = 24;      // riders one shaft moves in an hour before waits bite
export const WAIT_PENALTY = 60;             // happiness points lost per 1.0 of load
export const WALK_PENALTY_PER_FLOOR = 6;    // happiness points lost per floor climbed by stairs
export const WAIT_BUSY = 1;                 // load at which the card calls a lift busy
export const HAPPY_NEUTRAL = 55;            // where a new or loaded unit starts
export const HAPPY_GOOD = 70;               // band edges: good >= 70, poor < 40
export const HAPPY_POOR = 40;
export const HAPPY_FALL = 0.5;              // ease per tick toward a lower target (sours fast)
export const HAPPY_RISE = 0.04;             // ease per tick toward a higher target (forgives slowly)
export const LEAVE_AT = 30;                 // below this for LEAVE_TICKS ticks, tenants move out
export const LEAVE_TICKS = 6;

// People (agent model). Each tick runs WALK_STEPS sub-steps; riders queue at lift
// doors and board in FIFO order at the shaft's capacity. Walkers are derived, never saved.
export const WALK_STEPS = 12;               // agent sub-steps per game hour
export const WAIT_PER_HOUR = 2;             // load-ratio points per hour queued (mean rider waits half the clearing time)
export const GIVE_UP_HOURS = 1;             // a walker still queued this long takes the stairs instead
export const STRESS_TENSE = 0.4;            // stress (wait / GIVE_UP_HOURS) bands: calm < tense < stressed
export const STRESS_HIGH = 0.75;

// Food court, noise and escalators.
export const FOOD_RANGE = 5;                // floors above and below a food court that come to eat
export const FOOD_PER_DINER = 3;            // takings per diner
export const MEALS = { 12: 0.35, 13: 0.2, 18: 0.2, 19: 0.25 }; // hour -> share of nearby people who eat
export const NOISE_PENALTY = 12;            // happiness points a flat loses beside a noisy neighbour
export const NOISY_TYPES = ['shop', 'food', 'elevator', 'express', 'escalator', 'servicelift', 'hall'];
export const ESCALATOR_WALK = 0.25;         // walking cost of a floor climbed by escalator (stairs = 1)

// Hotel rooms (one tick = one hour; hour windows are inclusive) and housekeeping.
export const HOTEL_CHECKIN = [18, 22];      // hours guests arrive
export const HOTEL_CHECKOUT = [7, 10];      // hours guests leave; everyone is out by the last
export const HOTEL_CHECKIN_CHANCE = 0.5;    // per hour in the window, per clean vacant room
export const HOTEL_CHECKOUT_CHANCE = 0.5;
export const HOTEL_WEEKEND_FILL = 1.4;      // check-in chance multiplier on weekend nights
export const HOTEL_NIGHT = 160;             // paid at checkout
export const HOUSEKEEPING_RANGE = 10;       // floors above and below one office cleans
export const CLEAN_PER_HOUR = 2;            // dirty rooms one office cleans per hour
export const STAFF_LIFT_PENALTY = 10;       // happiness a room loses when its cleaners ride the guest lifts

// Event hall, parking, transit, clinic and plant room.
export const HALL_EVENTS = { weekday: [19], weekend: [14, 19] }; // hours an event runs
export const HALL_SEATS = 60;
export const HALL_POP_SHARE = 0.15;         // share of the tower's people at each event, on top of visitors
export const HALL_PER_GUEST = 6;
export const PARKING_SPACES = 6;            // per car park
export const PARKING_USERS = ['office', 'flat']; // one space per let unit of these types
export const PERK_BONUS = { parking: 8, clinic: 5, plant: 5 }; // happiness points each perk adds
export const CLINIC_RANGE = 10;
export const PLANT_RANGE = 15;
export const TRANSIT_VISITORS = 30;         // extra visitors a reachable transit station brings

// Structure catalogue. `kind` drives the rules: core (lobby), transport, unit, service,
// slab (a bare floor that other types may be built over). `under`: 'yes' may go
// below ground, 'only' must; anything else stays above. `staff` lifts carry no guests.
// Lift types carry `span` (max floors climbed) and `capacity` (riders/hour/car).
export const TYPES = {
  lobby:    { label: 'Lobby',    w: 1, h: 1, cost: 150,  kind: 'core' },
  stairs:   { label: 'Stairs',   w: 1, h: 2, cost: 400,  kind: 'transport', under: 'yes' },
  elevator: { label: 'Lift',     w: 1, h: 1, cost: 700,  kind: 'transport', upkeep: 4, span: LIFT_MAX_SPAN, capacity: SHAFT_RUSH_CAPACITY, under: 'yes' },
  express:  { label: 'Express',  w: 1, h: 1, cost: 1400, kind: 'transport', upkeep: 7, span: EXPRESS_MAX_SPAN, capacity: EXPRESS_RUSH_CAPACITY, under: 'yes' },
  office:   { label: 'Office',   w: 3, h: 1, cost: 2400, kind: 'unit', rent: 36, people: 4 },
  shop:     { label: 'Shop',     w: 2, h: 1, cost: 1800, kind: 'unit', rent: 0,  people: 0, perVisitor: 5, under: 'yes' },
  flat:     { label: 'Flat',     w: 2, h: 1, cost: 2000, kind: 'unit', rent: 0,  people: 2, price: FLAT_PRICE },
  security: { label: 'Security', w: 2, h: 1, cost: 2200, kind: 'service', upkeep: 6, range: SECURITY_RANGE },
  food:     { label: 'Food court', w: 3, h: 1, cost: 2600, kind: 'unit', rent: 0, people: 0, perDiner: FOOD_PER_DINER, under: 'yes' },
  escalator: { label: 'Escalator', w: 2, h: 2, cost: 1200, kind: 'transport', upkeep: 2, under: 'yes' },
  floor:    { label: 'Floor',    w: 1, h: 1, cost: 60,   kind: 'slab' },
  hotel:    { label: 'Hotel room', w: 2, h: 1, cost: 3000, kind: 'unit', rent: 0, people: 0, guests: 2, nightly: HOTEL_NIGHT },
  housekeeping: { label: 'Housekeeping', w: 2, h: 1, cost: 1800, kind: 'service', upkeep: 5, range: HOUSEKEEPING_RANGE },
  servicelift: { label: 'Service lift', w: 1, h: 1, cost: 800, kind: 'transport', upkeep: 4, span: LIFT_MAX_SPAN, capacity: SHAFT_RUSH_CAPACITY, staff: true, under: 'yes' },
  hall:     { label: 'Event hall', w: 4, h: 1, cost: 5000, kind: 'unit', rent: 0, people: 0, perGuest: HALL_PER_GUEST },
  parking:  { label: 'Car park', w: 4, h: 1, cost: 2400, kind: 'service', upkeep: 3, spaces: PARKING_SPACES, under: 'only' },
  transit:  { label: 'Transit', w: 6, h: 1, cost: 12000, kind: 'service', upkeep: 20, under: 'only' },
  clinic:   { label: 'Clinic',   w: 2, h: 1, cost: 3200, kind: 'service', upkeep: 8, range: CLINIC_RANGE },
  plant:    { label: 'Plant room', w: 3, h: 1, cost: 2800, kind: 'service', upkeep: 6, range: PLANT_RANGE, under: 'yes' },
};

// `car` and `dig` are tools, not types: one adds a car to the lift shaft it is tapped
// on, the other excavates the basement level it is tapped on.
export const TOOL_ORDER = ['lobby', 'floor', 'dig', 'stairs', 'escalator', 'elevator', 'car', 'express', 'servicelift',
  'office', 'shop', 'food', 'flat', 'hotel', 'hall', 'security', 'housekeeping', 'parking', 'clinic', 'plant', 'transit'];
