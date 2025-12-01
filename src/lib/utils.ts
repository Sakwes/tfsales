import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatCurrency = (amount = 0, currency = "NGN") => {
  // Create Intl.NumberFormat object with Nigerian currency format
  const formatter =
    currency === "GBP"
      ? new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency: "GBP",
          minimumFractionDigits: 2
        })
      : new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
          minimumFractionDigits: 2
        });

  // Format the currency
  return formatter.format(amount);
};
