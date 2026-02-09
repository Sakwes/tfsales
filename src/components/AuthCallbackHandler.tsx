import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export function AuthCallbackHandler() {
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.substring(1));
    const error = params.get("error");
    const errorCode = params.get("error_code");

    // Only handle ERROR cases here.
    // Successful token exchanges are handled by Supabase client automatically
    // and the PASSWORD_RECOVERY event in AuthContext.
    if (!error) return;

    handled.current = true;
    window.history.replaceState(null, "", window.location.pathname);

    if (errorCode === "otp_expired") {
      // Determine flow from the current pathname (set via redirectTo)
      const isRecovery =
        window.location.pathname.includes("reset-password") ||
        window.location.pathname.includes("forgot-password");

      if (isRecovery) {
        navigate("/auth/forgot-password", {
          state: {
            error:
              "This password reset link has expired. Please request a new one."
          },
          replace: true
        });
      } else {
        navigate("/auth/resend-confirmation", {
          state: {
            error:
              "This confirmation link has expired. Please request a new one."
          },
          replace: true
        });
      }
      return;
    }

    // Generic error fallback
    navigate("/auth/login", {
      state: { error: "Something went wrong. Please try again." },
      replace: true
    });
  }, [navigate]);

  return null;
}
