import { z } from "zod";

export const scheduleStatusSchema = z.enum(["draft", "published"]);
export const scheduleDayStatusSchema = z.enum(["scheduled", "day_off", "no_schedule"]);
export const scheduleHistoryActionSchema = z.enum(["created", "updated", "shift_added", "shift_updated", "shift_removed", "day_off_added", "day_off_updated", "day_off_removed", "published", "superseded", "revised"]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD");
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Время должно быть в формате HH:mm");
const timezone = z.string().trim().min(1).max(100);
const note = z.string().trim().max(1000).nullable().optional();

export const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  storeId: z.string().uuid().optional(),
  status: scheduleStatusSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const schedulePeriodCreateSchema = z.object({
  storeId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  timezone: timezone.default("Europe/Chisinau"),
});

export const schedulePeriodUpdateSchema = z.object({
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  timezone: timezone.optional(),
}).refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");

export const scheduleShiftCreateSchema = z.object({
  employeeId: z.string().uuid(),
  localDate: isoDate,
  startTime: localTime,
  endTime: localTime,
  note,
});
export const scheduleShiftUpdateSchema = scheduleShiftCreateSchema.omit({ employeeId: true }).partial().refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");

export const scheduleDayOffCreateSchema = z.object({ employeeId: z.string().uuid(), localDate: isoDate, note });
export const scheduleDayOffUpdateSchema = z.object({ localDate: isoDate.optional(), note }).refine((value) => Object.keys(value).length > 0, "Укажите хотя бы одно поле");

const actorSchema = z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string(), role: z.enum(["admin", "manager", "staff"]) }).nullable();

export const scheduleShiftResponseSchema = z.object({
  id: z.string().uuid(), periodId: z.string().uuid(), employeeId: z.string().uuid(), employeeName: z.string(), storeId: z.string().uuid(), storeName: z.string(),
  localDate: isoDate, startTime: localTime, endTime: localTime, timezone, startAt: z.string().datetime(), endAt: z.string().datetime(), note: z.string().nullable(),
});
export const scheduleDayOffResponseSchema = z.object({ id: z.string().uuid(), periodId: z.string().uuid(), employeeId: z.string().uuid(), employeeName: z.string(), storeId: z.string().uuid(), storeName: z.string(), localDate: isoDate, note: z.string().nullable() });

export const schedulePeriodResponseSchema = z.object({
  id: z.string().uuid(), storeId: z.string().uuid(), storeName: z.string(), startDate: isoDate, endDate: isoDate, timezone,
  status: scheduleStatusSchema, revision: z.number().int().positive(), supersededAt: z.string().datetime().nullable(),
  createdBy: actorSchema, publishedBy: actorSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(), publishedAt: z.string().datetime().nullable(),
  shifts: z.array(scheduleShiftResponseSchema), daysOff: z.array(scheduleDayOffResponseSchema),
});
export const scheduleListResponseSchema = z.object({ data: z.array(schedulePeriodResponseSchema), pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }) });

export const scheduleHistoryResponseSchema = z.object({ data: z.array(z.object({ id: z.string().uuid(), scheduleId: z.string().uuid(), actor: actorSchema, action: scheduleHistoryActionSchema, entityType: z.string(), entityId: z.string().uuid().nullable(), before: z.record(z.unknown()).nullable(), after: z.record(z.unknown()).nullable(), createdAt: z.string().datetime() })) });

export const staffScheduleQuerySchema = z.object({ from: isoDate, to: isoDate });
export const staffScheduleDaySchema = z.object({ date: isoDate, status: scheduleDayStatusSchema, shifts: z.array(scheduleShiftResponseSchema), daysOff: z.array(scheduleDayOffResponseSchema) });
export const staffScheduleResponseSchema = z.object({ from: isoDate, to: isoDate, days: z.array(staffScheduleDaySchema), nextShift: scheduleShiftResponseSchema.nullable() });

export type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>;
export type SchedulePeriodCreate = z.infer<typeof schedulePeriodCreateSchema>;
export type SchedulePeriodUpdate = z.infer<typeof schedulePeriodUpdateSchema>;
export type ScheduleShiftCreate = z.infer<typeof scheduleShiftCreateSchema>;
export type ScheduleShiftUpdate = z.infer<typeof scheduleShiftUpdateSchema>;
export type ScheduleDayOffCreate = z.infer<typeof scheduleDayOffCreateSchema>;
export type ScheduleDayOffUpdate = z.infer<typeof scheduleDayOffUpdateSchema>;
export type SchedulePeriodResponse = z.infer<typeof schedulePeriodResponseSchema>;
export type ScheduleShiftResponse = z.infer<typeof scheduleShiftResponseSchema>;
export type ScheduleDayOffResponse = z.infer<typeof scheduleDayOffResponseSchema>;
export type StaffScheduleResponse = z.infer<typeof staffScheduleResponseSchema>;
export type ScheduleHistoryResponse = z.infer<typeof scheduleHistoryResponseSchema>;
