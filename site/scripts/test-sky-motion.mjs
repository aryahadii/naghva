import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coastStep, gestureVelocity } from '../src/lib/sky-motion.ts';

test('a flick captures pan and pinch speed while a held or interrupted gesture stops', () => {
  const gesture = gestureVelocity();
  gesture.start(0);
  for (let t = 10; t <= 150; t += 10) gesture.move(t, 10, -5, .01);
  assert.deepEqual(gesture.release(150).x, 1);
  assert.deepEqual(gesture.release(150).y, -.5);
  assert.ok(Math.abs(gesture.release(150).z - .001) < 1e-10);
  assert.deepEqual(gesture.release(245), {x:0,y:0,z:0});
  gesture.start(250);
  assert.deepEqual(gesture.release(255), {x:0,y:0,z:0});
});

test('the same release travels the same distance at 60 Hz and 120 Hz', () => {
  function simulate(hz) {
    let position = 0, speed = 1;
    for (let frame = 0; frame < hz; frame++) {
      const step = coastStep(1000 / hz, 240);
      position += speed * step.travel;
      speed *= step.decay;
    }
    assert.ok(speed < .02);
    return position;
  }
  assert.ok(Math.abs(simulate(60) - simulate(120)) < 1e-8);
});
