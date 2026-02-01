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
      if (errorCode === "otp_expired") {
        navigate("/auth/login", {
          state: {
            error:
              "This link has expired. Please request a new one.",
          },
          replace: true,
        });
      } else {
        navigate("/auth/login", {
          state: {
            error: errorDescription || "Authentication failed.",
          },
          replace: true,
        });
      }

      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    /**
     * ✅ SUCCESSFUL EMAIL CONFIRMATION / MAGIC LINKS
     */
    const type = params.get("type");

    if (type === "signup" || type === "email") {
      navigate("/auth/login", {
        state: {
          message: "Email verified successfully. You can now log in.",
        },
        replace: true,
      });
    } else if (type === "magiclink" || type === "invite") {
      navigate("/seller/dashboard", { replace: true });
    } else {
      navigate("/auth/login", { replace: true });
    }

    window.history.replaceState(null, "", window.location.pathname);
  }, [navigate]);

  return null;
}
