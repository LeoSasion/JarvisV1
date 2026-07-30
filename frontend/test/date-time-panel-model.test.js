import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarMonth,
  isTimestampOnLocalDate,
  moveCalendarDate,
  parseLocalDateKey,
  shiftCalendarMonth,
  toLocalDateKey,
} from "../src/date-time-panel-model.js";

test("calendar months always expose a Monday-first six-week grid", () => {
  const calendar = createCalendarMonth({
    year: 2026,
    month: 6,
    todayKey: "2026-07-20",
  });

  assert.equal(calendar.monthLabel, "JULY 2026");
  assert.equal(calendar.cells.length, 42);
  assert.equal(calendar.cells[0].key, "2026-06-29");
  assert.equal(calendar.cells[2].key, "2026-07-01");
  assert.equal(calendar.cells.at(-1).key, "2026-08-09");
  assert.equal(calendar.cells.find((cell) => cell.today)?.key, "2026-07-20");
});

test("month shifts and keyboard date movement preserve valid local dates", () => {
  assert.deepEqual(shiftCalendarMonth(2026, 0, -1), {
    year: 2025,
    month: 11,
  });
  assert.equal(moveCalendarDate("2028-03-31", "previousMonth"), "2028-02-29");
  assert.equal(moveCalendarDate("2028-02-29", "previousYear"), "2027-02-28");
  assert.equal(moveCalendarDate("2028-02-29", "nextYear"), "2029-02-28");
  assert.equal(moveCalendarDate("2026-07-01", "previousDay"), "2026-06-30");
  assert.equal(moveCalendarDate("2026-07-01", "weekStart"), "2026-06-29");
  assert.equal(moveCalendarDate("2026-07-01", "weekEnd"), "2026-07-05");
});

test("event markers use local calendar days and ignore invalid timestamps", () => {
  const timestamp = new Date(2026, 6, 20, 23, 45).toISOString();
  const calendar = createCalendarMonth({
    year: 2026,
    month: 6,
    todayKey: "2026-07-20",
    eventTimestamps: [timestamp, timestamp, "invalid"],
  });

  assert.equal(
    calendar.cells.find((cell) => cell.key === "2026-07-20")?.eventCount,
    2,
  );
  assert.equal(isTimestampOnLocalDate(timestamp, "2026-07-20"), true);
});

test("date parsing fails closed for impossible or malformed values", () => {
  assert.equal(parseLocalDateKey("2026-02-30"), null);
  assert.equal(parseLocalDateKey("not-a-date"), null);
  assert.equal(toLocalDateKey("not-a-date"), null);
  assert.equal(moveCalendarDate("not-a-date", "nextDay"), null);
});
