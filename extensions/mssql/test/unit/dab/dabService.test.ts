/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DabService } from "../../../src/services/dabService";
import { Dab } from "../../../src/sharedInterfaces/dab";
import * as dockerUtils from "../../../src/deployment/dockerUtils";

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

    suite("runDeploymentStep", () => {
        test("should run dockerInstallation step successfully", async () => {
            sandbox.stub(dockerUtils, "checkDockerInstallation").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.dockerInstallation,
            );

            expect(result.success).to.be.true;
        });

        test("should return error with errorLink for failed dockerInstallation step", async () => {
            sandbox
                .stub(dockerUtils, "checkDockerInstallation")
                .resolves({ success: false, error: "Docker not installed" });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.dockerInstallation,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Docker not installed");
            expect(result.errorLink).to.equal(dockerUtils.dockerInstallErrorLink);
        });

        test("should run startDockerDesktop step successfully", async () => {
            sandbox.stub(dockerUtils, "startDocker").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startDockerDesktop,
            );

            expect(result.success).to.be.true;
        });

        test("should run checkDockerEngine step successfully", async () => {
            sandbox.stub(dockerUtils, "checkEngine").resolves({ success: true });

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkDockerEngine,
            );

            expect(result.success).to.be.true;
        });

        test("should run pullImage step successfully", async () => {
            sandbox.stub(dockerUtils, "pullDabContainerImage").resolves({ success: true });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.true;
        });

        test("should return error when pullImage fails", async () => {
            sandbox
                .stub(dockerUtils, "pullDabContainerImage")
                .resolves({ success: false, error: "Network error" });

            const result = await dabService.runDeploymentStep(Dab.DabDeploymentStepOrder.pullImage);

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Network error");
        });

        test("should run startContainer step successfully with valid params", async () => {
            sandbox
                .stub(dockerUtils, "startDabDockerContainer")
                .resolves({ success: true, port: 5000 });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                params,
                createTestConfig(),
                defaultConnectionInfo.connectionString,
            );

            expect(result.success).to.be.true;
            expect(result.apiUrl).to.equal("http://localhost:5000");
        });

        test("should return error when startContainer is called without params", async () => {
            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                undefined,
                createTestConfig(),
                defaultConnectionInfo.connectionString,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should return error when startContainer is called without config", async () => {
            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.startContainer,
                params,
                undefined,
                defaultConnectionInfo.connectionString,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should run checkContainer step successfully", async () => {
            sandbox
                .stub(dockerUtils, "checkIfDabContainerIsReady")
                .resolves({ success: true, port: 5000 });

            const params: Dab.DabDeploymentParams = {
                containerName: "test-container",
                port: 5000,
            };

            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkContainer,
                params,
            );

            expect(result.success).to.be.true;
            expect(result.apiUrl).to.equal("http://localhost:5000");
        });

        test("should return error when checkContainer is called without params", async () => {
            const result = await dabService.runDeploymentStep(
                Dab.DabDeploymentStepOrder.checkContainer,
            );

            expect(result.success).to.be.false;
            expect(result.error).to.include("required");
        });

        test("should return error for unknown deployment step", async () => {
            const result = await dabService.runDeploymentStep(999 as Dab.DabDeploymentStepOrder);

            expect(result.success).to.be.false;
            expect(result.error).to.include("Unknown deployment step");
        });
    });

    suite("validateDeploymentParams", () => {
        test("should return valid result when both container name and port are available", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.true;
            expect(result.validatedContainerName).to.equal("my-dab-container");
            expect(result.containerNameError).to.be.undefined;
            expect(result.isPortValid).to.be.true;
            expect(result.suggestedPort).to.equal(5000);
            expect(result.portError).to.be.undefined;
        });

        test("should return invalid result when container name is already taken", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container_2");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("my-dab-container_2");
            expect(result.containerNameError).to.include("invalid or already in use");
        });

        test("should return invalid result when port is already in use", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("my-dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5001);

            const result = await dabService.validateDeploymentParams("my-dab-container", 5000);

            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5001);
            expect(result.portError).to.include("already in use");
        });

        test("should return both invalid when container name and port are unavailable", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("dab-container_3");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5002);

            const result = await dabService.validateDeploymentParams("dab-container", 5000);

            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container_3");
            expect(result.isPortValid).to.be.false;
            expect(result.suggestedPort).to.equal(5002);
        });

        test("should handle empty container name for auto-generation", async () => {
            sandbox.stub(dockerUtils, "validateDabContainerName").resolves("dab-container");
            sandbox.stub(dockerUtils, "findAvailableDabPort").resolves(5000);

            const result = await dabService.validateDeploymentParams("", 5000);

            // Empty string != "dab-container", so isContainerNameValid is false
            expect(result.isContainerNameValid).to.be.false;
            expect(result.validatedContainerName).to.equal("dab-container");
        });
    });

    suite("stopDeployment", () => {
        test("should stop and remove container successfully", async () => {
            sandbox.stub(dockerUtils, "stopAndRemoveDabContainer").resolves({ success: true });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.true;
            expect(result.error).to.be.undefined;
        });

        test("should return error when stop fails", async () => {
            sandbox
                .stub(dockerUtils, "stopAndRemoveDabContainer")
                .resolves({ success: false, error: "Container not found" });

            const result = await dabService.stopDeployment("nonexistent-container");

            expect(result.success).to.be.false;
            expect(result.error).to.equal("Container not found");
        });

        test("should handle undefined success as false", async () => {
            sandbox
                .stub(dockerUtils, "stopAndRemoveDabContainer")
                .resolves({ success: undefined as any });

            const result = await dabService.stopDeployment("test-container");

            expect(result.success).to.be.false;
        });
    });
});
