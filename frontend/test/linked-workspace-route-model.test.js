import assert from "node:assert/strict";
import test from "node:test";
import {
  createThreeSegmentRoute,
  isRouteAnchorVisible,
  routeGeometryKey,
} from "../src/linked-workspace-route-model.js";

test("linked routes always use exactly three orthogonal segments", () => {
  const path = createThreeSegmentRoute(
    { x: 120, y: 210 },
    { x: 680, y: 360 },
    410,
  );

  assert.equal(path, "M 120 210 H 410 V 360 H 680");
  assert.deepEqual(path.match(/[HV]/gu), ["H", "V", "H"]);
  assert.equal(createThreeSegmentRoute(null, { x: 1, y: 2 }), "");
});

test("route corridors stay between close endpoints", () => {
  assert.equal(
    createThreeSegmentRoute({ x: 10, y: 20 }, { x: 30, y: 40 }, 999),
    "M 10 20 H 20 V 40 H 30",
  );
  assert.equal(
    createThreeSegmentRoute({ x: 80, y: 20 }, { x: 20, y: 40 }, -999),
    "M 80 20 H 38 V 40 H 20",
  );
});

test("route anchors hide when their centers leave the owning scroll viewport", () => {
  const viewport = { left: 100, top: 100, right: 500, bottom: 400 };
  assert.equal(isRouteAnchorVisible(
    { left: 120, top: 120, width: 20, height: 20 },
    viewport,
  ), true);
  assert.equal(isRouteAnchorVisible(
    { left: 120, top: 60, width: 20, height: 20 },
    viewport,
  ), false);
});

test("scrolling produces a new geometry key without path interpolation", () => {
  const before = {
    visible: true,
    path: "M 100 200 H 300 V 260 H 500",
    start: { x: 100, y: 200 },
    end: { x: 500, y: 260 },
  };
  const after = {
    ...before,
    path: "M 100 180 H 300 V 240 H 500",
    start: { x: 100, y: 180 },
    end: { x: 500, y: 240 },
  };
  assert.notEqual(routeGeometryKey(before), routeGeometryKey(after));
  assert.equal(routeGeometryKey({ visible: false }), "hidden");
});
