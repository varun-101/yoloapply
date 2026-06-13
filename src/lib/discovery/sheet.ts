import * as XLSX from "xlsx";
import { createHash } from "crypto";
import type { FetchResult, RawLead } from "./types";

// Community-maintained freshers job sheet, updated daily. CSV export drops the
// hyperlink behind the "Link" cells, so we pull XLSX (which keeps them) and read
// each link cell's Target.
const SPREADSHEET_ID =
  process.env.DISCOVERY_SHEET_ID ?? "1a0_P5Wcf3YTePSlqoxP9fPldDEFyMrW1pFKxF3Xin34";

// Tabs to ingest from the workbook. They share one column layout (Company Name /
// Job Role / Job Location / a date column / Source link page / Experience /
// Skills), so a single parser handles every tab — we download the workbook once
// and read each. "Working Professionals" / "Misc" are intentionally left out:
// this is a curated tier-1 feed that passes the per-user title filter, so only
// junior-appropriate tabs belong here. The tab's jobType is stamped on its rows
// (the sheet itself carries no job-type column).
interface SheetTab {
  name: string;
  jobType?: string;
}
const SHEET_TABS: SheetTab[] = [
  { name: process.env.DISCOVERY_SHEET_TAB ?? "Full Time Roles (Freshers)", jobType: "Full Time" },
  { name: "Interns Hiring", jobType: "Internship" },
];

// The date column is headed "Date of Job posting" on some tabs and just "Date"
// on others.
const DATE_HEADERS = ["date of job posting", "date"];

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

// Parse one worksheet into leads. Returns [] for a tab that isn't present in the
// workbook (e.g. renamed) rather than failing the whole fetch — the other tabs
// still ingest.
function parseTab(wb: XLSX.WorkBook, tab: SheetTab): RawLead[] {
  const ws = wb.Sheets[tab.name];
  if (!ws || !ws["!ref"]) return [];

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
  if (headerRow === -1) return [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = normHeader(cell(headerRow, c)?.v);
    if (h) col[h] = c;
  }

  const text = (r: number, name: string): string => {
    const c = col[name];
    return c === undefined ? "" : String(cell(r, c)?.v ?? "").trim();
  };
  const dateCol = DATE_HEADERS.map((h) => col[h]).find((c) => c !== undefined);

  const leads: RawLead[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const company = text(r, "company name");
    const role = text(r, "job role");
    if (!company || !role) continue; // blank spacer rows

    const postedAt = dateCol === undefined ? undefined : parseSheetDate(cell(r, dateCol)?.v);
    const linkCell = col["source link page"] !== undefined ? cell(r, col["source link page"]) : undefined;
    const url = linkCell?.l?.Target || undefined;

    // Tab name is folded into the id so the same company+role+date appearing in
    // two tabs (full-time vs internship listing) stays distinct.
    const externalId = createHash("sha1")
      .update(
        `${tab.name}|${company.toLowerCase()}|${role.toLowerCase()}|${postedAt?.toISOString().slice(0, 10) ?? ""}`
      )
      .digest("hex");

    leads.push({
      source: "sheet",
      externalId,
      company,
      role,
      location: text(r, "job location") || undefined,
      url,
      jobType: tab.jobType,
      experience: text(r, "experience required") || undefined,
      skills: text(r, "skills required") || undefined,
      postedAt,
    });
  }
  return leads;
}

export async function fetchSheetLeads(): Promise<FetchResult> {
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`,
      { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
    );
    if (!res.ok) throw new Error(`sheet export returned HTTP ${res.status}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });

    const leads = SHEET_TABS.flatMap((tab) => parseTab(wb, tab));
    // Every configured tab missing usually means the workbook was restructured —
    // surface that instead of silently returning nothing.
    if (leads.length === 0) {
      throw new Error(
        `no rows parsed from tabs [${SHEET_TABS.map((t) => t.name).join(", ")}] — workbook has: ${wb.SheetNames.join(", ")}`
      );
    }

    return { source: "sheet", leads };
  } catch (e: unknown) {
    return { source: "sheet", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
