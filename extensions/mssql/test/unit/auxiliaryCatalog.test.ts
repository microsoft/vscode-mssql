/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { AuxiliaryCatalog, AuxSectionSpec } from "../../src/services/metadata/auxiliaryCatalog";
import { DataPlaneMetadataSessionSource } from "../../src/services/metadata/metadataService";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";

const profile = { server: "fake", profileFingerprint: "pfp_aux", authKind: "sql" as const };
const mapName = (row: unknown[]) => ({ name: String(row[0]), isSystem: false });

suite("AuxiliaryCatalog", () => {
    test("different sections serialize on the one-active-query session", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: "SELECT A",
                    events: [
                        { type: "resultSet", columns: ["name"], rows: [["A"]], delayMs: 20 },
                        { type: "complete", status: "succeeded" },
                    ],
                },
                {
                    match: "SELECT B",
                    events: [
                        { type: "resultSet", columns: ["name"], rows: [["B"]], delayMs: 20 },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const source = new DataPlaneMetadataSessionSource(backend, {
            profile,
            applicationName: "test",
        });
        const specs: readonly AuxSectionSpec[] = [
            { key: "a", scope: "database", sql: "SELECT A", map: mapName },
            { key: "b", scope: "database", sql: "SELECT B", map: mapName },
        ];
        const catalog = new AuxiliaryCatalog(source, specs, "test:aux");

        await Promise.all([catalog.refreshSection("a"), catalog.refreshSection("b")]);

        expect(catalog.status("a").readiness).to.equal("ready");
        expect(catalog.status("b").readiness).to.equal("ready");
        expect(catalog.items("a")?.[0].name).to.equal("A");
        expect(catalog.items("b")?.[0].name).to.equal("B");
        expect(backend.sessions).to.have.length(1);
        catalog.dispose();
        source.dispose();
    });
});
