import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { supportedActions, workspaceTargets } from "./workspace-targets.mjs";

const npmCommand = "npm";
const spawnOptions = { shell: process.platform === "win32" };
const minSupportedNodeMajor = 24;
const mssqlPackageOnlyArgs = new Set([
    "--online",
    "--offline",
    "--skip-service-install",
    "--package-mcp",
]);

function ensureSupportedNodeVersion() {
    const currentNodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

    if (!Number.isFinite(currentNodeMajor) || currentNodeMajor < minSupportedNodeMajor) {
        throw new Error(
            `Node.js ${minSupportedNodeMajor}+ is required. Current version: ${process.version}.`,
        );
    }
}

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
        prerelease: false,
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

        if (arg === "--preview" || arg === "--pre-release") {
            options.prerelease = true;
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
  npm run package [-- --target <name>[,<name>]] [--preview|--pre-release] [-- <target args>]
  npm run list:targets
`);
}

function resolveTargets(action, targetValue) {
    const availableTargets = workspaceTargets.filter((target) => target.scripts.includes(action));

    if (!targetValue) {
        return {
            tasks: expandTargetsWithDependencies(action, availableTargets),
            requestedTargets: availableTargets,
        };
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

    const requestedTargets = [
        ...new Map(resolved.map((target) => [target.target, target])).values(),
    ];

    return {
        tasks: expandTargetsWithDependencies(action, requestedTargets),
        requestedTargets,
    };
}

function findTarget(name) {
    return workspaceTargets.find(
        (candidate) => candidate.target === name || candidate.aliases.includes(name),
    );
}

function getTargetDependencies(target, action) {
    return (target.dependencies?.[action] ?? []).map((dependency) =>
        typeof dependency === "string" ? { target: dependency, action } : dependency,
    );
}

function expandTargetsWithDependencies(action, targets) {
    const expanded = new Map();
    const visiting = new Set();

    function visit(target, targetAction) {
        const taskKey = `${targetAction}:${target.target}`;

        if (expanded.has(taskKey)) {
            return;
        }

        if (visiting.has(taskKey)) {
            throw new Error(
                `Cyclic target dependency involving "${target.target}" for action "${targetAction}".`,
            );
        }

        visiting.add(taskKey);

        for (const dependencyConfig of getTargetDependencies(target, targetAction)) {
            const dependency = findTarget(dependencyConfig.target);

            if (!dependency) {
                throw new Error(
                    `Target "${target.target}" depends on unknown target "${dependencyConfig.target}".`,
                );
            }

            if (!dependency.scripts.includes(dependencyConfig.action)) {
                throw new Error(
                    `Target "${target.target}" depends on "${dependency.target}", but "${dependency.target}" does not support "${dependencyConfig.action}".`,
                );
            }

            visit(dependency, dependencyConfig.action);
        }

        visiting.delete(taskKey);
        expanded.set(taskKey, { target, action: targetAction });
    }

    for (const target of targets) {
        visit(target, action);
    }

    return [...expanded.values()];
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

function validatePackageArguments(targets, action, forwardedArgs) {
    if (action !== "package") {
        return;
    }

    const mssqlOnlyArgs = forwardedArgs.filter((arg) => mssqlPackageOnlyArgs.has(arg));
    if (mssqlOnlyArgs.length === 0 || targets.some((target) => target.target === "mssql")) {
        return;
    }

    throw new Error(
        `${mssqlOnlyArgs.join(", ")} is only supported when packaging the mssql target. Add --target mssql.`,
    );
}

function getTargetForwardedArgs(target, action, forwardedArgs) {
    if (action !== "package" || target.target === "mssql") {
        return forwardedArgs;
    }

    return forwardedArgs.filter((arg) => !mssqlPackageOnlyArgs.has(arg));
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
    ensureSupportedNodeVersion();

    const { action, forwardedArgs, prod, prerelease, requireTarget, targetValue } = parseArgs(
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

    if (prerelease && action !== "package") {
        throw new Error(
            `The --preview/--pre-release flag is only supported for the "package" action.`,
        );
    }

    if (prod && action !== "build") {
        throw new Error(`The --prod flag is only supported for the "build" action.`);
    }

    const { tasks, requestedTargets } = resolveTargets(action, targetValue);
    const requestedTargetNames = new Set(requestedTargets.map((target) => target.target));
    ensureProdBuildSupport(requestedTargets, prod);
    validatePackageArguments(requestedTargets, action, forwardedArgs);

    const getActionArgs = (target) => {
        let actionArgs = forwardedArgs;

        if (prod && requestedTargetNames.has(target.target)) {
            actionArgs = [...actionArgs, "--prod"];
        }

        if (prerelease && requestedTargetNames.has(target.target)) {
            actionArgs = [...actionArgs, "--pre-release"];
        }

        return actionArgs;
    };

    if (action === "watch") {
        const watchableTargets = pruneRedundantWatchTargets(tasks.map((task) => task.target));
        watchTargets(watchableTargets, forwardedArgs);
        return;
    }

    for (const task of tasks) {
        const taskArgs =
            task.action === action && requestedTargetNames.has(task.target.target)
                ? getActionArgs(task.target)
                : [];
        runWorkspaceScript(
            task.target,
            task.action,
            getTargetForwardedArgs(task.target, task.action, taskArgs),
        );
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
