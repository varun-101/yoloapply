import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { refreshDueFollowUps } from "@/lib/application-agent/follow-up";
import { formatDate } from "@/lib/utils";
import FollowUpActions from "./follow-up-actions";

export const dynamic = "force-dynamic";

const statusClass: Record<string, string> = {
  DUE: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  SCHEDULED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  SENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  FAILED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  CANCELLED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SENDING: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
};

export default async function FollowUpsPage() {
  const user = await requirePageUser();
  await refreshDueFollowUps(user.id);
  const followUps = await prisma.followUp.findMany({
    where: { application: { userId: user.id } },
    include: {
      application: { select: { id: true, company: true, role: true, status: true } },
      originalEmail: { select: { toAddress: true, toName: true, subject: true, sentAt: true } },
    },
    orderBy: [{ scheduledFor: "asc" }],
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Follow-ups</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Drafts are scheduled after initial outreach, but only sent after you review and confirm them.
        </p>
      </div>

      {followUps.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-slate-500">No follow-ups scheduled yet.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {followUps.map((followUp) => {
            const terminal = followUp.status === "SENT" || followUp.status === "CANCELLED" || followUp.status === "SENDING";
            return (
              <Card key={followUp.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>
                      <Link href={`/applications/${followUp.application.id}`} className="hover:underline">
                        {followUp.application.company} — {followUp.application.role}
                      </Link>
                    </CardTitle>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      To {followUp.originalEmail.toName || followUp.originalEmail.toAddress} · scheduled {formatDate(followUp.scheduledFor)}
                    </div>
                  </div>
                  <Badge className={statusClass[followUp.status] ?? statusClass.SCHEDULED}>{followUp.status.toLowerCase()}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-sm">
                    <div className="font-medium">{followUp.subject}</div>
                    <div className="mt-2 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{followUp.body}</div>
                  </div>
                  {followUp.errorMessage && <div className="text-sm text-rose-700 dark:text-rose-300">{followUp.errorMessage}</div>}
                  {!terminal && <FollowUpActions id={followUp.id} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
