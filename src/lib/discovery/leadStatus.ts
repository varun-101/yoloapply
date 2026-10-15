import { prisma } from "../db";
import { ApiUserError } from "../auth";

// The per-user overlay status on a shared catalog posting (UserLead.status).
//   new:       default; no overlay row means "new" too
//   promoted:  turned into an Application (set by promote, never by hand)
//   dismissed: the user isn't interested
//   closed:    the user found the posting is no longer available
// Only "new" leads are offered in Discover, scored, or returned by MCP search by
// default. "closed" is per-user like "dismissed": the catalog is shared across
// tenants, so one user's report never hides a posting from anyone else.
export const LEAD_STATUSES = ["new", "promoted", "dismissed", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses the user can set by hand (promotion has its own route). */
export const SETTABLE_LEAD_STATUSES = ["new", "dismissed", "closed"] as const;
export type SettableLeadStatus = (typeof SETTABLE_LEAD_STATUSES)[number];

/** Statuses that take a lead out of the "new" queue. */
export const ACTED_LEAD_STATUSES: LeadStatus[] = ["promoted", "dismissed", "closed"];

export function isSettableLeadStatus(s: unknown): s is SettableLeadStatus {
  return typeof s === "string" && (SETTABLE_LEAD_STATUSES as readonly string[]).includes(s);
}

/**
 * Sets this user's overlay status on a catalog lead. A promoted lead is left
 * alone: its Application is the record now, and closing it is done there.
 */
export async function setLeadStatus(userId: string, jobLeadId: string, status: SettableLeadStatus) {
  const lead = await prisma.jobLead.findUnique({ where: { id: jobLeadId }, select: { id: true } });
  if (!lead) throw new ApiUserError("Job not found.", 404, "not_found");
  const overlay = await prisma.userLead.findUnique({
    where: { userId_jobLeadId: { userId, jobLeadId } },
    select: { status: true, applicationId: true },
  });
  if (overlay?.status === "promoted") {
    throw new ApiUserError(
      "This job is already promoted to an application. If it was never submitted, close it with update_application_draft markClosed=true; otherwise update the application's status.",
      400,
      "already_promoted"
    );
  }
  return prisma.userLead.upsert({
    where: { userId_jobLeadId: { userId, jobLeadId } },
    create: { userId, jobLeadId, status },
    update: { status },
  });
}

/** Stars or unstars a catalog lead for this user. Allowed in any status. */
export async function setLeadFavorite(userId: string, jobLeadId: string, favorite: boolean) {
  const lead = await prisma.jobLead.findUnique({ where: { id: jobLeadId }, select: { id: true } });
  if (!lead) throw new ApiUserError("Job not found.", 404, "not_found");
  const favoritedAt = favorite ? new Date() : null;
  return prisma.userLead.upsert({
    where: { userId_jobLeadId: { userId, jobLeadId } },
    create: { userId, jobLeadId, favoritedAt },
    update: { favoritedAt },
  });
}
