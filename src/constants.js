// The single tuning sheet. Every number that more than one module needs
// lives here so it can only ever drift in one place.

export const SAVE_VERSION = 1;
export const STORAGE_KEY = 'skyrise.save';

// Clock: one tick is one game hour.
export const TICK_MS = 1000;
export const HOURS_PER_DAY = 24;
export const AUTOSAVE_TICKS = 30;

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

// Structure catalogue. `kind` drives the rules: core (lobby), transport, unit.
export const TYPES = {
  lobby:    { label: 'Lobby',  w: 1, h: 1, cost: 150,  kind: 'core' },
  stairs:   { label: 'Stairs', w: 1, h: 2, cost: 400,  kind: 'transport' },
  elevator: { label: 'Lift',   w: 1, h: 1, cost: 700,  kind: 'transport', upkeep: 4 },
  office:   { label: 'Office', w: 3, h: 1, cost: 2400, kind: 'unit', rent: 36, people: 4 },
  shop:     { label: 'Shop',   w: 2, h: 1, cost: 1800, kind: 'unit', rent: 0,  people: 0, perVisitor: 5 },
  flat:     { label: 'Flat',   w: 2, h: 1, cost: 2000, kind: 'unit', rent: 22, people: 2 },
};

export const TOOL_ORDER = ['lobby', 'stairs', 'elevator', 'office', 'shop', 'flat'];
