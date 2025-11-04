/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { ServiceOption } from "vscode-mssql";
import { CapabilitiesResult, GetCapabilitiesRequest } from "../../src/models/contracts/connection";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import sinon from "sinon";

export function stubGetCapabilitiesRequest(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<SqlToolsServerClient> {
    const stubber = sandbox || sinon;
    const serviceClientMock = stubber.createStubInstance(SqlToolsServerClient);
    serviceClientMock.sendRequest
        .withArgs(GetCapabilitiesRequest.type)
        .resolves(buildCapabilitiesResult());
    return serviceClientMock;
}

export function buildCapabilitiesResult(): CapabilitiesResult {
    return {
        capabilities: {
            connectionProvider: {
                groupDisplayNames: {
                    group1: "Group 1",
                    group2: "Group 2",
                },
                options: [
                    {
                        name: "server",
                        displayName: "Server",
                        isRequired: true,
                        valueType: "string",
                    },
                    {
                        name: "user",
                        displayName: "User",
                        isRequired: false,
                        valueType: "string",
                    },
                    {
                        name: "password",
                        displayName: "Password",
                        isRequired: false,
                        valueType: "password",
                    },
                    {
                        name: "trustServerCertificate",
                        displayName: "Trust Server Certificate",
                        isRequired: false,
                        valueType: "boolean",
                    },
                    {
                        name: "authenticationType",
                        displayName: "Authentication Type",
                        isRequired: false,
                        valueType: "category",
                        categoryValues: [
                            AuthenticationType.SqlLogin,
                            AuthenticationType.Integrated,
                            AuthenticationType.AzureMFA,
                        ],
                    },
                    {
                        name: "savePassword",
                        displayName: "Save Password",
                        isRequired: false,
                        valueType: "boolean",
                    },
                    {
                        name: "accountId",
                        displayName: "Account Id",
                        isRequired: false,
                        valueType: "string",
                    },
                    {
                        name: "tenantId",
                        displayName: "Tenant Id",
                        isRequired: false,
                        valueType: "string",
                    },
                    {
                        name: "database",
                        displayName: "Database",
                        isRequired: false,
                        valueType: "string",
                    },
                    {
                        name: "encrypt",
                        displayName: "Encrypt",
                        isRequired: false,
                        valueType: "boolean",
                    },
                    {
                        name: "connectTimeout",
                        displayName: "Connect timeout",
                        isRequired: false,
                        valueType: "number",
                    },
                ] as ServiceOption[],
            },
        },
    } as unknown as CapabilitiesResult;
}
