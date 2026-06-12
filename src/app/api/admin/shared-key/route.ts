import { NextRequest } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { DEFAULT_PROVIDER } from "@/lib/providers";

async function requireAdmin(req: NextRequest) {
  const user = await requireUser(req);
  if (!user.isAdmin) throw new Error("Forbidden");
  return user;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const row = await prisma.sharedDeepseekKey.findUnique({ where: { id: 1 } });
    if (!row) return Response.json({ active: false });
    const key = decryptSecret(row.keyEnc);
    return Response.json({
      active: row.expiresAt > new Date(),
      expiresAt: row.expiresAt.toISOString(),
      maskedKey: key.slice(0, 6) + "…" + key.slice(-4),
      llmProvider: row.llmProvider,
      llmModel: row.llmModel ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { key, expiresAt, llmProvider, llmModel } = await req.json();
    if (!key || !expiresAt) return Response.json({ error: "key and expiresAt required" }, { status: 400 });
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return Response.json({ error: "invalid expiresAt" }, { status: 400 });
    const provider = llmProvider || DEFAULT_PROVIDER;
    await prisma.sharedDeepseekKey.upsert({
      where: { id: 1 },
      create: { id: 1, keyEnc: encryptSecret(key), expiresAt: expiry, llmProvider: provider, llmModel: llmModel || null },
      update: { keyEnc: encryptSecret(key), expiresAt: expiry, llmProvider: provider, llmModel: llmModel || null },
    });
    return Response.json({ ok: true, expiresAt: expiry.toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    await prisma.sharedDeepseekKey.deleteMany({ where: { id: 1 } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
