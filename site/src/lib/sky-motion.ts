/** Estimate release velocity from a short window of actual pointer motion.
 * Log scale lets a pinch in and a pinch out decelerate symmetrically. */
export function gestureVelocity() {
  type Sample = { time: number; x: number; y: number; z: number };
  let samples: Sample[] = [];
  return {
    start(time: number) {
      samples = [{ time, x: 0, y: 0, z: 0 }];
    },
    move(time: number, dx: number, dy: number, dz: number) {
      const last = samples.at(-1);
      if (!last || time - last.time > 90) {
        this.start(time);
        return;
      }
      samples.push({ time, x: last.x + dx, y: last.y + dy, z: last.z + dz });
      while (samples.length > 2 && time - samples[0].time > 90) samples.shift();
    },
    release(time: number) {
      const first = samples[0],
        last = samples.at(-1);
      if (!last || time - last.time > 80) return { x: 0, y: 0, z: 0 };
      const dt = Math.max(12, time - first.time);
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt, z: (last.z - first.z) / dt };
    },
  };
}

/** Integral of exponentially decaying velocity over a frame, independent of refresh rate. */
export function coastStep(elapsed: number, timeConstant: number) {
  const decay = Math.exp(-elapsed / timeConstant);
  return { decay, travel: timeConstant * (1 - decay) };
}
