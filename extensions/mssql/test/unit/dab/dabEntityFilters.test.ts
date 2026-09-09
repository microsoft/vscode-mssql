/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../../src/sharedInterfaces/dab";
import {
    DabEntityStatusFilter,
    defaultDabEntityFilters,
    doesEntityMatchDabFilters,
} from "../../../src/webviews/pages/SchemaDesigner/dab/dabEntityFilters";

function createEntity(): Dab.DabEntityConfig {
    return Dab.createDefaultConfigFromSources([
        {
            id: "table:dbo.Users",
            sourceType: Dab.EntitySourceType.Table,
            schemaName: "dbo",
            sourceName: "Users",
            columns: [
                {
                    id: "table:dbo.Users:Id",
                    name: "Id",
                    dataType: "int",
                    isPrimaryKey: true,
                    isSupported: true,
                    isExposed: true,
                },
            ],
        },
    ]).entities[0];
}

suite("DAB entity filters", () => {
    test("status filters use effective global API exposure", () => {
        const entity = createEntity();

        expect(
            doesEntityMatchDabFilters(
                entity,
                { ...defaultDabEntityFilters, status: DabEntityStatusFilter.Enabled },
                [],
            ),
        ).to.equal(false);
        expect(
            doesEntityMatchDabFilters(
                entity,
                { ...defaultDabEntityFilters, status: DabEntityStatusFilter.Disabled },
                [],
            ),
        ).to.equal(true);
    });

    test("API filters intersect entity and global API exposure", () => {
        const entity = createEntity();
        const filters = {
            ...defaultDabEntityFilters,
            apiTypes: [Dab.ApiType.Rest],
        };

        expect(doesEntityMatchDabFilters(entity, filters, [Dab.ApiType.GraphQL])).to.equal(false);
        expect(doesEntityMatchDabFilters(entity, filters, [Dab.ApiType.Rest])).to.equal(true);
    });
});
