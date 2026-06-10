import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/discovery/pipeline";

export const maxDuration = 300;

export async function POST() {
  try {
    const result = await runDiscovery();
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
