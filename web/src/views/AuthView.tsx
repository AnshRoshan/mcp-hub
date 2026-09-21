import { useState, type FormEvent } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Divider } from "@astryxdesign/core/Divider";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Heading } from "@astryxdesign/core/Text";
import { Zap } from "lucide-react";
import { emailSignIn, errMsg, socialSignIn } from "../lib/api";
import { useStore } from "../lib/store";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

export default function AuthView() {
  const { phase } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "github" | "email" | null>(null);

  const onSocial = async (provider: "google" | "github") => {
    setBusy(provider);
    setError(null);
    try {
      await socialSignIn(provider);
    } catch (err) {
      setError(errMsg(err, "Sign-in could not start."));
      setBusy(null);
    }
  };

  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("email");
    setError(null);
    try {
      await emailSignIn(email.trim(), password);
    } catch (err) {
      setError(errMsg(err, "Sign-in failed. Is email/password auth enabled?"));
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <Card padding={8} elevation="med" className="w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface">
            <Zap size={30} strokeWidth={2.2} className="text-primary" />
          </span>
          <Heading level={2} className="mt-5">
            MCP Workstation
          </Heading>
          <Text type="supporting" className="mt-2 max-w-[32ch] leading-relaxed">
            One endpoint. Every MCP. Your own toolbox.
          </Text>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button
            label={busy === "google" ? "Redirecting…" : "Continue with Google"}
            variant="secondary"
            icon={<GoogleMark />}
            width="100%"
            isDisabled={busy !== null}
            onClick={() => onSocial("google")}
          />
          <Button
            label={busy === "github" ? "Redirecting…" : "Continue with GitHub"}
            variant="secondary"
            icon={<GitHubMark />}
            width="100%"
            isDisabled={busy !== null}
            onClick={() => onSocial("github")}
          />

          <Divider label="or" />

          <form className="flex flex-col gap-2.5" onSubmit={onEmail}>
            <TextInput
              label="Email"
              isLabelHidden
              type="email"
              placeholder="you@example.com"
              isRequired
              value={email}
              onChange={setEmail}
            />
            <TextInput
              label="Password"
              isLabelHidden
              type="password"
              placeholder="Password"
              isRequired
              value={password}
              onChange={setPassword}
            />
            <Button
              label={busy === "email" ? "Working…" : "Sign in / Sign up"}
              variant="primary"
              type="submit"
              width="100%"
              isLoading={busy === "email"}
              isDisabled={busy !== null && busy !== "email"}
            />
          </form>
        </div>

        {error && (
          <Banner status="error" title="Sign-in failed" description={error} className="mt-4" />
        )}

        {phase === "platform-off" && (
          <Banner
            status="warning"
            title="Platform mode is off"
            description={
              <>
                Sign-in needs <code>BETTER_AUTH_SECRET</code> (plus{" "}
                <code>GOOGLE_CLIENT_ID/SECRET</code> or <code>GITHUB_CLIENT_ID/SECRET</code>) in
                your <code>.env</code>, then a restart. Without it, /mcp is open and there is no
                dashboard auth.
              </>
            }
            className="mt-4"
          />
        )}

        <Collapsible
          trigger={
            <Text type="supporting" size="sm" className="font-medium">
              What we ask for when you sign in
            </Text>
          }
          defaultIsOpen={false}
          className="mt-5"
        >
          <ul className="mt-2 space-y-1.5 pl-4 text-sm text-secondary">
            <li>
              <strong className="text-primary">Google / GitHub:</strong> your name, email, and
              profile picture — <em>only</em>. We request the minimal OAuth scopes (
              <code>openid email profile</code> / <code>read:user user:email</code>).
            </li>
            <li>
              We <strong className="text-primary">never</strong> request access to your email
              contents, Drive, contacts, or repository write access.
            </li>
            <li>
              Your profile creates your account here and shows your avatar — nothing is posted or
              shared anywhere.
            </li>
            <li>
              You can revoke access any time in your provider's account settings, and delete tokens
              from this dashboard.
            </li>
          </ul>
        </Collapsible>
      </Card>
    </div>
  );
}
