/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as path from "path";
import findRemoveSync from "find-remove";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import {
  IAzureSignInQuickPickItem,
  IConnectionProfile,
  AuthenticationTypes,
} from "./interfaces";
import * as LocalizedConstants from "../constants/locConstants";
import * as fs from "fs";
import { AzureAuthType } from "./contracts/azure";
import { IConnectionInfo } from "vscode-mssql";

// CONSTANTS //////////////////////////////////////////////////////////////////////////////////////
const msInH = 3.6e6;
const msInM = 60000;
const msInS = 1000;

const configTracingLevel = "tracingLevel";
const configPiiLogging = "piiLogging";
const configLogRetentionMinutes = "logRetentionMinutes";
const configLogFilesRemovalLimit = "logFilesRemovalLimit";

// INTERFACES /////////////////////////////////////////////////////////////////////////////////////

// Interface for package.json information
export interface IPackageInfo {
  name: string;
  version: string;
  aiKey: string;
}

// FUNCTIONS //////////////////////////////////////////////////////////////////////////////////////

// Generate a new GUID
export function generateGuid(): string {
  let hexValues: string[] = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
  ];
  // c.f. rfc4122 (UUID version 4 = xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
  let oct = "";
  let tmp: number;
  /* tslint:disable:no-bitwise */
  for (let a = 0; a < 4; a++) {
    tmp = (4294967296 * Math.random()) | 0;
    oct +=
      hexValues[tmp & 0xf] +
      hexValues[(tmp >> 4) & 0xf] +
      hexValues[(tmp >> 8) & 0xf] +
      hexValues[(tmp >> 12) & 0xf] +
      hexValues[(tmp >> 16) & 0xf] +
      hexValues[(tmp >> 20) & 0xf] +
      hexValues[(tmp >> 24) & 0xf] +
      hexValues[(tmp >> 28) & 0xf];
  }

  // 'Set the two most significant bits (bits 6 and 7) of the clock_seq_hi_and_reserved to zero and one, respectively'
  let clockSequenceHi: string = hexValues[(8 + Math.random() * 4) | 0];
  return (
    oct.substr(0, 8) +
    "-" +
    oct.substr(9, 4) +
    "-4" +
    oct.substr(13, 3) +
    "-" +
    clockSequenceHi +
    oct.substr(16, 3) +
    "-" +
    oct.substr(19, 12)
  );
  /* tslint:enable:no-bitwise */
}

// Return 'true' if the active editor window has a .sql file, false otherwise
export function isEditingSqlFile(): boolean {
  let sqlFile = false;
  let editor = getActiveTextEditor();
  if (editor) {
    if (editor.document.languageId === Constants.languageId) {
      sqlFile = true;
    }
  }
  return sqlFile;
}

// Return the active text editor if there's one
export function getActiveTextEditor(): vscode.TextEditor {
  let editor = undefined;
  if (vscode.window && vscode.window.activeTextEditor) {
    editor = vscode.window.activeTextEditor;
  }
  return editor;
}

// Retrieve the URI for the currently open file if there is one; otherwise return the empty string
export function getActiveTextEditorUri(): string {
  if (
    typeof vscode.window.activeTextEditor !== "undefined" &&
    typeof vscode.window.activeTextEditor.document !== "undefined"
  ) {
    return vscode.window.activeTextEditor.document.uri.toString(true);
  }
  return "";
}

// Helper to log debug messages
export function logDebug(msg: any): void {
  let config = vscode.workspace.getConfiguration(
    Constants.extensionConfigSectionName,
  );
  let logDebugInfo = config.get(Constants.configLogDebugInfo);
  if (logDebugInfo === true) {
    let currentTime = new Date().toLocaleTimeString();
    let outputMsg = "[" + currentTime + "]: " + msg ? msg.toString() : "";
    console.log(outputMsg);
  }
}

// Helper to show an info message
export function showInfoMsg(msg: string): void {
  vscode.window.showInformationMessage(Constants.extensionName + ": " + msg);
}

// Helper to show an warn message
export function showWarnMsg(msg: string): void {
  vscode.window.showWarningMessage(Constants.extensionName + ": " + msg);
}

// Helper to show an error message
export function showErrorMsg(msg: string): void {
  vscode.window.showErrorMessage(Constants.extensionName + ": " + msg);
}

export function isEmpty(str: any): boolean {
  return !str || "" === str;
}

export function isNotEmpty(str: any): boolean {
  return <boolean>(str && "" !== str);
}

export function authTypeToString(value: AuthenticationTypes): string {
  return AuthenticationTypes[value];
}

export function azureAuthTypeToString(value: AzureAuthType): string {
  return AzureAuthType[value];
}

export function escapeClosingBrackets(str: string): string {
  return str.replace("]", "]]");
}

/**
 * Format a string. Behaves like C#'s string.Format() function.
 */
export function formatString(str: string, ...args: any[]): string {
  // This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
  // License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
  let result: string;
  if (args.length === 0) {
    result = str;
  } else {
    result = str.replace(/\{(\d+)\}/g, (match, rest) => {
      let index = rest[0];
      return typeof args[index] !== "undefined" ? args[index] : match;
    });
  }
  return result;
}

/**
 * Compares 2 accounts to see if they are the same.
 */
export function isSameAccountKey(
  currentAccountKey: string,
  newAccountKey: string,
): boolean {
  return currentAccountKey === newAccountKey;
}

/**
 * Compares 2 database names to see if they are the same.
 * If either is undefined or empty, it is assumed to be 'master'
 */
function isSameDatabase(
  currentDatabase: string,
  expectedDatabase: string,
): boolean {
  if (isEmpty(currentDatabase)) {
    currentDatabase = Constants.defaultDatabase;
  }
  if (isEmpty(expectedDatabase)) {
    expectedDatabase = Constants.defaultDatabase;
  }
  return currentDatabase === expectedDatabase;
}

/**
 * Compares 2 authentication type strings to see if they are the same.
 * If either is undefined or empty, then it is assumed to be SQL authentication by default.
 */
function isSameAuthenticationType(
  currentAuthenticationType: string,
  expectedAuthenticationType: string,
): boolean {
  if (isEmpty(currentAuthenticationType)) {
    currentAuthenticationType = Constants.sqlAuthentication;
  }
  if (isEmpty(expectedAuthenticationType)) {
    expectedAuthenticationType = Constants.sqlAuthentication;
  }
  return currentAuthenticationType === expectedAuthenticationType;
}

/**
 * Compares 2 profiles to see if they match. Logic for matching:
 * If a profile name is used, can simply match on this.
 * If not, match on all key properties (server, db, auth type, user) being identical.
 * Other properties are ignored for this purpose
 *
 * @param currentProfile the profile to check
 * @param expectedProfile the profile to try
 * @returns boolean that is true if the profiles match
 */
export function isSameProfile(
  currentProfile: IConnectionProfile,
  expectedProfile: IConnectionProfile,
): boolean {
  if (currentProfile.id && expectedProfile.id) {
    // If connection profile has an id, use that to compare connections
    return currentProfile.id === expectedProfile.id;
  }
  if (currentProfile === undefined) {
    return false;
  }
  if (expectedProfile.profileName) {
    // Can match on profile name
    return expectedProfile.profileName === currentProfile.profileName;
  } else if (currentProfile.profileName) {
    // This has a profile name but expected does not - can break early
    return false;
  } else if (
    currentProfile.connectionString ||
    expectedProfile.connectionString
  ) {
    // If either profile uses connection strings, compare them directly
    return currentProfile.connectionString === expectedProfile.connectionString;
  } else if (
    currentProfile.authenticationType === Constants.azureMfa &&
    expectedProfile.authenticationType === Constants.azureMfa
  ) {
    return (
      expectedProfile.server === currentProfile.server &&
      isSameDatabase(expectedProfile.database, currentProfile.database) &&
      isSameAccountKey(expectedProfile.accountId, currentProfile.accountId)
    );
  }
  return (
    expectedProfile.server === currentProfile.server &&
    isSameDatabase(expectedProfile.database, currentProfile.database) &&
    isSameAuthenticationType(
      expectedProfile.authenticationType,
      currentProfile.authenticationType,
    ) &&
    ((isEmpty(expectedProfile.user) && isEmpty(currentProfile.user)) ||
      expectedProfile.user === currentProfile.user)
  );
}

export enum MatchScore {
  /**
   * Not a match on core connection properties
   */
  NotMatch = 0,

  /**
   * Matches on the server URL only.  Other properties may be different.
   */
  Server = 1,

  /**
   * Matches on the server URL and database name only.  Other properties may be different.
   */
  ServerAndDatabase = 2,

  /**
   * Matches on core connection properties (server, database, and auth).  Other properties may be different.
   */
  ServerDatabaseAndAuth = 3,

  /**
   * Match on core connection properties, as well as all available additional properties.
   * If a property is specified in the partial profile, it must match.  If a property is not specified
   * in the partial profile, it is ignored for matching purposes.
   *
   * If either connection uses a connection string, the connection strings must match exactly and all other properties are ignored.
   */
  AllAvailableProps = 4,

  /**
   * Matches on connection ID GUID.  Other properties are assumed to be the same.
   */
  Id = 5,
}

export class ConnectionMatcher {
  /**
   * Returns the highest match level for the given connection profiles
   * @param current the saved connection profile that's being checked as a match; generally expected to be a complete profile.
   * @param expected the connection info that you're looking for a match for; treated as the partial profile when evaluating `MatchLevel.AllAvailableProps`.
   */
  public static isMatchingConnection(
    current: IConnectionProfile,
    expected: IConnectionProfile,
  ): MatchScore {
    // Check for ID match first (highest match confidence)
    if (current.id && expected.id && current.id === expected.id) {
      return MatchScore.Id;
    }

    // Check for connection string match; all-or-nothing when connection strings are involved
    if (current.connectionString || expected.connectionString) {
      if (current.connectionString === expected.connectionString) {
        return MatchScore.AllAvailableProps;
      } else {
        return MatchScore.NotMatch;
      }
    }

    // Check for connection information match (server, database, authentication info)
    if (ConnectionMatcher.serverMatches(current, expected)) {
      if (
        expected.database &&
        ConnectionMatcher.databaseMatches(current, expected)
      ) {
        if (
          expected.authenticationType &&
          ConnectionMatcher.authenticationMatches(current, expected)
        ) {
          if (ConnectionMatcher.additionalPropertiesMatch(current, expected)) {
            return MatchScore.AllAvailableProps;
          }
          return MatchScore.ServerDatabaseAndAuth;
        }
        return MatchScore.ServerAndDatabase;
      }
      return MatchScore.Server;
    }

    return MatchScore.NotMatch;
  }

  /**
   * Finds the closest-matching profile from the provided list for the given partial connection profile
   * @param connProfile partial connection profile to match against
   * @returns closest-matching connection profile from the provided list. If none is found, returns {score: MatchScore.NotMatch}
   */
  public static findMatchingProfile(
    connProfile: IConnectionProfile,
    connectionList: IConnectionProfile[],
  ): { profile: IConnectionProfile; score: MatchScore } {
    let bestMatch: IConnectionProfile | undefined;
    let bestMatchScore = MatchScore.NotMatch;

    for (const savedConn of connectionList) {
      const matchLevel = ConnectionMatcher.isMatchingConnection(
        savedConn,
        connProfile,
      );

      if (matchLevel > bestMatchScore) {
        bestMatchScore = matchLevel;
        bestMatch = savedConn;
      }
    }

    return { profile: bestMatch, score: bestMatchScore };
  }

  /**
   * Checks if the server names match.  Normalizes "." to "localhost" for comparison purposes.  Case-sensitive.
   */
  public static serverMatches(
    current: IConnectionProfile,
    expected: IConnectionProfile,
  ): boolean {
    function normalizeServerName(server: string): string {
      if (server === ".") {
        return "localhost";
      }
      return server;
    }

    const currentServer = normalizeServerName(current.server);
    const expectedServer = normalizeServerName(expected.server);

    return currentServer === expectedServer;
  }

  /**
   * Checks if the database names match.  Case-sensitive.
   */
  public static databaseMatches(
    current: IConnectionProfile,
    expected: IConnectionProfile,
  ): boolean {
    return isSameDatabase(current.database, expected.database);
  }

  /**
   * Checks if the authentication information matches, including authentication type and user/account.  Does not compare passwords.
   */
  public static authenticationMatches(
    current: IConnectionProfile,
    expected: IConnectionProfile,
  ): boolean {
    let result = true;

    // confirm same authentication type
    result &&= isSameAuthenticationType(
      current.authenticationType,
      expected.authenticationType,
    );

    // confirm same user/account
    if (current.authenticationType === Constants.sqlAuthentication) {
      result &&= current.user === expected.user;
    } else if (current.authenticationType === Constants.azureMfa) {
      if (current.accountId && expected.accountId) {
        // If both account IDs are defined, then require those to match as well
        result &&= isSameAccountKey(current.accountId, expected.accountId);
      }
    }

    return result;
  }

  public static additionalPropertiesMatch(
    current: IConnectionProfile,
    expected: IConnectionProfile,
  ): boolean {
    const coreKeys = new Set<keyof IConnectionProfile>([
      "server",
      "database",
      "authenticationType",
      "user",
      "password",
      "accountId",
      "profileName",
      "connectionString",
      "savePassword",
      "id",
    ]);

    for (const key of Object.keys(expected).filter(
      (k) => !coreKeys.has(k as keyof IConnectionProfile),
    )) {
      if (current[key] !== expected[key]) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Compares 2 connections to see if they match. Logic for matching:
 * match on all key properties (connectionString or server, db, auth type, user) being identical.
 * Other properties are ignored for this purpose
 *
 * @param conn the connection to check
 * @param expectedConn the connection to try to match
 * @returns boolean that is true if the connections match
 */
export function isSameConnectionInfo(
  conn: IConnectionInfo,
  expectedConn: IConnectionInfo,
): boolean {
  // If connection info has an id, use that to compare connections
  const connId = (conn as IConnectionProfile).id;
  const expectedConnId = (expectedConn as IConnectionProfile).id;
  if (connId && expectedConnId) {
    return connId === expectedConnId;
  }
  // If no id, compare the connection string or other properties
  return conn.connectionString || expectedConn.connectionString
    ? conn.connectionString === expectedConn.connectionString
    : // Azure MFA connections
      expectedConn.authenticationType === Constants.azureMfa &&
        conn.authenticationType === Constants.azureMfa
      ? expectedConn.server === conn.server &&
        isSameDatabase(expectedConn.database, conn.database) &&
        isSameAccountKey(expectedConn.accountId, conn.accountId)
      : // Not Azure MFA connections
        expectedConn.server === conn.server &&
        isSameDatabase(expectedConn.database, conn.database) &&
        isSameAuthenticationType(
          expectedConn.authenticationType,
          conn.authenticationType,
        ) &&
        (conn.authenticationType === Constants.sqlAuthentication
          ? conn.user === expectedConn.user
          : isEmpty(conn.user) === isEmpty(expectedConn.user)) &&
        (conn as IConnectionProfile).savePassword ===
          (expectedConn as IConnectionProfile).savePassword;
}

/**
 * Compares 2 connections to see if they match. Logic for matching:
 * match on properties like the (connectionString or server, auth type, user) being identical.
 * Other properties are ignored for this purpose
 *
 * @param conn the connection to check
 * @param expectedConn the connection to try to match
 * @returns boolean that is true if the connections match
 */
export function isSameScmpConnection(
  conn: IConnectionInfo,
  expectedConn: IConnectionInfo,
): boolean {
  if (conn.connectionString) {
    return conn.connectionString === expectedConn.connectionString;
  } else if (
    expectedConn.authenticationType === Constants.azureMfa &&
    conn.authenticationType === Constants.azureMfa
  ) {
    return (
      expectedConn.server === conn.server &&
      isSameAccountKey(expectedConn.accountId, conn.accountId)
    );
  } else if (
    expectedConn.server === conn.server &&
    isSameAuthenticationType(
      expectedConn.authenticationType,
      conn.authenticationType,
    )
  ) {
    if (conn.authenticationType === Constants.sqlAuthentication) {
      return conn.user === expectedConn.user;
    } else {
      return isEmpty(conn.user) === isEmpty(expectedConn.user);
    }
  }
}

/**
 * Check if a file exists on disk
 */
export function isFileExisting(filePath: string): boolean {
  try {
    fs.statSync(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

// One-time use timer for performance testing
export class Timer {
  private _startTime: number[];
  private _endTime: number[];

  constructor() {
    this.start();
  }

  // Get the duration of time elapsed by the timer, in milliseconds
  public getDuration(): number {
    if (!this._startTime) {
      return -1;
    } else if (!this._endTime) {
      let endTime = process.hrtime(<any>this._startTime);
      return endTime[0] * 1000 + endTime[1] / 1000000;
    } else {
      return this._endTime[0] * 1000 + this._endTime[1] / 1000000;
    }
  }

  public start(): void {
    this._startTime = process.hrtime();
  }

  public end(): void {
    if (!this._endTime) {
      this._endTime = process.hrtime(<any>this._startTime);
    }
  }
}

/**
 * Takes a string in the format of HH:MM:SS.MS and returns a number representing the time in
 * miliseconds
 * @param value The string to convert to milliseconds
 * @return False is returned if the string is an invalid format,
 *         the number of milliseconds in the time string is returned otherwise.
 */
export function parseTimeString(value: string): number | boolean {
  if (!value) {
    return false;
  }
  let tempVal = value.split(".");

  if (tempVal.length === 1) {
    // Ideally would handle more cleanly than this but for now handle case where ms not set
    tempVal = [tempVal[0], "0"];
  } else if (tempVal.length !== 2) {
    return false;
  }

  let msString = tempVal[1];
  let msStringEnd = msString.length < 3 ? msString.length : 3;
  let ms = parseInt(tempVal[1].substring(0, msStringEnd), 10);

  tempVal = tempVal[0].split(":");

  if (tempVal.length !== 3) {
    return false;
  }

  let h = parseInt(tempVal[0], 10);
  let m = parseInt(tempVal[1], 10);
  let s = parseInt(tempVal[2], 10);

  return ms + h * msInH + m * msInM + s * msInS;
}

export function isBoolean(obj: any): obj is boolean {
  return obj === true || obj === false;
}

/**
 * Takes a number of milliseconds and converts it to a string like HH:MM:SS.fff
 * @param value The number of milliseconds to convert to a timespan string
 * @returns A properly formatted timespan string.
 */
export function parseNumAsTimeString(value: number): string {
  let tempVal = value;
  let h = Math.floor(tempVal / msInH);
  tempVal %= msInH;
  let m = Math.floor(tempVal / msInM);
  tempVal %= msInM;
  let s = Math.floor(tempVal / msInS);
  tempVal %= msInS;

  let hs = h < 10 ? "0" + h : "" + h;
  let ms = m < 10 ? "0" + m : "" + m;
  let ss = s < 10 ? "0" + s : "" + s;
  let mss =
    tempVal < 10
      ? "00" + tempVal
      : tempVal < 100
        ? "0" + tempVal
        : "" + tempVal;

  let rs = hs + ":" + ms + ":" + ss;

  return tempVal > 0 ? rs + "." + mss : rs;
}

function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(
    Constants.extensionConfigSectionName,
  );
}

export function getConfigTracingLevel(): string {
  let config = getConfiguration();
  if (config) {
    return config.get(configTracingLevel);
  } else {
    return undefined;
  }
}

export function getConfigPiiLogging(): boolean {
  let config = getConfiguration();
  if (config) {
    return config.get(configPiiLogging);
  } else {
    return undefined;
  }
}

export function getConfigLogFilesRemovalLimit(): number {
  let config = getConfiguration();
  if (config) {
    return Number(config.get(configLogFilesRemovalLimit, 0).toFixed(0));
  } else {
    return undefined;
  }
}

export function getConfigLogRetentionSeconds(): number {
  let config = getConfiguration();
  if (config) {
    return Number((config.get(configLogRetentionMinutes, 0) * 60).toFixed(0));
  } else {
    return undefined;
  }
}

export function removeOldLogFiles(
  logPath: string,
  prefix: string,
): Record<string, any> | number {
  return findRemoveSync(logPath, {
    age: { seconds: getConfigLogRetentionSeconds() },
    limit: getConfigLogFilesRemovalLimit(),
    prefix: prefix,
  });
}

export function getCommonLaunchArgsAndCleanupOldLogFiles(
  executablePath: string,
  logPath: string,
  fileName: string,
): string[] {
  let launchArgs = [];
  launchArgs.push("--log-file");
  let logFile = path.join(logPath, fileName);
  launchArgs.push(logFile);

  console.log(`logFile for ${path.basename(executablePath)} is ${logFile}`);
  // Delete old log files
  let deletedLogFiles = removeOldLogFiles(logPath, fileName);
  console.log(
    `Old log files deletion report: ${JSON.stringify(deletedLogFiles)}`,
  );
  console.log(
    `This process (ui Extenstion Host) for ${path.basename(executablePath)} is pid: ${process.pid}`,
  );
  launchArgs.push("--tracing-level");
  launchArgs.push(getConfigTracingLevel());
  if (getConfigPiiLogging()) {
    launchArgs.push("--pii-logging");
  }
  return launchArgs;
}

/**
 * Returns the all the sign in methods as quickpick items
 */
export function getSignInQuickPickItems(): IAzureSignInQuickPickItem[] {
  let signInItem: IAzureSignInQuickPickItem = {
    label: LocalizedConstants.azureSignIn,
    description: LocalizedConstants.azureSignInDescription,
    command: Constants.cmdAzureSignIn,
  };
  let signInWithDeviceCode: IAzureSignInQuickPickItem = {
    label: LocalizedConstants.azureSignInWithDeviceCode,
    description: LocalizedConstants.azureSignInWithDeviceCodeDescription,
    command: Constants.cmdAzureSignInWithDeviceCode,
  };
  let signInAzureCloud: IAzureSignInQuickPickItem = {
    label: LocalizedConstants.azureSignInToAzureCloud,
    description: LocalizedConstants.azureSignInToAzureCloudDescription,
    command: Constants.cmdAzureSignInToCloud,
  };
  return [signInItem, signInWithDeviceCode, signInAzureCloud];
}

/**
 * Limits the size of a string with ellipses in the middle
 */
export function limitStringSize(
  input: string,
  forCommandPalette: boolean = false,
): string {
  if (!forCommandPalette) {
    if (input.length > 45) {
      return `${input.substr(0, 20)}...${input.substr(input.length - 20, input.length)}`;
    }
  } else {
    if (input.length > 100) {
      return `${input.substr(0, 45)}...${input.substr(input.length - 45, input.length)}`;
    }
  }
  return input;
}

let uriIndex = 0;
/**
 * Generates a URI intended for use when running queries if a file connection isn't present (such
 * as when running ad-hoc queries).
 */
export function generateQueryUri(scheme = "vscode-mssql-adhoc"): vscode.Uri {
  return vscode.Uri.from({
    scheme: scheme,
    authority: `Query${uriIndex++}`,
  });
}

/**
 * deep clone the object. Copied from vscode: https://github.com/microsoft/vscode/blob/main/src/vs/base/common/objects.ts#L8
 */
export function deepClone<T>(obj: T): T {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  if (obj instanceof RegExp) {
    // See https://github.com/microsoft/TypeScript/issues/10990
    return obj as any;
  }
  const result: any = Array.isArray(obj) ? [] : {};
  Object.keys(<any>obj).forEach((key: string) => {
    if ((<any>obj)[key] && typeof (<any>obj)[key] === "object") {
      result[key] = deepClone((<any>obj)[key]);
    } else {
      result[key] = (<any>obj)[key];
    }
  });
  return result;
}

export const isLinux = os.platform() === "linux";

/**
 * Database name validation error types
 */
export enum DatabaseNameValidationError {
  None = "None",
  Required = "Required",
  InvalidCharacters = "InvalidCharacters",
  TooLong = "TooLong",
}

/**
 * Validates a database name format according to SQL Server rules.
 * Checks for: empty/whitespace, invalid characters, and length limits.
 * @param databaseName The database name to validate
 * @returns An object with isValid flag and optional error type
 */
export function validateDatabaseNameFormat(databaseName: string): {
  isValid: boolean;
  errorType?: DatabaseNameValidationError;
} {
  // Check for empty or whitespace-only name
  if (!databaseName || databaseName.trim() === "") {
    return {
      isValid: false,
      errorType: DatabaseNameValidationError.Required,
    };
  }

  // Check for invalid characters
  const invalidChars = /[<>*?"/\\|]/;
  if (invalidChars.test(databaseName)) {
    return {
      isValid: false,
      errorType: DatabaseNameValidationError.InvalidCharacters,
    };
  }

  // Check length (SQL Server max identifier length is 128)
  if (databaseName.length > 128) {
    return {
      isValid: false,
      errorType: DatabaseNameValidationError.TooLong,
    };
  }

  return { isValid: true, errorType: DatabaseNameValidationError.None };
}
