/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as xmldom from "@xmldom/xmldom";
import * as constants from "../../common/constants";
import * as utils from "../../common/utils";
import * as vscodeMssql from "vscode-mssql";
import * as vscode from "vscode";
import * as path from "path";

import { promises as fs } from "fs";
import { SqlConnectionDataSource } from "../dataSources/sqlConnectionStringSource";
import { TelemetryActions, TelemetryReporter, TelemetryViews } from "../../common/telemetry";
import { Project } from "../project";

// only reading db name, connection string, and SQLCMD vars from profile for now
export interface PublishProfile {
    databaseName: string;
    serverName: string;
    connectionId: string;
    connection: string;
    sqlCmdVariables: Map<string, string>;
    options?: vscodeMssql.DeploymentOptions;
}

export async function readPublishProfile(profileUri: vscode.Uri): Promise<PublishProfile> {
    try {
        const dacFxService = await utils.getDacFxService();
        const profile = await load(profileUri, dacFxService);
        return profile;
    } catch (e) {
        void vscode.window.showErrorMessage(constants.profileReadError(e));
        throw e;
    }
}

/**
 * parses the specified file to load publish settings
 */
export async function load(
    profileUri: vscode.Uri,
    dacfxService: utils.IDacFxService,
): Promise<PublishProfile> {
    const profileText = await fs.readFile(profileUri.fsPath);
    const profileXmlDoc: Document = new xmldom.DOMParser().parseFromString(profileText.toString());

    // read target database name
    let targetDbName = "";
    let targetDatabaseNameCount = profileXmlDoc.documentElement.getElementsByTagName(
        constants.targetDatabaseName,
    ).length;
    if (targetDatabaseNameCount > 0) {
        // if there is more than one TargetDatabaseName nodes, SSDT uses the name in the last one so we'll do the same here
        targetDbName = profileXmlDoc.documentElement.getElementsByTagName(
            constants.targetDatabaseName,
        )[targetDatabaseNameCount - 1].textContent!;
    }

    const connectionInfo = await readConnectionString(profileXmlDoc);
    const optionsResult = await dacfxService.getOptionsFromProfile(profileUri.fsPath);

    // get all SQLCMD variables to include from the profile
    const sqlCmdVariables = utils.readSqlCmdVariables(profileXmlDoc, true);

    TelemetryReporter.createActionEvent(
        TelemetryViews.SqlProjectPublishDialog,
        TelemetryActions.profileLoaded,
    )
        .withAdditionalProperties({
            hasTargetDbName: (!!targetDbName).toString(),
            hasConnectionString: (!!connectionInfo?.connectionId).toString(),
            hasSqlCmdVariables: (sqlCmdVariables.size > 0).toString(),
        })
        .send();

    return {
        databaseName: targetDbName,
        serverName: connectionInfo.server,
        connectionId: connectionInfo.connectionId,
        connection: connectionInfo.connection,
        sqlCmdVariables: sqlCmdVariables,
        options: optionsResult.deploymentOptions,
    };
}

async function readConnectionString(
    xmlDoc: any,
): Promise<{ connectionId: string; connection: string; server: string }> {
    let targetConnection = "";
    let connId = "";
    let server = "";

    if (xmlDoc.documentElement.getElementsByTagName(constants.targetConnectionString).length > 0) {
        const targetConnectionString = xmlDoc.documentElement.getElementsByTagName(
            constants.TargetConnectionString,
        )[0].textContent;
        const dataSource = new SqlConnectionDataSource("", targetConnectionString);
        let username: string = "";

        try {
            if (dataSource.integratedSecurity) {
                // TODO@chgagnon - hook up VS Code MSSQL
                server = dataSource.server;
                username = constants.defaultUser;
            } else {
                // TODO@chgagnon - hook up VS Code MSSQL
            }

            targetConnection = `${server} (${username})`;
        } catch (err) {
            throw new Error(constants.unableToCreatePublishConnection(utils.getErrorMessage(err)));
        }
    }

    return {
        connectionId: connId,
        connection: targetConnection,
        server: server,
    };
}

/**
 * saves publish settings to the specified profile file
 */
export async function savePublishProfile(
    profilePath: string,
    databaseName: string,
    connectionString: string,
    sqlCommandVariableValues?: Map<string, string>,
    deploymentOptions?: vscodeMssql.DeploymentOptions,
): Promise<void> {
    const dacFxService = await utils.getDacFxService();
    await (dacFxService as vscodeMssql.IDacFxService).savePublishProfile(
        profilePath,
        databaseName,
        connectionString,
        sqlCommandVariableValues,
        deploymentOptions as vscodeMssql.DeploymentOptions,
    );
}

export function promptToSaveProfile(project: Project, publishProfileUri?: vscode.Uri) {
    return vscode.window.showSaveDialog({
        defaultUri:
            publishProfileUri ??
            vscode.Uri.file(
                path.join(project.projectFolderPath, `${project.projectFileName}_1.publish.xml`),
            ),
        saveLabel: constants.save,
        filters: {
            "Publish files": ["publish.xml"],
        },
    });
}
