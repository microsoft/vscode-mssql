/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAccount, IConnectionInfo, IServerInfo } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { EncryptOptions } from "./interfaces";
import * as Interfaces from "./interfaces";
import { getCloudProviderSettings } from "../azure/providerSettings";
import { getErrorMessage } from "../utils/utils";
import {
  AuthenticationType,
  IConnectionDialogProfile,
} from "../sharedInterfaces/connectionDialog";

/**
 * Sets sensible defaults for key connection properties, especially
 * if connection to Azure
 *
 * @export connectionInfo/fixupConnectionCredentials
 * @param connCreds connection to be fixed up
 * @returns the updated connection
 */
export function fixupConnectionCredentials(
  connCreds: IConnectionInfo,
): IConnectionInfo {
  if (!connCreds.server) {
    connCreds.server = "";
  }

  if (!connCreds.database) {
    connCreds.database = "";
  }

  if (!connCreds.user) {
    connCreds.user = "";
  }

  if (!connCreds.password) {
    connCreds.password = "";
  }

  if (!connCreds.connectTimeout) {
    connCreds.connectTimeout = Constants.defaultConnectionTimeout;
  }

  if (!connCreds.commandTimeout) {
    connCreds.commandTimeout = Constants.defaultCommandTimeout;
  }

  // default value for appName
  if (!connCreds.applicationName) {
    connCreds.applicationName = Constants.connectionApplicationName;
  }

  // default value for encrypt
  if (
    connCreds.encrypt === undefined ||
    connCreds.encrypt === "" ||
    connCreds.encrypt === true
  ) {
    connCreds.encrypt = EncryptOptions.Mandatory;
  } else if (connCreds.encrypt === false) {
    connCreds.encrypt = EncryptOptions.Optional;
  }

  // Override specific properties for Azure SQL Database connections
  if (isAzureDatabase(connCreds.server)) {
    // always encrypt connection when connecting to Azure SQL
    if (connCreds.encrypt === EncryptOptions.Optional) {
      connCreds.encrypt = EncryptOptions.Mandatory;
    }

    // Ensure minumum connection timeout when connecting to Azure SQL
    if (connCreds.connectTimeout < Constants.azureSqlDbConnectionTimeout) {
      connCreds.connectTimeout = Constants.azureSqlDbConnectionTimeout;
    }
  }
  return connCreds;
}

/**
 * Gets a connection profile with default values for key properties
 * @returns the default connection profile
 */
export function getDefaultConnection(): IConnectionDialogProfile {
  const connectionInfo = {
    authenticationType: AuthenticationType.SqlLogin,
    connectTimeout: 30, // seconds
    applicationName: "vscode-mssql",
    applicationIntent: "ReadWrite",
  } as IConnectionDialogProfile;
  return fixupConnectionCredentials(connectionInfo);
}

export function updateEncrypt(connection: IConnectionInfo): {
  connection: IConnectionInfo;
  updateStatus: boolean;
} {
  let updatePerformed = true;
  let resultConnection = Object.assign({}, connection);
  if (connection.encrypt === true) {
    resultConnection.encrypt = EncryptOptions.Mandatory;
  } else if (connection.encrypt === false) {
    resultConnection.encrypt = EncryptOptions.Optional;
  } else {
    updatePerformed = false;
  }
  return { connection: resultConnection, updateStatus: updatePerformed };
}

// return true if server name ends with '.database.windows.net'
function isAzureDatabase(server: string): boolean {
  return server ? server.endsWith(Constants.sqlDbSuffix) : false;
}

/**
 * Gets a label describing a connection in the picklist UI
 *
 * @export connectionInfo/getPicklistLabel
 * @param connection connection to create a label for
 * @param itemType type of quickpick item to display - this influences the icon shown to the user
 * @returns user readable label
 */
export function getSimpleConnectionDisplayName(
  connection: IConnectionInfo,
): string {
  let profile: Interfaces.IConnectionProfile =
    connection as Interfaces.IConnectionProfile;

  if (profile.profileName) {
    return profile.profileName;
  } else {
    return connection.server ? connection.server : connection.connectionString;
  }
}

/**
 * Gets a description for a connection to display in the picklist UI
 *
 * @export connectionInfo/getPicklistDescription
 * @param connCreds connection
 * @returns description
 */
export function getPicklistDescription(connCreds: IConnectionInfo): string {
  let desc = `[${getConnectionDisplayString(connCreds)}]`;
  return desc;
}

/**
 * Gets detailed information about a connection, which can be displayed in the picklist UI
 *
 * @export connectionInfo/getPicklistDetails
 * @param connCreds connection
 * @returns details
 */
export function getPicklistDetails(connCreds: IConnectionInfo): string {
  // In the current spec this is left empty intentionally. Leaving the method as this may change in the future
  return undefined;
}

/**
 * Gets a display string for a connection. This is a concise version of the connection
 * information that can be shown in a number of different UI locations
 *
 * @export connectionInfo/getConnectionDisplayString
 * @param conn connection
 * @returns display string that can be used in status view or other locations
 */
export function getConnectionDisplayString(
  creds: IConnectionInfo,
  trimLength?: number,
): string {
  const server = generateServerDisplayName(creds);
  const database = generateDatabaseDisplayName(creds);
  const user = getUserNameOrDomainLogin(creds);

  let result = user
    ? `${server} : ${database} : ${user}`
    : `${server} : ${database}`;

  if (trimLength) {
    if (trimLength === 0) {
      result = "";
    } else if (trimLength > 0 && result.length > trimLength) {
      result = result.slice(0, trimLength) + " \u2026"; // add ellipsis
    }
  }

  return result;
}

export function generateServerDisplayName(creds: IConnectionInfo): string {
  return creds.server;
}

export function generateDatabaseDisplayName(
  creds: IConnectionInfo,
  includeDatabaseIcon: boolean = true,
): string {
  const databaseName =
    creds.database || LocalizedConstants.defaultDatabaseLabel;
  if (includeDatabaseIcon) {
    return `$(database) ${databaseName}`;
  } else {
    return databaseName;
  }
}

/**
 * Gets a formatted display version of a username, or the domain user if using Integrated authentication
 *
 * @export connectionInfo/getUserNameOrDomainLogin
 * @param conn connection
 * @param [defaultValue] optional default value to use if username is empty and this is not an Integrated auth profile
 * @returns
 */
export function getUserNameOrDomainLogin(
  creds: IConnectionInfo,
  defaultValue?: string,
): string {
  if (!defaultValue) {
    defaultValue = "";
  }

  if (
    creds.authenticationType ===
    Interfaces.AuthenticationTypes[Interfaces.AuthenticationTypes.Integrated]
  ) {
    return process.platform === "win32"
      ? process.env.USERDOMAIN + "\\" + process.env.USERNAME
      : "";
  } else {
    return creds.user ? creds.user : defaultValue;
  }
}

/**
 * Gets a detailed tooltip with information about a connection
 *
 * @export connectionInfo/getTooltip
 * @param connCreds connection
 * @returns tooltip
 */
export function getTooltip(
  connCreds: IConnectionInfo,
  serverInfo?: IServerInfo,
): string {
  let tooltip: string = connCreds.connectionString
    ? "Connection string: " + connCreds.connectionString + "\r\n"
    : "Server: " +
      connCreds.server +
      "\r\n" +
      "Database: " +
      (connCreds.database ? connCreds.database : "<connection default>") +
      "\r\n" +
      (connCreds.authenticationType !== Constants.integratedauth
        ? "User: " + connCreds.user + "\r\n"
        : "") +
      "Encryption Mode: " +
      getEncryptionMode(connCreds.encrypt) +
      "\r\n";

  if (serverInfo && serverInfo.serverVersion) {
    tooltip += "Server version: " + serverInfo.serverVersion + "\r\n";
  }

  return tooltip;
}

export function getEncryptionMode(
  encryption: string | boolean | undefined,
): EncryptOptions {
  let encryptionMode = EncryptOptions.Mandatory;
  if (encryption !== undefined) {
    let encrypt = encryption.toString().toLowerCase();
    switch (encrypt) {
      case "true":
      case EncryptOptions.Mandatory.toLowerCase():
        encryptionMode = EncryptOptions.Mandatory;
        break;
      case "false":
      case EncryptOptions.Optional.toLowerCase():
        encryptionMode = EncryptOptions.Optional;
        break;
      case EncryptOptions.Strict.toLowerCase():
        encryptionMode = EncryptOptions.Strict;
        break;
      default:
        break;
    }
  }
  return encryptionMode;
}

export function getConnectionDisplayName(connection: IConnectionInfo): string {
  const profile: Interfaces.IConnectionProfile =
    connection as Interfaces.IConnectionProfile;

  if (profile.profileName) {
    return profile.profileName;
  } else {
    let database = connection.database;
    const server = connection.server;
    const authType = connection.authenticationType;
    let userOrAuthType = authType;
    if (authType === Constants.sqlAuthentication) {
      userOrAuthType = connection.user;
    }
    if (authType === Constants.azureMfa) {
      userOrAuthType = connection.email;
    }
    if (!database || database === "") {
      database = LocalizedConstants.defaultDatabaseLabel;
    }
    return `${server}, ${database} (${userOrAuthType})`;
  }
}

export enum ServerType {
  Azure = "Azure",
  Fabric = "Fabric",
  Dynamics = "Dynamics",
  Sql = "SQL",
  DataWarehouse = "DataWarehouse",
  Local = "Local",
  Other = "Other",
  Unknown = "Unknown",
}

/**
 * Attempts to determine the server type(s) of a connection based on the server name.
 * @param account If provided, the account's cloud environment will be used to determine the server type.  Otherwise, the currently-selected cloud will be used.
 * @returns Array of connection target tags that apply to the server
 */
export function getServerTypes(
  connection: IConnectionInfo,
  account?: IAccount,
): ServerType[] {
  if (connection?.server === undefined) {
    return [ServerType.Unknown];
  }

  try {
    const providerSettings = getCloudProviderSettings(
      account?.properties?.providerSettings?.id,
    );

    // Notes:
    // Using includes() here instead of endsWith() because there may be additional suffixes (e.g. port: .database.windows.net,1433)
    // Pre-prod environments may have different suffixes (e.g. msit-database.fabric.microsoft.com), so trim the leading dot.

    const typeMappings: Record<string, ServerType[]> = {
      [providerSettings.settings.sqlResource.dnsSuffix]: [
        ServerType.Azure,
        ServerType.Sql,
      ],
      [providerSettings.settings.sqlResource.analyticsDnsSuffix]: [
        ServerType.Azure,
        ServerType.DataWarehouse,
      ],
      [providerSettings.fabric.sqlDbDnsSuffix]: [
        ServerType.Fabric,
        ServerType.Sql,
      ],
      [providerSettings.fabric.dataWarehouseDnsSuffix]: [
        ServerType.Fabric,
        ServerType.DataWarehouse,
      ],
      [providerSettings.dataverse.dynamicsCrmDnsSuffix]: [
        ServerType.Dynamics,
        ServerType.Sql,
      ],
    };

    for (const [name, types] of Object.entries(typeMappings)) {
      if (
        connection.server.includes(name.startsWith(".") ? name.slice(1) : name)
      ) {
        return types;
      }
    }
  } catch (error) {
    console.error("Error checking server types:", getErrorMessage(error));
  }

  // check if it's a local connection
  if (
    connection.server.endsWith("localhost") || // might have http:
    connection.server.includes("localhost,") || // includes port
    connection.server === "." ||
    connection.server.includes(".,") // includes port
  ) {
    return [ServerType.Local, ServerType.Sql];
  }

  return [ServerType.Other];
}
