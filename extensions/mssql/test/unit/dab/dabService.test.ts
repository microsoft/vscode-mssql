/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DabService } from "../../../src/services/dabService";
import { Dab } from "../../../src/sharedInterfaces/dab";

function createTestEntity(overrides?: Partial<Dab.DabEntityConfig>): Dab.DabEntityConfig {
    return {
        id: "test-id-1",
        tableName: "Users",
        schemaName: "dbo",
        isEnabled: true,
        enabledActions: [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
        advancedSettings: {
            entityName: "Users",
            authorizationRole: Dab.AuthorizationRole.Anonymous,
        },
        ...overrides,
    };
}

function createTestConfig(overrides?: Partial<Dab.DabConfig>): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest],
        entities: [createTestEntity()],
        ...overrides,
    };
}

const defaultConnectionInfo: Dab.DabConnectionInfo = {
    connectionString: "Server=localhost;Database=TestDb;Trusted_Connection=true;",
};

suite("DabService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let dabService: DabService;

    setup(() => {
        sandbox = sinon.createSandbox();
        dabService = new DabService();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("generateConfig", () => {
        test("should return success: true for valid input", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            expect(result.success).to.equal(true);
            expect(result.error).to.be.undefined;
        });

        test("should return valid JSON in configContent", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            const parsed = JSON.parse(result.configContent);
            expect(parsed).to.be.an("object");
        });

        test("should delegate to DabConfigFileBuilder for config content", () => {
            const result = dabService.generateConfig(createTestConfig(), defaultConnectionInfo);
            const parsed = JSON.parse(result.configContent);
            expect(parsed).to.have.property("$schema");
            expect(parsed).to.have.property("data-source");
            expect(parsed).to.have.property("runtime");
            expect(parsed).to.have.property("entities");
        });
    });
});
