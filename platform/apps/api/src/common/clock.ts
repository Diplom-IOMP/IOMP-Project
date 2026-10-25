// Injectable time source, so tests can pin the server clock (fixture `server_time`).
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
