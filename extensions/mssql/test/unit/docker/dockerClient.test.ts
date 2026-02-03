/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as dockerClient from "../../../src/docker/dockerClient";

chai.use(sinonChai);

/**
 * Tests for Docker Client module
 * 
 * Note: The functions checkDockerInstallation, pingDocker, and getDockerInfo
 * internally call getDockerClient() which cannot be easily mocked without
 * module rewiring. These functions are tested indirectly through the
 * mssqlDockerUtils tests which properly stub the module at a higher level.
 * 
 * This test file focuses on testing resetDockerClient and verifying the
 * module structure is correct.
 */
suite("Docker Client", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("resetDockerClient: should be callable", () => {
        // This should not throw
        expect(() => dockerClient.resetDockerClient()).to.not.throw();
    });

    test("exports: should export expected functions", () => {
        expect(typeof dockerClient.getDockerClient).to.equal("function");
        expect(typeof dockerClient.resetDockerClient).to.equal("function");
        expect(typeof dockerClient.checkDockerInstallation).to.equal("function");
        expect(typeof dockerClient.pingDocker).to.equal("function");
        expect(typeof dockerClient.getDockerInfo).to.equal("function");
    });
});
