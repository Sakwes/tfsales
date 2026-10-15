import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// This development branch must never silently fall back to the tracked production dotenv.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const mock =
    mode === "development" &&
    process.env.SELLNOVA_ISOLATED_MOCKS === "1" &&
    env.VITE_SUPABASE_URL === "http://127.0.0.1:54321" &&
    env.VITE_SUPABASE_PUBLISHABLE_KEY === "mock-public-key";
  if (
    !mock &&
    env.VITE_SUPABASE_URL !== "https://qfcnaceeppgrquoszkor.supabase.co"
  ) {
    throw new Error(
      "Development branch refused a Supabase target other than sellnova-v2-dev. Inject development configuration explicitly.",
    );
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!mock && !key.startsWith("sb_publishable_")) {
    let safeAnon = false;
    try {
      const claims = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      );
      safeAnon =
        claims.role === "anon" && claims.ref === "qfcnaceeppgrquoszkor";
    } catch {
      /* fail closed */
    }
    if (!safeAnon)
      throw new Error(
        "A development publishable key is required; privileged or mismatched keys are refused.",
      );
  }
  return {
    server: { host: "::", port: 8080 },
    plugins: [react(), mode === "development" && componentTagger()].filter(
      Boolean,
    ),
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  };
});
