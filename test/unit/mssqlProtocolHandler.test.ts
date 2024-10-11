/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import { assert } from "chai";
import { MssqlProtocolHandler } from "../../src/mssqlProtocolHandler";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Uri } from "vscode";

suite("MssqlProtocolHandler Tests", () => {
    let mssqlProtocolHandler: MssqlProtocolHandler;
    let sqlToolsServiceClientMock: TypeMoq.IMock<SqlToolsServiceClient>;

    setup(() => {
        sqlToolsServiceClientMock = TypeMoq.Mock.ofType(
            SqlToolsServiceClient,
            TypeMoq.MockBehavior.Loose,
        );

        sqlToolsServiceClientMock
            .setup((x) => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() =>
                Promise.resolve({
                    capabilities: {
                        connectionProvider: {
                            options: [
                                {
                                    specialValueType: "serverName",
                                    isIdentity: true,
                                    name: "server",
                                    displayName: "Server name",
                                    description:
                                        "Name of the SQL Server instance",
                                    groupName: "Source",
                                    valueType: "string",
                                    defaultValue: null,
                                    objectType: null,
                                    categoryValues: null,
                                    isRequired: true,
                                    isArray: false,
                                },
                                {
                                    specialValueType: "databaseName",
                                    isIdentity: true,
                                    name: "database",
                                    displayName: "Database name",
                                    description:
                                        "The name of the initial catalog or database in the data source",
                                    groupName: "Source",
                                    valueType: "string",
                                    defaultValue: null,
                                    objectType: null,
                                    categoryValues: null,
                                    isRequired: false,
                                    isArray: false,
                                },
                                {
                                    specialValueType: "userName",
                                    isIdentity: true,
                                    name: "user",
                                    displayName: "User name",
                                    description:
                                        "Indicates the user ID to be used when connecting to the data source",
                                    groupName: "Security",
                                    valueType: "string",
                                    defaultValue: null,
                                    objectType: null,
                                    categoryValues: null,
                                    isRequired: true,
                                    isArray: false,
                                },
                                {
                                    specialValueType: "authType",
                                    isIdentity: true,
                                    name: "authenticationType",
                                    displayName: "Authentication type",
                                    description:
                                        "Specifies the method of authenticating with SQL Server",
                                    groupName: "Security",
                                    valueType: "category",
                                    defaultValue: null,
                                    objectType: null,
                                    categoryValues: [
                                        {
                                            displayName: "SQL Login",
                                            name: "SqlLogin",
                                        },
                                        {
                                            displayName:
                                                "Windows Authentication",
                                            name: "Integrated",
                                        },
                                        {
                                            displayName:
                                                "Microsoft Entra ID - Universal with MFA support",
                                            name: "AzureMFA",
                                        },
                                    ],
                                    isRequired: true,
                                    isArray: false,
                                },
                                {
                                    specialValueType: null,
                                    isIdentity: false,
                                    name: "connectTimeout",
                                    displayName: "Connect timeout",
                                    description:
                                        "The length of time (in seconds) to wait for a connection to the server before terminating the attempt and generating an error",
                                    groupName: "Initialization",
                                    valueType: "number",
                                    defaultValue: "15",
                                    objectType: null,
                                    categoryValues: null,
                                    isRequired: false,
                                    isArray: false,
                                },
                                {
                                    specialValueType: null,
                                    isIdentity: false,
                                    name: "trustServerCertificate",
                                    displayName: "Trust server certificate",
                                    description:
                                        "When true (and encrypt=true), SQL Server uses SSL encryption for all data sent between the client and server without validating the server certificate",
                                    groupName: "Security",
                                    valueType: "boolean",
                                    defaultValue: null,
                                    objectType: null,
                                    categoryValues: null,
                                    isRequired: false,
                                    isArray: false,
                                },
                            ],
                        },
                    },
                }),
            );

        mssqlProtocolHandler = new MssqlProtocolHandler(
            sqlToolsServiceClientMock.object,
        );
    });

    test("handleUri - with no command and empty query - returns undefined", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse("vscode://ms-mssql.mssql/"),
        );

        assert.isUndefined(connInfo);
    });

    test("handleUri - with connect command and no query - doesn't parse query and returns undefined", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse("vscode://ms-mssql.mssql/connect"),
        );

        assert.isUndefined(connInfo);
    });

    test("handleUri - with connect command and connection string - parses connection string and returns connection info object", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse(
                "vscode://ms-mssql.mssql/connect?connectionString=Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;",
            ),
        );

        assert.isDefined(connInfo);
        assert.equal(
            connInfo.connectionString,
            "Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;",
        );
    });

    test("handleUri - with connect command and query - parses query and returns connection info object", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse(
                "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&authenticationType=SqlLogin&connectTimeout=15&trustServerCertificate=true",
            ),
        );

        assert.isDefined(connInfo);
        assert.equal(connInfo.server, "myServer");
        assert.equal(connInfo.database, "dbName");
        assert.equal(connInfo.authenticationType, "SqlLogin");
        assert.equal(connInfo.connectTimeout, 15);
        assert.isTrue(connInfo.trustServerCertificate);
    });

    test("handleUri - with connect command and query with invalid bool value for trust server cert - trust server cert is false and parses valid params", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse(
                "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&trustServerCertificate=yes",
            ),
        );

        assert.isDefined(connInfo);
        assert.equal(connInfo.server, "myServer");
        assert.equal(connInfo.database, "dbName");
        assert.isFalse(connInfo.trustServerCertificate);
    });

    test("handleUri - with connect command and query with invalid numerical value for connect timeout - timeout is undefined and parses valid params", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse(
                "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&connectTimeout=twenty",
            ),
        );

        assert.isDefined(connInfo);
        assert.equal(connInfo.server, "myServer");
        assert.equal(connInfo.database, "dbName");
        assert.isUndefined(connInfo.connectTimeout);
    });

    test("handleUri - with connect command and query invalid parameter - invalid param is undefined", async () => {
        const connInfo = await mssqlProtocolHandler.handleUri(
            Uri.parse(
                "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&madeUpParam=great",
            ),
        );

        assert.isDefined(connInfo);
        assert.equal(connInfo.server, "myServer");
        assert.equal(connInfo.database, "dbName");

        const madeUpParam = "madeUpParam";
        assert.isUndefined(connInfo[madeUpParam]);
    });
});
