/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { ApiType, managerInstance } from "../../src/sqlOps/serviceApiManager";

suite("ServiceApiManager", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should register and fire API events", (done) => {
        const testFeature = { name: "testFeature" };

        const event = managerInstance.onRegisteredApi<typeof testFeature>(ApiType.FlatFileProvider);
        const disposable = event((feature) => {
            expect(feature).to.equal(testFeature);
            done();
        });

        managerInstance.registerApi(ApiType.FlatFileProvider, testFeature);

        disposable.dispose();
    });

    test("should return a disposable from registerApi", () => {
        const testFeature = { name: "testFeature2" };
        const disposable = managerInstance.registerApi(ApiType.FlatFileProvider, testFeature);
        expect(disposable).to.have.property("dispose").that.is.a("function");
    });

    test("should fire model view registration events", (done) => {
        const mockModelView: any = {}; // azdata.ModelView can be mocked as empty object
        const id = "testModelView";

        const disposable = managerInstance.onRegisteredModelView((modelViewDef) => {
            expect(modelViewDef.id).to.equal(id);
            expect(modelViewDef.modelView).to.equal(mockModelView);
            done();
        });

        managerInstance.registerModelView(id, mockModelView);

        disposable.dispose();
    });

    test("onRegisteredApi should return the same event for the same ApiType", () => {
        const event1 = managerInstance.onRegisteredApi(ApiType.FlatFileProvider);
        const event2 = managerInstance.onRegisteredApi(ApiType.FlatFileProvider);
        expect(event1).to.equal(event2);
    });

    test("registerApi should fire event only if the emitter exists", () => {
        const spy = sinon.spy();
        const event = managerInstance.onRegisteredApi(ApiType.FlatFileProvider);
        event(spy);

        const testFeature = { name: "feature3" };
        managerInstance.registerApi(ApiType.FlatFileProvider, testFeature);

        expect(spy.calledOnceWith(testFeature)).to.be.true;
    });
});
