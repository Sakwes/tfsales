import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export function AuthCallbackHandler() {
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const hash = window.location.hash;
    if (!hash) return;

    handled.current = true;
    const params = new URLSearchParams(hash.substring(1));

    const error = params.get("error");
    const errorCode = params.get("error_code");
    const errorDescription = params
      .get("error_description")
      ?.replace(/\+/g, " ");

    /**
     * ❌ EXPIRED / INVALID LINKS
     */
    if (error) {
      window.history.replaceState(null, "", window.location.pathname);

      if (errorCode === "otp_expired") {
        window.history.replaceState(null, "", window.location.pathname);

        // If the user came from a recovery flow, ALWAYS send to forgot password
        if (
          params.get("type") === "recovery" ||
          window.location.pathname.includes("reset-password")
        ) {
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
    }

    /**
     * ✅ SUCCESSFUL EMAIL CONFIRMATION / MAGIC LINKS
     */
    const type = params.get("type");

    if (type === "signup" || type === "email") {
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/auth/login", {
        state: {
          message: "Email verified successfully. You can now log in."
        },
        replace: true
      });
    } else if (type === "recovery") {
      // Valid recovery token — navigate to reset password page.
      // Also handled by PASSWORD_RECOVERY event in AuthContext as a fallback.
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/auth/reset-password", { replace: true });
    } else if (type === "magiclink" || type === "invite") {
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/seller/dashboard", { replace: true });
    } else {
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/auth/login", { replace: true });
    }
  }, [navigate]);

  return null;
}
