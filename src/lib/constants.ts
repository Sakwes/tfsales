// Reserved store names that cannot be used to avoid route conflicts
export const RESERVED_STORE_NAMES = [
  // Auth routes
  "auth",
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "signup",
  "signin",
  "logout",

  // Seller routes
  "seller",
  "dashboard",
  "analytics",
  "onboarding",

  // Admin routes
  "admin",
  "administrator",

  // Legal/static pages
  "terms",
  "privacy",
  "support",
  "help",
  "contact",
  "about",
  "faq",

  // Common reserved words
  "store",
  "stores",
  "shop",
  "shops",
  "api",
  "app",
  "www",
  "mail",
  "email",
  "blog",
  "news",
  "static",
  "assets",
  "images",
  "img",
  "css",
  "js",
  "fonts",

  // System/technical
  "null",
  "undefined",
  "true",
  "false",
  "test",
  "demo",
  "example",
  "sample",
  "404",
  "500",
  "error",
  "not-found",
  "notfound",

  // Business related
  "sellnovas",
  "sell-novas",
  "techfusion",
  "tech-fusion",
];

// Function to check if a store name is reserved
export function isReservedStoreName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/\s+/g, "-");
  return RESERVED_STORE_NAMES.includes(normalized);
}
