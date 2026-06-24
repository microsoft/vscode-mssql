/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";
import * as contracts from "../../src/models/contracts/sqlProjects/sqlProjectsContracts";
import { GetScriptsResult, ResultStatus } from "vscode-mssql";

chai.use(sinonChai);

suite("SqlProjectsService - RefactorLog methods", () => {
    const PROJECT_URI = "/path/to/TestProject.sqlproj";
    const REFACTORLOG_PATH = "TestProject.refactorlog";

    let sandbox: sinon.SinonSandbox;
    let clientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let service: SqlProjectsService;

    setup(() => {
        sandbox = sinon.createSandbox();
        clientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        service = new SqlProjectsService(clientStub as unknown as SqlToolsServiceClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getRefactorLogItems sends GetRefactorLogItemsRequest with correct params", async () => {
        const expectedResult: GetScriptsResult = {
            success: true,
            errorMessage: "",
            scripts: [REFACTORLOG_PATH],
        };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.getRefactorLogItems(PROJECT_URI);

        expect(clientStub.sendRequest).to.have.been.calledOnceWith(
            contracts.GetRefactorLogItemsRequest.type,
            { projectUri: PROJECT_URI },
        );
        expect(result).to.deep.equal(expectedResult);
        expect(result.scripts).to.deep.equal([REFACTORLOG_PATH]);
    });

    test("addRefactorLogItem sends AddRefactorLogItemRequest with correct params", async () => {
        const expectedResult: ResultStatus = { success: true, errorMessage: "" };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.addRefactorLogItem(PROJECT_URI, REFACTORLOG_PATH);

        expect(clientStub.sendRequest).to.have.been.calledOnceWith(
            contracts.AddRefactorLogItemRequest.type,
            { projectUri: PROJECT_URI, path: REFACTORLOG_PATH },
        );
        expect(result).to.deep.equal(expectedResult);
        expect(result.success).to.be.true;
    });

    test("deleteRefactorLogItem sends DeleteRefactorLogItemRequest with correct params", async () => {
        const expectedResult: ResultStatus = { success: true, errorMessage: "" };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.deleteRefactorLogItem(PROJECT_URI, REFACTORLOG_PATH);

        expect(clientStub.sendRequest).to.have.been.calledOnceWith(
            contracts.DeleteRefactorLogItemRequest.type,
            { projectUri: PROJECT_URI, path: REFACTORLOG_PATH },
        );
        expect(result).to.deep.equal(expectedResult);
        expect(result.success).to.be.true;
    });

    test("getRefactorLogItems returns empty scripts array when project has no RefactorLog items", async () => {
        const expectedResult: GetScriptsResult = {
            success: true,
            errorMessage: "",
            scripts: [],
        };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.getRefactorLogItems(PROJECT_URI);

        expect(result.success).to.be.true;
        expect(result.scripts).to.deep.equal([]);
    });

    test("addRefactorLogItem propagates failure from service", async () => {
        const expectedResult: ResultStatus = {
            success: false,
            errorMessage: "File not found: TestProject.refactorlog",
        };
        clientStub.sendRequest.resolves(expectedResult);

        const result = await service.addRefactorLogItem(PROJECT_URI, REFACTORLOG_PATH);

        expect(result.success).to.be.false;
        expect(result.errorMessage).to.include("File not found");
    });
});
