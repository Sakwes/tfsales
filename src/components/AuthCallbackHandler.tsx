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
        const type = params.get("type");

        if (type === "recovery") {
          // Expired password reset link → forgot password page
          navigate("/auth/forgot-password", {
            state: {
              error:
                "This password reset link has expired. Please request a new one.",
            },
            replace: true,
          });
        } else {
          // Expired signup/confirmation link → resend confirmation page
          navigate("/auth/resend-confirmation", {
            state: {
              error:
                "This confirmation link has expired. Please request a new one.",
            },
            replace: true,
          });
        }
      } else {
        navigate("/auth/login", {
          state: {
            error: errorDescription || "Authentication failed.",
          },
          replace: true,
        });
      }
      return;
    }

    /**
     * ✅ SUCCESSFUL EMAIL CONFIRMATION / MAGIC LINKS
     */
    const type = params.get("type");

    if (type === "signup" || type === "email") {
      window.history.replaceState(null, "", window.location.pathname);
      navigate("/auth/login", {
        state: {
          message: "Email verified successfully. You can now log in.",
        },
        replace: true,
      });
    } else if (type === "recovery") {
      // Don't navigate — let the PASSWORD_RECOVERY event in AuthContext
      // handle the redirect to /auth/reset-password.
      // Just clean the hash so it doesn't re-trigger.
      window.history.replaceState(null, "", window.location.pathname);
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
