/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as tmp from "tmp";
import { ILogger } from "../models/interfaces";
import * as vscodeMssql from "vscode-mssql";

export interface IStatusView {
  installingService(): void;
  serviceInstalled(): void;
  serviceInstallationFailed(): void;
  updateServiceDownloadingProgress(downloadPercentage: number): void;
}

export interface IConfigUtils {
  getSqlToolsServiceDownloadUrl(): string;
  getSqlToolsInstallDirectory(): string;
  getSqlToolsExecutableFiles(): string[];
  getSqlToolsPackageVersion(): string;
  getExtensionConfig(key: string, defaultValue?: any): any;
  getWorkspaceConfig(key: string, defaultValue?: any): any;
  getSqlToolsConfigValue(configKey: string): any;
  useServiceVersion(version: number): void;
  getServiceVersion(): number;
}

export interface IPackage {
  url: string;
  installPath?: string;
  tmpFile: tmp.SynchrounousResult;
  isZipFile: boolean;
}

export class FirewallRuleError
  extends Error
  implements vscodeMssql.IFireWallRuleError
{
  constructor(
    public connectionUri: string,
    errorMessage: string,
  ) {
    super(errorMessage);
  }
}
export class PackageError extends Error {
  // Do not put PII (personally identifiable information) in the 'message' field as it will be logged to telemetry
  constructor(
    public message: string,
    public pkg: IPackage = undefined,
    public innerError: any = undefined,
  ) {
    super(message);
  }
}

export interface IHttpClient {
  downloadFile(
    urlString: string,
    pkg: IPackage,
    logger: ILogger,
    statusView: IStatusView,
  ): Promise<void>;
}

export interface IDecompressProvider {
  decompress(pkg: IPackage, logger: ILogger): Promise<void>;
}
