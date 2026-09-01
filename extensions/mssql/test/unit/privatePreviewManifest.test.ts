/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

const SQL_DATA_PLANE_GATE =
    "mssql.privatePreview.sqlDataPlaneActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled";
const METADATA_CACHE_GATE =
    "mssql.privatePreview.metadataCacheActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled && config.mssql.metadataCache.enabled";
const AI_INLINE_COMPLETIONS_GATE =
    "mssql.privatePreview.aiInlineCompletionsActive && config.mssql.enableExperimentalFeatures && config.mssql.copilot.inlineCompletions.enabled";

interface CommandContribution {
    command: string;
    enablement?: string;
}

interface CommandPaletteContribution {
    command: string;
    when?: string;
}

interface LanguageModelChatProviderContribution {
    vendor: string;
    when?: string;
}

interface ExtensionPackageJson {
    contributes: {
        commands: CommandContribution[];
        menus: { commandPalette: CommandPaletteContribution[] };
        configuration: {
            properties: Record<string, { default?: unknown }>;
        };
        languageModelChatProviders: LanguageModelChatProviderContribution[];
    };
}

suite("Private preview manifest", () => {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as ExtensionPackageJson;

    test("keeps the umbrella and current private-preview features off by default", () => {
        const settings = packageJson.contributes.configuration.properties;

        expect(settings["mssql.enableExperimentalFeatures"]?.default).to.equal(false);
        expect(settings["mssql.sqlDataPlane.enabled"]?.default).to.equal(false);
        expect(settings["mssql.metadataCache.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.inlineCompletions.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.inlineCompletions.trace.captureEnabled"]?.default).to.equal(
            false,
        );
        expect(settings["mssql.copilot.inlineCompletions.trace.redactPrompts"]?.default).to.equal(
            true,
        );
        expect(settings["mssql.copilot.sdkProviders.anthropic.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.sdkProviders.openai.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.sdkProviders.xai.enabled"]?.default).to.equal(false);
    });

    test("keeps AI provider commands out of the default UI", () => {
        for (const provider of ["anthropic", "openai", "xai"]) {
            for (const action of ["setApiKey", "clearApiKey"]) {
                const commandId = `mssql.copilot.sdkProviders.${provider}.${action}`;
                expect(command(commandId).enablement).to.equal(AI_INLINE_COMPLETIONS_GATE);
                expect(commandPalette(commandId).when).to.equal(AI_INLINE_COMPLETIONS_GATE);
            }
        }
    });

    test("keeps AI language-model providers out of the default UI", () => {
        for (const vendor of ["anthropic-api", "openai-api", "xai-api"]) {
            const provider = packageJson.contributes.languageModelChatProviders.find(
                (candidate) => candidate.vendor === vendor,
            );
            expect(provider, `missing language model provider ${vendor}`).to.not.be.undefined;
            expect(provider!.when).to.equal(AI_INLINE_COMPLETIONS_GATE);
        }
    });

    test("requires the activation snapshot and umbrella before SQL Data Plane UI is visible", () => {
        expect(command("mssql.sqlDataPlane.showStatus").enablement).to.equal(SQL_DATA_PLANE_GATE);
        expect(commandPalette("mssql.sqlDataPlane.showStatus").when).to.equal(SQL_DATA_PLANE_GATE);
    });

    test("requires the activation snapshot and complete path for metadata cache commands", () => {
        for (const commandId of [
            "mssql.metadataCache.showStatus",
            "mssql.metadataCache.clearAll",
            "mssql.metadataCache.clearForConnection",
        ]) {
            expect(command(commandId).enablement).to.equal(METADATA_CACHE_GATE);
            expect(commandPalette(commandId).when).to.equal(METADATA_CACHE_GATE);
        }

        expect(command("mssql.metadataCache.enableOfflineMode").enablement).to.equal(
            `${METADATA_CACHE_GATE} && !config.mssql.metadataCache.offlineMode`,
        );
        expect(commandPalette("mssql.metadataCache.enableOfflineMode").when).to.equal(
            `${METADATA_CACHE_GATE} && !config.mssql.metadataCache.offlineMode`,
        );
        expect(command("mssql.metadataCache.disableOfflineMode").enablement).to.equal(
            `${METADATA_CACHE_GATE} && config.mssql.metadataCache.offlineMode`,
        );
        expect(commandPalette("mssql.metadataCache.disableOfflineMode").when).to.equal(
            `${METADATA_CACHE_GATE} && config.mssql.metadataCache.offlineMode`,
        );
    });

    function command(commandId: string): CommandContribution {
        const contribution = packageJson.contributes.commands.find(
            (candidate) => candidate.command === commandId,
        );
        expect(contribution, `missing command contribution ${commandId}`).to.not.be.undefined;
        return contribution!;
    }

    function commandPalette(commandId: string): CommandPaletteContribution {
        const contribution = packageJson.contributes.menus.commandPalette.find(
            (candidate) => candidate.command === commandId,
        );
        expect(contribution, `missing commandPalette contribution ${commandId}`).to.not.be
            .undefined;
        return contribution!;
    }
});
