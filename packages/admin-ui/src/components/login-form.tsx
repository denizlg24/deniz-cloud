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
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error("An unexpected error occurred");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {step === "credentials" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
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
              autoComplete="current-password"
              required
            />
          </div>
        </>
      )}

      {step === "totp" && !useRecovery && (
        <div className="space-y-2">
          <Label htmlFor="totp">Authenticator code</Label>
          <Input
            id="totp"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            autoFocus
            autoComplete="one-time-code"
            required
          />
          {showRecoveryOption && (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setUseRecovery(true)}
            >
              Use a recovery code instead
            </button>
          )}
        </div>
      )}

      {step === "totp" && useRecovery && (
        <div className="space-y-2">
          <Label htmlFor="recovery">Recovery code</Label>
          <Input
            id="recovery"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoFocus
            required
          />
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setUseRecovery(false)}
          >
            Use authenticator code instead
          </button>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Signing in..." : step === "credentials" ? "Continue" : "Sign in"}
      </Button>

      {step === "totp" && (
        <button
          type="button"
          className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            setStep("credentials");
            setTotpCode("");
            setRecoveryCode("");
            setUseRecovery(false);
          }}
        >
          Back to login
        </button>
      )}
    </form>
  );
}
