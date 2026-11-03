/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import { WebviewNavigation, WebviewNavigationHost } from "../../src/controllers/webviewNavigation";
import {
    GetLocationRequest,
    LocationChangedNotification,
    NavigateNotification,
    WebviewLocationParams,
} from "../../src/sharedInterfaces/webviewNavigation";

chai.use(sinonChai);

suite("Webview navigation (extension)", () => {
    let sandbox: sinon.SinonSandbox;
    let host: WebviewNavigationHost;
    let sendNotification: sinon.SinonStub;
    let requestHandlers: Map<string, () => WebviewLocationParams>;
    let notificationHandlers: Map<string, (params: WebviewLocationParams) => void>;

    setup(() => {
        sandbox = sinon.createSandbox();
        requestHandlers = new Map();
        notificationHandlers = new Map();
        sendNotification = sandbox.stub().resolves();
        host = {
            onRequest: (type, handler) =>
                requestHandlers.set(type.method, handler as unknown as () => WebviewLocationParams),
            onNotification: (type, handler) =>
                notificationHandlers.set(
                    type.method,
                    handler as unknown as (params: WebviewLocationParams) => void,
                ),
            sendNotification,
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    const pageAsksForLocation = () => requestHandlers.get(GetLocationRequest.type.method)!();
    const pageReports = (location: string) =>
        notificationHandlers.get(LocationChangedNotification.type.method)!({ location });

    test("gives the page its initial location", () => {
        const navigation = new WebviewNavigation(host, "queries/913");

        expect(pageAsksForLocation()).to.deep.equal({ location: "queries/913" });
        expect(navigation.location).to.equal("queries/913");
    });

    test("uses an empty location for the page default", () => {
        new WebviewNavigation(host);

        expect(pageAsksForLocation()).to.deep.equal({ location: "" });
    });

    test("keeps a location that comes before the page starts", () => {
        const navigation = new WebviewNavigation(host);
        navigation.navigate("activity/77");

        expect(sendNotification).to.not.have.been.called;
        expect(pageAsksForLocation()).to.deep.equal({ location: "activity/77" });
    });

    test("sends locations after the page starts", () => {
        const navigation = new WebviewNavigation(host);
        pageAsksForLocation();
        navigation.navigate("setup");

        expect(sendNotification).to.have.been.calledOnceWithExactly(NavigateNotification.type, {
            location: "setup",
        });
        expect(navigation.location).to.equal("setup");
    });

    test("remembers the page's location for a reload", () => {
        const navigation = new WebviewNavigation(host, "overview");
        pageAsksForLocation();
        pageReports("queries/913/compare?plans=4,9");

        expect(navigation.location).to.equal("queries/913/compare?plans=4,9");
        expect(pageAsksForLocation()).to.deep.equal({
            location: "queries/913/compare?plans=4,9",
        });
    });
});
