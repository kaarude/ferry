import { z } from "zod";

// Empty strings in .env mean "not set", so optional values treat "" as undefined.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string({ error: "DISCORD_TOKEN is required" }).min(1),
  GITHUB_TOKEN: z.string({ error: "GITHUB_TOKEN is required" }).min(1),
  ANTHROPIC_API_KEY: optional(z.string()),
  AI_MODEL: optional(z.string()).transform((v) => v ?? "claude-opus-5-5"),
  DATABASE_PATH: optional(z.string()).transform((v) => v ?? "./data/ferry.db"),
  POLL_INTERVAL_MINUTES: optional(z.coerce.number().min(1)).transform(
    (v) => v ?? 5,
  ),
});

export type Env = z.infer<typeof EnvSchema>;

/** Validates process.env once at startup and exits with a readable error. */
export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
