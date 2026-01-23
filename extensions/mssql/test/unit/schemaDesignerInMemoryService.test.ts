/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";

import { SchemaDesignerInMemoryService } from "../../src/services/schemaDesignerInMemoryService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import ConnectionManager from "../../src/controllers/connectionManager";
import { IConnectionProfile } from "../../src/models/interfaces";

chai.use(sinonChai);

suite("SchemaDesignerInMemoryService", () => {
    let sandbox: sinon.SinonSandbox;
    let sqlClientStub: { sendRequest: sinon.SinonStub; logger: { error: sinon.SinonStub } };
    let connectionManagerStub: {
        isConnected: sinon.SinonStub;
        connect: sinon.SinonStub;
        disconnect: sinon.SinonStub;
    };
    let service: SchemaDesignerInMemoryService;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlClientStub = {
            sendRequest: sandbox.stub().resolves({ rows: [], rowCount: 0, columnInfo: [] }),
            logger: { error: sandbox.stub() },
        };
        connectionManagerStub = {
            isConnected: sandbox.stub().returns(true),
            connect: sandbox.stub().resolves(true),
            disconnect: sandbox.stub().resolves(true),
        };
        service = new SchemaDesignerInMemoryService(
            sqlClientStub as unknown as SqlToolsServiceClient,
            connectionManagerStub as unknown as ConnectionManager,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("buildCommandGraph handles table, schema, and column renames", () => {
        const original = schema([
            table({
                id: "users",
                name: "Users",
                schema: "dbo",
                primaryKeyName: "PK_Users",
                columns: [
                    column({
                        id: "users_id",
                        name: "UserId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                    column({
                        id: "users_name",
                        name: "Name",
                        dataType: "nvarchar",
                        maxLength: "50",
                        isNullable: false,
                    }),
                ],
            }),
            table({
                id: "orders",
                name: "Orders",
                schema: "dbo",
                primaryKeyName: "PK_Orders",
                columns: [
                    column({
                        id: "orders_id",
                        name: "OrderId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                    column({
                        id: "orders_user",
                        name: "UserId",
                        dataType: "int",
                        isNullable: false,
                    }),
                ],
                foreignKeys: [
                    {
                        id: "fk_orders_users",
                        name: "FK_Orders_Users",
                        columns: ["UserId"],
                        referencedSchemaName: "dbo",
                        referencedTableName: "Users",
                        referencedColumns: ["UserId"],
                        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    },
                ],
            }),
        ]);

        const updated = schema([
            table({
                id: "users",
                name: "Customers",
                schema: "sales",
                primaryKeyName: "PK_Customers",
                columns: [
                    column({
                        id: "users_id",
                        name: "UserId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                    column({
                        id: "users_name",
                        name: "FullName",
                        dataType: "nvarchar",
                        maxLength: "50",
                        isNullable: false,
                    }),
                ],
            }),
            table({
                id: "orders",
                name: "Orders",
                schema: "dbo",
                primaryKeyName: "PK_Orders",
                columns: [
                    column({
                        id: "orders_id",
                        name: "OrderId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                    column({
                        id: "orders_user",
                        name: "CustomerId",
                        dataType: "int",
                        isNullable: false,
                    }),
                ],
                foreignKeys: [
                    {
                        id: "fk_orders_users",
                        name: "FK_Orders_Customers",
                        columns: ["CustomerId"],
                        referencedSchemaName: "sales",
                        referencedTableName: "Customers",
                        referencedColumns: ["UserId"],
                        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    },
                ],
            }),
        ]);

        const graph = (service as any).buildCommandGraph(original, updated);
        const statements: string[] = graph.toStatements();

        expect(statements).to.deep.include(
            "ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users];",
        );
        expect(statements).to.deep.include(
            "ALTER SCHEMA [sales] TRANSFER [dbo].[Users];",
        );
        expect(statements.some((stmt) => stmt.includes("EXEC sp_rename"))).to.be.true;
        expect(statements).to.deep.include(
            "EXEC sp_rename N'[sales].[Customers].[Name]', N'FullName', 'COLUMN';",
        );
        expect(statements.some((stmt) => stmt.includes("FK_Orders_Customers"))).to.be.true;
    });

    test("column recreation handles identity, defaults, and pk rebuild", () => {
        const original = schema([
            table({
                id: "products",
                name: "Products",
                schema: "inventory",
                primaryKeyName: "PK_Products",
                columns: [
                    column({
                        id: "prod_id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                    column({
                        id: "prod_sku",
                        name: "Sku",
                        dataType: "varchar",
                        maxLength: "20",
                        defaultValue: "'sku'",
                        defaultConstraintName: "DF_Products_Sku",
                        isNullable: false,
                    }),
                    column({
                        id: "prod_legacy",
                        name: "LegacyCode",
                        dataType: "int",
                        isNullable: true,
                    }),
                ],
            }),
        ]);

        const updated = schema([
            table({
                id: "products",
                name: "Products",
                schema: "inventory",
                primaryKeyName: "PK_Products",
                columns: [
                    column({
                        id: "prod_id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 100,
                        identityIncrement: 5,
                        isNullable: false,
                    }),
                    column({
                        id: "prod_sku",
                        name: "Sku",
                        dataType: "varchar",
                        maxLength: "30",
                        defaultValue: "'sku-new'",
                        defaultConstraintName: "DF_Products_Sku",
                        isNullable: false,
                    }),
                    column({
                        id: "prod_desc",
                        name: "Description",
                        dataType: "nvarchar",
                        maxLength: "200",
                        isNullable: true,
                    }),
                ],
            }),
        ]);

        const graph = (service as any).buildCommandGraph(original, updated);
        const statements: string[] = graph.toStatements();

        expect(statements).to.deep.include(
            "ALTER TABLE [inventory].[Products] DROP CONSTRAINT [PK_Products];",
        );
        expect(statements.some((stmt) => stmt.includes("DROP COLUMN [LegacyCode]"))).to.be.true;
        expect(statements.some((stmt) => stmt.includes("DROP COLUMN [ProductId]"))).to.be.true;
        expect(statements.some((stmt) => stmt.includes("ADD [ProductId] int"))).to.be.true;
        expect(statements).to.deep.include(
            "ALTER TABLE [inventory].[Products] ADD CONSTRAINT [DF_Products_Sku] DEFAULT 'sku-new' FOR [Sku];",
        );
        expect(statements.some((stmt) => stmt.includes("ADD [Description] nvarchar(200)"))).to.be.true;
    });

    test("publishSession executes script and updates cached schema", async () => {
        const original = schema([
            table({
                id: "products",
                name: "Products",
                schema: "inventory",
                primaryKeyName: "PK_Products",
                columns: [
                    column({
                        id: "prod_id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                    }),
                ],
            }),
        ]);

        const updated = schema([
            table({
                id: "products",
                name: "Products",
                schema: "inventory",
                primaryKeyName: "PK_Products",
                columns: [
                    column({
                        id: "prod_id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 10,
                        identityIncrement: 2,
                        isNullable: false,
                    }),
                    column({
                        id: "prod_name",
                        name: "Name",
                        dataType: "nvarchar",
                        maxLength: "100",
                        isNullable: false,
                    }),
                ],
            }),
        ]);

        connectionManagerStub.isConnected.returns(false);
        const sessionId = "session-1";
        const profile = createConnectionProfile();
        (service as any)._sessions.set(sessionId, {
            sessionId,
            ownerUri: "owner-uri",
            schema: cloneSchema(original),
            originalSchema: cloneSchema(original),
            dataTypes: [],
            schemaNames: [],
            connectionProfile: profile,
        });

        await service.publishSession({ sessionId, updatedSchema: updated });

        expect(sqlClientStub.sendRequest).to.have.been.calledOnce;
        const script = sqlClientStub.sendRequest.getCall(0).args[1].queryString as string;
        expect(script).to.include("BEGIN TRY");
        expect(script).to.include("Products");
        expect(connectionManagerStub.connect).to.have.been.called;

        const cached = (service as any)._sessions.get(sessionId);
        expect(cached.originalSchema.tables[0].columns.length).to.equal(2);
        expect(cached.schema.tables[0].columns[1].name).to.equal("Name");
    });
});

function schema(tables: SchemaDesigner.Table[]): SchemaDesigner.Schema {
    return { tables };
}

function table(options: {
    id: string;
    name: string;
    schema: string;
    columns: SchemaDesigner.Column[];
    foreignKeys?: SchemaDesigner.ForeignKey[];
    primaryKeyName?: string;
}): SchemaDesigner.Table {
    return {
        id: options.id,
        name: options.name,
        schema: options.schema,
        columns: options.columns,
        foreignKeys: options.foreignKeys ?? [],
    };
}

function column(options: {
    id: string;
    name: string;
    dataType: string;
    maxLength?: string;
    precision?: number;
    scale?: number;
    isPrimaryKey?: boolean;
    isIdentity?: boolean;
    identitySeed?: number;
    identityIncrement?: number;
    isNullable?: boolean;
    defaultValue?: string;
    defaultConstraintName?: string;
    isComputed?: boolean;
    computedFormula?: string;
    computedPersisted?: boolean;
}): SchemaDesigner.Column {
    return {
        id: options.id,
        name: options.name,
        dataType: options.dataType,
        maxLength: options.maxLength ?? "",
        precision: options.precision ?? 0,
        scale: options.scale ?? 0,
        isPrimaryKey: options.isPrimaryKey ?? false,
        isIdentity: options.isIdentity ?? false,
        identitySeed: options.identitySeed ?? 0,
        identityIncrement: options.identityIncrement ?? 0,
        isNullable: options.isNullable ?? true,
        defaultValue: options.defaultValue ?? "",
        isComputed: options.isComputed ?? false,
        computedFormula: options.computedFormula ?? "",
        computedPersisted: options.computedPersisted ?? false,
    };
}

function cloneSchema(schema: SchemaDesigner.Schema): SchemaDesigner.Schema {
    return JSON.parse(JSON.stringify(schema));
}

function createConnectionProfile(): IConnectionProfile {
    return {
        server: "localhost",
        database: "AdventureWorks",
        user: "sa",
        password: "Password!",
        authenticationType: "SqlLogin",
    } as unknown as IConnectionProfile;
}
