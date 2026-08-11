import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/auth";
import { LandingPage } from "@/components/landing-page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor, statusBarColor } from "@/lib/utils";
import { getSetupStatus } from "@/lib/setup";
import { SetupChecklist } from "@/components/setup-checklist";
import { ArrowRight, PlusCircle, Shield } from "lucide-react";

export const dynamic = "force-dynamic";

// Pipeline stages in the order an application moves through them.
const STATUS_ORDER = ["draft", "personalized", "applied", "replied", "interview", "offer", "rejected", "closed"];

export default async function Dashboard() {
  // "/" is public: signed-out visitors see the landing page, signed-in users
  // get the dashboard.
  const { userId: clerkId } = await auth();
  if (!clerkId) return <LandingPage />;
  const user = await ensureUser(clerkId);

  const [apps, emails, setup] = await Promise.all([
    prisma.application.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.email.count({ where: { userId: user.id } }),
    getSetupStatus(user.id),
  ]);

  const byStatus = await prisma.application.groupBy({
    by: ["status"],
    where: { userId: user.id },
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
          <h1 className="text-2xl sm:text-3xl font-semibold">The hunt, at a glance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Everything the agent has tracked, applied to, and sent on your behalf.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/applications/new">
            <PlusCircle className="h-4 w-4" />
            New application
          </Link>
        </Button>
      </div>

      {user.isAdmin && (
        <Link
          href="/admin"
          className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/10 px-4 py-3 transition-colors hover:bg-signal/20"
        >
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-signal-deep dark:text-signal shrink-0" />
            <div>
              <div className="text-sm font-medium text-amber-900 dark:text-signal">Admin control room</div>
              <div className="font-mono text-[11px] text-amber-800/80 dark:text-signal/80">
                run discovery for everyone · grant scan access
              </div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-signal-deep dark:text-signal" />
        </Link>
      )}

      <SetupChecklist status={setup} />

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
            <>
            {/* Phones: the same rows as a tappable list. */}
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
                        {a.source} · {formatDate(a.createdAt)}
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
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
