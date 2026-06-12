import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { generateExtensionToken, revokeExtensionToken } from "@/lib/credentials";

// Personal API token for the Chrome extension. Only the sha256 hash is
// stored — POST returns the full token exactly once.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const cred = await prisma.userCredential.findUnique({
      where: { userId: user.id },
      select: { extensionTokenPrefix: true },
    });
    return NextResponse.json({ tokenPrefix: cred?.extensionTokenPrefix ?? null });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const token = await generateExtensionToken(user.id);
    return NextResponse.json({ token, tokenPrefix: token.slice(0, 12) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await revokeExtensionToken(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
