/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { DOMParser } from "@xmldom/xmldom";
import { projectDacpacSchemaDiff } from "../../src/runbookStudio/presentation/schemaDiffProjection";

suite("Runbook Studio schema diff projection", () => {
    const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

    test("projects namespaced DacFx operations and alerts into semantic rows", () => {
        const document = parse(
            [
                '<d:DeploymentReport xmlns:d="urn:test">',
                "<d:Alerts>",
                '<d:Alert Name="DataIssue"><d:Issue Value="Rows may be rebuilt" /></d:Alert>',
                "</d:Alerts>",
                "<d:Operations>",
                '<d:Operation Name="Create">',
                '<d:Item Type="SqlTable" Value="[dbo].[Widget]" />',
                '<d:Item Type="SqlIndex" Value="[dbo].[Widget].[IX_Widget]" />',
                "</d:Operation>",
                '<d:Operation Name="Alter"><d:Item Type="SqlTable" Value="[dbo].[Account]" /></d:Operation>',
                "</d:Operations>",
                "</d:DeploymentReport>",
            ].join(""),
        );

        expect(projectDacpacSchemaDiff(document)).to.deep.equal({
            changeCount: 3,
            operationGroups: [
                { name: "Create", count: 2 },
                { name: "Alter", count: 1 },
            ],
            omittedOperationGroupCount: 0,
            changes: [
                { operation: "Create", objectType: "SqlTable", name: "[dbo].[Widget]" },
                {
                    operation: "Create",
                    objectType: "SqlIndex",
                    name: "[dbo].[Widget].[IX_Widget]",
                },
                { operation: "Alter", objectType: "SqlTable", name: "[dbo].[Account]" },
            ],
            omittedChangeCount: 0,
            alertCount: 1,
            alerts: [{ kind: "DataIssue", detail: "Rows may be rebuilt" }],
            omittedAlertCount: 0,
        });
    });

    test("bounds detailed rows while retaining complete counts", () => {
        const items = Array.from(
            { length: 30 },
            (_, index) => `<Item Type="SqlTable" Value="[dbo].[T${index}]" />`,
        ).join("");
        const alerts = Array.from(
            { length: 15 },
            (_, index) => `<Alert Name="Alert${index}" />`,
        ).join("");
        const projection = projectDacpacSchemaDiff(
            parse(
                `<DeploymentReport><Alerts>${alerts}</Alerts><Operations><Operation Name="Create">${items}</Operation></Operations></DeploymentReport>`,
            ),
        );

        expect(projection?.changeCount).to.equal(30);
        expect(projection?.changes).to.have.length(20);
        expect(projection?.omittedChangeCount).to.equal(10);
        expect(projection?.alertCount).to.equal(15);
        expect(projection?.alerts).to.have.length(10);
        expect(projection?.omittedAlertCount).to.equal(5);
    });

    test("refuses XML that is not a DacFx deployment report", () => {
        expect(
            projectDacpacSchemaDiff(parse('<Other><Operation Name="Create" /></Other>')),
        ).to.equal(undefined);
    });
});
