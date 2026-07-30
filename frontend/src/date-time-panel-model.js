export const CALENDAR_WEEKDAYS = Object.freeze([
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
]);

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_EVENT_COUNT = 99;

function createLocalDate(year, month, day) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function toLocalDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!isValidDate(date)) return null;

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseLocalDateKey(value) {
  const match = DATE_KEY_PATTERN.exec(String(value ?? ""));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = createLocalDate(year, month, day);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
}

export function shiftCalendarMonth(year, month, delta) {
  const date = createLocalDate(year, month + Number(delta || 0), 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
  };
}

export function moveCalendarDate(dateKey, command) {
  const date = parseLocalDateKey(dateKey);
  if (!date) return null;

  const day = date.getDay();
  const mondayIndex = (day + 6) % 7;
  const dayDelta = {
    previousDay: -1,
    nextDay: 1,
    previousWeek: -7,
    nextWeek: 7,
    weekStart: -mondayIndex,
    weekEnd: 6 - mondayIndex,
  }[command];

  if (Number.isFinite(dayDelta)) {
    date.setDate(date.getDate() + dayDelta);
    return toLocalDateKey(date);
  }

  if ([
    "previousMonth",
    "nextMonth",
    "previousYear",
    "nextYear",
  ].includes(command)) {
    const targetDay = date.getDate();
    const monthDelta = command === "previousMonth"
      ? -1
      : command === "nextMonth"
        ? 1
        : command === "previousYear"
          ? -12
          : 12;
    const target = createLocalDate(
      date.getFullYear(),
      date.getMonth() + monthDelta,
      1,
    );
    const lastDay = createLocalDate(
      target.getFullYear(),
      target.getMonth() + 1,
      0,
    ).getDate();
    target.setDate(Math.min(targetDay, lastDay));
    return toLocalDateKey(target);
  }

  return dateKey;
}

export function isTimestampOnLocalDate(timestamp, dateKey) {
  return toLocalDateKey(timestamp) === dateKey;
}

function countEventsByDate(eventTimestamps) {
  const counts = new Map();
  eventTimestamps.forEach((timestamp) => {
    const dateKey = toLocalDateKey(timestamp);
    if (!dateKey) return;
    counts.set(
      dateKey,
      Math.min(MAX_EVENT_COUNT, (counts.get(dateKey) ?? 0) + 1),
    );
  });
  return counts;
}

export function createCalendarMonth({
  year,
  month,
  todayKey,
  eventTimestamps = [],
}) {
  const firstOfMonth = createLocalDate(year, month, 1);
  const normalizedYear = firstOfMonth.getFullYear();
  const normalizedMonth = firstOfMonth.getMonth();
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = createLocalDate(
    normalizedYear,
    normalizedMonth,
    1 - mondayOffset,
  );
  const eventCounts = countEventsByDate(eventTimestamps);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = createLocalDate(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    );
    const key = toLocalDateKey(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === normalizedMonth,
      today: key === todayKey,
      eventCount: eventCounts.get(key) ?? 0,
    };
  });

  return {
    year: normalizedYear,
    month: normalizedMonth,
    monthLabel: firstOfMonth.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }).toUpperCase(),
    cells,
  };
}
