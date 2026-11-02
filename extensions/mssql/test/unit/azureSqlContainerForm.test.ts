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
    generateContainerCertificateFiles,
    readContainerCertificate,
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
import * as containerEngine from "../../src/docker/containerEngine";
import { GraphClient, graphClient } from "../../src/azure/graphClient";
import { X509Certificate } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

chai.use(sinonChai);
const { expect } = chai;

suite("Azure SQL container configuration", () => {
    let sandbox: sinon.SinonSandbox;
    let certificate: X509Certificate;
    let certificateDirectory: string;
    let certificatePfxFilePath: string;

    suiteSetup(async () => {
        certificateDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "mssql-entra-provisioning-"),
        );
        certificatePfxFilePath = path.join(certificateDirectory, "certificate.pfx");
        await generateContainerCertificateFiles(certificatePfxFilePath);
        certificate = await readContainerCertificate(certificatePfxFilePath);
    });

    suiteTeardown(async () => {
        for (const name of await fs.readdir(certificateDirectory)) {
            await fs.unlink(path.join(certificateDirectory, name));
        }
        await fs.rmdir(certificateDirectory);
    });

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

    test("accepts Entra configuration and still requires the SQL administrator password", () => {
        expect(validateAzureSqlContainerForm(entraForm())).to.deep.equal({});
        expect(validateAzureSqlContainerForm({ ...entraForm(), password: "" })).to.have.property(
            "password",
        );
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
            applicationId: AzureSqlContainer.selectAppRegistration,
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

    const getCertificateGenerationHandler = () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        return controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.GenerateContainerCertificateFiles,
        ).firstCall.args[1];
    };

    test("generates all three certificate files at the selected location without asking for a password", async () => {
        const file = vscode.Uri.file(path.join(certificateDirectory, "generated.pfx"));
        const files = {
            pfxFilePath: file.fsPath,
            privateKeyFilePath: vscode.Uri.file(path.join(certificateDirectory, "generated.key"))
                .fsPath,
            publicCertificateFilePath: vscode.Uri.file(
                path.join(certificateDirectory, "generated.cer"),
            ).fsPath,
        };
        sandbox.stub(vscode.window, "showSaveDialog").resolves(file);
        const passwordPrompt = sandbox.stub(vscode.window, "showInputBox");
        const notification = sandbox.stub(vscode.window, "showInformationMessage").resolves();
        expect(
            await getCertificateGenerationHandler()(undefined, CancellationToken.None),
        ).to.deep.equal(files);
        for (const filePath of Object.values(files)) {
            expect((await fs.stat(filePath)).isFile()).to.equal(true);
        }
        expect(passwordPrompt).not.to.have.been.called;
        expect(notification).to.have.been.calledWith(
            AzureSqlContainer.certificateFilesSaved(
                files.pfxFilePath,
                files.privateKeyFilePath,
                files.publicCertificateFilePath,
            ),
        );
    });

    test("does not generate certificate files when the save dialog is cancelled", async () => {
        sandbox.stub(vscode.window, "showSaveDialog").resolves(undefined);
        const open = sandbox.stub(fs, "open");
        expect(await getCertificateGenerationHandler()(undefined, CancellationToken.None)).to.be
            .undefined;
        expect(open).not.to.have.been.called;
    });

    test("does not report certificate generation as successful after a write error", async () => {
        sandbox
            .stub(vscode.window, "showSaveDialog")
            .resolves(vscode.Uri.file("C:\\certificates\\generated.pfx"));
        const failure = new Error("Certificate write failed");
        sandbox.stub(fs, "open").rejects(failure);
        const notification = sandbox.stub(vscode.window, "showInformationMessage");
        try {
            await getCertificateGenerationHandler()(undefined, CancellationToken.None);
            expect.fail("Expected certificate generation failure");
        } catch (error) {
            expect(error).to.equal(failure);
        }
        expect(notification).not.to.have.been.called;
    });

    test("rejects non-local certificate destinations before generating files", async () => {
        sandbox
            .stub(vscode.window, "showSaveDialog")
            .resolves(vscode.Uri.parse("untitled:certificate.pfx"));
        const open = sandbox.stub(fs, "open");
        try {
            await getCertificateGenerationHandler()(undefined, CancellationToken.None);
            expect.fail("Expected local filesystem validation");
        } catch (error) {
            expect(error).to.have.property(
                "message",
                AzureSqlContainer.localCertificateLocationRequired,
            );
        }
        expect(open).not.to.have.been.called;
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

    const getApplicationListingHandler = () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        return controller.onRequest.withArgs(AzureSqlDatabaseRequests.ContainerEntraApplications)
            .firstCall.args[1];
    };

    const getApplicationCreationHandler = () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        return controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.CreateContainerEntraApplication,
        ).firstCall.args[1];
    };

    test("creates an app registration for the selected account and tenant and returns its client ID", async () => {
        const account = { id: "account-id", label: "Selected account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
        const create = sandbox.stub(graphClient, "createAppRegistration").resolves({
            id: "new-object",
            appId: "new-client",
            displayName: "New application",
        });
        const tenantId = entraForm().tenantId!;
        expect(
            await getApplicationCreationHandler()(
                { accountId: account.id, tenantId, displayName: "New application" },
                CancellationToken.None,
            ),
        ).to.deep.equal({ value: "new-client", displayName: "New application" });
        expect(create).to.have.been.calledWith("New application", account, tenantId);
    });

    test("rejects app creation when the selected account is unavailable", async () => {
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(undefined);
        const create = sandbox.stub(graphClient, "createAppRegistration");
        const tenantId = entraForm().tenantId!;
        try {
            await getApplicationCreationHandler()(
                { accountId: "missing-account", tenantId, displayName: "Application" },
                CancellationToken.None,
            );
            expect.fail("Expected account validation failure");
        } catch (error) {
            expect(error).to.have.property(
                "message",
                Accounts.accountNotAvailableThroughVsCode("missing-account", tenantId),
            );
        }
        expect(create).not.to.have.been.called;
    });

    test("propagates app creation errors to the drawer", async () => {
        const account = { id: "account-id", label: "Selected account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
        const failure = new Error("Application creation denied");
        sandbox.stub(graphClient, "createAppRegistration").rejects(failure);
        try {
            await getApplicationCreationHandler()(
                {
                    accountId: account.id,
                    tenantId: entraForm().tenantId!,
                    displayName: "Application",
                },
                CancellationToken.None,
            );
            expect.fail("Expected application creation failure");
        } catch (error) {
            expect(error).to.equal(failure);
        }
    });

    test("lists registrations for the selected account and tenant using Graph client IDs", async () => {
        const account = { id: "account-id", label: "Selected account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
        const graph = sandbox.createStubInstance(GraphClient);
        graph.fetchAppRegistrations.resolves([
            { id: "object-id", appId: "client-id", displayName: "Application" },
            { id: "unnamed-object", appId: "unnamed-client", displayName: "" },
        ]);
        sandbox.stub(graphClient, "fetchAppRegistrations").callsFake(graph.fetchAppRegistrations);
        const tenantId = entraForm().tenantId!;

        expect(
            await getApplicationListingHandler()(
                { accountId: account.id, tenantId },
                CancellationToken.None,
            ),
        ).to.deep.equal([
            { value: "client-id", displayName: "Application" },
            { value: "unnamed-client", displayName: "unnamed-client" },
        ]);
        expect(graph.fetchAppRegistrations).to.have.been.calledWith(account, tenantId);
    });

    test("rejects registration lookup when the selected account is unavailable", async () => {
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(undefined);
        const graph = sandbox.stub(graphClient, "fetchAppRegistrations");
        const tenantId = entraForm().tenantId!;

        try {
            await getApplicationListingHandler()(
                { accountId: "missing-account", tenantId },
                CancellationToken.None,
            );
            expect.fail("Expected missing account error");
        } catch (error) {
            expect(error).to.have.property(
                "message",
                Accounts.accountNotAvailableThroughVsCode("missing-account", tenantId),
            );
        }
        expect(graph).not.to.have.been.called;
    });

    test("requires a selected tenant before fetching app registrations", async () => {
        const graph = sandbox.stub(graphClient, "fetchAppRegistrations");

        try {
            await getApplicationListingHandler()(
                { accountId: "account-id", tenantId: "" },
                CancellationToken.None,
            );
            expect.fail("Expected missing tenant error");
        } catch (error) {
            expect(error).to.have.property("message", ConnectionDialog.tenantIdIsRequired);
        }
        expect(graph).not.to.have.been.called;
    });

    test("propagates Graph registration errors instead of returning an empty list", async () => {
        const account = { id: "account-id", label: "Selected account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
        const failure = new Error("Graph consent required");
        sandbox.stub(graphClient, "fetchAppRegistrations").rejects(failure);

        try {
            await getApplicationListingHandler()(
                { accountId: account.id, tenantId: entraForm().tenantId! },
                CancellationToken.None,
            );
            expect.fail("Expected Graph listing error");
        } catch (error) {
            expect(error).to.equal(failure);
        }
    });

    const stubCertificateUpload = () => {
        const account = { id: "account-id", label: "Selected account" };
        sandbox.stub(azureHelpers.VsCodeAzureHelper, "getAccountById").resolves(account);
        sandbox.stub(graphClient, "fetchCurrentUser").resolves({
            id: "33333333-3333-3333-3333-333333333333",
            userPrincipalName: "admin@contoso.com",
        });
        return { account, upload: sandbox.stub(graphClient, "uploadAppCertificate").resolves() };
    };

    test("uploads only the selected PFX's public certificate and resolves the selected tenant's admin", async () => {
        const { account, upload } = stubCertificateUpload();
        const state = {};
        const form = entraForm();
        const signal = new AbortController().signal;
        expect(
            await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.UploadCertificate,
                form,
                sandbox.createStubInstance(MainController),
                signal,
                state,
            ),
        ).to.deep.equal({ success: true });
        expect(upload).to.have.been.calledWith(
            form.applicationId,
            sinon.match
                .instanceOf(X509Certificate)
                .and(sinon.match((value: X509Certificate) => value.raw.equals(certificate.raw))),
            account,
            form.tenantId,
            signal,
        );
        expect(state).to.deep.equal({
            administrator: {
                id: "33333333-3333-3333-3333-333333333333",
                name: "admin@contoso.com",
            },
            certificateThumbprint: certificate.fingerprint256,
            identity: JSON.stringify([
                form.authenticationType,
                form.accountId,
                form.tenantId,
                form.applicationId,
            ]),
        });

        test("uses the selected application's service-principal object ID as the Entra admin", async () => {
            const { account, upload } = stubCertificateUpload();
            const form: AzureSqlContainerForm = {
                ...entraForm(),
                authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                servicePrincipalClientSecret: "app-secret",
            };
            const principal = {
                id: "44444444-4444-4444-4444-444444444444",
                displayName: "Container app",
            };
            const ensure = sandbox.stub(graphClient, "ensureServicePrincipal").resolves(principal);
            const state = {};
            const result = await runAzureSqlContainerProvisioningStep(
                ContainerEngine.Docker,
                AzureSqlContainerProvisioningStep.UploadCertificate,
                form,
                sandbox.createStubInstance(MainController),
                undefined,
                state,
            );
            expect(result.success).to.equal(true);
            expect(ensure).to.have.been.calledWith(
                form.applicationId,
                account,
                form.tenantId,
                undefined,
            );
            expect(state).to.have.property("administrator").that.deep.equals({
                id: principal.id,
                name: principal.displayName,
            });
            expect(upload).to.have.been.called;
            expect(graphClient.fetchCurrentUser).not.to.have.been.called;
        });
    });

    test("surfaces upload permission failures without retaining successful Entra state", async () => {
        const { upload } = stubCertificateUpload();
        upload.rejects(new Error("Graph returned 403"));
        const state = {};
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.UploadCertificate,
            entraForm(),
            sandbox.createStubInstance(MainController),
            undefined,
            state,
        );
        expect(result).to.deep.equal({
            success: false,
            error: AzureSqlContainer.certificateUploadFailed,
            fullErrorText: "Graph returned 403",
        });
        expect(state).to.deep.equal({});
    });

    test("stops canceled uploads before marking the certificate as provisioned", async () => {
        const { upload } = stubCertificateUpload();
        const abort = new AbortController();
        upload.callsFake(async () => abort.abort());
        const state = {};
        expect(
            (
                await runAzureSqlContainerProvisioningStep(
                    ContainerEngine.Docker,
                    AzureSqlContainerProvisioningStep.UploadCertificate,
                    entraForm(),
                    sandbox.createStubInstance(MainController),
                    abort.signal,
                    state,
                )
            ).success,
        ).to.equal(false);
        expect(state).to.deep.equal({});
    });

    test("does not start an Entra container without a successful certificate upload", async () => {
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
        );
        expect(result.success).to.equal(false);
        expect(result.fullErrorText).to.equal(AzureSqlContainer.certificateUploadRequired);
        expect(execute).not.to.have.been.called;
    });

    test("rejects a PFX changed after upload instead of starting with mismatched app credentials", async () => {
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            entraForm(),
            sandbox.createStubInstance(MainController),
            undefined,
            {
                administrator: { id: "user-id", name: "admin@contoso.com" },
                certificateThumbprint: "previous certificate",
                identity: JSON.stringify([
                    entraForm().authenticationType,
                    entraForm().accountId,
                    entraForm().tenantId,
                    entraForm().applicationId,
                ]),
            },
        );
        expect(result.fullErrorText).to.equal(AzureSqlContainer.pfxCertificateChanged);
        expect(execute).not.to.have.been.called;
    });

    test("rejects cached user-admin state when switching to service-principal authentication", async () => {
        stubCertificateUpload();
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const controller = sandbox.createStubInstance(MainController);
        const form = entraForm();
        const state = {};
        await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.UploadCertificate,
            form,
            controller,
            undefined,
            state,
        );
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            {
                ...form,
                authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                servicePrincipalClientSecret: "app-secret",
            },
            controller,
            undefined,
            state,
        );
        expect(result.fullErrorText).to.equal(AzureSqlContainer.certificateUploadRequired);
        expect(execute).not.to.have.been.called;
    });

    test("reuses uploaded certificate and admin state when container creation is retried", async () => {
        const { upload } = stubCertificateUpload();
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        execute.onFirstCall().rejects(new Error("Temporary container error"));
        execute.onSecondCall().resolves({ stdout: "container-id", stderr: "" });
        const state = {};
        const controller = sandbox.createStubInstance(MainController);
        await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.UploadCertificate,
            entraForm(),
            controller,
            undefined,
            state,
        );
        expect(
            (
                await runAzureSqlContainerProvisioningStep(
                    ContainerEngine.Docker,
                    AzureSqlContainerProvisioningStep.CreateContainer,
                    entraForm(),
                    controller,
                    undefined,
                    state,
                )
            ).success,
        ).to.equal(false);
        expect(
            (
                await runAzureSqlContainerProvisioningStep(
                    ContainerEngine.Docker,
                    AzureSqlContainerProvisioningStep.CreateContainer,
                    entraForm(),
                    controller,
                    undefined,
                    state,
                )
            ).success,
        ).to.equal(true);
        expect(upload).to.have.been.calledOnce;
        expect(execute).to.have.been.calledWith(
            sinon.match.has(
                "args",
                sinon.match.array.contains([
                    "MSSQL_AAD_SERVER_ADMIN_SID=33333333-3333-3333-3333-333333333333",
                ]),
            ),
            120_000,
            undefined,
        );
    });

    test("does not reuse a successful upload for a different selected app", async () => {
        stubCertificateUpload();
        const execute = sandbox.stub(containerEngine, "executeContainerEngineCommand");
        const state = {};
        const controller = sandbox.createStubInstance(MainController);
        await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.UploadCertificate,
            entraForm(),
            controller,
            undefined,
            state,
        );
        const result = await runAzureSqlContainerProvisioningStep(
            ContainerEngine.Docker,
            AzureSqlContainerProvisioningStep.CreateContainer,
            { ...entraForm(), applicationId: "55555555-5555-5555-5555-555555555555" },
            controller,
            undefined,
            state,
        );
        expect(result.fullErrorText).to.equal(AzureSqlContainer.certificateUploadRequired);
        expect(execute).not.to.have.been.called;
    });

    test("rejects the certificate-upload RPC for SQL Login instead of starting the wrong deployment step", async () => {
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        registerAzureSqlRpcHandlers(controller);
        const run = controller.onRequest.withArgs(
            AzureSqlDatabaseRequests.RunContainerProvisioningStep,
        ).firstCall.args[1];
        expect(
            await run(
                {
                    engine: ContainerEngine.Docker,
                    form: validForm(),
                    step: AzureSqlContainerProvisioningStep.UploadCertificate,
                },
                CancellationToken.None,
            ),
        ).to.deep.equal({ success: false, error: AzureSqlContainer.invalidProvisioningStep });
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
                "MSSQL_SA_PASSWORD",
                "-p",
                "14330:1433",
                "--hostname",
                form.hostname,
                "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest",
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

        for (const authenticationType of [
            AuthenticationType.AzureMFA,
            AuthenticationType.ActiveDirectoryDefault,
            AuthenticationType.ActiveDirectoryServicePrincipal,
        ] as const) {
            test(`provisions all five ${authenticationType} steps through RPC and retains upload state across a create retry`, async () => {
                const { upload } = stubCertificateUpload();
                sandbox.stub(graphClient, "ensureServicePrincipal").resolves({
                    id: "44444444-4444-4444-4444-444444444444",
                    displayName: "Container app",
                });
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
                    await runStep(AzureSqlContainerProvisioningStep.UploadCertificate),
                ).to.have.property("success", true);
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
                expect(upload).to.have.been.calledOnce;
                expect(execute).to.have.been.calledWith(
                    sinon.match(
                        (command: { args: string[] }) =>
                            command.args[0] === "run" &&
                            command.args.includes(
                                `MSSQL_AAD_SERVER_ADMIN_SID=${
                                    authenticationType ===
                                    AuthenticationType.ActiveDirectoryServicePrincipal
                                        ? "44444444-4444-4444-4444-444444444444"
                                        : "33333333-3333-3333-3333-333333333333"
                                }`,
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
            await clock.runAllAsync();
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
            await clock.runAllAsync();
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
            expect(clock.countTimers()).to.equal(0);
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
            expect(clock.countTimers()).to.equal(0);
        });

        test("cancels readiness polling without leaving a retry timer", async () => {
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
            expect(clock.countTimers()).to.equal(0);
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
