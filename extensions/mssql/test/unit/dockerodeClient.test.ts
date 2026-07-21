/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getDockerodeClient } from "../../src/docker/dockerodeClient";

suite("dockerode client", () => {
    test("constructs the CommonJS Docker client in the extension host", () => {
        const client = getDockerodeClient();

        expect(client).to.have.property("listContainers").that.is.a("function");
        expect(client).to.have.property("createContainer").that.is.a("function");
    });
});
