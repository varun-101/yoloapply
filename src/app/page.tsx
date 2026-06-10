import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor } from "@/lib/utils";
import { ArrowRight, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [apps, emails, contacts] = await Promise.all([
    prisma.application.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.email.count(),
    prisma.contact.count(),
  ]);

  const byStatus = await prisma.application.groupBy({
    by: ["status"],
    _count: { status: true },
  });

  const stats = {
    total: byStatus.reduce((acc, s) => acc + s._count.status, 0),
    applied: byStatus.find((s) => s.status === "applied")?._count.status ?? 0,
    interview: byStatus.find((s) => s.status === "interview")?._count.status ?? 0,
    offer: byStatus.find((s) => s.status === "offer")?._count.status ?? 0,
    emails,
    contacts,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Track applications, personalize resumes, send outreach.</p>
        </div>
        <Button asChild>
          <Link href="/applications/new">
            <PlusCircle className="h-4 w-4" />
            New Application
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatCard label="Applications" value={stats.total} />
        <StatCard label="Applied" value={stats.applied} />
        <StatCard label="Interviews" value={stats.interview} />
        <StatCard label="Offers" value={stats.offer} />
        <StatCard label="Cold emails" value={stats.emails} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent applications</CardTitle>
          <Link href="/applications" className="text-sm text-slate-600 dark:text-slate-300 hover:underline flex items-center gap-1">
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
              <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900">
                    <td className="px-4 py-3 font-medium">{a.company}</td>
                    <td className="px-4 py-3">{a.role}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.source}</td>
                    <td className="px-4 py-3">
                      <Badge className={statusColor(a.status)}>{a.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/applications/${a.id}`} className="text-slate-600 dark:text-slate-300 hover:underline">
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
