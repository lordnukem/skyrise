// The single tuning sheet. Every number that more than one module needs
// lives here so it can only ever drift in one place.

export const SAVE_VERSION = 3; // v3 adds lift cars, flat sales and rent levels; v1 and v2 still load
export const STORAGE_KEY = 'skyrise.save';

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
export const MAX_FLOORS = 30;
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
export const STAR_REQUIRES = { 3: 'security' }; // star level -> service type it needs (reachable)
export const UNLOCK_AT = { security: 2, express: 3 }; // type -> stars needed to build it

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

// Structure catalogue. `kind` drives the rules: core (lobby), transport, unit, service.
// Lift types carry `span` (max floors climbed) and `capacity` (riders/hour/car).
export const TYPES = {
  lobby:    { label: 'Lobby',    w: 1, h: 1, cost: 150,  kind: 'core' },
  stairs:   { label: 'Stairs',   w: 1, h: 2, cost: 400,  kind: 'transport' },
  elevator: { label: 'Lift',     w: 1, h: 1, cost: 700,  kind: 'transport', upkeep: 4, span: LIFT_MAX_SPAN, capacity: SHAFT_RUSH_CAPACITY },
  express:  { label: 'Express',  w: 1, h: 1, cost: 1400, kind: 'transport', upkeep: 7, span: EXPRESS_MAX_SPAN, capacity: EXPRESS_RUSH_CAPACITY },
  office:   { label: 'Office',   w: 3, h: 1, cost: 2400, kind: 'unit', rent: 36, people: 4 },
  shop:     { label: 'Shop',     w: 2, h: 1, cost: 1800, kind: 'unit', rent: 0,  people: 0, perVisitor: 5 },
  flat:     { label: 'Flat',     w: 2, h: 1, cost: 2000, kind: 'unit', rent: 0,  people: 2, price: FLAT_PRICE },
  security: { label: 'Security', w: 2, h: 1, cost: 2200, kind: 'service', upkeep: 6, range: SECURITY_RANGE },
};

// `car` is a tool, not a type: it adds a car to the lift shaft it is tapped on.
export const TOOL_ORDER = ['lobby', 'stairs', 'elevator', 'car', 'express', 'office', 'shop', 'flat', 'security'];
