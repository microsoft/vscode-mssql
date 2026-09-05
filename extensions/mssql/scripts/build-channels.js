/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Build-channel support: compile-time inclusion/exclusion of non-production
 * code areas, the TypeScript equivalent of a C #ifdef — except the excluded
 * code is absent from the shipped bundle entirely, not just disabled.
 *
 * Channels (ordered least → most restricted): development, internal,
 * insiders, stable. Each area under src/nonproduction/<area>/ declares the
 * channels that include it in src/nonproduction/channels.json. For any other
 * channel the area's ONE sanctioned import seam — its index.ts — is replaced
 * at bundle time with index.stub.ts (same export surface, inert), so esbuild
 * never visits the area's sources and nothing from it reaches dist/. A
 * metafile audit fails the build if excluded sources leak in anyway, and the
 * bundle records its channel in dist/build-channel.json so packaging can
 * strip the area's package.json contributions and verify consistency.
 *
 * Channel selection: --channel=<name> argument, else the MSSQL_BUILD_CHANNEL
 * environment variable, else "development" (source builds get everything).
 * Packaging refuses to produce a VSIX whose manifest channel differs from
 * the channel the bundle was built with.
 */

const fs = require("fs");
const path = require("path");

const CHANNELS = ["development", "internal", "insiders", "stable"];
const DEFAULT_CHANNEL = "development";
const NONPRODUCTION_ROOT = path.resolve(__dirname, "..", "src", "nonproduction");
// Anchored to the extension root (not process.cwd()) so build and packaging
// agree on the record's location regardless of the invoking directory.
const BUILD_CHANNEL_RECORD = path.resolve(__dirname, "..", "dist", "build-channel.json");

function resolveBuildChannel(argv = process.argv.slice(2), env = process.env) {
    const arg = argv.find((value) => value.startsWith("--channel="));
    const raw = arg ? arg.slice("--channel=".length) : env.MSSQL_BUILD_CHANNEL;
    const channel = (raw ?? DEFAULT_CHANNEL).trim().toLowerCase();
    if (!CHANNELS.includes(channel)) {
        throw new Error(
            `Unknown build channel '${channel}'. Valid channels: ${CHANNELS.join(", ")}.`,
        );
    }
    return channel;
}

function normalizeSlashes(value) {
    return value.split(path.sep).join("/");
}

function loadChannelAreas() {
    const manifestPath = path.join(NONPRODUCTION_ROOT, "channels.json");
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const areas = parsed.areas;
    if (typeof areas !== "object" || areas === null) {
        throw new Error(`${manifestPath} must declare an "areas" object.`);
    }
    for (const [area, spec] of Object.entries(areas)) {
        if (!Array.isArray(spec.channels) || spec.channels.length === 0) {
            throw new Error(`Area '${area}' must declare a non-empty "channels" array.`);
        }
        for (const channel of spec.channels) {
            if (!CHANNELS.includes(channel)) {
                throw new Error(`Area '${area}' lists unknown channel '${channel}'.`);
            }
        }
        const areaRoot = path.join(NONPRODUCTION_ROOT, area);
        for (const required of ["index.ts", "index.stub.ts"]) {
            if (!fs.existsSync(path.join(areaRoot, required))) {
                throw new Error(`Area '${area}' is missing its seam file ${required}.`);
            }
        }
    }
    return areas;
}

function getExcludedAreas(channel) {
    const areas = loadChannelAreas();
    return Object.entries(areas)
        .filter(([, spec]) => !spec.channels.includes(channel))
        .map(([area]) => area);
}

/**
 * esbuild plugin: substitute excluded areas' index seams with their stubs,
 * reject deep imports into excluded areas, audit the metafile, and record
 * the channel next to the bundle.
 */
function channelExclusionPlugin(channel) {
    const excluded = getExcludedAreas(channel);
    const nonproductionRootSlashed = normalizeSlashes(NONPRODUCTION_ROOT);

    return {
        name: "mssql-build-channel",
        setup(build) {
            build.initialOptions.metafile = true;

            build.onResolve({ filter: /nonproduction/ }, (args) => {
                if (!args.resolveDir) {
                    return undefined;
                }
                let resolved = normalizeSlashes(path.resolve(args.resolveDir, args.path));
                if (resolved.endsWith("/index")) {
                    resolved = resolved.slice(0, -"/index".length);
                }
                for (const area of excluded) {
                    const areaRoot = `${nonproductionRootSlashed}/${area}`;
                    if (resolved === areaRoot) {
                        return { path: path.join(NONPRODUCTION_ROOT, area, "index.stub.ts") };
                    }
                    if (resolved.startsWith(`${areaRoot}/`) && !resolved.includes("index.stub")) {
                        return {
                            errors: [
                                {
                                    text:
                                        `'${args.path}' is inside non-production area '${area}', ` +
                                        `which is excluded from the '${channel}' build channel. ` +
                                        `Production code may only import the area's index seam.`,
                                },
                            ],
                        };
                    }
                }
                return undefined;
            });

            build.onEnd((result) => {
                if (result.errors.length > 0) {
                    return;
                }
                if (result.metafile) {
                    const offenders = [];
                    for (const input of Object.keys(result.metafile.inputs)) {
                        const normalized = normalizeSlashes(input);
                        for (const area of excluded) {
                            if (
                                normalized.includes(`src/nonproduction/${area}/`) &&
                                !normalized.endsWith("index.stub.ts")
                            ) {
                                offenders.push(input);
                            }
                        }
                    }
                    if (offenders.length > 0) {
                        result.errors.push({
                            text:
                                `Excluded non-production sources reached the '${channel}' ` +
                                `bundle: ${offenders.join(", ")}`,
                        });
                        return;
                    }
                }
                fs.mkdirSync(path.dirname(BUILD_CHANNEL_RECORD), { recursive: true });
                fs.writeFileSync(
                    BUILD_CHANNEL_RECORD,
                    `${JSON.stringify({ channel, excludedAreas: excluded }, null, 4)}\n`,
                    "utf8",
                );
            });
        },
    };
}

function readBuildChannelRecord() {
    if (!fs.existsSync(BUILD_CHANNEL_RECORD)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(BUILD_CHANNEL_RECORD, "utf8"));
}

function loadManifestContributions() {
    const manifestPath = path.join(NONPRODUCTION_ROOT, "manifest-contributions.json");
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

/**
 * Remove the excluded areas' package.json contributions in place. Returns a
 * summary of what was removed; the caller owns saving and restoring the
 * manifest (mirror of the offline-packaging manifest pattern).
 */
function stripManifestForChannel(packageJson, channel) {
    const excluded = getExcludedAreas(channel);
    const contributions = loadManifestContributions();
    const removed = { settings: 0, commands: 0, commandPalette: 0, languageModelChatProviders: 0 };

    for (const area of excluded) {
        const spec = contributions[area];
        if (!spec) {
            continue;
        }

        const settingKeys = new Set(spec.configuration ?? []);
        const sections = Array.isArray(packageJson.contributes.configuration)
            ? packageJson.contributes.configuration
            : [packageJson.contributes.configuration];
        for (const section of sections) {
            for (const key of Object.keys(section.properties ?? {})) {
                if (settingKeys.has(key)) {
                    delete section.properties[key];
                    removed.settings++;
                }
            }
        }

        const commandIds = new Set(spec.commands ?? []);
        if (Array.isArray(packageJson.contributes.commands)) {
            const before = packageJson.contributes.commands.length;
            packageJson.contributes.commands = packageJson.contributes.commands.filter(
                (command) => !commandIds.has(command.command),
            );
            removed.commands += before - packageJson.contributes.commands.length;
        }
        if (Array.isArray(packageJson.contributes.menus?.commandPalette)) {
            const before = packageJson.contributes.menus.commandPalette.length;
            packageJson.contributes.menus.commandPalette =
                packageJson.contributes.menus.commandPalette.filter(
                    (entry) => !commandIds.has(entry.command),
                );
            removed.commandPalette += before - packageJson.contributes.menus.commandPalette.length;
        }

        const providerIds = new Set(spec.languageModelChatProviders ?? []);
        if (Array.isArray(packageJson.contributes.languageModelChatProviders)) {
            const before = packageJson.contributes.languageModelChatProviders.length;
            packageJson.contributes.languageModelChatProviders =
                packageJson.contributes.languageModelChatProviders.filter(
                    (provider) => !providerIds.has(provider.vendor ?? provider.id),
                );
            removed.languageModelChatProviders +=
                before - packageJson.contributes.languageModelChatProviders.length;
        }
    }

    return { excludedAreas: excluded, removed };
}

module.exports = {
    BUILD_CHANNEL_RECORD,
    CHANNELS,
    DEFAULT_CHANNEL,
    NONPRODUCTION_ROOT,
    channelExclusionPlugin,
    getExcludedAreas,
    loadChannelAreas,
    loadManifestContributions,
    readBuildChannelRecord,
    resolveBuildChannel,
    stripManifestForChannel,
};
