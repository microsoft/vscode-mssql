import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { supportedActions, workspaceTargets } from "./workspace-targets.mjs";

const npmCommand = "npm";
const spawnOptions = { shell: process.platform === "win32" };

function parseTargetValue(flag, value) {
    if (!value || value.trim().length === 0 || value.startsWith("-")) {
        throw new Error(
            `Missing value for ${flag}. Usage: npm run <action> -- --target <name>[,<name>]`,
        );
    }

    return value;
}

function parseArgs(argv) {
    const [action, ...rest] = argv;
    const options = {
        action,
        forwardedArgs: [],
        prod: false,
        requireTarget: false,
        targetValue: undefined,
    };

    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];

        if (arg === "--target" || arg === "-t") {
            options.targetValue = parseTargetValue(arg, rest[i + 1]);
            i++;
            continue;
        }

        if (arg.startsWith("--target=")) {
            options.targetValue = parseTargetValue("--target", arg.slice("--target=".length));
            continue;
        }

        if (arg === "--prod") {
            options.prod = true;
            continue;
        }

        if (arg === "--require-target") {
            options.requireTarget = true;
            continue;
        }

        options.forwardedArgs.push(arg);
    }

    return options;
}

function printUsage() {
    console.log(`Usage:
  npm run build [-- --target <name>[,<name>]] [--prod]
  npm run watch [-- --target <name>[,<name>]]
  npm run watch:all
  npm run test [-- --target <name>[,<name>]] [-- <target args>]
  npm run smoketest [-- --target <name>[,<name>]] [-- <target args>]
  npm run lint [-- --target <name>[,<name>]]
  npm run package [-- --target <name>[,<name>]] [-- <target args>]
  npm run list:targets
`);
}

function resolveTargets(action, targetValue) {
    const availableTargets = workspaceTargets.filter((target) => target.scripts.includes(action));

    if (!targetValue) {
        return availableTargets;
    }

    const requested = targetValue
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

    const resolved = requested.map((name) => {
        const target = workspaceTargets.find(
            (candidate) => candidate.target === name || candidate.aliases.includes(name),
        );

        if (!target) {
            throw new Error(
                `Unknown target "${name}". Run "npm run list:targets" to see supported targets.`,
            );
        }

        if (!target.scripts.includes(action)) {
            throw new Error(`Target "${target.target}" does not support "${action}".`);
        }

        return target;
    });

    return [...new Map(resolved.map((target) => [target.target, target])).values()];
}

function ensureProdBuildSupport(targets, prod) {
    if (!prod) {
        return;
    }

    const unsupported = targets.filter((target) => !target.supportsProdBuild);

    if (unsupported.length > 0) {
        throw new Error(
            `The --prod flag is only supported for ${workspaceTargets
                .filter((target) => target.supportsProdBuild)
                .map((target) => target.target)
                .join(
                    ", ",
                )}. Unsupported target(s): ${unsupported.map((target) => target.target).join(", ")}`,
        );
    }
}

function pruneRedundantWatchTargets(targets) {
    const includedTargets = new Set(targets.flatMap((target) => target.watchIncludesTargets ?? []));

    return targets.filter(
        (target) => !includedTargets.has(target.target) || !target.scripts.includes("watch"),
    );
}

function runWorkspaceScript(target, action, forwardedArgs = []) {
    const npmArgs = ["run", action, "--if-present"];

    if (forwardedArgs.length > 0) {
        npmArgs.push("--", ...forwardedArgs);
    }

    console.log(`\n> ${target.target} (${target.packageName}) :: ${action}`);
    const result = spawnSync(npmCommand, npmArgs, {
        cwd: path.join(process.cwd(), target.directory),
        stdio: "inherit",
        ...spawnOptions,
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function watchTargets(targets, forwardedArgs = []) {
    console.log(`Watching targets: ${targets.map((target) => target.target).join(", ")}`);

    const children = targets.map((target) => {
        const npmArgs = ["run", "watch", "--if-present"];

        if (forwardedArgs.length > 0) {
            npmArgs.push("--", ...forwardedArgs);
        }

        console.log(`\n> ${target.target} (${target.packageName}) :: watch`);
        return spawn(npmCommand, npmArgs, {
            cwd: path.join(process.cwd(), target.directory),
            stdio: "inherit",
            ...spawnOptions,
        });
    });

    let closing = false;
    const closeChildren = (signal = "SIGTERM") => {
        if (closing) {
            return;
        }

        closing = true;
        for (const child of children) {
            if (!child.killed) {
                child.kill(signal);
            }
        }
    };

    process.on("SIGINT", () => {
        closeChildren("SIGINT");
    });

    process.on("SIGTERM", () => {
        closeChildren("SIGTERM");
    });

    children.forEach((child) => {
        child.on("exit", (code) => {
            if (!closing && code && code !== 0) {
                closeChildren("SIGTERM");
                process.exit(code);
            }
        });
    });
}

function listTargets() {
    console.log("Available targets:\n");

    for (const target of workspaceTargets) {
        console.log(
            `- ${target.target}: package=${target.packageName}; dir=${target.directory}; scripts=${target.scripts.join(", ")}; aliases=${target.aliases.join(", ")}`,
        );
    }
}

function main() {
    const { action, forwardedArgs, prod, requireTarget, targetValue } = parseArgs(
        process.argv.slice(2),
    );

    if (!action || action === "help" || action === "--help" || action === "-h") {
        printUsage();
        return;
    }

    if (action === "list") {
        listTargets();
        return;
    }

    if (!supportedActions.includes(action)) {
        throw new Error(
            `Unsupported action "${action}". Supported actions: ${supportedActions.join(", ")}`,
        );
    }

    if (requireTarget && !targetValue) {
        throw new Error(
            `The "${action}" command requires --target. Run "npm run list:targets" to see options.`,
        );
    }

    const targets = resolveTargets(action, targetValue);
    ensureProdBuildSupport(targets, prod);

    const actionArgs = prod ? [...forwardedArgs, "--prod"] : forwardedArgs;

    if (action === "watch") {
        const watchableTargets = pruneRedundantWatchTargets(targets);
        watchTargets(watchableTargets, actionArgs);
        return;
    }

    for (const target of targets) {
        runWorkspaceScript(target, action, actionArgs);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
