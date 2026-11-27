import type { DuplicateFinder } from "./ai.ts";
import type { Store } from "./db.ts";
import type { GitHub } from "./github.ts";

/** Shared services handed to every handler. */
export type App = {
  store: Store;
  github: GitHub;
  /** null when ANTHROPIC_API_KEY is not set. */
  finder: DuplicateFinder | null;
};

/** Never let Ferry's own messages ping @everyone, roles, or users. */
export const NO_PINGS = { allowedMentions: { parse: [] } } as const;
