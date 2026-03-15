import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiRequestError, getMe, setupTotp, verifyTotpSetup } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Step = "setup" | "verify" | "recovery-codes";

export function SetupMfaPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, setUser } = useAuth();

  const [step, setStep] = useState<Step>("setup");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (user.totpEnabled) return;

    setupTotp()
      .then((uri) => {
        setTotpUri(uri);
        setInitializing(false);
      })
      .catch(() => {
        toast.error("Failed to initialize TOTP setup");
        setInitializing(false);
      });
  }, [isAuthenticated, user]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.totpEnabled) {
    return <Navigate to="/" replace />;
  }

  const totpSecret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;

  async function handleVerify(e: FormEvent) {
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

  async function handleFinish() {
    const updated = await getMe();
    setUser(updated);
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {step === "setup" && "Set up two-factor authentication"}
            {step === "verify" && "Verify authenticator"}
            {step === "recovery-codes" && "Save your recovery codes"}
          </CardTitle>
          <CardDescription>
            {step === "setup" &&
              "Two-factor authentication is required. Scan the QR code with your authenticator app."}
            {step === "verify" && "Enter the 6-digit code from your authenticator"}
            {step === "recovery-codes" &&
              "Store these codes somewhere safe — you won't see them again"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "setup" && (
            <div className="space-y-4">
              {initializing ? (
                <div className="flex justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : (
                <>
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

                  <Button className="w-full" onClick={() => setStep("verify")}>
                    I&apos;ve scanned it
                  </Button>
                </>
              )}
            </div>
          )}

          {step === "verify" && (
            <form onSubmit={handleVerify} className="space-y-4">
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
                onClick={() => setStep("setup")}
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

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={codesAcknowledged}
                  onChange={(e) => setCodesAcknowledged(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-muted-foreground">
                  I&apos;ve saved these codes in a secure location. I understand they cannot be
                  shown again.
                </span>
              </label>

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
