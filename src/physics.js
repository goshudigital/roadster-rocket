/** Tuning shared by the car physics and the track generator (metres, seconds). */
export const PHYS = {
  G: 30, // gravity
  THRUST: 54, // upward acceleration from the down-facing thrusters
  MAX_VY: 13,
  CEILING: 15, // thrust fades out approaching this height
  AIR_MAX: 600, // litres, as on the real car
  AIR_USE: 72, // litres per second of thrust
  AIR_REGEN: 24, // litres per second with wheels on the ground
  AIR_TANK: 220, // litres per canister
  LAT_GROUND: 17,
  LAT_AIR: 12,
  X_LIMIT: 9.2,
  FLIP_TIME: 0.6,
  STEP: 0.45, // how far the car can step up onto a surface
  CAR_HX: 0.92,
  CAR_HZ: 2.15,
  LOOP_R: 13,
};

export function launchVy(speed, ramp) {
  return speed * (ramp.H / ramp.L) * 1.05 + 1.5;
}

/** Cruise speed for a given distance: ~100 mph at launch up to ~250 mph. */
export function cruiseSpeed(odo) {
  const a = Math.min(1, odo / 6000);
  const b = Math.min(1, Math.max(0, (odo - 6000) / 6000));
  return 45 + 58 * a + 9 * b;
}
