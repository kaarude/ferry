import { Client, Events, GatewayIntentBits } from "discord.js";
import { DuplicateFinder } from "./ai.ts";
import type { App } from "./app.ts";
import { commandDefinitions, handleInteraction } from "./commands.ts";
import { openStore } from "./db.ts";
import { loadEnv } from "./env.ts";
import { GitHub } from "./github.ts";
import { handleNewThread } from "./intake.ts";
import { startPoller } from "./poller.ts";

// Entry point: wires config, storage, GitHub, optional AI, and Discord together.

const env = loadEnv();
const app: App = {
  store: openStore(env.DATABASE_PATH),
  github: new GitHub(env.GITHUB_TOKEN),
  finder: env.ANTHROPIC_API_KEY
    ? new DuplicateFinder(env.ANTHROPIC_API_KEY, env.AI_MODEL)
    : null,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // channels, threads, and tags
    GatewayIntentBits.GuildMessages, // messages inside forum threads
    GatewayIntentBits.MessageContent, // privileged: lets Ferry read the post text
  ],
});

let stopPoller = () => {};

client.once(Events.ClientReady, async (ready) => {
  // Global commands: registered once at startup, available in every server.
  await ready.application.commands.set(commandDefinitions);
  stopPoller = startPoller(app, ready, env.POLL_INTERVAL_MINUTES);
  console.log(
    `Ferry is online as ${ready.user.tag} in ${ready.guilds.cache.size} server(s). ` +
      `AI duplicate check: ${app.finder ? env.AI_MODEL : "off"}.`,
  );
});

client.on(Events.ThreadCreate, (thread, newlyCreated) => {
  if (!newlyCreated) return;
  handleNewThread(app, thread).catch((error: unknown) => {
    console.error(`Failed to handle thread ${thread.id}:`, error);
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(app, interaction);
});

const shutdown = async () => {
  stopPoller();
  await client.destroy();
  app.store.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  console.error(`Could not log in to Discord: ${(error as Error).message}`);
  console.error(
    "Check DISCORD_TOKEN and that the Message Content intent is enabled.",
  );
  process.exit(1);
}
