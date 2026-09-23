/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    defaultAzureSqlContainerName,
    findAvailableAzureSqlContainerPort,
    generateAzureSqlContainerName,
    getAzureSqlContainerProvisioningCommand,
    prepareAzureSqlContainerForm,
    registerAzureSqlRpcHandlers,
    runAzureSqlContainerDeployment,
    runAzureSqlContainerProvisioningStep,
    validateAzureSqlContainerPort,
    validateAzureSqlContainerForm,
} from "../../src/deployment/azureSqlHelpers";
import {
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlContainerProvisioningStep,
    ContainerEngine,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { AzureSqlContainer } from "../../src/constants/locConstants";
import * as dockerUtils from "../../src/docker/dockerUtils";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionUI } from "../../src/views/connectionUI";
import {
    containerConnectionMaxAttempts,
    containerConnectionRetryDelayMs,
    sa,
} from "../../src/constants/constants";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { BackgroundTaskState } from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);
const { expect } = chai;

suite("Azure SQL container configuration", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    const validForm = (): AzureSqlContainerForm => ({
        password: ["Example", "123", "!"].join(""),
        savePassword: false,
        profileName: "",
        groupId: "default",
        containerName: "",
        port: "1433",
        hostname: "",
        acceptEula: true,
    });

    test("accepts the default configuration with a valid password and accepted terms", () => {
        expect(validateAzureSqlContainerForm(validForm())).to.deep.equal({});
    });

    test("validates the direct form RPC payload", async () => {
        const onRequest = sandbox.stub();
        const controller = {
            state: {
                connectionGroupOptions: [{ value: "default" }],
            },
            onRequest,
        } as unknown as DeploymentWebviewController;
        registerAzureSqlRpcHandlers(controller);
        const validateForm = onRequest.firstCall.args[1] as (
            form: AzureSqlContainerForm,
        ) => Promise<AzureSqlContainerFormErrors>;

        expect(await validateForm(validForm())).to.deep.equal({});
    });

    test("generates the default container name using the local container naming logic", async () => {
        const generatedName = `${defaultAzureSqlContainerName}_2`;
        const validateContainerName = sandbox
            .stub(dockerUtils, "validateContainerName")
            .resolves(generatedName);

        expect(await generateAzureSqlContainerName()).to.equal(generatedName);
        expect(validateContainerName).to.have.been.calledOnceWithExactly(
            "",
            defaultAzureSqlContainerName,
        );
    });

    test("selects ports using the local-container allocation logic", async () => {
        const findAvailablePort = sandbox
            .stub(dockerUtils, "findAvailablePort")
            .withArgs(1433)
            .resolves(1434);

        expect(await findAvailableAzureSqlContainerPort(ContainerEngine.Podman, 1433)).to.equal(
            1434,
        );
        expect(findAvailablePort).to.have.been.calledOnceWithExactly(1433);
    });

    test("rejects a manually selected port that is already in use", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").withArgs(1433).resolves(1434);

        expect(await validateAzureSqlContainerPort(ContainerEngine.Docker, "1433")).to.equal(
            AzureSqlContainer.portInUse,
        );
    });

    test("accepts a manually selected port that is available", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").withArgs(1434).resolves(1434);

        expect(await validateAzureSqlContainerPort(ContainerEngine.Docker, "1434")).to.be.undefined;
    });

    test("allocates a blank port at submission and uses it in the run command", async () => {
        const findAvailablePort = sandbox.stub(dockerUtils, "findAvailablePort").resolves(1442);
        const original = { ...validForm(), port: "" };
        const { form, errors } = await prepareAzureSqlContainerForm(original);

        expect(findAvailablePort).to.have.been.calledWithExactly(1433);
        expect(errors).to.deep.equal({});
        expect(original.port).to.equal("");
        expect(form.port).to.equal("1442");
        expect(
            getAzureSqlContainerProvisioningCommand(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                form,
            )?.args,
        ).to.include("1442:1433");
    });

    test("preserves an explicit available port at submission", async () => {
        const findAvailablePort = sandbox.stub(dockerUtils, "findAvailablePort").resolves(1500);
        const { form, errors } = await prepareAzureSqlContainerForm({
            ...validForm(),
            port: "1500",
        });

        expect(findAvailablePort).to.have.been.calledWithExactly(1500);
        expect(form.port).to.equal("1500");
        expect(errors).to.deep.equal({});
    });

    test("rejects an occupied explicit port instead of replacing it", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").resolves(1442);
        const { form, errors } = await prepareAzureSqlContainerForm(validForm());

        expect(form.port).to.equal("1433");
        expect(errors.port).to.equal(AzureSqlContainer.portInUse);
    });

    test("reports failed allocation without falling back to 1433", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").resolves(-1);
        const { form, errors } = await prepareAzureSqlContainerForm({ ...validForm(), port: "" });

        expect(form.port).to.equal("");
        expect(errors.port).to.equal(AzureSqlContainer.portDetectionFailed);
    });

    test("allows a blank port for automatic selection without probing during editing", async () => {
        const findAvailablePort = sandbox.stub(dockerUtils, "findAvailablePort");
        expect(await validateAzureSqlContainerPort(ContainerEngine.Docker, "")).to.be.undefined;
        expect(findAvailablePort).not.to.have.been.called;
    });

    test("builds the private-preview Docker pull command", () => {
        expect(
            getAzureSqlContainerProvisioningCommand(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.PullImage,
                validForm(),
            ),
        ).to.deep.equal({
            executable: "docker",
            args: ["pull", "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest"],
        });
    });

    test("builds the Docker run command with the configured connection values", () => {
        const form = {
            ...validForm(),
            containerName: "azure_sql_db_container",
            hostname: "sqldbdev",
            port: "14330",
        };

        expect(
            getAzureSqlContainerProvisioningCommand(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                form,
            ),
        ).to.deep.equal({
            executable: "docker",
            args: [
                "run",
                "-d",
                "--name",
                form.containerName,
                "-e",
                "ACCEPT_EULA=Y",
                "-e",
                `MSSQL_SA_PASSWORD=${form.password}`,
                "-p",
                "14330:1433",
                "--hostname",
                form.hostname,
                "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest",
            ],
        });
    });

    test("does not create a connection when provisioning is canceled", async () => {
        const saveProfile = sandbox.stub();
        const mainController = {
            connectionManager: {
                connectionUI: { saveProfile },
            },
        } as unknown as MainController;
        const abortController = new AbortController();
        abortController.abort();

        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.Connect,
            validForm(),
            mainController,
            abortController.signal,
        );

        expect(result.success).to.be.false;
        expect(saveProfile).not.to.have.been.called;
    });

    suite("connection readiness", () => {
        let mainController: sinon.SinonStubbedInstance<MainController>;
        let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
        let connectionUI: sinon.SinonStubbedInstance<ConnectionUI>;

        setup(() => {
            mainController = sandbox.createStubInstance(MainController);
            connectionManager = sandbox.createStubInstance(ConnectionManager);
            connectionUI = sandbox.createStubInstance(ConnectionUI);
            sandbox.stub(mainController, "connectionManager").get(() => connectionManager);
            sandbox.stub(connectionManager, "connectionUI").get(() => connectionUI);
            connectionUI.saveProfile.callsFake(async (profile) => profile);
            connectionManager.createConnectionDetails.returns({ options: {} });
            connectionManager.getConnectionString.resolves("Server=localhost,1433");
            connectionManager.disconnect.resolves(true);
            mainController.createObjectExplorerSession.resolves();
        });

        test("retries login before saving the profile and opening Object Explorer", async () => {
            const clock = sandbox.useFakeTimers();
            connectionManager.connect.onFirstCall().resolves(false);
            connectionManager.connect.onSecondCall().resolves(true);
            const form = { ...validForm(), containerName: "azure_sql_db_container" };
            const pending = runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                form,
                mainController,
            );

            await clock.tickAsync(0);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
            await clock.tickAsync(containerConnectionRetryDelayMs);

            expect(await pending).to.deep.equal({
                success: true,
                connectionString: "Server=localhost,1433",
            });
            expect(connectionManager.connect).to.have.been.calledWith(
                "localhost,1433/azure_sql_db_container/deployment",
                sinon.match({
                    user: sa,
                    password: form.password,
                    server: "localhost,1433",
                }),
                { shouldHandleErrors: false },
            );
            expect(connectionManager.disconnect).to.have.been.calledWith(
                "localhost,1433/azure_sql_db_container/deployment",
            );
            expect(mainController.createObjectExplorerSession).to.have.been.calledWith(
                sinon.match({ user: sa, password: form.password, savePassword: false }),
            );
        });

        test("reports persistent login failure without opening Object Explorer", async () => {
            const clock = sandbox.useFakeTimers();
            connectionManager.connect.rejects(new Error("Login failed"));
            const pending = runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                validForm(),
                mainController,
            );
            await clock.runAllAsync();

            expect(await pending).to.deep.equal({
                success: false,
                error: AzureSqlContainer.connectContainerFailed,
            });
            expect(connectionManager.connect).to.have.callCount(containerConnectionMaxAttempts);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });

        test("cancel interrupts the authentication retry delay", async () => {
            const clock = sandbox.useFakeTimers();
            const abortController = new AbortController();
            connectionManager.connect.resolves(false);
            const pending = runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                validForm(),
                mainController,
                abortController.signal,
            );
            await clock.tickAsync(0);
            abortController.abort();

            expect((await pending).success).to.be.false;
            expect(clock.countTimers()).to.equal(0);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });
    });

    test("completes background provisioning after controller disposal", async () => {
        const update = sandbox.stub();
        const complete = sandbox.stub();
        const registerTask = sandbox.stub().returns({
            id: "azure-sql-container-task",
            update,
            complete,
            remove: sandbox.stub(),
        });
        const controller = {
            isDisposed: false,
            mainController: {
                backgroundTasksService: { registerTask },
            },
        };
        const executeStep = sandbox.stub().callsFake(async () => {
            controller.isDisposed = true;
            return { success: true };
        });
        const completedSteps: AzureSqlContainerProvisioningStep[] = [];

        await runAzureSqlContainerDeployment(
            controller as unknown as DeploymentWebviewController,
            ContainerEngine.Docker,
            { ...validForm(), containerName: "azure_sql_db_container" },
            AzureSqlContainerProvisioningStep.PullImage,
            new AbortController().signal,
            (step) => completedSteps.push(step),
            executeStep,
        );

        expect(registerTask).to.have.been.calledOnce;
        expect(registerTask.firstCall.args[0]).to.deep.include({
            displayText: "Provisioning Azure SQL Database container",
            target: "azure_sql_db_container",
            state: BackgroundTaskState.InProgress,
        });
        expect(controller.isDisposed).to.be.true;
        expect(executeStep).to.have.callCount(4);
        expect(completedSteps).to.deep.equal([
            AzureSqlContainerProvisioningStep.PullImage,
            AzureSqlContainerProvisioningStep.CreateContainer,
            AzureSqlContainerProvisioningStep.WaitForReady,
            AzureSqlContainerProvisioningStep.Connect,
        ]);
        expect(complete).to.have.been.calledOnceWith(
            BackgroundTaskState.Succeeded,
            sinon.match.object,
        );
    });

    test("requires a complex password and accepted terms", () => {
        const errors = validateAzureSqlContainerForm({
            ...validForm(),
            password: "short",
            acceptEula: false,
        });
        expect(errors.password).to.be.a("string").and.not.empty;
        expect(errors.acceptEula).to.equal(AzureSqlContainer.acceptTerms);
    });

    for (const password of [
        "Short1!",
        "a".repeat(129),
        "alllowercase",
        "ALLUPPERCASE",
        "12345678",
    ]) {
        test(`rejects password that does not meet Azure SQL requirements: ${password}`, () => {
            expect(
                validateAzureSqlContainerForm({
                    ...validForm(),
                    password,
                }).password,
            ).to.be.a("string").and.not.empty;
        });
    }

    for (const password of ["Upperlower1", "UPPER123!", "lower123!", "Upper<>!"]) {
        test(`accepts password with at least three character categories: ${password}`, () => {
            expect(
                validateAzureSqlContainerForm({
                    ...validForm(),
                    password,
                }).password,
            ).to.be.undefined;
        });
    }

    for (const port of ["", "0", "65536", "-1", "1.5", "1e3", "abc"]) {
        test(`rejects invalid port ${JSON.stringify(port)}`, () => {
            expect(validateAzureSqlContainerForm({ ...validForm(), port }).port).to.equal(
                AzureSqlContainer.invalidPort,
            );
        });
    }

    for (const port of ["1", "65535"]) {
        test(`accepts port boundary ${port}`, () => {
            expect(validateAzureSqlContainerForm({ ...validForm(), port })).to.deep.equal({});
        });
    }

    test("validates optional container names without invoking Docker", () => {
        expect(
            validateAzureSqlContainerForm({
                ...validForm(),
                containerName: "azure_sql_db_container",
            }),
        ).to.deep.equal({});
        expect(
            validateAzureSqlContainerForm({
                ...validForm(),
                containerName: "invalid name",
            }).containerName,
        ).to.equal(AzureSqlContainer.invalidContainerName);
    });

    test("validates optional hostnames", () => {
        expect(
            validateAzureSqlContainerForm({
                ...validForm(),
                hostname: "db.local",
            }),
        ).to.deep.equal({});
        for (const hostname of ["invalid name", "-db", "db-", "db..local", "a".repeat(64)]) {
            expect(validateAzureSqlContainerForm({ ...validForm(), hostname }).hostname).to.equal(
                AzureSqlContainer.invalidHostname,
            );
        }
    });
});
