import * as XLSX from "xlsx";
import { createHash } from "crypto";
import type { FetchResult, RawLead } from "./types";

// Community-maintained freshers job sheet, updated daily. CSV export drops the
// hyperlink behind the "Link" cells, so we pull XLSX (which keeps them) and read
// each link cell's Target.
const SPREADSHEET_ID =
  process.env.DISCOVERY_SHEET_ID ?? "1a0_P5Wcf3YTePSlqoxP9fPldDEFyMrW1pFKxF3Xin34";
const SHEET_NAME = process.env.DISCOVERY_SHEET_TAB ?? "Full Time Roles (Freshers)";

// Header cells in the sheet have inconsistent trailing spaces ("Job Location ").
function normHeader(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

// Dates are typed into the sheet as DD/MM/YYYY. When the day is ≤ 12, the
// sheet's US locale auto-coerces the text into a real date cell parsed as
// MM/DD — i.e. month and day arrive swapped in the exported serial number.
// Days > 12 are invalid as a US month, so those stay as (correct) DD/MM text.
function parseSheetDate(v: unknown): Date | undefined {
  if (typeof v === "number" && v > 20000) {
    const parsed = new Date(Math.round((v - 25569) * 86400 * 1000));
    const swapped = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCDate() - 1, parsed.getUTCMonth() + 1)
    );
    // Postings can't be future-dated; if the swap produces a future date the
    // cell was genuinely MM/DD-typed, so keep the original.
    const tomorrow = Date.now() + 86400 * 1000;
    if (swapped.getTime() > tomorrow && parsed.getTime() <= tomorrow) return parsed;
    return swapped;
  }
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function fetchSheetLeads(): Promise<FetchResult> {
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`,
      { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
    );
    if (!res.ok) throw new Error(`sheet export returned HTTP ${res.status}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });

    const ws = wb.Sheets[SHEET_NAME];
    if (!ws || !ws["!ref"]) {
      throw new Error(
        `tab "${SHEET_NAME}" not found — workbook has: ${wb.SheetNames.join(", ")}`
      );
    }

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })];

    // Locate the header row (first row containing "Company Name") and map columns.
    let headerRow = -1;
    const col: Record<string, number> = {};
    for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (normHeader(cell(r, c)?.v) === "company name") {
          headerRow = r;
          break;
        }
      }
      if (headerRow !== -1) break;
    }
    if (headerRow === -1) throw new Error("couldn't find the header row (Company Name)");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = normHeader(cell(headerRow, c)?.v);
      if (h) col[h] = c;
    }

    const text = (r: number, name: string): string => {
      const c = col[name];
      return c === undefined ? "" : String(cell(r, c)?.v ?? "").trim();
    };

    const leads: RawLead[] = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const company = text(r, "company name");
      const role = text(r, "job role");
      if (!company || !role) continue; // blank spacer rows

      const dateCell = cell(r, col["date of job posting"]);
      const postedAt = parseSheetDate(dateCell?.v);
      const linkCell = col["source link page"] !== undefined ? cell(r, col["source link page"]) : undefined;
      const url = linkCell?.l?.Target || undefined;

      const externalId = createHash("sha1")
        .update(
          `${company.toLowerCase()}|${role.toLowerCase()}|${postedAt?.toISOString().slice(0, 10) ?? ""}`
        )
        .digest("hex");

      leads.push({
        source: "sheet",
        externalId,
        company,
        role,
        location: text(r, "job location") || undefined,
        url,
        experience: text(r, "experience required") || undefined,
        skills: text(r, "skills required") || undefined,
        postedAt,
      });
    }

    return { source: "sheet", leads };
  } catch (e: unknown) {
    return { source: "sheet", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
