/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    generateAzureSqlDatabaseArm,
    generateAzureSqlDatabaseBicep,
    generateAzureSqlDatabaseTerraform,
    generateFabricSqlDatabaseBicep,
    generateFabricSqlDatabaseTerraform,
} from "../../src/webviews/pages/Deployment/deploymentScripts";

suite("Deployment scripts", () => {
    test("preserves the deployed region, tags, and advanced settings in all Azure formats", () => {
        const params = {
            databaseName: "Inventory",
            serverName: "server",
            serverResourceId:
                "/subscriptions/sub/resourceGroups/group/providers/Microsoft.Sql/servers/server",
            location: "westus",
            tags: { project: "inventory" },
            collation: "Latin1_General_100_CI_AS",
            maxVcores: "4",
            freeLimitBehavior: "BillOverUsage",
            maintenanceConfig: "/maintenance/config",
            enableAlwaysEncrypted: true,
        };
        const resource = JSON.parse(generateAzureSqlDatabaseArm(params)).resources[0];
        expect(resource.location).to.equal("westus");
        expect(resource.tags).to.deep.equal(params.tags);
        expect(resource.sku).to.include({ name: "GP_S_Gen5_4", capacity: 4 });
        expect(resource.properties).to.include({
            collation: params.collation,
            useFreeLimit: true,
            freeLimitExhaustionBehavior: "BillOverUsage",
            maintenanceConfigurationId: "/maintenance/config",
            preferredEnclaveType: "Default",
        });
        const bicep = generateAzureSqlDatabaseBicep(params);
        expect(bicep).to.include("location: 'westus'");
        expect(bicep).to.include("'project': 'inventory'");
        expect(bicep).to.include("minCapacity: 0.5");
        expect(bicep).to.include("maintenanceConfigurationId: '/maintenance/config'");
        expect(bicep).to.include("preferredEnclaveType: 'Default'");
        const terraform = generateAzureSqlDatabaseTerraform(params);
        expect(terraform).to.include(`parent_id = "${params.serverResourceId}"`);
        expect(terraform).to.include('location  = "westus"');
        expect(terraform).to.include('"project" = "inventory"');
        expect(terraform).to.include("useFreeLimit = true");
        expect(terraform).to.include('freeLimitExhaustionBehavior = "BillOverUsage"');
        expect(terraform).not.to.include("azurerm_mssql_server.");
    });

    test("escapes tags in Azure Bicep and Terraform without evaluating template expressions", () => {
        const params = {
            serverResourceId: "/servers/server",
            location: "westus",
            tags: { "team'name": '${expression}\n"quoted"' },
        };
        expect(generateAzureSqlDatabaseBicep(params)).to.include(
            "'team\\'name': '\\${expression}\\n\"quoted\"'",
        );
        expect(generateAzureSqlDatabaseTerraform(params)).to.include(
            '"team\'name" = "$${expression}\\n\\"quoted\\""',
        );
    });

    test("escapes Bicep string characters and interpolation", () => {
        const script = generateFabricSqlDatabaseBicep({
            databaseName: "db\\name'${expression}\nnext",
        });

        expect(script).to.include(
            "param databaseName string = 'db\\\\name\\'\\${expression}\\nnext'",
        );
    });

    test("escapes Terraform string characters and template markers", () => {
        const script = generateFabricSqlDatabaseTerraform({
            databaseName: 'db\\name"${expression}%{directive}\nnext',
        });

        expect(script).to.include('name      = "db\\\\name\\"$${expression}%%{directive}\\nnext"');
    });

    test("preserves escaped values in ARM JSON", () => {
        const databaseName = 'db\\name"${expression}\nnext';
        const serverName = "server\\name";
        const template = JSON.parse(
            generateAzureSqlDatabaseArm({
                databaseName,
                serverName,
            }),
        ) as { resources: { name: string }[] };

        expect(template.resources[0].name).to.equal(`${serverName}/${databaseName}`);
    });
});
