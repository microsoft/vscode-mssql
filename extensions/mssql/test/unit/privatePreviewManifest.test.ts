/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { collectConfigurationProperties, ConfigurationContribution } from "./manifestUtils";
import { getPreviewConfigKey, PreviewFeature } from "../../src/previews/previewService";

const SQL_DATA_PLANE_GATE =
    "mssql.privatePreview.sqlDataPlaneActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled";
const METADATA_CACHE_GATE =
    "mssql.privatePreview.metadataCacheActive && config.mssql.enableExperimentalFeatures && config.mssql.sqlDataPlane.enabled && config.mssql.metadataCache.enabled";

interface CommandContribution {
    command: string;
    enablement?: string;
}

interface CommandPaletteContribution {
    command: string;
    when?: string;
}

interface ExtensionPackageJson {
    contributes: {
        commands: CommandContribution[];
        menus: { commandPalette: CommandPaletteContribution[] };
        configuration:
            | ConfigurationContribution<{ default?: unknown }>
            | ConfigurationContribution<{ default?: unknown }>[];
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
    });

    test("does not list Azure SQL container flags in Settings", () => {
        const settings = collectConfigurationProperties(packageJson.contributes.configuration);

        expect(settings).not.to.have.property(
            getPreviewConfigKey(PreviewFeature.AzureSqlContainers),
        );
        expect(settings).not.to.have.property("mssql.preview.azureSqlContainers");
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
