try { process.loadEnvFile(".env") } catch {}
import { prisma } from "../src/lib/db";

const EMAIL = "varunchandwani101@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.log(`No user found for ${EMAIL}`);
    const all = await prisma.user.findMany({ select: { email: true } });
    console.log("Existing users:", all.map((u) => u.email).join(", "));
    return;
  }
  const userId = user.id;

  const [
    applicationsTotal,
    appsByStatus,
    appliedCount,
    emailsTotal,
    emailsSent,
    emailsReplied,
    contactsTotal,
    contactsVerified,
    userLeadsTotal,
    promotedLeads,
    scoredLeads,
    topScores,
    scanRuns,
    catalogTotal,
    firstApp,
    lastApp,
  ] = await Promise.all([
    prisma.application.count({ where: { userId } }),
    prisma.application.groupBy({ by: ["status"], where: { userId }, _count: true }),
    prisma.application.count({ where: { userId, status: { in: ["applied", "replied", "interview", "offer", "rejected"] } } }),
    prisma.email.count({ where: { userId } }),
    prisma.email.count({ where: { userId, status: { in: ["sent", "replied"] } } }),
    prisma.email.count({ where: { userId, status: "replied" } }),
    prisma.contact.count({ where: { userId } }),
    prisma.contact.count({ where: { userId, verified: true } }),
    prisma.userLead.count({ where: { userId } }),
    prisma.userLead.count({ where: { userId, status: "promoted" } }),
    prisma.userLead.count({ where: { userId, score: { not: null } } }),
    prisma.userLead.findMany({ where: { userId, score: { not: null } }, orderBy: { score: "desc" }, take: 5, select: { score: true, jobLead: { select: { company: true, role: true } } } }),
    prisma.scanRun.count({ where: { userId } }),
    prisma.jobLead.count(),
    prisma.application.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.application.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const days = firstApp && lastApp
    ? Math.max(1, Math.round((+lastApp.createdAt - +firstApp.createdAt) / 86400000))
    : null;

  console.log("\n==================  STATS for", EMAIL, " ==================");
  console.log("account created:      ", user.createdAt.toISOString().slice(0, 10));
  console.log("global catalog size:  ", catalogTotal, "postings discovered (shared)");
  console.log("scan runs (this user):", scanRuns);
  console.log("");
  console.log("--- Discovery / fit-scoring ---");
  console.log("leads surfaced to you:", userLeadsTotal);
  console.log("leads fit-scored:     ", scoredLeads);
  console.log("leads promoted to app:", promotedLeads);
  console.log("top fit scores:");
  for (const l of topScores) console.log(`   ${l.score}  ${l.jobLead.company} — ${l.jobLead.role}`);
  console.log("");
  console.log("--- Applications ---");
  console.log("applications total:   ", applicationsTotal);
  console.log("actually applied+:    ", appliedCount);
  console.log("by status:");
  for (const s of appsByStatus) console.log(`   ${s.status.padEnd(14)} ${s._count}`);
  if (days) console.log(`activity window:       ${days} days (first → last application)`);
  console.log("");
  console.log("--- Cold email / contacts ---");
  console.log("contacts found:       ", contactsTotal, `(${contactsVerified} verified)`);
  console.log("emails drafted:       ", emailsTotal);
  console.log("emails sent:          ", emailsSent);
  console.log("email replies:        ", emailsReplied);
  console.log("=========================================================\n");
}

main().catch(console.error).finally(() => prisma.$disconnect());
