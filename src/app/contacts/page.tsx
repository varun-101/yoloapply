import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const user = await requirePageUser();
  const contacts = await prisma.contact.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { emails: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Contacts</h1>
      <Card>
        <CardHeader>
          <CardTitle>People you&apos;ve reached out to</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No contacts yet — they&apos;ll show up here as you send cold emails.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Last email</th>
                  <th className="px-4 py-3">Added</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/contacts/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c.title ?? "—"}</td>
                    <td className="px-4 py-3">{c.company}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {c.email ? <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.source === "cold_email_target" ? (
                        <Badge className="bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300">cold email</Badge>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">{c.source ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                      {c.emails[0]?.sentAt
                        ? formatDate(c.emails[0].sentAt)
                        : c.emails[0]
                        ? c.emails[0].status
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatDate(c.createdAt)}</td>
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
