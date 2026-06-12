import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { sha256Hex } from "./crypto";

// The single auth chokepoint for /api/* route handlers. Two paths in:
//   1. Chrome extension: "Authorization: Bearer yolo_…" personal token,
//      resolved against UserCredential.extensionTokenHash.
//   2. Browser session: Clerk cookie → ensureUser() upserts our User row.
// Throws typed errors; wrap handlers' catch with apiError() to map them.

export class ApiAuthError extends Error {
  status = 401;
}

export class ApiUserError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function requireUser(req?: NextRequest): Promise<User> {
  const header = req?.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith("yolo_")) {
      const cred = await prisma.userCredential.findUnique({
        where: { extensionTokenHash: sha256Hex(token) },
        include: { user: true },
      });
      if (!cred) throw new ApiAuthError("invalid API token — generate a new one in Settings → Credentials");
      return cred.user;
    }
    throw new ApiAuthError("unrecognized bearer token");
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) throw new ApiAuthError("not signed in");
  return ensureUser(clerkId);
}

// Find-or-create our User row for a Clerk identity. If a row with the same
// email already exists without a clerkId (pre-created by the legacy-data
// import), claim it — this is how Varun's migrated data attaches to his
// account on first sign-in.
export async function ensureUser(clerkId: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

  const cu = await currentUser();
  const email = (
    cu?.primaryEmailAddress?.emailAddress ??
    cu?.emailAddresses?.[0]?.emailAddress ??
    ""
  ).toLowerCase();
  if (!email) throw new ApiAuthError("Clerk account has no email address");

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.clerkId && byEmail.clerkId !== clerkId) {
      throw new ApiAuthError("this email is already linked to another login");
    }
    return prisma.user.update({ where: { id: byEmail.id }, data: { clerkId } });
  }
  return prisma.user.create({ data: { clerkId, email } });
}

// Discovery is admin-driven. The shared JobLead catalog is refreshed by a scan,
// which only an admin (or a user the admin granted canScan) may trigger.
export async function requireAdmin(req?: NextRequest): Promise<User> {
  const user = await requireUser(req);
  if (!user.isAdmin) throw new ApiUserError("admin only", 403, "not_admin");
  return user;
}

export async function requireScanPermission(req?: NextRequest): Promise<User> {
  const user = await requireUser(req);
  if (!user.isAdmin && !user.canScan) {
    throw new ApiUserError("you don't have permission to run scans", 403, "no_scan_permission");
  }
  return user;
}

// For server components (pages). Middleware already redirects signed-out
// visitors to /sign-in, so a missing session here is exceptional.
export async function requirePageUser(): Promise<User> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new ApiAuthError("not signed in");
  return ensureUser(clerkId);
}

// Standard catch-block mapper: typed errors → JSON status responses,
// anything else → 500 with the message.
export function apiError(e: unknown): NextResponse {
  if (e instanceof ApiAuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ApiUserError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 500 });
}
