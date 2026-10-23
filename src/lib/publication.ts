import { z } from "zod";
export const publicationStateSchema = z.object({
  plan: z.enum(["free", "paid"]), status: z.string(), allowance: z.number().int(),
  saved_count: z.number().int(), selected_ids: z.array(z.string()), visible_ids: z.array(z.string()),
  version: z.string(), expires_at: z.string().nullable(), server_time: z.string(),
});
export interface PublicationState {
  plan: "free" | "paid"; status: string; allowance: number; saved_count: number;
  selected_ids: string[]; visible_ids: string[]; version: string;
  expires_at: string | null; server_time: string;
}
