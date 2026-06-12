import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { AdminPanel } from "@/components/admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requirePageUser();
  if (!user.isAdmin) redirect("/");
  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-1.5">
          Admin
        </div>
        <h1 className="text-3xl font-semibold">Control room</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
          Run discovery for everyone and choose who else can trigger scans.
        </p>
      </div>
      <AdminPanel />
    </div>
  );
}
