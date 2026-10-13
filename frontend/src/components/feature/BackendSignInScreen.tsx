import { useState, type FormEvent } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";

export interface BackendSignInResult {
  ok: boolean;
  error?: string;
}

interface BackendSignInScreenProps {
  loading?: boolean;
  onSignIn: (email: string, password: string) => Promise<BackendSignInResult>;
}

export default function BackendSignInScreen({ loading, onSignIn }: BackendSignInScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await onSignIn(email.trim(), password);
      if (!result.ok) setError(result.error || "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-100 px-4 py-8">
      <section className="w-full max-w-[25rem] rounded-lg border border-background-200 bg-background-50 p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-100 text-xl text-primary-700">
            <i className="ri-shield-user-line"></i>
          </span>
          <div>
            <h1 className="font-heading text-xl font-extrabold text-foreground-950">
              Sign in
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-foreground-500">
              Use the backend account to load live workspace records.
            </p>
          </div>
        </div>

        <form className="space-y-3.5" onSubmit={submit}>
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="username"
            leftIcon="ri-mail-line"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            leftIcon="ri-lock-password-line"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            fullWidth
            disabled={submitting || loading}
            leftIcon={<i className="ri-login-circle-line"></i>}
          >
            {submitting || loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </section>
    </main>
  );
}
