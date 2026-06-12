import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="grid min-h-[85vh] place-items-center p-6">
      <div className="space-y-6">
        <div className="text-center">
          <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Access
          </div>
          <h1 className="font-display text-3xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            The agent works the night shift. You just review.
          </p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
