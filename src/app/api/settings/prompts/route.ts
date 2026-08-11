import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import {
  DEFAULT_SYSTEM,
  MAX_PROMPT_CHARS,
  PROMPT_SURFACES,
  SURFACE_META,
  VOICE_PLACEHOLDER,
  composeSystem,
  getUserPrompts,
  setUserPrompts,
  type PromptSurface,
  type UserPrompts,
} from "@/lib/prompts";

// Per-user writing instructions layered onto the built-in system prompts.
// GET also returns the read-only defaults so the settings page can show what
// the user's text is being appended to, plus a preview of the composed result.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const prompts = await getUserPrompts(user.id);
    return NextResponse.json({
      prompts,
      defaults: DEFAULT_SYSTEM,
      surfaces: SURFACE_META,
      voicePlaceholder: VOICE_PLACEHOLDER,
      maxChars: MAX_PROMPT_CHARS,
      previews: Object.fromEntries(
        PROMPT_SURFACES.map((s) => [s, composeSystem(s, prompts)])
      ) as Record<PromptSurface, string>,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as Partial<Record<keyof UserPrompts, unknown>>;

    const patch: Partial<UserPrompts> = {};
    for (const key of ["voice", ...PROMPT_SURFACES] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${key} must be a string` }, { status: 400 });
      }
      if (value.trim().length > MAX_PROMPT_CHARS) {
        return NextResponse.json(
          { error: `${key} is too long — keep it under ${MAX_PROMPT_CHARS} characters` },
          { status: 400 }
        );
      }
      patch[key] = value;
    }

    const prompts = await setUserPrompts(user.id, patch);
    return NextResponse.json({
      prompts,
      previews: Object.fromEntries(
        PROMPT_SURFACES.map((s) => [s, composeSystem(s, prompts)])
      ) as Record<PromptSurface, string>,
    });
  } catch (e) {
    return apiError(e);
  }
}
