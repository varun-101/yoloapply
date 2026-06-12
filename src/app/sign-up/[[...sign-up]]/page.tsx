import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="grid min-h-[85vh] place-items-center p-6">
      <div className="space-y-6">
        <div className="text-center">
          <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Access
          </div>
          <h1 className="font-display text-3xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bring your own profile, projects, and keys — the agent does the rest.
          </p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
