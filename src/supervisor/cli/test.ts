/**
 * CLI harness for probing the supervisor in isolation.
 *
 * Usage:
 *   pnpm supervisor:test "schedule team standup for tuesday"
 *   pnpm supervisor:test "wait change that to wednesday" --cancel act_noop_1_1234567
 *
 * Runs processTurn (or cancelAction) with a console transport so the event
 * stream is visible without spinning up the voice loop. This is also the
 * place to reproduce rough-edge probes for Pranay's writeup — determinism
 * violations, cancellation under in-flight steps, step result size limits.
 *
 * Run with: tsx src/supervisor/cli/test.ts <transcript> [options]
 */
import {
  cancelAction,
  createConsoleTransport,
  processTurn,
} from "../index";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: pnpm supervisor:test <transcript> [--cancel <actionId>]",
    );
    process.exit(1);
  }

  const cancelIdx = args.indexOf("--cancel");
  const transport = createConsoleTransport();

  if (cancelIdx >= 0) {
    const actionId = args[cancelIdx + 1];
    if (!actionId) {
      console.error("--cancel requires an actionId");
      process.exit(1);
    }
    const reason = args.filter((_, i) => i !== cancelIdx && i !== cancelIdx + 1).join(" ");
    console.log(`\n=== cancelAction ===`);
    console.log(`actionId: ${actionId}`);
    console.log(`reason: ${reason || "(none)"}`);
    console.log("");
    await cancelAction(
      { actionId, reason: reason || "user requested cancel" },
      transport,
    );
    return;
  }

  const transcript = args.join(" ");
  console.log(`\n=== processTurn ===`);
  console.log(`transcript: "${transcript}"`);
  console.log("");

  const result = await processTurn(
    {
      transcript,
      sessionId: "cli_session",
      context: {},
    },
    transport,
  );

  console.log("");
  console.log("=== result ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
