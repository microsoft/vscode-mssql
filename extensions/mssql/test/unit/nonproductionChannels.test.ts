/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Invariants for the build-channel mechanism (src/nonproduction/README.md):
 * valid channel declarations, seam/stub export parity per area, and a
 * manifest-contribution map that matches package.json exactly — so channel
 * stripping cannot silently rot as the manifest evolves.
 */

import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";

const VALID_CHANNELS = ["development", "internal", "insiders", "stable"];
const extensionRoot = path.resolve(__dirname, "..", "..", "..");
const nonproductionRoot = path.join(extensionRoot, "src", "nonproduction");

function readJson(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

suite("Non-production build channels", () => {
    const channelsManifest = readJson(path.join(nonproductionRoot, "channels.json"));
    const areas = channelsManifest.areas as Record<string, { channels: string[] }>;

    test("every area declares valid, non-empty channel lists", () => {
        expect(Object.keys(areas)).to.not.be.empty;
        for (const [area, spec] of Object.entries(areas)) {
            expect(spec.channels, area).to.be.an("array").that.is.not.empty;
            for (const channel of spec.channels) {
                expect(VALID_CHANNELS, `${area} channel '${channel}'`).to.include(channel);
            }
        }
    });

    test("every area has its index seam and stub with identical export surfaces", () => {
        for (const area of Object.keys(areas)) {
            const areaRoot = path.join(nonproductionRoot, area);
            expect(fs.existsSync(path.join(areaRoot, "index.ts")), `${area}/index.ts`).to.equal(
                true,
            );
            expect(
                fs.existsSync(path.join(areaRoot, "index.stub.ts")),
                `${area}/index.stub.ts`,
            ).to.equal(true);

            // Compare compiled export surfaces (tests run from out/).
            const compiledArea = path.join(__dirname, "..", "..", "src", "nonproduction", area);
            /* eslint-disable @typescript-eslint/no-require-imports */
            const seam = require(path.join(compiledArea, "index.js"));
            const stub = require(path.join(compiledArea, "index.stub.js"));
            /* eslint-enable @typescript-eslint/no-require-imports */
            const seamExports = Object.keys(seam).sort();
            const stubExports = Object.keys(stub).sort();
            expect(stubExports, `${area} stub export names`).to.deep.equal(seamExports);
            for (const name of seamExports) {
                expect(typeof stub[name], `${area} stub export '${name}' type`).to.equal(
                    typeof seam[name],
                );
            }
        }
    });

    test("manifest-contributions map matches package.json exactly", () => {
        const contributions = readJson(
            path.join(nonproductionRoot, "manifest-contributions.json"),
        ) as Record<
            string,
            { configuration?: string[]; commands?: string[]; languageModelChatProviders?: string[] }
        >;
        const packageJson = readJson(path.join(extensionRoot, "package.json")) as {
            contributes: {
                configuration:
                    | { properties: Record<string, unknown> }
                    | { properties: Record<string, unknown> }[];
                commands: { command: string }[];
                menus: { commandPalette: { command: string }[] };
                languageModelChatProviders: { vendor?: string; id?: string }[];
            };
        };

        const sections = Array.isArray(packageJson.contributes.configuration)
            ? packageJson.contributes.configuration
            : [packageJson.contributes.configuration];
        const declaredSettings = new Set(
            sections.flatMap((section) => Object.keys(section.properties ?? {})),
        );
        const declaredCommands = new Set(
            packageJson.contributes.commands.map((command) => command.command),
        );
        const paletteCommands = new Set(
            packageJson.contributes.menus.commandPalette.map((entry) => entry.command),
        );
        const declaredProviders = new Set(
            packageJson.contributes.languageModelChatProviders.map(
                (provider) => provider.vendor ?? provider.id,
            ),
        );

        for (const [area, spec] of Object.entries(contributions)) {
            if (area.startsWith("$")) {
                continue;
            }
            expect(areas, `map area '${area}' is declared in channels.json`).to.have.property(area);
            for (const setting of spec.configuration ?? []) {
                expect(declaredSettings.has(setting), `setting ${setting}`).to.equal(true);
            }
            for (const command of spec.commands ?? []) {
                expect(declaredCommands.has(command), `command ${command}`).to.equal(true);
                expect(paletteCommands.has(command), `palette entry ${command}`).to.equal(true);
            }
            for (const provider of spec.languageModelChatProviders ?? []) {
                expect(declaredProviders.has(provider), `provider ${provider}`).to.equal(true);
            }
        }
    });
});
