/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import sinonChai from "sinon-chai";
import {
    defaultAzureSqlContainerName,
    generateAzureSqlContainerName,
    getAzureSqlContainerProvisioningCommand,
    executeContainerEngineCommand,
    prepareAzureSqlContainerForm,
    registerAzureSqlRpcHandlers,
    runAzureSqlContainerDeployment,
    runAzureSqlContainerProvisioningStep,
    validateAzureSqlContainerForm,
    waitForAzureSqlContainer,
} from "../../src/deployment/azureSqlHelpers";
import {
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlContainerProvisioningStep,
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { Accounts, AzureSqlContainer, ConnectionDialog } from "../../src/constants/locConstants";
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
import {
    BackgroundTasksService,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";
import { CancellationToken } from "vscode-jsonrpc";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import * as azureHelpers from "../../src/connectionconfig/azureHelpers";
import * as vscodeEntraMfaUtils from "../../src/azure/vscodeEntraMfaUtils";
import * as containerEngine from "../../src/docker/containerEngine";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stubExtensionContext, stubTelemetry } from "./utils";
import { logger } from "../../src/models/logger";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { DeploymentType } from "../../src/sharedInterfaces/deployment";

chai.use(sinonChai);
const { expect } = chai;

suite("Azure SQL container configuration", () => {
    let sandbox: sinon.SinonSandbox;
    let certificateDirectory: string;
    let certificatePfxFilePath: string;
    let acquireToken: sinon.SinonStub;
    let telemetry: ReturnType<typeof stubTelemetry>;

    suiteSetup(async () => {
        certificateDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "mssql-entra-provisioning-"),
        );
        certificatePfxFilePath = path.join(certificateDirectory, "certificate.pfx");
        await fs.writeFile(certificatePfxFilePath, "Externally prepared PFX fixture");
    });

    suiteTeardown(async () => {
        for (const name of await fs.readdir(certificateDirectory)) {
            await fs.unlink(path.join(certificateDirectory, name));
        }
        await fs.rmdir(certificateDirectory);
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        acquireToken = sandbox
            .stub(vscodeEntraMfaUtils, "acquireTokenFromVscodeAccountForResource")
            .resolves(entraIdentity());
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

    const getPortValidationHandler = () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        return controller.onRequest.withArgs(AzureSqlDatabaseRequests.ValidateContainerPort)
            .firstCall.args[1];
    };

    test("accepts the default configuration with a valid password and accepted terms", () => {
        expect(validateAzureSqlContainerForm(validForm())).to.deep.equal({});
    });

    const entraForm = (): AzureSqlContainerForm => ({
        ...validForm(),
        authenticationType: AuthenticationType.AzureMFA,
        accountId: "account-id",
        tenantId: "11111111-1111-1111-1111-111111111111",
        applicationId: "22222222-2222-2222-2222-222222222222",
        pfxFilePath: certificatePfxFilePath,
    });

    const stubEntraAccount = () => {
        const account = { id: "account-id", label: "Selected account" };
        const getAccount = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getAccountById")
            .resolves(account);
        return { account, getAccount };
    };

    const entraIdentity = (
        claims: unknown = {
            oid: "33333333-3333-3333-3333-333333333333",
            tid: "11111111-1111-1111-1111-111111111111",
        },
    ): vscodeEntraMfaUtils.VscodeEntraSqlTokenInfo => {
        const account = { id: "account-id", label: "Selected account" };
        const accessToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
        return {
            account,
            session: { id: "session-id", account, scopes: [], accessToken },
            tenantId: "11111111-1111-1111-1111-111111111111",
            token: {
                key: account.id,
                token: accessToken,
                tokenType: "Bearer",
                expiresOn: Math.floor(Date.now() / 1000) + 3600,
            },
        };
    };

    for (const authenticationType of [
        AuthenticationType.AzureMFA,
        AuthenticationType.ActiveDirectoryDefault,
    ] as const) {
        test(`creates a ${authenticationType} container directly using an externally prepared PFX`, async () => {
            const getAccount = sandbox
                .stub(azureHelpers.VsCodeAzureHelper, "getAccountById")
                .rejects(new Error("Account resolution is handled by the token helper"));
            const getSession = sandbox
                .stub(vscode.authentication, "getSession")
                .rejects(new Error("Provisioning must not request Graph authentication"));
            const execute = sandbox
                .stub(containerEngine, "executeContainerEngineCommand")
                .resolves({ stdout: "container-id", stderr: "" });
            const form = { ...entraForm(), authenticationType };
            const signal = new AbortController().signal;
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                form,
                sandbox.createStubInstance(MainController),
                signal,
            );
            expect(result).to.deep.equal({ success: true });
            expect(acquireToken).to.have.been.calledWith(
                vscodeEntraMfaUtils.getCloudResourceEndpoint("armResource"),
                form.accountId,
                form.tenantId,
            );
            expect(getAccount).not.to.have.been.called;
            expect(getSession).not.to.have.been.called;
            expect(execute).to.have.been.calledWith(
                sinon.match.has(
                    "args",
                    sinon.match.array.contains([
                        `MSSQL_AAD_CLIENT_ID=${form.applicationId}`,
                        `MSSQL_AAD_PRIMARY_TENANT=${form.tenantId}`,
                        "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
                        "MSSQL_AAD_SERVER_ADMIN_NAME=Selected account",
                        `${certificatePfxFilePath}:/var/opt/mssql/mssql-entra-id.pfx:ro`,
                    ]),
                ),
                120_000,
                signal,
            );
        });
    }

    test("uses the signed-in Microsoft user as administrator for service-principal authentication without Graph", async () => {
        const getAccount = sandbox
            .stub(azureHelpers.VsCodeAzureHelper, "getAccountById")
            .rejects(new Error("Account resolution is handled by the token helper"));
        const getSession = sandbox
            .stub(vscode.authentication, "getSession")
            .rejects(
                new Error("Service-principal provisioning must not request Graph authentication"),
            );
        const execute = sandbox
            .stub(containerEngine, "executeContainerEngineCommand")
            .resolves({ stdout: "container-id", stderr: "" });
        const form: AzureSqlContainerForm = {
            ...entraForm(),
            authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
            servicePrincipalClientSecret: "app-secret",
        };
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            form,
            sandbox.createStubInstance(MainController),
        );
        expect(result.success).to.equal(true);
        expect(acquireToken).to.have.been.calledWith(
            vscodeEntraMfaUtils.getCloudResourceEndpoint("armResource"),
            form.accountId,
            form.tenantId,
        );
        expect(getAccount).not.to.have.been.called;
        expect(getSession).not.to.have.been.called;
        expect(execute).to.have.been.calledWith(
            sinon.match.has(
                "args",
                sinon.match.array.contains([
                    "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
                    "MSSQL_AAD_SERVER_ADMIN_NAME=Selected account",
                    "MSSQL_AAD_SERVER_ADMIN_TYPE=0",
                ]),
            ),
        );
    });

    test("rejects nonexistent or unreadable PFX files before creating a container", async () => {
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const access = sandbox.stub(fs, "access");
        for (const form of [
            { ...entraForm(), pfxFilePath: path.join(certificateDirectory, "missing.pfx") },
            entraForm(),
        ]) {
            access.rejects(new Error("PFX permission denied"));
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                form,
                sandbox.createStubInstance(MainController),
            );
            expect(result.success).to.equal(false);
        }
        expect(execute).not.to.have.been.called;
    });

    test("rejects a PFX path pointing to a directory before creating a container", async () => {
        const stats = await fs.stat(certificatePfxFilePath);
        sandbox.stub(stats, "isFile").returns(false);
        sandbox.stub(fs, "stat").resolves(stats);
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
        );
        expect(result).to.include({
            success: false,
            fullErrorText: AzureSqlContainer.pfxFileRequired,
        });
        expect(execute).not.to.have.been.called;
    });

    test("rejects missing or wrong-tenant administrator claims before creating a container", async () => {
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        for (const claims of [
            null,
            {},
            { oid: "not-an-object-id", tid: entraForm().tenantId },
            { oid: "33333333-3333-3333-3333-333333333333" },
            {
                oid: "33333333-3333-3333-3333-333333333333",
                tid: "55555555-5555-5555-5555-555555555555",
            },
        ]) {
            acquireToken.resolves(entraIdentity(claims));
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                entraForm(),
                sandbox.createStubInstance(MainController),
            );
            expect(result).to.include({
                success: false,
                fullErrorText: AzureSqlContainer.invalidEntraAdministrator,
            });
        }
        expect(execute).not.to.have.been.called;
    });

    test("rejects opaque or malformed identity tokens rather than guessing an administrator", async () => {
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        for (const accessToken of ["opaque-token", "header.invalid-json.signature"]) {
            const identity = entraIdentity();
            identity.session = { ...identity.session, accessToken };
            acquireToken.resolves(identity);
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.CreateContainer,
                entraForm(),
                sandbox.createStubInstance(MainController),
            );
            expect(result).to.include({
                success: false,
                fullErrorText: AzureSqlContainer.invalidEntraAdministrator,
            });
        }
        expect(execute).not.to.have.been.called;
    });

    test("uses the guest user's target-tenant object ID rather than the home-account ID", async () => {
        const identity = entraIdentity();
        identity.account = {
            id: "99999999-9999-9999-9999-999999999999.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            label: "Guest account",
        };
        acquireToken.resolves(identity);
        const execute = sandbox
            .stub(containerEngine, "executeContainerEngineCommand")
            .resolves({ stdout: "container-id", stderr: "" });
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            { ...entraForm(), accountId: identity.account.id },
            sandbox.createStubInstance(MainController),
        );
        expect(result.success).to.equal(true);
        expect(execute).to.have.been.calledWith(
            sinon.match.has(
                "args",
                sinon.match.array.contains([
                    "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
                    "MSSQL_AAD_SERVER_ADMIN_NAME=Guest account",
                ]),
            ),
        );
    });

    test("surfaces authentication failures without starting a container", async () => {
        acquireToken.rejects(new Error("Authentication cancelled"));
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
        );
        expect(result).to.include({ success: false, fullErrorText: "Authentication cancelled" });
        expect(execute).not.to.have.been.called;
    });

    test("cancels creation if account authentication completes after cancellation", async () => {
        const abort = new AbortController();
        acquireToken.callsFake(async () => {
            abort.abort();
            return entraIdentity();
        });
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
            abort.signal,
        );
        expect(result.success).to.equal(false);
        expect(execute).not.to.have.been.called;
    });

    test("cancels creation if the certificate check completes after cancellation", async () => {
        const abort = new AbortController();
        sandbox.stub(fs, "access").callsFake(async () => {
            abort.abort();
        });
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
            abort.signal,
        );
        expect(result.success).to.equal(false);
        expect(execute).not.to.have.been.called;
    });

    test("accepts Entra configuration and still requires the SQL administrator password", () => {
        expect(validateAzureSqlContainerForm(entraForm())).to.deep.equal({});
        expect(validateAzureSqlContainerForm({ ...entraForm(), password: "" })).to.have.property(
            "password",
        );
    });

    test("validates manually entered application client IDs without listing app registrations", () => {
        for (const applicationId of ["", "not-a-client-id", "application-object-name"]) {
            expect(
                validateAzureSqlContainerForm({ ...entraForm(), applicationId }),
            ).to.have.property("applicationId", AzureSqlContainer.invalidApplicationClientId);
        }
        expect(
            validateAzureSqlContainerForm({
                ...entraForm(),
                applicationId: "ABCDEF12-3456-7890-ABCD-EF1234567890",
            }),
        ).not.to.have.property("applicationId");
    });

    for (const authenticationType of [
        AuthenticationType.ActiveDirectoryDefault,
        AuthenticationType.ActiveDirectoryServicePrincipal,
    ] as const) {
        test(`requires complete Entra provisioning configuration for ${authenticationType}`, () => {
            const form: AzureSqlContainerForm = {
                ...entraForm(),
                authenticationType,
                servicePrincipalClientSecret: "app-secret",
            };
            expect(validateAzureSqlContainerForm(form)).to.deep.equal({});
            const errors = validateAzureSqlContainerForm({
                ...form,
                accountId: undefined,
                tenantId: undefined,
                applicationId: undefined,
                pfxFilePath: undefined,
                servicePrincipalClientSecret: " ",
            });
            expect(errors).to.include.keys("accountId", "tenantId", "applicationId", "pfxFilePath");
            if (authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal) {
                expect(errors.servicePrincipalClientSecret).to.equal(
                    AzureSqlContainer.servicePrincipalClientSecretRequired,
                );
            } else {
                expect(errors).not.to.have.property("servicePrincipalClientSecret");
            }
        });
    }

    test("preserves selected Entra configuration when preparing the form", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").withArgs(1433).resolves(1433);
        const form = entraForm();
        const prepared = await prepareAzureSqlContainerForm(form);

        expect(prepared.errors).to.deep.equal({});
        expect(prepared.form).to.deep.equal(form);
    });

    test("requires an account, tenant, app, and local PFX for Entra provisioning only", () => {
        const form: AzureSqlContainerForm = {
            ...entraForm(),
            accountId: undefined,
            tenantId: undefined,
            applicationId: undefined,
            pfxFilePath: undefined,
        };
        expect(validateAzureSqlContainerForm(form)).to.deep.equal({
            accountId: AzureSqlContainer.selectEntraAccount,
            tenantId: ConnectionDialog.tenantIdIsRequired,
            applicationId: AzureSqlContainer.invalidApplicationClientId,
            pfxFilePath: AzureSqlContainer.pfxFileRequired,
        });
        expect(
            validateAzureSqlContainerForm({
                ...form,
                authenticationType: AuthenticationType.SqlLogin,
            }),
        ).to.deep.equal({});
    });

    const getPfxSelectionHandler = () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        return controller.onRequest.withArgs(AzureSqlDatabaseRequests.SelectContainerPfxFile)
            .firstCall.args[1];
    };

    test("selects a single PFX file and returns its filesystem path", async () => {
        const file = vscode.Uri.file("C:\\certificates\\selected.pfx");
        const showOpenDialog = sandbox.stub(vscode.window, "showOpenDialog").resolves([file]);

        expect(await getPfxSelectionHandler()(undefined, CancellationToken.None)).to.equal(
            file.fsPath,
        );
        expect(showOpenDialog).to.have.been.calledWith({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: AzureSqlContainer.selectPfxFile,
            filters: { [AzureSqlContainer.pfxFiles]: ["pfx"] },
        });
    });

    test("returns no PFX selection when the file dialog is cancelled", async () => {
        sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);
        expect(await getPfxSelectionHandler()(undefined, CancellationToken.None)).to.be.undefined;
    });

    test("propagates PFX picker errors instead of treating them as cancellation", async () => {
        const failure = new Error("File dialog failed");
        sandbox.stub(vscode.window, "showOpenDialog").rejects(failure);
        try {
            await getPfxSelectionHandler()(undefined, CancellationToken.None);
            expect.fail("Expected PFX selection failure");
        } catch (error) {
            expect(error).to.equal(failure);
        }
    });

    test("loads container accounts and tenants through the existing VS Code Azure helpers", async () => {
        const account = { id: "account-id", label: "Account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccounts").resolves([account]);
        const signIn = sandbox.stub(azureHelpers.VsCodeAzureHelper, "signIn").resolves();
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getTenantsForAccount").resolves([
            {
                tenantId: entraForm().tenantId!,
                displayName: "Tenant",
                account,
            },
        ]);
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        const accounts = controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.ContainerEntraAccounts,
        ).firstCall.args[1];
        const tenants = controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.ContainerEntraTenants,
        ).firstCall.args[1];

        expect(await accounts({}, CancellationToken.None)).to.deep.equal([
            { value: account.id, displayName: account.label },
        ]);
        expect(signIn).not.to.have.been.called;
        await accounts({ signIn: true }, CancellationToken.None);
        expect(signIn).to.have.been.calledWith(true);
        expect(await tenants({ accountId: account.id }, CancellationToken.None)).to.deep.equal([
            {
                value: entraForm().tenantId,
                displayName: "Tenant",
            },
        ]);
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

        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        const generatePort = controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.GenerateContainerPort,
        ).firstCall.args[1];
        expect(
            await generatePort(
                { engine: ContainerEngine.Podman, startPort: 1433 },
                CancellationToken.None,
            ),
        ).to.equal(1434);
        expect(findAvailablePort).to.have.been.calledOnceWithExactly(1433);
    });

    test("rejects a manually selected port that is already in use", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").withArgs(1433).resolves(1434);

        expect(
            await getPortValidationHandler()(
                { engine: ContainerEngine.Docker, port: "1433" },
                CancellationToken.None,
            ),
        ).to.equal(AzureSqlContainer.portInUse);
    });

    test("accepts a manually selected port that is available", async () => {
        sandbox.stub(dockerUtils, "findAvailablePort").withArgs(1434).resolves(1434);

        expect(
            await getPortValidationHandler()(
                { engine: ContainerEngine.Docker, port: "1434" },
                CancellationToken.None,
            ),
        ).to.be.undefined;
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
        expect(
            await getPortValidationHandler()(
                { engine: ContainerEngine.Docker, port: "" },
                CancellationToken.None,
            ),
        ).to.be.undefined;
        expect(findAvailablePort).not.to.have.been.called;
    });

    test("reports malformed ports without probing availability during editing or submission", async () => {
        const findAvailablePort = sandbox.stub(dockerUtils, "findAvailablePort");
        const validatePort = getPortValidationHandler();
        for (const port of ["0", "65536", "-1", "1.5", "1e3", "abc", " "]) {
            expect(
                await validatePort(
                    { engine: ContainerEngine.Docker, port },
                    CancellationToken.None,
                ),
            ).to.equal(AzureSqlContainer.invalidPort);
            expect(
                (await prepareAzureSqlContainerForm({ ...validForm(), port })).errors.port,
            ).to.equal(AzureSqlContainer.invalidPort);
        }
        expect(findAvailablePort).not.to.have.been.called;
    });

    test("builds the public-registry Docker pull command", () => {
        expect(
            getAzureSqlContainerProvisioningCommand(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.PullImage,
                validForm(),
            ),
        ).to.deep.equal({
            executable: "docker",
            args: ["pull", "mcr.microsoft.com/mssql/azure-sql-db-server:latest"],
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
                "MSSQL_SA_PASSWORD",
                "-p",
                "14330:1433",
                "--hostname",
                form.hostname,
                "mcr.microsoft.com/mssql/azure-sql-db-server:latest",
            ],
            env: { MSSQL_SA_PASSWORD: form.password },
        });
    });

    test("builds the Entra run command with a read-only PFX mount and tenant-local user admin", () => {
        const form = {
            ...entraForm(),
            pfxFilePath: path.resolve("certificate folder", "selected.pfx"),
        };
        const command = getAzureSqlContainerProvisioningCommand(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            form,
            { id: "33333333-3333-3333-3333-333333333333", name: "admin@contoso.com" },
        );
        expect(command.args).to.include.members([
            "MSSQL_AAD_CLIENT_ID=22222222-2222-2222-2222-222222222222",
            "MSSQL_AAD_PRIMARY_TENANT=11111111-1111-1111-1111-111111111111",
            "MSSQL_AAD_CERTIFICATE_FILE_PATH=/var/opt/mssql/mssql-entra-id.pfx",
            "MSSQL_AAD_SERVER_ADMIN_NAME=admin@contoso.com",
            "MSSQL_AAD_SERVER_ADMIN_TYPE=0",
            "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
            `${form.pfxFilePath}:/var/opt/mssql/mssql-entra-id.pfx:ro`,
            "1433:1433",
        ]);
        expect(command.args.join(" ")).not.to.include(form.password);
        expect(command.env).to.deep.equal({ MSSQL_SA_PASSWORD: form.password });
    });
    for (const engine of Object.values(ContainerEngine)) {
        test(`passes the SA password through the environment, not arguments, for ${engine}`, () => {
            const form = { ...validForm(), password: "Example '\"$&=123!\n" };
            const command = getAzureSqlContainerProvisioningCommand(
                engine,
                AzureSqlContainerProvisioningStep.CreateContainer,
                form,
            );

            expect(command.args).to.include("MSSQL_SA_PASSWORD");
            expect(command.args.join(" ")).not.to.include(form.password);
            expect(command.args.some((arg) => arg.startsWith("MSSQL_SA_PASSWORD="))).to.be.false;
            expect(command.env).to.deep.equal({ MSSQL_SA_PASSWORD: form.password });
            const readinessCommand = getAzureSqlContainerProvisioningCommand(
                engine,
                AzureSqlContainerProvisioningStep.WaitForReady,
                form,
            );
            expect(readinessCommand.executable).to.equal(command.executable);
            expect(readinessCommand.args.slice(0, 3)).to.deep.equal([
                "exec",
                "--env",
                "SQLCMDPASSWORD",
            ]);
            expect(readinessCommand.args.join(" ")).not.to.include(form.password);
            expect(readinessCommand.env).to.deep.equal({ SQLCMDPASSWORD: form.password });
            expect(
                getAzureSqlContainerProvisioningCommand(
                    engine,
                    AzureSqlContainerProvisioningStep.PullImage,
                    form,
                ),
            ).not.to.have.property("env");
        });
    }

    test("forwards the password to the child without changing the parent environment", async () => {
        sandbox.stub(process, "env").value({
            ...process.env,
            MSSQL_SA_PASSWORD: "parent-value",
            MSSQL_CONTAINER_ENV_TEST: "inherited-value",
        });
        const form = { ...validForm(), password: "Example '\"$&=123!\n" };
        const command = getAzureSqlContainerProvisioningCommand(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            form,
        );
        const result = await executeContainerEngineCommand(
            {
                executable: process.execPath,
                args: [
                    "-e",
                    "process.stdout.write(JSON.stringify({ password: process.env.MSSQL_SA_PASSWORD, inherited: process.env.MSSQL_CONTAINER_ENV_TEST }))",
                ],
                env: { ...command.env, ELECTRON_RUN_AS_NODE: "1" },
            },
            15_000,
        );

        expect(JSON.parse(result.stdout)).to.deep.equal({
            password: form.password,
            inherited: "inherited-value",
        });
        expect(process.env.MSSQL_SA_PASSWORD).to.equal("parent-value");
        expect(command.env).to.deep.equal({ MSSQL_SA_PASSWORD: form.password });
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
        let context: vscode.ExtensionContext;

        async function expectPollingStopped(clock: sinon.SinonFakeTimers, probe: sinon.SinonStub) {
            // The shared extension host can schedule unrelated timers and nextTick jobs.
            // Verify that this operation has stopped polling instead of counting host timers.
            const completedProbeCount = probe.callCount;
            await clock.tickAsync(30_000);
            expect(probe).to.have.callCount(completedProbeCount);
        }

        setup(() => {
            mainController = sandbox.createStubInstance(MainController);
            context = stubExtensionContext(sandbox);
            sandbox.stub(mainController, "context").get(() => context);
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

        test("records the first wizard connection once across concurrent completions and persisted state", async () => {
            const stored = new Map<string, unknown>();
            const configureState = () => {
                const state = context.globalState;
                (state.get as sinon.SinonStub).callsFake((key: string) => stored.get(key));
                (state.update as sinon.SinonStub).callsFake(async (key: string, value: unknown) => {
                    stored.set(key, value);
                });
            };
            configureState();
            connectionManager.connect.resolves(true);
            const connect = () =>
                runAzureSqlContainerProvisioningStep(
                    ContainerEngine.Podman,
                    AzureSqlContainerProvisioningStep.Connect,
                    validForm(),
                    mainController,
                    new AbortController().signal,
                );
            const results = await Promise.all([connect(), connect()]);
            expect(results.every((result) => result.success)).to.be.true;
            context = stubExtensionContext(sandbox);
            configureState();
            expect((await connect()).success).to.be.true;
            const milestones = telemetry.sendActionEvent
                .getCalls()
                .filter((call) => call.args[1] === "FirstSuccessfulConnection")
                .map((call) => ({
                    view: call.args[0],
                    properties: call.args[2].additionalProps,
                }));
            expect(milestones).to.deep.equal([
                {
                    view: TelemetryViews.AzureContainer,
                    properties: {
                        containerEngine: ContainerEngine.Podman,
                        hostArchitecture: os.arch(),
                        hostOS: os.platform(),
                        initiatedBy: "VSCode",
                    },
                },
            ]);
        });

        test("does not fail or repeat the milestone when adoption state cannot be saved", async () => {
            const state = context.globalState;
            (state.update as sinon.SinonStub).rejects(new Error("state is read-only"));
            const logError = sandbox.stub(logger, "error");
            connectionManager.connect.resolves(true);
            for (let attempt = 0; attempt < 2; attempt++) {
                const result = await runAzureSqlContainerProvisioningStep(
                    ContainerEngine.Docker,
                    AzureSqlContainerProvisioningStep.Connect,
                    validForm(),
                    mainController,
                    new AbortController().signal,
                );
                expect(result.success).to.be.true;
            }
            expect(logError).to.have.been.calledWith(
                sinon.match("Failed to persist Azure SQL container adoption milestone"),
            );
            const milestones = telemetry.sendActionEvent
                .getCalls()
                .filter((call) => call.args[1] === "FirstSuccessfulConnection")
                .map((call) => call.args[2].additionalProps);
            expect(milestones).to.deep.equal([
                {
                    containerEngine: ContainerEngine.Docker,
                    hostArchitecture: os.arch(),
                    hostOS: os.platform(),
                    initiatedBy: "VSCode",
                },
            ]);
        });

        for (const authenticationType of [
            AuthenticationType.AzureMFA,
            AuthenticationType.ActiveDirectoryDefault,
            AuthenticationType.ActiveDirectoryServicePrincipal,
        ] as const) {
            test(`provisions all four ${authenticationType} steps through RPC and retries creation without uploading a certificate`, async () => {
                stubEntraAccount();
                const tasks = sandbox.createStubInstance(BackgroundTasksService);
                const complete = sandbox.stub();
                tasks.registerTask.returns({
                    id: "entra-container-task",
                    update: sandbox.stub(),
                    complete,
                    remove: sandbox.stub(),
                });
                mainController.backgroundTasksService = tasks;
                connectionManager.connect.resolves(true);
                const controller = sandbox.createStubInstance(DeploymentWebviewController);
                controller.mainController = mainController;
                sandbox.stub(controller, "workflowCorrelationId").get(() => "container-workflow");
                registerAzureSqlRpcHandlers(controller);
                const run = controller.onRequest.withArgs(
                    AzureSqlDatabaseRequests.RunContainerProvisioningStep,
                ).firstCall.args[1];
                const form: AzureSqlContainerForm = {
                    ...entraForm(),
                    authenticationType,
                    containerName: "entra-container",
                    servicePrincipalClientSecret: "app-secret",
                };
                let failedCreate = false;
                const execute = sandbox
                    .stub(containerEngine, "executeContainerEngineCommand")
                    .callsFake(async (command) => {
                        if (command.args[0] === "run" && !failedCreate) {
                            failedCreate = true;
                            throw new Error("Temporary container start failure");
                        }
                        return { stdout: "ok", stderr: "" };
                    });
                const runStep = (step: AzureSqlContainerProvisioningStep, retry = false) =>
                    run(
                        { engine: ContainerEngine.Docker, form, step, retry },
                        CancellationToken.None,
                    );
                expect(await runStep(AzureSqlContainerProvisioningStep.PullImage)).to.have.property(
                    "success",
                    true,
                );
                expect(
                    await runStep(AzureSqlContainerProvisioningStep.CreateContainer),
                ).to.have.property("success", false);
                expect(
                    await runStep(AzureSqlContainerProvisioningStep.CreateContainer, true),
                ).to.have.property("success", true);
                expect(
                    await runStep(AzureSqlContainerProvisioningStep.WaitForReady),
                ).to.have.property("success", true);
                expect(await runStep(AzureSqlContainerProvisioningStep.Connect)).to.have.property(
                    "success",
                    true,
                );
                expect(execute).to.have.been.calledWith(
                    sinon.match(
                        (command: { args: string[] }) =>
                            command.args[0] === "run" &&
                            command.args.includes(
                                "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
                            ) &&
                            !command.args.some((arg) =>
                                arg.includes(form.servicePrincipalClientSecret),
                            ),
                    ),
                    sinon.match.any,
                );
                expect(complete).to.have.been.calledWith(
                    BackgroundTaskState.Succeeded,
                    sinon.match.object,
                );
                expect(connectionUI.saveProfile).to.have.been.calledWith(
                    sinon.match({
                        user:
                            authenticationType ===
                            AuthenticationType.ActiveDirectoryServicePrincipal
                                ? form.applicationId
                                : authenticationType === AuthenticationType.AzureMFA
                                  ? "Selected account"
                                  : "",
                        authenticationType,
                        accountId:
                            authenticationType === AuthenticationType.AzureMFA
                                ? form.accountId
                                : undefined,
                        tenantId: form.tenantId,
                        password:
                            authenticationType ===
                            AuthenticationType.ActiveDirectoryServicePrincipal
                                ? form.servicePrincipalClientSecret
                                : "",
                        savePassword: false,
                        containerName: form.containerName,
                    }),
                );
            });
        }

        test("redacts both SQL and client secrets from service-principal connection failures", async () => {
            const clock = sandbox.useFakeTimers();
            // Recurring extension-host timers must not prevent the retry sequence from finishing.
            setInterval(() => undefined, 1000);
            const form: AzureSqlContainerForm = {
                ...entraForm(),
                authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                servicePrincipalClientSecret: "different-client-secret",
            };
            connectionManager.connect.rejects(
                new Error(
                    `Authentication failed: ${form.password}; ${form.servicePrincipalClientSecret}`,
                ),
            );
            const pending = runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                form,
                mainController,
            );
            await clock.tickAsync(
                containerConnectionRetryDelayMs *
                    (Math.pow(2, containerConnectionMaxAttempts - 1) - 1),
            );
            const result = await pending;
            expect(result.success).to.equal(false);
            expect(result.fullErrorText).to.include("Authentication failed");
            expect(result.fullErrorText).not.to.include(form.password);
            expect(result.fullErrorText).not.to.include(form.servicePrincipalClientSecret);
            expect(connectionUI.saveProfile).not.to.have.been.called;
        });

        test("does not substitute the SA password when the service-principal secret is missing", async () => {
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                {
                    ...entraForm(),
                    authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                },
                mainController,
            );
            expect(result.fullErrorText).to.equal(
                AzureSqlContainer.servicePrincipalClientSecretRequired,
            );
            expect(connectionManager.connect).not.to.have.been.called;
        });

        test("connects and saves Entra authentication with the selected account and tenant, without SQL credentials", async () => {
            const account = { id: "account-id", label: "admin@contoso.com" };
            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
            connectionManager.connect.resolves(true);
            const form = { ...entraForm(), containerName: "entra-container", savePassword: true };
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                form,
                mainController,
            );
            expect(result.success).to.equal(true);
            const expectedProfile = sinon.match({
                authenticationType: AuthenticationType.AzureMFA,
                accountId: account.id,
                tenantId: form.tenantId,
                user: account.label,
                email: account.label,
                password: "",
                savePassword: false,
                emptyPasswordInput: true,
                server: "localhost,1433",
                containerEngine: ContainerEngine.Docker,
                containerName: form.containerName,
            });
            expect(connectionManager.connect).to.have.been.calledWith(
                `localhost,1433/${form.containerName}/deployment`,
                expectedProfile,
                { shouldHandleErrors: false },
            );
            expect(connectionUI.saveProfile).to.have.been.calledWith(expectedProfile);
            expect(mainController.createObjectExplorerSession).to.have.been.calledWith(
                expectedProfile,
            );
        });

        test("does not fall back to SQL Login when the selected Entra account is unavailable", async () => {
            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(undefined);
            const form = entraForm();
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                form,
                mainController,
            );
            expect(result).to.deep.equal({
                success: false,
                error: AzureSqlContainer.connectContainerFailed,
                fullErrorText: Accounts.accountNotAvailableThroughVsCode(
                    form.accountId!,
                    form.tenantId!,
                ),
            });
            expect(connectionManager.connect).not.to.have.been.called;
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });

        test("retries Entra connection failures without switching to SQL Login or saving the SA password", async () => {
            const clock = sandbox.useFakeTimers();
            // Recurring extension-host timers must not prevent the retry sequence from finishing.
            setInterval(() => undefined, 1000);
            const account = { id: "account-id", label: "admin@contoso.com" };
            sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
            connectionManager.connect.rejects(new Error("Entra authentication failed"));
            const form = { ...entraForm(), containerName: "entra-container" };
            const pending = runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                form,
                mainController,
            );
            await clock.tickAsync(
                containerConnectionRetryDelayMs *
                    (Math.pow(2, containerConnectionMaxAttempts - 1) - 1),
            );
            const result = await pending;
            expect(result.success).to.equal(false);
            expect(result.fullErrorText).to.equal("Entra authentication failed");
            expect(
                connectionManager.connect
                    .getCalls()
                    .every(
                        (call) =>
                            call.args[1].authenticationType === AuthenticationType.AzureMFA &&
                            call.args[1].accountId === account.id &&
                            call.args[1].tenantId === form.tenantId &&
                            call.args[1].password === "",
                    ),
            ).to.equal(true);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });

        for (const engine of Object.values(ContainerEngine)) {
            test(`saves container identity and ${engine} engine before opening Object Explorer`, async () => {
                connectionManager.connect.resolves(true);
                const form = {
                    ...validForm(),
                    containerName: "azure-sql-test",
                    profileName: "Custom display name",
                };

                const result = await runAzureSqlContainerProvisioningStep(
                    engine,
                    AzureSqlContainerProvisioningStep.Connect,
                    form,
                    mainController,
                );

                expect(result.success).to.be.true;
                const expectedProfile = sinon.match({
                    containerName: form.containerName,
                    containerEngine: engine,
                    profileName: form.profileName,
                    server: "localhost,1433",
                });
                expect(connectionUI.saveProfile).to.have.been.calledWith(expectedProfile);
                expect(mainController.createObjectExplorerSession).to.have.been.calledWith(
                    expectedProfile,
                );
            });
        }

        test("checks readiness with an in-container SELECT 1 without exposing the password in arguments", async () => {
            const form = {
                ...validForm(),
                containerName: "azure_sql_db_container",
                password: "Example '\"$&=123!",
            };
            const executeCommand = sandbox.stub().resolves({ stdout: "1", stderr: "" });
            const signal = new AbortController().signal;

            expect(
                await waitForAzureSqlContainer(
                    ContainerEngine.Docker,
                    form,
                    signal,
                    executeCommand,
                ),
            ).to.deep.equal({ success: true });

            const command = getAzureSqlContainerProvisioningCommand(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.WaitForReady,
                form,
            );
            expect(command).to.deep.equal({
                executable: "docker",
                args: [
                    "exec",
                    "--env",
                    "SQLCMDPASSWORD",
                    form.containerName,
                    "/opt/mssql-tools18/bin/sqlcmd",
                    "-S",
                    "localhost",
                    "-U",
                    sa,
                    "-C",
                    "-b",
                    "-l",
                    "5",
                    "-t",
                    "5",
                    "-Q",
                    "SELECT 1",
                ],
                env: { SQLCMDPASSWORD: form.password },
            });
            expect(command.args.join(" ")).not.to.include(form.password);
            expect(executeCommand).to.have.been.calledWith(command, 15_000, signal);
            expect(connectionManager.connect).not.to.have.been.called;
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });

        test("retries failed sqlcmd probes until SELECT 1 succeeds", async () => {
            const clock = sandbox.useFakeTimers();
            // Reproduce an unrelated host timer remaining after readiness completes.
            setTimeout(() => undefined, 60_000);
            const readyAt = Date.now() + 10_000;
            const executeCommand = sandbox.stub().callsFake(async () => {
                if (Date.now() < readyAt) {
                    throw new Error("SQL is still starting");
                }
                return { stdout: "1", stderr: "" };
            });
            let settled = false;
            const pending = waitForAzureSqlContainer(
                ContainerEngine.Docker,
                validForm(),
                undefined,
                executeCommand,
            ).then((result) => {
                settled = true;
                return result;
            });

            await clock.tickAsync(8000);
            expect(settled).to.be.false;
            await clock.tickAsync(2000);

            expect(await pending).to.deep.equal({ success: true });
            await expectPollingStopped(clock, executeCommand);
        });

        test("reports sanitized sqlcmd errors after five minutes of failed probes", async () => {
            const clock = sandbox.useFakeTimers();
            const form = validForm();
            const executeCommand = sandbox
                .stub()
                .rejects(new Error(`Login failed: ${form.password}`));
            let settled = false;
            const pending = waitForAzureSqlContainer(
                ContainerEngine.Docker,
                form,
                undefined,
                executeCommand,
            ).then((result) => {
                settled = true;
                return result;
            });

            await clock.tickAsync(299_999);
            expect(settled).to.be.false;
            await clock.tickAsync(1);

            const result = await pending;
            expect(result).to.include({
                success: false,
                error: AzureSqlContainer.containerNotReady,
            });
            expect(result.fullErrorText).to.include("Login failed:");
            expect(result.fullErrorText).not.to.include(form.password);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
            await expectPollingStopped(clock, executeCommand);
        });

        test("cancels readiness polling without issuing another probe", async () => {
            const clock = sandbox.useFakeTimers();
            const abortController = new AbortController();
            const executeCommand = sandbox.stub().rejects(new Error("SQL is still starting"));
            const pending = waitForAzureSqlContainer(
                ContainerEngine.Docker,
                validForm(),
                abortController.signal,
                executeCommand,
            );

            await clock.tickAsync(0);
            abortController.abort();

            expect((await pending).success).to.be.false;
            await expectPollingStopped(clock, executeCommand);
            expect(connectionUI.saveProfile).not.to.have.been.called;
        });

        test("does not execute sqlcmd if readiness checking is already canceled", async () => {
            const abortController = new AbortController();
            abortController.abort();
            const executeCommand = sandbox.stub();

            expect(
                (
                    await waitForAzureSqlContainer(
                        ContainerEngine.Docker,
                        validForm(),
                        abortController.signal,
                        executeCommand,
                    )
                ).success,
            ).to.be.false;
            expect(executeCommand).not.to.have.been.called;
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
            // Advance through the retry backoff only. runAllAsync would also run timers the
            // extension host schedules while the clock is faked, and can loop until Sinon aborts.
            await clock.tickAsync(
                containerConnectionRetryDelayMs *
                    (Math.pow(2, containerConnectionMaxAttempts - 1) - 1),
            );

            expect(await pending).to.deep.equal({
                success: false,
                error: AzureSqlContainer.connectContainerFailed,
                fullErrorText: "Login failed",
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
            await expectPollingStopped(clock, connectionManager.connect);
            expect(connectionUI.saveProfile).not.to.have.been.called;
            expect(mainController.createObjectExplorerSession).not.to.have.been.called;
        });
    });

    suite("adoption telemetry", () => {
        function createController() {
            const controller = sandbox.createStubInstance(DeploymentWebviewController);
            const main = sandbox.createStubInstance(MainController);
            const tasks = sandbox.createStubInstance(BackgroundTasksService);
            const complete = sandbox.stub();
            tasks.registerTask.returns({
                id: "container-telemetry-task",
                update: sandbox.stub(),
                complete,
                remove: sandbox.stub(),
            });
            main.backgroundTasksService = tasks;
            controller.mainController = main;
            sandbox.stub(controller, "workflowCorrelationId").get(() => "container-workflow");
            return { controller, complete };
        }

        test("records available engines without collecting command output", async () => {
            const { controller } = createController();
            sandbox
                .stub(containerEngine, "executeContainerEngineCommand")
                .callsFake(async (command) => {
                    if (command.executable !== "docker") {
                        throw new Error("private-command-output");
                    }
                    return { stdout: "private-version-output", stderr: "" };
                });
            registerAzureSqlRpcHandlers(controller);
            const detect = controller.onRequest.withArgs(
                AzureSqlDatabaseRequests.DetectContainerEngines,
            ).firstCall.args[1];
            const results = await detect(undefined, CancellationToken.None);
            expect(results[ContainerEngine.Docker].success).to.be.true;
            expect(results[ContainerEngine.Podman].success).to.be.false;
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                "DetectContainerEngines",
                sinon.match({
                    additionalProps: {
                        dockerDetected: "true",
                        podmanDetected: "false",
                        hostArchitecture: os.arch(),
                        hostOS: os.platform(),
                        workflowCorrelationId: "container-workflow",
                        status: "succeeded",
                    },
                }),
            );
            expect(JSON.stringify(telemetry.sendActionEvent.args)).not.to.include("private-");
        });

        for (const success of [true, false]) {
            test(`records prerequisite ${success ? "success" : "failure"} without command output`, async () => {
                const { controller } = createController();
                const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
                if (success) {
                    execute.resolves({ stdout: "private-command-output", stderr: "" });
                } else {
                    execute.rejects(new Error("private-command-output"));
                }
                registerAzureSqlRpcHandlers(controller);
                const check = controller.onRequest.withArgs(
                    AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
                ).firstCall.args[1];
                const result = await check(
                    {
                        engine: ContainerEngine.Podman,
                        prerequisite: ContainerEnginePrerequisite.Running,
                    },
                    CancellationToken.None,
                );
                expect(result).to.have.property("success", success);
                const event = success ? telemetry.sendActionEvent : telemetry.sendErrorEvent;
                expect(event).to.have.been.calledWith(
                    TelemetryViews.AzureContainer,
                    "CheckContainerEnginePrerequisite",
                    sinon.match({
                        additionalProps: {
                            containerEngine: ContainerEngine.Podman,
                            prerequisite: ContainerEnginePrerequisite.Running,
                            workflowCorrelationId: "container-workflow",
                            status: success ? "succeeded" : "failed",
                        },
                    }),
                );
                expect(JSON.stringify(event.args)).not.to.include("private-command-output");
            });
        }

        test("measures startup separately from registry pull attempts without changing task classification", async () => {
            const clock = sandbox.useFakeTimers();
            const { controller, complete } = createController();
            const executeStep = sandbox.stub().callsFake(async (_engine, step) => {
                clock.tick(step === AzureSqlContainerProvisioningStep.PullImage ? 100 : 25);
                return { success: true };
            });
            await runAzureSqlContainerDeployment(
                controller,
                ContainerEngine.Podman,
                validForm(),
                AzureSqlContainerProvisioningStep.PullImage,
                new AbortController().signal,
                sandbox.stub(),
                executeStep,
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                TelemetryActions.PullImage,
                sinon.match({
                    additionalProps: {
                        containerEngine: ContainerEngine.Podman,
                        hostArchitecture: os.arch(),
                        hostOS: os.platform(),
                        initiatedBy: "VSCode",
                        pullType: "requested",
                        status: "succeeded",
                        workflowCorrelationId: "container-workflow",
                    },
                    additionalMeasurements: { durationInMs: 100 },
                }),
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                "StartContainer",
                sinon.match({
                    additionalProps: { status: "succeeded" },
                    additionalMeasurements: { durationInMs: 50 },
                }),
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                TelemetryActions.ConnectToContainer,
                sinon.match({ additionalProps: { status: "succeeded" } }),
            );
            expect(controller.recordDeploymentStarted).to.have.been.calledWith(
                DeploymentType.AzureSqlDatabase,
            );
            expect(complete).to.have.been.calledWith(
                BackgroundTaskState.Succeeded,
                sinon.match.object,
            );
        });

        test("measures a readiness retry without repeating the pull or container creation", async () => {
            const clock = sandbox.useFakeTimers();
            const { controller } = createController();
            const executeStep = sandbox.stub().callsFake(async () => {
                clock.tick(25);
                return { success: true };
            });
            await runAzureSqlContainerDeployment(
                controller,
                ContainerEngine.Docker,
                validForm(),
                AzureSqlContainerProvisioningStep.WaitForReady,
                new AbortController().signal,
                sandbox.stub(),
                executeStep,
                true,
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                "StartContainer",
                sinon.match({
                    additionalProps: {
                        startStep: AzureSqlContainerProvisioningStep.WaitForReady,
                        isRetry: "true",
                        status: "succeeded",
                    },
                    additionalMeasurements: { durationInMs: 25 },
                }),
            );
            expect(executeStep).not.to.have.been.calledWith(
                sinon.match.any,
                AzureSqlContainerProvisioningStep.CreateContainer,
            );
            expect(telemetry.sendActionEvent).not.to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                TelemetryActions.PullImage,
            );
        });

        test("records the original successful outcome without replacing results after cancellation", async () => {
            const { controller, complete } = createController();
            const abort = new AbortController();
            const onStepComplete = sandbox.stub();
            const result = { success: true };
            const executeStep = sandbox.stub().callsFake(async () => {
                abort.abort();
                return result;
            });
            await runAzureSqlContainerDeployment(
                controller,
                ContainerEngine.Docker,
                validForm(),
                AzureSqlContainerProvisioningStep.CreateContainer,
                abort.signal,
                onStepComplete,
                executeStep,
            );
            expect(onStepComplete).to.have.been.calledWith(
                AzureSqlContainerProvisioningStep.CreateContainer,
                sinon.match.same(result),
            );
            expect(executeStep).to.have.been.calledWith(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.Connect,
                sinon.match.object,
                sinon.match.object,
                abort.signal,
            );
            expect(complete).to.have.been.calledWith(
                BackgroundTaskState.Succeeded,
                sinon.match.object,
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.AzureContainer,
                "FinishAzureSqlContainerDeployment",
                sinon.match({ additionalProps: { status: "succeeded" } }),
            );
        });

        for (const cancelled of [false, true]) {
            test(`records ${cancelled ? "cancellation" : "failure"} without including raw errors`, async () => {
                const { controller, complete } = createController();
                const abort = new AbortController();
                const onStepComplete = sandbox.stub();
                const executeStep = sandbox.stub().callsFake(async () => {
                    if (cancelled) {
                        abort.abort();
                        return { success: false };
                    }
                    throw new Error("private-command-output");
                });
                await runAzureSqlContainerDeployment(
                    controller,
                    ContainerEngine.Docker,
                    validForm(),
                    AzureSqlContainerProvisioningStep.CreateContainer,
                    abort.signal,
                    onStepComplete,
                    executeStep,
                    true,
                );
                const event = cancelled ? telemetry.sendActionEvent : telemetry.sendErrorEvent;
                expect(event).to.have.been.calledWith(
                    TelemetryViews.AzureContainer,
                    "AzureSqlContainerProvisioningStep",
                    sinon.match({
                        additionalProps: {
                            step: AzureSqlContainerProvisioningStep.CreateContainer,
                            status: cancelled ? "cancelled" : "failed",
                            isRetry: "true",
                        },
                    }),
                );
                expect(event).to.have.been.calledWith(
                    TelemetryViews.AzureContainer,
                    "StartContainer",
                    sinon.match({
                        additionalProps: {
                            status: cancelled ? "cancelled" : "failed",
                            isRetry: "true",
                        },
                    }),
                );
                expect(event).to.have.been.calledWith(
                    TelemetryViews.AzureContainer,
                    "FinishAzureSqlContainerDeployment",
                    sinon.match({
                        additionalProps: { status: cancelled ? "cancelled" : "failed" },
                    }),
                );
                expect(executeStep).not.to.have.been.calledWith(
                    sinon.match.any,
                    AzureSqlContainerProvisioningStep.WaitForReady,
                );
                expect(onStepComplete).to.have.been.calledWith(
                    AzureSqlContainerProvisioningStep.CreateContainer,
                    sinon.match({ success: false }),
                );
                expect(complete).to.have.been.calledWith(
                    cancelled ? BackgroundTaskState.Canceled : BackgroundTaskState.Failed,
                    sinon.match.object,
                );
                expect(JSON.stringify(event.args)).not.to.include("private-command-output");
            });
        }
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
            recordDeploymentStarted: sandbox.stub(),
            recordDeploymentCompleted: sandbox.stub(),
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
