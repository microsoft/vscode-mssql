/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { KnownFreeLimitExhaustionBehavior } from "@azure/arm-sql";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import { AzureSqlDatabase, mssqlProviderName } from "../../src/constants/locConstants";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";
import { provisionAzureSqlDatabase } from "../../src/deployment/azureSqlDatabaseHelpers";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { AzureSqlDatabaseState } from "../../src/sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { stubTelemetry } from "./utils";

chai.use(sinonChai);

suite("Azure SQL database helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let backgroundTasksService: sinon.SinonStubbedInstance<BackgroundTasksService>;
    let completeTask: sinon.SinonStub;
    let deploymentController: DeploymentWebviewController;
    let state: AzureSqlDatabaseState;
    let updateState: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        completeTask = sandbox.stub();
        const backgroundTaskHandle: BackgroundTaskHandle = {
            id: "azure-sql-provisioning",
            update: sandbox.stub(),
            complete: completeTask,
            remove: sandbox.stub(),
        };
        backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);
        backgroundTasksService.registerTask.returns(backgroundTaskHandle);
        updateState = sandbox.stub();

        state = new AzureSqlDatabaseState({
            formState: {
                accountId: "account",
                tenantId: "tenant",
                subscriptionId: "subscription",
                resourceGroup: "resource-group",
                serverName: "server",
                databaseName: "database",
                authenticationType: "AzureMFA",
                userName: "",
                password: "",
                savePassword: false,
                freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
                profileName: "",
                groupId: "",
                dataSource: "",
                collation: "",
                maintenanceConfig: "",
                enableAlwaysEncrypted: false,
                maxVcores: "",
            },
            subscriptions: [
                {
                    subscriptionId: "subscription",
                    name: "Subscription",
                } as AzureSubscription,
            ],
            provisionLoadState: ApiStatus.Loading,
        });

        deploymentController = {
            isDisposed: false,
            mainController: {
                backgroundTasksService,
            },
            state: {
                deploymentTypeState: state,
            },
            updateState,
        } as unknown as DeploymentWebviewController;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("registers and completes a background task when provisioning succeeds", async () => {
        sandbox.stub(VsCodeAzureHelper, "createAzureSqlDatabase").resolves({} as never);

        const result = await provisionAzureSqlDatabase(deploymentController, state, {
            environment: "test",
        });

        expect(result).to.be.true;
        expect(backgroundTasksService.registerTask).to.have.been.calledWith({
            displayText: AzureSqlDatabase.provisionDatabase,
            description: "database",
            details: "server/database",
            target: "resource-group/server/database",
            tooltip: AzureSqlDatabase.provisioningDatabase("database"),
            source: mssqlProviderName,
            message: AzureSqlDatabase.provisioningDatabase("database"),
        });
        expect(completeTask).to.have.been.calledWith(
            BackgroundTaskState.Succeeded,
            sinon.match({
                message: AzureSqlDatabase.databaseProvisioned("database"),
            }),
        );
        expect(state.provisionLoadState).to.equal(ApiStatus.Loaded);
        expect(updateState).to.have.been.calledWith(deploymentController.state);
    });

    test("fails the background task when provisioning fails", async () => {
        sandbox
            .stub(VsCodeAzureHelper, "createAzureSqlDatabase")
            .rejects(new Error("Provisioning failed"));

        const result = await provisionAzureSqlDatabase(deploymentController, state, {});

        expect(result).to.be.false;
        expect(completeTask).to.have.been.calledWith(
            BackgroundTaskState.Failed,
            sinon.match({ message: "Provisioning failed" }),
        );
        expect(state.provisionLoadState).to.equal(ApiStatus.Error);
        expect(state.errorMessage).to.equal("Provisioning failed");
    });

    test("continues provisioning without updating a disposed deployment webview", async () => {
        sandbox.stub(VsCodeAzureHelper, "createAzureSqlDatabase").resolves({} as never);
        (deploymentController as unknown as { isDisposed: boolean }).isDisposed = true;

        const result = await provisionAzureSqlDatabase(deploymentController, state, {});

        expect(result).to.be.true;
        expect(updateState).to.not.have.been.called;
        expect(completeTask).to.have.been.calledWith(
            BackgroundTaskState.Succeeded,
            sinon.match.object,
        );
    });
});
