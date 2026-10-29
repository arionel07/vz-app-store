import { DomainError } from "../errors";

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localTimePattern = /^(\d{2}):(\d{2})$/;

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

function partsAt(instant: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

function parseWall(date: string, time: string): WallClock {
  const dateMatch = localDatePattern.exec(date);
  const timeMatch = localTimePattern.exec(time);
  if (!dateMatch || !timeMatch) throw new DomainError(400, "INVALID_LOCAL_TIME", "Дата или время указаны неверно");
  const wall = { year: Number(dateMatch[1]), month: Number(dateMatch[2]), day: Number(dateMatch[3]), hour: Number(timeMatch[1]), minute: Number(timeMatch[2]) };
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute));
  if (check.getUTCFullYear() !== wall.year || check.getUTCMonth() !== wall.month - 1 || check.getUTCDate() !== wall.day || wall.hour > 23 || wall.minute > 59) {
    throw new DomainError(400, "INVALID_LOCAL_TIME", "Дата или время указаны неверно");
  }
  return wall;
}

function sameWall(left: WallClock, right: WallClock): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

export function assertTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new DomainError(400, "INVALID_TIMEZONE", "Укажите корректную IANA timezone");
  }
}

export function localDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const zone = assertTimezone(timezone);
  const wall = parseWall(date, time);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsets = new Set<number>();
  for (const delta of [-172800000, -86400000, 0, 86400000, 172800000]) {
    const probe = new Date(wallAsUtc + delta);
    const formatted = partsAt(probe, zone);
    offsets.add(Date.UTC(formatted.year, formatted.month - 1, formatted.day, formatted.hour, formatted.minute) - probe.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wallAsUtc - offset))
    .filter((candidate) => sameWall(partsAt(candidate, zone), wall));
  const unique = [...new Map(candidates.map((candidate) => [candidate.getTime(), candidate])).values()];
  if (unique.length === 0) throw new DomainError(400, "NONEXISTENT_LOCAL_TIME", "Указанное местное время не существует из-за перехода времени");
  if (unique.length > 1) throw new DomainError(400, "AMBIGUOUS_LOCAL_TIME", "Указанное местное время неоднозначно из-за перехода времени");
  return unique[0];
}

export function shiftInstants(localDate: string, startTime: string, endTime: string, timezone: string): { startAt: Date; endAt: Date } {
  const startAt = localDateTimeToUtc(localDate, startTime, timezone);
  const [hours, minutes] = endTime.split(":").map(Number);
  const [year, month, day] = localDate.split("-").map(Number);
  const endDate = new Date(Date.UTC(year, month - 1, day));
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  if (hours * 60 + minutes === startHours * 60 + startMinutes) throw new DomainError(400, "INVALID_SHIFT_RANGE", "Начало и конец смены не могут совпадать");
  if (hours * 60 + minutes < startHours * 60 + startMinutes) endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endDateString = endDate.toISOString().slice(0, 10);
  const endAt = localDateTimeToUtc(endDateString, endTime, timezone);
  if (endAt <= startAt) throw new DomainError(400, "INVALID_SHIFT_RANGE", "Конец смены должен быть позже начала");
  return { startAt, endAt };
}

export function dateRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new DomainError(400, "INVALID_DATE_RANGE", "Диапазон дат указан неверно");
  const result: string[] = [];
  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    result.push(current.toISOString().slice(0, 10));
    if (result.length > 366) throw new DomainError(400, "INVALID_DATE_RANGE", "Диапазон не может быть длиннее 366 дней");
  }
  return result;
}

export function assertDateInRange(date: string, startDate: string, endDate: string): void {
  if (date < startDate || date > endDate) throw new DomainError(400, "DATE_OUTSIDE_SCHEDULE", "Дата должна входить в период расписания");
}
