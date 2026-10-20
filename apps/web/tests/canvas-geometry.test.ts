/**
 * Canvas geometry unit tests.
 *
 * Run with: node --test apps/web/tests/
 * Node strips the TypeScript types natively, so no test framework is needed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_H,
  CANVAS_W,
  DEFAULT_NODE_W,
  GEN_NODE_H,
  noteNodeHeight,
  pickPortSides,
  portPoint,
  shotNodeHeight,
  softCurve,
  textNodeHeight,
  viewportCenterWorld,
} from "../src/lib/canvas-geometry.ts";

test("port points sit on the node edge", () => {
  const box = { x: 10, y: 20, w: 100, h: 50 };
  assert.deepEqual(portPoint(10, 20, 100, 50, "left"), { x: 10, y: 45 });
  assert.deepEqual(portPoint(10, 20, 100, 50, "right"), { x: 110, y: 45 });
  assert.deepEqual(portPoint(10, 20, 100, 50, "top"), { x: 60, y: 20 });
  assert.deepEqual(portPoint(10, 20, 100, 50, "bottom"), { x: 60, y: 70 });
});

test("port sides follow the dominant axis", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(pickPortSides(a, { x: 300, y: 0, w: 100, h: 100 }), {
    out: "right",
    inn: "left",
  });
  assert.deepEqual(pickPortSides(a, { x: -300, y: 0, w: 100, h: 100 }), {
    out: "left",
    inn: "right",
  });
  assert.deepEqual(pickPortSides(a, { x: 0, y: 300, w: 100, h: 100 }), {
    out: "bottom",
    inn: "top",
  });
  assert.deepEqual(pickPortSides(a, { x: 0, y: -300, w: 100, h: 100 }), {
    out: "top",
    inn: "bottom",
  });
});

test("a tie on both axes prefers the horizontal connection", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const sides = pickPortSides(a, { x: 100, y: 100, w: 100, h: 100 });
  assert.equal(sides.out, "right");
  assert.equal(sides.inn, "left");
});

test("soft curve starts and ends on the given points", () => {
  const path = softCurve(0, 0, 200, 0, "right", "left");
  assert.ok(path.startsWith("M 0 0 C "));
  assert.ok(path.endsWith("200 0"));
});

test("soft curve bows away from both nodes", () => {
  const path = softCurve(0, 0, 400, 0, "right", "left");
  // The control points sit outside the gap, not inside it.
  const match = path.match(/C (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
  assert.ok(match, "the path should contain a cubic segment");
  const [, c1x, c1y, c2x, c2y] = match.map(Number);
  assert.ok(c1x > 0, "out control point moves right");
  assert.equal(c1y, 0);
  assert.ok(c2x < 400, "in control point moves left");
  assert.equal(c2y, 0);
});

test("node heights follow their type", () => {
  assert.equal(textNodeHeight("title"), 40);
  assert.equal(textNodeHeight("caption"), 28);
  assert.equal(textNodeHeight("body"), 72);
  assert.ok(noteNodeHeight(100) >= 80);
  assert.ok(Math.abs(noteNodeHeight(400) - 220) < 1e-9);
  assert.ok(Math.abs(shotNodeHeight(200) - 124) < 1e-9);
});

test("viewport centre maps back to world space", () => {
  const world = viewportCenterWorld({ x: -100, y: -50, scale: 2 }, { width: 800, height: 600 });
  assert.deepEqual(world, { x: 250, y: 175 });
});

test("canvas world constants are sane", () => {
  assert.equal(CANVAS_W, 20000);
  assert.equal(CANVAS_H, 20000);
  assert.equal(DEFAULT_NODE_W, 220);
  assert.equal(GEN_NODE_H, 344);
});
