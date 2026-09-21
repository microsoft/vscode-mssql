/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    defaultAzureSqlContainerName,
    generateAzureSqlContainerName,
    getAzureSqlContainerProvisioningCommand,
    runAzureSqlContainerProvisioningStep,
    validateAzureSqlContainerForm,
} from "../../src/deployment/azureSqlHelpers";
import {
    AzureSqlContainerForm,
    AzureSqlContainerProvisioningStep,
    ContainerEngine,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { AzureSqlContainer } from "../../src/constants/locConstants";
import * as dockerUtils from "../../src/docker/dockerUtils";
import MainController from "../../src/controllers/mainController";

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
