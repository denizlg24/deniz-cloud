import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiRequestError, completeSignup, setupTotp, verifyTotpSetup } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Step = "credentials" | "totp-setup" | "totp-verify" | "recovery-codes";

export function SignupPage() {
  const navigate = useNavigate();
  const { setUser, isAuthenticated } = useAuth();

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (
    isAuthenticated &&
    step !== "totp-setup" &&
    step !== "totp-verify" &&
    step !== "recovery-codes"
  ) {
    navigate("/", { replace: true });
  }

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      const data = await completeSignup({
        username: username.trim().toLowerCase(),
        email,
        password,
      });
      setUser(data.user);

      const uri = await setupTotp();
      setTotpUri(uri);
      setStep("totp-setup");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.message);
      } else {
        toast.error("Signup failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyTotp(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const codes = await verifyTotpSetup(totpCode);
      setRecoveryCodes(codes);
      setStep("recovery-codes");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        toast.error(err.message);
      } else {
        toast.error("Invalid code");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleFinish() {
    navigate("/", { replace: true });
  }

  const totpSecret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {step === "credentials" && "Complete your account"}
            {step === "totp-setup" && "Set up two-factor authentication"}
            {step === "totp-verify" && "Verify authenticator"}
            {step === "recovery-codes" && "Save your recovery codes"}
          </CardTitle>
          <CardDescription>
            {step === "credentials" && "Enter your details to activate your account"}
            {step === "totp-setup" && "Scan the QR code with your authenticator app"}
            {step === "totp-verify" && "Enter the 6-digit code from your authenticator"}
            {step === "recovery-codes" &&
              "Store these codes somewhere safe — you won't see them again"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your assigned username"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Setting up..." : "Continue"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}

          {step === "totp-setup" && (
            <div className="space-y-4">
              <div className="flex justify-center rounded-lg bg-white p-4">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
                  alt="TOTP QR Code"
                  className="h-48 w-48"
                />
              </div>

              {totpSecret && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Or enter this key manually:</p>
                    <code className="block rounded bg-muted px-3 py-2 text-center text-sm font-mono select-all break-all">
                      {totpSecret}
                    </code>
                  </div>
                </>
              )}

              <Button className="w-full" onClick={() => setStep("totp-verify")}>
                I&apos;ve scanned it
              </Button>
            </div>
          )}

          {step === "totp-verify" && (
            <form onSubmit={handleVerifyTotp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="totp-code">Authenticator code</Label>
                <Input
                  id="totp-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Verifying..." : "Verify"}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setStep("totp-setup")}
              >
                Back to QR code
              </button>
            </form>
          )}

          {step === "recovery-codes" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4">
                {recoveryCodes.map((code) => (
                  <code key={code} className="text-sm font-mono text-center py-1">
                    {code}
                  </code>
                ))}
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(recoveryCodes.join("\n"));
                  toast.success("Codes copied to clipboard");
                }}
              >
                Copy all codes
              </Button>

              <Separator />

              <div className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  id="codes-acknowledged"
                  checked={codesAcknowledged}
                  onCheckedChange={(checked) => setCodesAcknowledged(!!checked)}
                />
                <label
                  htmlFor="codes-acknowledged"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  I&apos;ve saved these codes in a secure location. I understand they cannot be
                  shown again.
                </label>
              </div>

              <Button className="w-full" disabled={!codesAcknowledged} onClick={handleFinish}>
                Go to my files
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
