/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { DEFAULT_METADATA_CACHE_SETTINGS } from "../../src/services/metadata/cache/metadataCacheSettings";
import { MetadataStoreService } from "../../src/services/metadata/metadataStoreService";
import { prepareConnection } from "../../src/services/metadata/profileAuthAdapter";

suite("MetadataStoreService composition", () => {
    let service: MetadataStoreService;

    setup(() => {
        service = new MetadataStoreService();
    });

    teardown(() => {
        service.dispose();
    });

    test("keeps persistence absent when the default-off setting is disabled", () => {
        service.configureCache({
            cacheRootPath: "unused-disabled-cache-root",
            settings: () => DEFAULT_METADATA_CACHE_SETTINGS,
        });

        expect(service.cache()).to.equal(undefined);
        expect(service.store().status().cache).to.equal(undefined);
    });

    test("composes the persistent coordinator only when explicitly enabled", () => {
        service.configureCache({
            cacheRootPath: "unused-enabled-cache-root",
            settings: () => ({ ...DEFAULT_METADATA_CACHE_SETTINGS, enabled: true }),
        });

        expect(service.cache()).to.not.equal(undefined);
        expect(service.store().status().cache).to.deep.equal({ enabled: true, loadedFromDisk: 0 });
    });

    test("rejects metadata acquisition before starting a disabled SQL Data Plane", async () => {
        service.configureHost({ dataPlaneEnabled: () => false, pollSeconds: () => 0 });
        const prepared = prepareConnection(
            { server: "test", authenticationType: "Integrated" },
            {
                lookupPassword: async () => {
                    throw new Error("integrated auth must not request a password");
                },
            },
        );
        let failure: unknown;
        try {
            await service.store().acquireDatabase(prepared, "Db1");
        } catch (error) {
            failure = error;
        }
        expect(String(failure)).to.include("mssql.sqlDataPlane.enabled");
        expect(service.store().status().databases).to.deep.equal([]);
    });
});
