import { cac } from "cac";
import type { CAC } from "cac";

import { resolveToolPackConfig, type ToolPackCliOptions } from "./config.js";
import {
  cleanupPackedWinNamespace,
  inspectPackedWinApp,
  listPackedWinNamespaces,
  packWin,
  readPackedWinLogs,
  startPackedWinApp,
  stopPackedWinApp,
} from "./win/index.js";

type CliOptions = ToolPackCliOptions;
type CacCommand = ReturnType<CAC["command"]>;

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printLogs(result: { logs: Record<string, { lines: string[]; logPath: string }>; namespace: string }, options: CliOptions): void {
  if (options.json === true) {
    printJson(result);
    return;
  }

  for (const [app, entry] of Object.entries(result.logs)) {
    process.stdout.write(`[${app}] ${entry.logPath}\n`);
    process.stdout.write(entry.lines.length > 0 ? `${entry.lines.join("\n")}\n` : "(no log lines)\n");
  }
}

function addSharedOptions(command: CacCommand) {
  return command
    .option("--cache-dir <path>", "tools-pack cache directory")
    .option("--dir <path>", "tools-pack root directory")
    .option("--json", "print JSON")
    .option("--namespace <name>", "runtime namespace")
    .option("--expr <expression>", "desktop inspect eval expression")
    .option("--path <path>", "desktop inspect screenshot path");
}

function addBuildOptions(command: CacCommand) {
  return command
    .option("--app-version <version>", "override packaged app version for release artifacts")
    .option("--portable", "do not bake local tools-pack runtime roots into the packaged config")
    .option("--require-vela-cli", "fail packaging when the bundled Vela CLI cannot be resolved")
    .option("--signed", "build a signed Windows artifact")
    .option("--to <target>", "build target: zip (default: zip)");
}

const cli = cac("tools-pack");

addBuildOptions(
  addSharedOptions(
    cli.command(
      "win <action>",
      "Windows portable commands: build|start|stop|logs|cleanup|list|inspect",
    ),
  ),
).action(async (action: string, options: CliOptions) => {
  const config = resolveToolPackConfig("win", options);
  switch (action) {
    case "build":
      printJson(await packWin(config));
      return;
    case "install":
    case "uninstall":
    case "reset":
      throw new Error(`unsupported Windows installed-product action: ${action}`);
    case "start":
      printJson(await startPackedWinApp(config));
      return;
    case "stop":
      printJson(await stopPackedWinApp(config));
      return;
    case "logs":
      printLogs(await readPackedWinLogs(config), options);
      return;
    case "cleanup":
      printJson(await cleanupPackedWinNamespace(config));
      return;
    case "list":
      printJson(await listPackedWinNamespaces(config));
      return;
    case "inspect":
      printJson(await inspectPackedWinApp(config, options));
      return;
    default:
      throw new Error(`unsupported win action: ${action}`);
  }
});

cli.on("command:*", () => {
  const platform = process.argv[2] ?? "unknown";
  process.stderr.write(`unsupported tools-pack platform: ${platform}\n`);
  process.exitCode = 1;
});

cli.help();
cli.parse();
