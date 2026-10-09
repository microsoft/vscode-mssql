/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    databaseFactsParts,
    editionLabel,
    overviewTimeRangePresets,
    platformLabel,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardOverviewModel";

suite("Performance dashboard overview", () => {
    test("shows the platform, tier, and vCores of an Azure SQL Database in the vCore model", () => {
        expect(
            databaseFactsParts({
                platform: "azureSqlDatabase",
                facts: { edition: "GeneralPurpose", serviceObjective: "GP_Gen5_8", vCores: 8 },
            }),
        ).to.deep.equal(["Azure SQL Database", "General Purpose", "8 vCores"]);
    });

    test("shows the service objective in the DTU model and for Synapse", () => {
        expect(
            databaseFactsParts({
                platform: "azureSqlDatabase",
                facts: { edition: "Standard", serviceObjective: "S2", vCores: 1 },
            }),
        ).to.deep.equal(["Azure SQL Database", "Standard", "S2"]);
        expect(
            databaseFactsParts({
                platform: "azureSqlDatabase",
                facts: { edition: "Basic", serviceObjective: "Basic" },
            }),
        ).to.deep.equal(["Azure SQL Database", "Basic"]);
        expect(
            databaseFactsParts({
                platform: "synapseDedicated",
                facts: { edition: "DataWarehouse", serviceObjective: "DW100c" },
            }),
        ).to.deep.equal(["Azure Synapse dedicated SQL pool", "DW100c"]);
    });

    test("shows the SQL Server version, edition, and logical CPUs", () => {
        expect(
            databaseFactsParts({
                platform: "sqlServer",
                majorVersion: 16,
                facts: { edition: "Developer Edition (64-bit)", logicalCpus: 1 },
            }),
        ).to.deep.equal(["SQL Server 2022", "Developer Edition (64-bit)", "1 logical CPU"]);
        expect(platformLabel("sqlServer", 99)).to.equal("SQL Server");
    });

    test("shows nothing without facts", () => {
        expect(databaseFactsParts(undefined)).to.deep.equal([]);
        expect(databaseFactsParts({ errorMessage: "Login failed" })).to.deep.equal([]);
    });

    test("spaces an edition code but keeps a written edition", () => {
        expect(editionLabel("BusinessCritical")).to.equal("Business Critical");
        expect(editionLabel("Hyperscale")).to.equal("Hyperscale");
        expect(editionLabel("Enterprise Edition: Core-based Licensing (64-bit)")).to.equal(
            "Enterprise Edition: Core-based Licensing (64-bit)",
        );
    });

    test("offers the presets of the mock, with the past 24 hours", () => {
        expect(overviewTimeRangePresets().map((preset) => preset.id)).to.deep.equal([
            "1h",
            "12h",
            "24h",
            "7d",
            "30d",
        ]);
    });
});
