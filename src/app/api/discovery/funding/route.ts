import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getFundingRadar, startFundingScan } from "@/lib/discovery/funding";

// Funding radar is global (operator-level) work cached in-memory and refreshed
// each discovery tick. If nothing has populated it yet this process lifetime
// (e.g. right after a restart, before the first tick), kick a best-effort refresh
// in the background and return what we have — the page polls until it lands.
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const radar = getFundingRadar();
    let warming = false;
    if (radar.items.length === 0 && !radar.running) {
      warming = true;
      startFundingScan();
    }
    return NextResponse.json({ ...radar, warming });
  } catch (e) {
    return apiError(e);
  }
}

// Explicit user refresh: actually re-pull the funding feeds + re-extract (the
// kick-off endpoint). Doesn't await the ~minute-long scan — kicks it in the
// background (joining any in-flight run) and returns immediately so the request
// isn't tied to the work; the page polls GET (running -> false) for the result.
export async function POST(req: NextRequest) {
  try {
    await requireUser(req);
    const { alreadyRunning } = startFundingScan();
    return NextResponse.json({ ...getFundingRadar(), scanning: true, alreadyRunning });
  } catch (e) {
    return apiError(e);
  }
}
