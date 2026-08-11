import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor } from "@/lib/utils";
import { PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AppsList() {
  const user = await requirePageUser();
  const apps = await prisma.application.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/applications/new">
            <PlusCircle className="h-4 w-4" /> New Application
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All applications</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {apps.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No applications yet.</div>
          ) : (
            <>
            {/* Phones get a tappable list — a 6-column table can only be read
                by side-scrolling, which hid the company name off-screen. */}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {apps.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/applications/${a.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-slate-800/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.company}</div>
                      <div className="truncate text-sm text-slate-600 dark:text-slate-300">{a.role}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {a.source} · {formatDate(a.appliedAt ?? a.createdAt)}
                      </div>
                    </div>
                    <Badge className={`${statusColor(a.status)} shrink-0`}>{a.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Applied</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/applications/${a.id}`} className="hover:underline">
                        {a.company}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{a.role}</td>
                    <td className="px-4 py-3">
                      <Badge className={statusColor(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{a.source}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{formatDate(a.appliedAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
