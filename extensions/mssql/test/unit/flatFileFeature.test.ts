/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { SqlOpsDataClient } from "../../src/sqlOps/clientInterfaces";
import { FlatFileFeature } from "../../src/sqlOps/flatFileFeature";
import { managerInstance, ApiType } from "../../src/sqlOps/serviceApiManager";
import * as ff from "../../src/models/contracts/flatFile";

chai.use(sinonChai);

suite("FlatFileFeature", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlOpsDataClient>;
    let registerApiStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockClient = {
            sendRequest: sandbox.stub(),
            logFailedRequest: sandbox.stub(),
            providerId: "testProvider",
        } as unknown as sinon.SinonStubbedInstance<SqlOpsDataClient>;

        registerApiStub = sandbox
            .stub(managerInstance, "registerApi")
            .callsFake((apiType, provider) => provider as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor sets messages correctly", () => {
        const feature = new FlatFileFeature(mockClient as any);
        expect((feature as any).messages).to.deep.equal([ff.ProseDiscoveryRequest.type]);
    });

    test("fillClientCapabilities is a no-op", () => {
        const feature = new FlatFileFeature(mockClient as any);
        expect(() => feature.fillClientCapabilities({} as any)).to.not.throw();
    });

    test("initialize calls register with correct messages and id", () => {
        const feature = new FlatFileFeature(mockClient as any);
        const registerStub = sandbox.stub(feature as any, "register");

        feature.initialize({} as any);
        expect(registerStub).to.have.been.calledOnce;
        const callArg = registerStub.getCall(0).args[0];
        expect(callArg).to.deep.equal([ff.ProseDiscoveryRequest.type]);
    });

    test("registerProvider registers FlatFileProvider with managerInstance", async () => {
        const feature = new FlatFileFeature(mockClient as any);

        const provider = (feature as any).registerProvider(undefined);

        expect(registerApiStub).to.have.been.calledOnceWith(
            ApiType.FlatFileProvider,
            sinon.match.has("providerId", "testProvider"),
        );

        // Ensure returned provider has send*Request functions
        expect(provider.sendProseDiscoveryRequest).to.be.a("function");
        expect(provider.sendGetColumnInfoRequest).to.be.a("function");
        expect(provider.sendChangeColumnSettingsRequest).to.be.a("function");
        expect(provider.sendInsertDataRequest).to.be.a("function");
    });

    test("sendProseDiscoveryRequest forwards to client.sendRequest", async () => {
        const feature = new FlatFileFeature(mockClient as any);
        const provider = (feature as any).registerProvider(undefined);

        const mockResponse = { columns: [] };
        (mockClient.sendRequest as sinon.SinonStub).resolves(mockResponse);

        const params: ff.ProseDiscoveryParams = { filePath: "file.csv" } as any;
        const result = await provider.sendProseDiscoveryRequest(params);

        expect(mockClient.sendRequest).to.have.been.calledOnceWith(
            ff.ProseDiscoveryRequest.type,
            params,
        );
        expect(result).to.equal(mockResponse);
    });

    test("sendProseDiscoveryRequest rejects and logs on client error", async () => {
        const feature = new FlatFileFeature(mockClient as any);
        const provider = (feature as any).registerProvider(undefined);

        const error = new Error("fail");
        (mockClient.sendRequest as sinon.SinonStub).rejects(error);

        try {
            await provider.sendProseDiscoveryRequest({} as any);
            throw new Error("Should not reach here");
        } catch (e) {
            expect(e).to.equal(error);
            expect(mockClient.logFailedRequest).to.have.been.calledOnceWith(
                ff.ProseDiscoveryRequest.type,
                error,
            );
        }
    });

    test("other send*Request functions forward correctly", async () => {
        const feature = new FlatFileFeature(mockClient as any);
        const provider = (feature as any).registerProvider(undefined);

        const response = { success: true } as any;
        (mockClient.sendRequest as sinon.SinonStub).resolves(response);

        const getColumnInfoResult = await provider.sendGetColumnInfoRequest({} as any);
        expect(getColumnInfoResult).to.equal(response);

        const changeColResult = await provider.sendChangeColumnSettingsRequest({} as any);
        expect(changeColResult).to.equal(response);

        const insertDataResult = await provider.sendInsertDataRequest({} as any);
        expect(insertDataResult).to.equal(response);
    });
});
