import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { deriveApplicationReadiness } from "@/lib/application-agent/workflow-types";
import BatchRunner from "./batch-runner";

export const dynamic = "force-dynamic";

export default async function ApplicationInboxPage() {
  const user = await requirePageUser();
  const [applications, activeBatch] = await Promise.all([
    prisma.application.findMany({
      where: { userId: user.id, status: { notIn: ["rejected", "closed"] } },
      include: { tasks: { select: { status: true, required: true } }, analysis: { select: { score: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.applicationBatch.findFirst({
      where: { userId: user.id, status: { in: ["PENDING", "RUNNING"] } },
      include: { items: { include: { application: { select: { company: true, role: true } } }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Application inbox</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Prepare up to five opportunities using the same analysis, resume, and recruiter workflows as each application page.
        </p>
      </div>
      <BatchRunner
        applications={applications.map((application) => ({
          id: application.id,
          company: application.company,
          role: application.role,
          readiness: deriveApplicationReadiness(application.tasks),
          score: application.analysis?.score ?? null,
        }))}
        initialBatch={activeBatch ? {
          id: activeBatch.id,
          status: activeBatch.status,
          operations: activeBatch.operations,
          items: activeBatch.items.map((item) => ({
            id: item.id,
            applicationId: item.applicationId,
            status: item.status,
            currentStep: item.currentStep,
            errorMessage: item.errorMessage,
            application: item.application,
          })),
        } : null}
      />
    </div>
  );
}
