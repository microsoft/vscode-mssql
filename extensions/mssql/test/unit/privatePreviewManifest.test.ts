/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { MAX_TRACE_FILE_SIZE_MB } from "../../src/copilot/inlineCompletionDebug/traceSerializer";
import { collectConfigurationProperties, ConfigurationContribution } from "./manifestUtils";

const SQL_DATA_PLANE_GATE =
    "mssql.privatePreview.sqlDataPlaneActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled";
const METADATA_CACHE_GATE =
    "mssql.privatePreview.metadataCacheActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled && config.mssql.metadataCache.enabled";
const AI_INLINE_COMPLETIONS_GATE =
    "mssql.privatePreview.aiInlineCompletionsActive && config.mssql.enableExperimentalFeatures && config.mssql.copilot.inlineCompletions.enabled";
const DEBUG_CONSOLE_GATE =
    "mssql.privatePreview.debugConsoleActive && config.mssql.enableExperimentalFeatures && config.mssql.debugConsole.enabled";
const SESSION_DIAGNOSTICS_GATE =
    "mssql.privatePreview.sessionDiagnosticsActive && config.mssql.enableExperimentalFeatures && config.mssql.sessionDiag.enabled";
const OBJECT_EXPLORER_V2_GATE =
    "mssql.privatePreview.objectExplorerV2Active && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled && config.mssql.objectExplorer.v2.enabled";

interface CommandContribution {
    command: string;
    enablement?: string;
}

interface CommandPaletteContribution {
    command?: string;
    when?: string;
}

interface LanguageModelChatProviderContribution {
    vendor: string;
    when?: string;
}

interface ExtensionPackageJson {
    contributes: {
        commands: CommandContribution[];
        menus: {
            commandPalette: CommandPaletteContribution[];
            "view/item/context": CommandPaletteContribution[];
            "view/title": CommandPaletteContribution[];
        };
        views: { objectExplorer: { id: string; when?: string }[] };
        keybindings: { command: string; when?: string }[];
        languageModelChatProviders: LanguageModelChatProviderContribution[];
        configuration:
            | ConfigurationContribution<{
                  default?: unknown;
                  scope?: string;
                  minimum?: number;
                  maximum?: number;
              }>
            | ConfigurationContribution<{
                  default?: unknown;
                  scope?: string;
                  minimum?: number;
                  maximum?: number;
              }>[];
    };
}

suite("Private preview manifest", () => {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as ExtensionPackageJson;

    test("keeps the umbrella and current private-preview features off by default", () => {
        const settings = collectConfigurationProperties(packageJson.contributes.configuration);

        expect(settings["mssql.enableExperimentalFeatures"]?.default).to.equal(false);
        expect(settings["mssql.sqlDataPlane.enabled"]?.default).to.equal(false);
        expect(settings["mssql.metadataCache.enabled"]?.default).to.equal(false);
        expect(settings["mssql.debugConsole.enabled"]?.default).to.equal(false);
        expect(settings["mssql.sessionDiag.enabled"]?.default).to.equal(false);
        expect(settings["mssql.objectExplorer.v2.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.inlineCompletions.enabled"]?.default).to.equal(false);
        expect(settings["mssql.copilot.inlineCompletions.useSchemaContext"]?.default).to.equal(
            false,
        );
        expect(settings["mssql.copilot.inlineCompletions.includeSqlDiagnostics"]?.default).to.equal(
            false,
        );
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

    test("keeps prompt controls global and trace controls machine-local", () => {
        const settings = collectConfigurationProperties(packageJson.contributes.configuration);
        for (const key of [
            "mssql.copilot.inlineCompletions.enabled",
            "mssql.copilot.inlineCompletions.useSchemaContext",
            "mssql.copilot.inlineCompletions.includeSqlDiagnostics",
            "mssql.copilot.inlineCompletions.modelVendors",
        ]) {
            expect(settings[key]?.scope, key).to.equal("application");
        }
        for (const key of [
            "mssql.copilot.inlineCompletions.debug.recordWhenClosed",
            "mssql.copilot.inlineCompletions.trace.captureEnabled",
            "mssql.copilot.inlineCompletions.trace.folder",
            "mssql.copilot.inlineCompletions.trace.redactPrompts",
            "mssql.copilot.inlineCompletions.trace.maxFileSizeMB",
        ]) {
            expect(settings[key]?.scope, key).to.equal("machine");
        }
    });

    test("caps the trace file size setting at the limit that loading enforces", () => {
        const setting = collectConfigurationProperties(packageJson.contributes.configuration)[
            "mssql.copilot.inlineCompletions.trace.maxFileSizeMB"
        ];
        expect(setting?.minimum).to.equal(1);
        expect(setting?.maximum).to.equal(MAX_TRACE_FILE_SIZE_MB);
        expect(setting?.default).to.be.within(1, MAX_TRACE_FILE_SIZE_MB);
    });

    test("keeps AI provider commands out of the default UI", () => {
        const refreshCommandId = "mssql.copilot.inlineCompletion.refreshSchemaContext";
        expect(command(refreshCommandId).enablement).to.equal(AI_INLINE_COMPLETIONS_GATE);
        expect(commandPalette(refreshCommandId).when).to.equal(AI_INLINE_COMPLETIONS_GATE);
        for (const provider of ["anthropic", "openai", "xai"]) {
            for (const action of ["setApiKey", "clearApiKey"]) {
                const commandId = `mssql.copilot.sdkProviders.${provider}.${action}`;
                expect(command(commandId).enablement).to.equal(AI_INLINE_COMPLETIONS_GATE);
                expect(commandPalette(commandId).when).to.equal(AI_INLINE_COMPLETIONS_GATE);
            }
        }
    });

    test("uses the Debug Console entry point for completion debugging", () => {
        const obsoleteCommand = "mssql.openInlineCompletionDebug";
        expect(packageJson.contributes.commands.map((entry) => entry.command)).to.not.include(
            obsoleteCommand,
        );
        expect(
            packageJson.contributes.menus.commandPalette.map((entry) => entry.command),
        ).to.not.include(obsoleteCommand);
        expect(
            collectConfigurationProperties(packageJson.contributes.configuration),
        ).to.not.have.property("mssql.copilot.inlineCompletions.debug.standalonePanel");
        expect(command("mssql.openDebugConsole").enablement).to.equal(DEBUG_CONSOLE_GATE);
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

    test("requires activation snapshots and complete paths for diagnostics commands", () => {
        expect(command("mssql.openDebugConsole").enablement).to.equal(DEBUG_CONSOLE_GATE);
        expect(commandPalette("mssql.openDebugConsole").when).to.equal(DEBUG_CONSOLE_GATE);

        for (const commandId of [
            "mssql.sessionDiag.enable",
            "mssql.sessionDiag.disable",
            "mssql.sessionDiag.elevateCapture",
            "mssql.sessionDiag.clear",
            "mssql.sessionDiag.openStorageFolder",
        ]) {
            expect(command(commandId).enablement).to.equal(SESSION_DIAGNOSTICS_GATE);
            expect(commandPalette(commandId).when).to.equal(SESSION_DIAGNOSTICS_GATE);
        }
    });

    test("keeps every Object Explorer v2 UI surface behind the complete private-preview gate", () => {
        const oeCommands = packageJson.contributes.commands.filter((item) =>
            item.command.startsWith("mssql.objectExplorerV2."),
        );
        expect(oeCommands.length).to.be.greaterThan(0);
        for (const contribution of oeCommands) {
            const queryCommand =
                /^mssql\.objectExplorerV2\.(newQuery|selectTop|scriptCreate|scriptAlter|scriptDrop|scriptExecute)$/.test(
                    contribution.command,
                );
            expect(contribution.enablement, contribution.command).to.equal(
                OBJECT_EXPLORER_V2_GATE +
                    (queryCommand
                        ? " && mssql.privatePreview.queryStudioActive && config.mssql.queryStudio.enabled"
                        : ""),
            );
        }

        const view = packageJson.contributes.views.objectExplorer.find(
            (candidate) => candidate.id === "mssql.objectExplorerV2",
        );
        expect(view?.when).to.equal(OBJECT_EXPLORER_V2_GATE);

        for (const menu of [
            ...packageJson.contributes.menus["view/title"],
            ...packageJson.contributes.menus["view/item/context"],
        ].filter((item) => item.command?.startsWith("mssql.objectExplorerV2."))) {
            expect(menu.when, menu.command).to.contain(OBJECT_EXPLORER_V2_GATE);
        }

        const keybindings = packageJson.contributes.keybindings.filter((item) =>
            item.command?.startsWith("mssql.objectExplorerV2."),
        );
        expect(keybindings.length).to.be.greaterThan(0);
        for (const keybinding of keybindings) {
            expect(keybinding.when, keybinding.command).to.contain(OBJECT_EXPLORER_V2_GATE);
        }
    });

    test("does not publish deferred Docker lifecycle commands", () => {
        const commandIds = packageJson.contributes.commands.map((item) => item.command);
        for (const deferred of [
            "mssql.objectExplorerV2.startContainer",
            "mssql.objectExplorerV2.stopContainer",
            "mssql.objectExplorerV2.deleteContainer",
        ]) {
            expect(commandIds, deferred).to.not.include(deferred);
        }
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
