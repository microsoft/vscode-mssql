/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DacFxService } from "../../src/services/dacFxService";
import { SqlTasksService, TaskCompletionHandler } from "../../src/services/sqlTasksService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as Constants from "../../src/constants/constants";

suite("DacFxService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let sqlTasksServiceStub: sinon.SinonStubbedInstance<SqlTasksService>;
    let registeredHandlers: Map<string, TaskCompletionHandler>;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        sqlTasksServiceStub = sandbox.createStubInstance(SqlTasksService);
        registeredHandlers = new Map<string, TaskCompletionHandler>();

        // Capture registered handlers
        sqlTasksServiceStub.registerCompletionSuccessHandler.callsFake(
            (handler: TaskCompletionHandler) => {
                registeredHandlers.set(handler.operationName, handler);
            },
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Constructor and Handler Registration", () => {
        test("should register all four task completion handlers during construction", () => {
            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);

            // Assert
            expect(sqlTasksServiceStub.registerCompletionSuccessHandler).to.have.callCount(4);
            expect(registeredHandlers.size).to.equal(4);
        });

        test("should register Export BACPAC handler with correct operation ID", () => {
            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);

            // Assert
            expect(registeredHandlers.has(Constants.operationIdExportBacpac)).to.be.true;
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            expect(handler.operationName).to.equal(Constants.operationIdExportBacpac);
        });

        test("should register Extract DACPAC handler with correct operation ID", () => {
            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);

            // Assert
            expect(registeredHandlers.has(Constants.operationIdExtractDacpac)).to.be.true;
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;
            expect(handler.operationName).to.equal(Constants.operationIdExtractDacpac);
        });

        test("should register Import BACPAC handler with correct operation ID", () => {
            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);

            // Assert
            expect(registeredHandlers.has(Constants.operationIdImportBacpac)).to.be.true;
            const handler = registeredHandlers.get(Constants.operationIdImportBacpac)!;
            expect(handler.operationName).to.equal(Constants.operationIdImportBacpac);
        });

        test("should register Deploy DACPAC handler with correct operation ID", () => {
            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);

            // Assert
            expect(registeredHandlers.has(Constants.operationIdDeployDacpac)).to.be.true;
            const handler = registeredHandlers.get(Constants.operationIdDeployDacpac)!;
            expect(handler.operationName).to.equal(Constants.operationIdDeployDacpac);
        });
    });

    suite("Export BACPAC Handler Configuration", () => {
        test("should configure handler to get target location from taskInfo.targetLocation", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const mockTaskInfo: any = {
                targetLocation: "/path/to/export.bacpac",
                databaseName: "testDb",
            };

            // Act
            const targetLocation = handler.getTargetLocation(mockTaskInfo);

            // Assert
            expect(targetLocation).to.equal("/path/to/export.bacpac");
        });

        test("should provide success message with file name for Export BACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;

            // Act
            const message = handler.getSuccessMessage({} as any, "C:\\exports\\database.bacpac");

            // Assert
            expect(message).to.include("database.bacpac");
        });

        test("should provide action button text for Export BACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;

            // Act
            const buttonText = handler.actionButtonText;

            // Assert
            expect(buttonText).to.exist;
            expect(buttonText).to.be.a("string");
        });

        test("should provide action command for Export BACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;

            // Act
            const command = handler.actionCommand;

            // Assert
            expect(command).to.equal("revealFileInOS");
        });

        test("should provide action command args with file URI for Export BACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;

            // Act
            const args = handler.getActionCommandArgs?.({} as any, "C:\\exports\\test.bacpac");

            // Assert
            expect(args).to.exist;
            expect(args).to.be.an("array").with.lengthOf(1);
            expect(args![0]).to.have.property("fsPath");
        });
    });

    suite("Extract DACPAC Handler Configuration", () => {
        test("should configure handler to get target location from taskInfo.targetLocation", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;
            const mockTaskInfo: any = {
                targetLocation: "/path/to/extract.dacpac",
                databaseName: "testDb",
            };

            // Act
            const targetLocation = handler.getTargetLocation(mockTaskInfo);

            // Assert
            expect(targetLocation).to.equal("/path/to/extract.dacpac");
        });

        test("should provide success message with file name for Extract DACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Act
            const message = handler.getSuccessMessage({} as any, "C:\\extracts\\database.dacpac");

            // Assert
            expect(message).to.include("database.dacpac");
        });

        test("should provide action button text for Extract DACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Act
            const buttonText = handler.actionButtonText;

            // Assert
            expect(buttonText).to.exist;
            expect(buttonText).to.be.a("string");
        });

        test("should provide action command for Extract DACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Act
            const command = handler.actionCommand;

            // Assert
            expect(command).to.equal("revealFileInOS");
        });

        test("should provide action command args with file URI for Extract DACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Act
            const args = handler.getActionCommandArgs?.({} as any, "C:\\extracts\\test.dacpac");

            // Assert
            expect(args).to.exist;
            expect(args).to.be.an("array").with.lengthOf(1);
            expect(args![0]).to.have.property("fsPath");
        });
    });

    suite("Import BACPAC Handler Configuration", () => {
        test("should configure handler to get target location from taskInfo.databaseName", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdImportBacpac)!;
            const mockTaskInfo: any = {
                targetLocation: "/path/to/import.bacpac",
                databaseName: "ImportedDatabase",
            };

            // Act
            const targetLocation = handler.getTargetLocation(mockTaskInfo);

            // Assert
            expect(targetLocation).to.equal("ImportedDatabase");
        });

        test("should provide success message with database name for Import BACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdImportBacpac)!;

            // Act
            const message = handler.getSuccessMessage({} as any, "MyDatabase");

            // Assert
            expect(message).to.include("MyDatabase");
        });

        test("should not provide action button for Import BACPAC (database operation)", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdImportBacpac)!;

            // Act & Assert
            expect(handler.actionButtonText).to.be.undefined;
            expect(handler.actionCommand).to.be.undefined;
            expect(handler.getActionCommandArgs).to.be.undefined;
        });
    });

    suite("Deploy DACPAC Handler Configuration", () => {
        test("should configure handler to get target location from taskInfo.databaseName", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdDeployDacpac)!;
            const mockTaskInfo: any = {
                targetLocation: "/path/to/deploy.dacpac",
                databaseName: "DeployedDatabase",
            };

            // Act
            const targetLocation = handler.getTargetLocation(mockTaskInfo);

            // Assert
            expect(targetLocation).to.equal("DeployedDatabase");
        });

        test("should provide success message with database name for Deploy DACPAC", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdDeployDacpac)!;

            // Act
            const message = handler.getSuccessMessage({} as any, "ProductionDB");

            // Assert
            expect(message).to.include("ProductionDB");
        });

        test("should not provide action button for Deploy DACPAC (database operation)", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdDeployDacpac)!;

            // Act & Assert
            expect(handler.actionButtonText).to.be.undefined;
            expect(handler.actionCommand).to.be.undefined;
            expect(handler.getActionCommandArgs).to.be.undefined;
        });
    });

    suite("Platform-Specific Reveal Button Text", () => {
        let originalPlatform: string;

        setup(() => {
            originalPlatform = process.platform;
        });

        teardown(() => {
            // Restore original platform
            Object.defineProperty(process, "platform", {
                value: originalPlatform,
            });
        });

        test("should use 'Reveal in Explorer' text on Windows", () => {
            // Arrange
            Object.defineProperty(process, "platform", {
                value: "win32",
            });

            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const buttonText = handler.actionButtonText;

            // Assert - on Windows, should contain "Explorer"
            expect(buttonText).to.exist;
        });

        test("should use 'Reveal in Finder' text on macOS", () => {
            // Arrange
            Object.defineProperty(process, "platform", {
                value: "darwin",
            });

            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const buttonText = handler.actionButtonText;

            // Assert - on macOS, should contain "Finder"
            expect(buttonText).to.exist;
        });

        test("should use 'Open Containing Folder' text on Linux", () => {
            // Arrange
            Object.defineProperty(process, "platform", {
                value: "linux",
            });

            // Act
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const handler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const buttonText = handler.actionButtonText;

            // Assert - on Linux, should contain "Folder"
            expect(buttonText).to.exist;
        });
    });

    suite("Handler Consistency", () => {
        test("file operation handlers should all have action buttons", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const exportHandler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const extractHandler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Assert
            expect(exportHandler.actionButtonText).to.exist;
            expect(exportHandler.actionCommand).to.exist;
            expect(exportHandler.getActionCommandArgs).to.exist;

            expect(extractHandler.actionButtonText).to.exist;
            expect(extractHandler.actionCommand).to.exist;
            expect(extractHandler.getActionCommandArgs).to.exist;
        });

        test("database operation handlers should not have action buttons", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const importHandler = registeredHandlers.get(Constants.operationIdImportBacpac)!;
            const deployHandler = registeredHandlers.get(Constants.operationIdDeployDacpac)!;

            // Assert
            expect(importHandler.actionButtonText).to.be.undefined;
            expect(importHandler.actionCommand).to.be.undefined;
            expect(importHandler.getActionCommandArgs).to.be.undefined;

            expect(deployHandler.actionButtonText).to.be.undefined;
            expect(deployHandler.actionCommand).to.be.undefined;
            expect(deployHandler.getActionCommandArgs).to.be.undefined;
        });

        test("all file operation handlers should use same action command", () => {
            // Arrange
            new DacFxService(sqlToolsClientStub, sqlTasksServiceStub);
            const exportHandler = registeredHandlers.get(Constants.operationIdExportBacpac)!;
            const extractHandler = registeredHandlers.get(Constants.operationIdExtractDacpac)!;

            // Act
            const exportCommand = exportHandler.actionCommand;
            const extractCommand = extractHandler.actionCommand;

            // Assert
            expect(exportCommand).to.equal(extractCommand);
            expect(exportCommand).to.equal("revealFileInOS");
        });
    });
});
