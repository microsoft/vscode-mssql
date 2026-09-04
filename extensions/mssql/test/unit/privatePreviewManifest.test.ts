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
        configuration: {
            properties: Record<string, { default?: unknown }>;
        };
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
        expect(settings["mssql.objectExplorer.v2.enabled"]?.default).to.equal(false);
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

    test("keeps every Object Explorer v2 UI surface behind the complete private-preview gate", () => {
        const oeCommands = packageJson.contributes.commands.filter((item) =>
            item.command.startsWith("mssql.objectExplorerV2."),
        );
        expect(oeCommands.length).to.be.greaterThan(0);
        for (const contribution of oeCommands) {
            expect(contribution.enablement, contribution.command).to.equal(OBJECT_EXPLORER_V2_GATE);
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

    test("does not publish deferred Query Studio or Docker lifecycle commands", () => {
        const commandIds = packageJson.contributes.commands.map((item) => item.command);
        for (const deferred of [
            "mssql.objectExplorerV2.newQuery",
            "mssql.objectExplorerV2.selectTop",
            "mssql.objectExplorerV2.scriptAsCreate",
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
