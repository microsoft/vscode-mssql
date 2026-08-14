/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    generateAzureSqlDatabaseArm,
    generateFabricSqlDatabaseBicep,
    generateFabricSqlDatabaseTerraform,
} from "../../src/webviews/pages/Deployment/deploymentScripts";

suite("Deployment scripts", () => {
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
