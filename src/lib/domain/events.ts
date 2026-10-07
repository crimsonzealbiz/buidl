import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { eventStaff, events, registrations, users } from "@/db/schema";
import type { Db } from "@/db";
import { AppError, assert } from "../errors";
import { newId } from "../ids";
import type { User } from "../auth/session";
import { isPlatformAdmin, type Ctx } from "./context";

export type Event = typeof events.$inferSelect;
export type StaffRole = "organizer" | "reviewer";

export const createEventInput = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(48)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
    name: z.string().min(3).max(120),
    description: z.string().max(4000).default(""),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    submissionDeadline: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, "Event must end after it starts")
  .refine((v) => v.submissionDeadline >= v.startsAt, "Submission deadline must be after the start");

export async function createEvent(ctx: Ctx, actor: User, raw: z.input<typeof createEventInput>) {
  assert(isPlatformAdmin(actor), "forbidden", "Only platform admins can create events");
  const input = createEventInput.parse(raw);
  const clash = await ctx.db.query.events.findFirst({ where: eq(events.slug, input.slug) });
  assert(!clash, "conflict", "An event with this slug already exists");
  return ctx.db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({ id: newId(), ...input, createdBy: actor.id })
      .returning();
    await tx.insert(eventStaff).values({ eventId: event.id, userId: actor.id, role: "organizer" });
    return event;
  });
}

export async function getEvent(db: Db, id: string) {
  const event = await db.query.events.findFirst({ where: eq(events.id, id) });
  if (!event) throw new AppError("not_found", "Event not found");
  return event;
}

export async function getEventBySlug(db: Db, slug: string) {
  return (await db.query.events.findFirst({ where: eq(events.slug, slug) })) ?? null;
}

export function listEvents(db: Db) {
  return db.query.events.findMany({ orderBy: [asc(events.startsAt)] });
}

export async function hasStaffRole(db: Db, eventId: string, userId: string, role: StaffRole) {
  const row = await db.query.eventStaff.findFirst({
    where: and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, userId), eq(eventStaff.role, role)),
  });
  return !!row;
}

export async function staffRoles(db: Db, eventId: string, userId: string): Promise<StaffRole[]> {
  const rows = await db.query.eventStaff.findMany({
    where: and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, userId)),
  });
  return rows.map((r) => r.role);
}

export function listStaff(db: Db, eventId: string) {
  return db
    .select({ role: eventStaff.role, user: users })
    .from(eventStaff)
    .innerJoin(users, eq(users.id, eventStaff.userId))
    .where(eq(eventStaff.eventId, eventId));
}

/** Organizers grant staff roles to people who have signed in at least once. */
export async function addStaff(ctx: Ctx, actor: User, eventId: string, githubLogin: string, role: StaffRole) {
  await getEvent(ctx.db, eventId);
  assert(await hasStaffRole(ctx.db, eventId, actor.id, "organizer"), "forbidden", "Only organizers can add staff");
  const target = await ctx.db.query.users.findFirst({
    where: sql`lower(${users.githubLogin}) = ${githubLogin.trim().toLowerCase()}`,
  });
  assert(target, "not_found", `No builder with GitHub login "${githubLogin}" has signed in yet`);
  await ctx.db.insert(eventStaff).values({ eventId, userId: target.id, role }).onConflictDoNothing();
  return target;
}

export async function registerForEvent(ctx: Ctx, actor: User, eventId: string) {
  const event = await getEvent(ctx.db, eventId);
  assert(ctx.now() < event.submissionDeadline, "precondition_failed", "Registration is closed for this event");
  const [row] = await ctx.db
    .insert(registrations)
    .values({ id: newId(), eventId, userId: actor.id })
    .onConflictDoNothing()
    .returning();
  return row ?? (await ctx.db.query.registrations.findFirst({
    where: and(eq(registrations.eventId, eventId), eq(registrations.userId, actor.id)),
  }))!;
}

export async function isRegistered(db: Db, eventId: string, userId: string) {
  return !!(await db.query.registrations.findFirst({
    where: and(eq(registrations.eventId, eventId), eq(registrations.userId, userId)),
  }));
}
