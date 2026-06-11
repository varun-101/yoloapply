// One-off: close out any ScanRun rows that were left open by a killed process.
import { prisma } from "../src/lib/db";

try { process.loadEnvFile(".env"); } catch {}

async function main() {
  const stale = await prisma.scanRun.findMany({ where: { finishedAt: null } });
  if (stale.length === 0) {
    console.log("No stale scan runs found.");
    return;
  }
  for (const run of stale) {
    console.log(`Closing stale run ${run.id} (started ${run.startedAt.toISOString()}, trigger=${run.trigger})`);
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        error: "Process terminated before scan could complete",
      },
    });
  }
  console.log(`Fixed ${stale.length} stale run(s).`);
}

main()
  .catch((e) => {
    console.error("fix-stale-runs failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
