import { z } from "zod";
import { CAPABILITY_IDS } from "@/lib/capabilities/catalog";

// Validates against the SAME capability catalog the planner/router/Circuit
// Breaker already use (lib/capabilities/catalog.ts) - no second taxonomy.
const capabilityIdSchema = z.enum(CAPABILITY_IDS);

export const registerProviderSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(2000).optional(),
  contactEmail: z.string().email().optional(),
});

export const MODEL_TIERS = ["economy", "standard", "premium"] as const;

export const registerExternalAgentSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(2000).optional(),
  capabilities: z.array(capabilityIdSchema).min(1).max(20),
  endpoint: z.string().url().max(500),
  price: z.number().int().positive().max(1000),
  modelTier: z.enum(MODEL_TIERS).default("standard"),
  // The secret Kraven should send back to the provider's own endpoint
  // (Authorization: Bearer <this>). Optional - some demo/test endpoints
  // require no auth at all.
  authToken: z.string().min(8).max(500).optional(),
});

export const updateExternalAgentSchema = z.object({
  description: z.string().max(2000).optional(),
  endpoint: z.string().url().max(500).optional(),
  price: z.number().int().positive().max(1000).optional(),
  authToken: z.string().min(8).max(500).optional(),
  action: z.enum(["pause", "suspend", "reactivate"]).optional(),
});
