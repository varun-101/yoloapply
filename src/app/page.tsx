import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor, statusBarColor } from "@/lib/utils";
import { ArrowRight, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

// Pipeline stages in the order an application moves through them.
const STATUS_ORDER = ["draft", "personalized", "applied", "replied", "interview", "offer", "rejected", "closed"];

export default async function Dashboard() {
  const [apps, emails] = await Promise.all([
    prisma.application.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.email.count(),
  ]);

  const byStatus = await prisma.application.groupBy({
    by: ["status"],
    _count: { status: true },
  });

  const counts = new Map(byStatus.map((s) => [s.status, s._count.status]));
  const total = byStatus.reduce((acc, s) => acc + s._count.status, 0);
  const pipeline = STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 })).filter(
    (p) => p.count > 0
  );

  const stats = [
    { label: "tracked", value: total },
    { label: "applied", value: counts.get("applied") ?? 0 },
    { label: "interviews", value: counts.get("interview") ?? 0 },
    { label: "offers", value: counts.get("offer") ?? 0 },
    { label: "cold emails", value: emails },
  ];

  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-1.5">
            Overview
          </div>
          <h1 className="text-3xl font-semibold">The hunt, at a glance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Everything the agent has tracked, applied to, and sent on your behalf.
          </p>
        </div>
        <Button asChild>
          <Link href="/applications/new">
            <PlusCircle className="h-4 w-4" />
            New application
          </Link>
        </Button>
      </div>

      <Card className="mb-8">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
          {stats.map((s) => (
            <div key={s.label} className="px-4 py-4 md:px-5">
              <div className="font-display text-3xl font-semibold tabular-nums">{s.value}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 mt-1">
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <CardContent className="py-3.5">
          {total === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The pipeline is empty —{" "}
              <Link href="/discover" className="text-signal-deep dark:text-signal hover:underline">
                scan for leads
              </Link>{" "}
              or{" "}
              <Link href="/applications/new" className="text-signal-deep dark:text-signal hover:underline">
                add an application
              </Link>{" "}
              to start it.
            </p>
          ) : (
            <div>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                {pipeline.map((p) => (
                  <div
                    key={p.status}
                    className={statusBarColor(p.status)}
                    style={{ width: `${(p.count / total) * 100}%` }}
                    title={`${p.status}: ${p.count}`}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {pipeline.map((p) => (
                  <span key={p.status} className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusBarColor(p.status)}`} />
                    {p.status} {p.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent applications</CardTitle>
          <Link
            href="/applications"
            className="text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:underline flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {apps.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No applications yet.{" "}
              <Link className="underline" href="/applications/new">
                Start by adding one.
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-medium">{a.company}</td>
                    <td className="px-4 py-3">{a.role}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{a.source}</td>
                    <td className="px-4 py-3">
                      <Badge className={statusColor(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(a.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/applications/${a.id}`}
                        className="text-slate-600 dark:text-slate-300 hover:text-signal-deep dark:hover:text-signal hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
