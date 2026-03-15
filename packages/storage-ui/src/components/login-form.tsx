import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiRequestError, login } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Step = "credentials" | "totp";

export function LoginForm() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [showRecoveryOption, setShowRecoveryOption] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = await login({
        username,
        password,
        ...(step === "totp" && !useRecovery && { totpCode }),
        ...(step === "totp" && useRecovery && { recoveryCode }),
      });

      setUser(data.user);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "TOTP_REQUIRED") {
          setStep("totp");
          setShowRecoveryOption(err.requiresRecoveryCode ?? false);
        } else if (err.code === "INVALID_CREDENTIALS") {
          toast.error("Invalid username or password");
        } else if (err.code === "INVALID_TOTP") {
          toast.error("Invalid TOTP code");
          setTotpCode("");
        } else if (err.code === "INVALID_RECOVERY_CODE") {
          toast.error("Invalid recovery code");
          setRecoveryCode("");
        } else {
          toast.error(err.code);
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBack() {
    setStep("credentials");
    setTotpCode("");
    setRecoveryCode("");
    setUseRecovery(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {step === "credentials" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </>
      )}

      {step === "totp" && !useRecovery && (
        <div className="space-y-2">
          <Label htmlFor="totpCode">Authenticator code</Label>
          <Input
            id="totpCode"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="000000"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      )}

      {step === "totp" && useRecovery && (
        <div className="space-y-2">
          <Label htmlFor="recoveryCode">Recovery code</Label>
          <Input
            id="recoveryCode"
            type="text"
            autoFocus
            required
            placeholder="XXXX-XXXX"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
          />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : step === "credentials" ? "Sign in" : "Verify"}
      </Button>

      {step === "totp" && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleBack}
          >
            Back
          </button>
          {showRecoveryOption && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setTotpCode("");
                setRecoveryCode("");
              }}
            >
              {useRecovery ? "Use authenticator" : "Use recovery code"}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
