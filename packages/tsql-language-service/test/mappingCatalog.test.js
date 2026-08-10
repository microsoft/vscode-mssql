/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { MappingCatalogProvider } = require("../dist/index.js");

describe("MappingCatalogProvider", () => {
    const mapping = {
        Main: {
            dbo: {
                Users: {
                    Id: { type: "int", nullable: false },
                    Name: "nvarchar(100)",
                },
            },
            sales: { Users: { Id: "bigint" } },
        },
    };

    it("resolves multipart and unqualified dbo objects without case sensitivity", () => {
        const catalog = new MappingCatalogProvider(mapping, 4, "closed");
        assert.deepEqual(catalog.columnsFor(["MAIN", "DBO", "users"]), [
            { name: "Id", type: "int", nullable: false },
            { name: "Name", type: "nvarchar(100)", nullable: undefined },
        ]);
        assert.equal(catalog.objectFor(["Users"]).parts.join("."), "Main.dbo.Users");
        assert.equal(catalog.world, "closed");
        assert.equal(catalog.version, 4);
    });

    it("does not guess an ambiguous non-dbo object and enumerates catalog children", () => {
        const catalog = new MappingCatalogProvider({
            one: { Inventory: { Id: "int" } },
            two: { Inventory: { Id: "int" } },
        });
        assert.equal(catalog.objectFor(["Inventory"]), undefined);
        assert.deepEqual(catalog.childrenOf([]), [
            { name: "one", kind: "namespace" },
            { name: "two", kind: "namespace" },
        ]);
        assert.deepEqual(catalog.tables(), ["one.Inventory", "two.Inventory"]);
    });

    it("indexes suffix resolution and caches namespace children for large catalogs", () => {
        const tables = {};
        for (let index = 0; index < 10_000; index++) {
            tables[`Table${String(index).padStart(5, "0")}`] = { Id: "int" };
        }
        const catalog = new MappingCatalogProvider({ Large: { dbo: tables } }, 1, "closed");

        assert.equal(catalog.columnsFor(["dbo", "Table09999"])[0].name, "Id");
        const children = catalog.childrenOf(["Large", "dbo"]);
        assert.equal(children.length, 10_000);
        assert.equal(catalog.childrenOf(["large", "DBO"]), children);
    });
});
