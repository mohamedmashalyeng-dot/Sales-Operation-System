import { useEffect, useState, type FormEvent } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";

const kentLogoFull = "/assets/images/kent-logo-full-dark.png";

export interface BackendSignInResult {
  ok: boolean;
  error?: string;
}

interface BackendSignInScreenProps {
  loading?: boolean;
  connectionError?: string;
  onRetry?: () => void;
  onSignIn: (email: string, password: string) => Promise<BackendSignInResult>;
}

export default function BackendSignInScreen({ loading, connectionError, onRetry, onSignIn }: BackendSignInScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!submitting) {
      setStatus("");
      return undefined;
    }
    setStatus("Checking account...");
    const slowTimer = window.setTimeout(() => {
      setStatus("Still connecting to the backend...");
    }, 5000);
    const databaseTimer = window.setTimeout(() => {
      setStatus("Database response is taking longer than expected...");
    }, 12000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(databaseTimer);
    };
  }, [submitting]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await onSignIn(email.trim().toLowerCase(), password);
      if (!result.ok) setError(result.error || "Sign in failed.");
    } catch {
      setError("Unable to sign in. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-100 px-4 py-8">
      <section className="w-full max-w-[25rem] rounded-lg border border-background-200 bg-background-50 p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-4">
          <img
            src={kentLogoFull}
            alt="Kent Business College"
            className="h-14 w-auto max-w-[15rem] object-contain object-left"
          />
          <div>
            <h1 className="font-heading text-xl font-extrabold text-foreground-950">
              Sign in
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-foreground-500">
              Use your work email and password. Your account opens with its assigned role and permissions.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-md bg-primary-50 p-3 text-xs text-foreground-600">
          <p className="font-semibold text-primary-800">Manager · Staff Sales · Staff Enrollment</p>
          <p className="mt-1">Managers can view the team. Staff can view their assigned records.</p>
        </div>
        {connectionError ? <div role="alert" className="mb-4 space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700"><p>{connectionError}</p>{onRetry && <Button size="sm" variant="outline" disabled={loading || submitting} loading={loading} onClick={onRetry}>Retry connection</Button>}</div> : null}
        <form className="space-y-3.5" onSubmit={submit} aria-busy={submitting || loading}>
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            leftIcon="ri-mail-line"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <div className="relative"><Input
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            leftIcon="ri-lock-password-line"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          /><button type="button" className="mt-1 text-xs font-semibold text-primary-700" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide password' : 'Show password'}</button></div>
          {error ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            fullWidth
            loading={submitting || loading}
            disabled={submitting || loading}
            leftIcon={<i className="ri-login-circle-line"></i>}
          >
            {submitting ? status || "Signing in..." : loading ? "Loading workspace..." : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
