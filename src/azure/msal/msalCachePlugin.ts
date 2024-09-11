/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { promises as fsPromises } from "fs";

import * as lockFile from "lockfile";
import * as path from "path";
import VscodeWrapper from "../../controllers/vscodeWrapper";
import { ICredentialStore } from "../../credentialstore/icredentialstore";
import { Logger } from "../../models/logger";
import { FileEncryptionHelper } from "../fileEncryptionHelper";

export class MsalCachePluginProvider {
  constructor(
    private readonly _serviceName: string,
    private readonly _msalFilePath: string,
    private readonly _vscodeWrapper: VscodeWrapper,
    private readonly _logger: Logger,
    private readonly _credentialStore: ICredentialStore,
  ) {
    this._msalFilePath = path.join(this._msalFilePath, this._serviceName);
    this._serviceName = this._serviceName.replace(/-/, "_");
    this._fileEncryptionHelper = new FileEncryptionHelper(
      this._credentialStore,
      this._vscodeWrapper,
      this._logger,
      this._serviceName,
    );
    this._logger.verbose(
      `MsalCachePluginProvider: Using cache path ${_msalFilePath} and serviceName ${_serviceName}`,
    );
  }

  private _lockTaken: boolean = false;
  private _fileEncryptionHelper: FileEncryptionHelper;

  private getLockfilePath(): string {
    return this._msalFilePath + ".lockfile";
  }

  /**
   * Deletes Msal access token cache file
   */
  public async unlinkMsalCache(): Promise<void> {
    await fsPromises.unlink(this._msalFilePath);
  }

  public async clearCacheEncryptionKeys(): Promise<void> {
    await this._fileEncryptionHelper.clearEncryptionKeys();
  }

  public getCachePlugin(): ICachePlugin {
    const lockFilePath = this.getLockfilePath();
    const beforeCacheAccess = async (
      cacheContext: TokenCacheContext,
    ): Promise<void> => {
      await this.waitAndLock(lockFilePath);
      try {
        const cache = await fsPromises.readFile(this._msalFilePath, {
          encoding: "utf8",
        });
        const decryptedCache =
          await this._fileEncryptionHelper.fileOpener(cache);
        try {
          cacheContext.tokenCache.deserialize(decryptedCache);
        } catch (e) {
          // Handle deserialization error in cache file in case file gets corrupted.
          // Clearing cache here will ensure account is marked stale so re-authentication can be triggered.
          this._logger.verbose(
            `MsalCachePlugin: Error occurred when trying to read cache file, file contents will be cleared: ${e.message}`,
          );
          await fsPromises.unlink(this._msalFilePath);
        }
        this._logger.verbose(
          `MsalCachePlugin: Token read from cache successfully.`,
        );
      } catch (e) {
        if (e.code === "ENOENT") {
          // File doesn't exist, log and continue
          this._logger.verbose(
            `MsalCachePlugin: Cache file not found on disk: ${e.code}`,
          );
        } else {
          this._logger.error(
            `MsalCachePlugin: Failed to read from cache file, file contents will be cleared : ${e}`,
          );
          await fsPromises.unlink(this._msalFilePath);
        }
      } finally {
        lockFile.unlockSync(lockFilePath);
        this._lockTaken = false;
      }
    };

    const afterCacheAccess = async (
      cacheContext: TokenCacheContext,
    ): Promise<void> => {
      if (cacheContext.cacheHasChanged) {
        await this.waitAndLock(lockFilePath);
        try {
          const cache = cacheContext.tokenCache.serialize();
          const encryptedCache =
            await this._fileEncryptionHelper.fileSaver(cache);
          await fsPromises.writeFile(this._msalFilePath, encryptedCache, {
            encoding: "utf8",
          });
          this._logger.verbose(
            `MsalCachePlugin: Token written to cache successfully.`,
          );
        } catch (e) {
          this._logger.error(
            `MsalCachePlugin: Failed to write to cache file. ${e}`,
          );
          throw e;
        } finally {
          lockFile.unlockSync(lockFilePath);
          this._lockTaken = false;
        }
      }
    };

    // This is an implementation of ICachePlugin that uses the beforeCacheAccess and afterCacheAccess callbacks to read and write to a file
    // Ref https://docs.microsoft.com/en-us/azure/active-directory/develop/msal-node-migration#enable-token-caching
    // In future we should use msal-node-extensions to provide a secure storage of tokens, instead of implementing our own
    // However - as of now this library does not come with pre-compiled native libraries that causes runtime issues
    // Ref https://github.com/AzureAD/microsoft-authentication-library-for-js/issues/3332
    return {
      beforeCacheAccess,
      afterCacheAccess,
    };
  }

  private async waitAndLock(lockFilePath: string): Promise<void> {
    // Make 500 retry attempts with 100ms wait time between each attempt to allow enough time for the lock to be released.
    const retries = 500;
    const retryWait = 100;

    // We cannot rely on lockfile.lockSync() to clear stale lockfile,
    // so we check if the lockfile exists and if it does, calling unlockSync() will clear it.
    if (lockFile.checkSync(lockFilePath) && !this._lockTaken) {
      lockFile.unlockSync(lockFilePath);
      this._logger.verbose(
        `MsalCachePlugin: Stale lockfile found and has been removed.`,
      );
    }

    let retryAttempt = 0;
    while (retryAttempt <= retries) {
      try {
        // Use lockfile.lockSync() to ensure only one process is accessing the cache at a time.
        // lockfile.lock() does not wait for async callback promise to resolve.
        lockFile.lockSync(lockFilePath);
        this._lockTaken = true;
        break;
      } catch (e) {
        if (retryAttempt === retries) {
          this._logger.error(
            `MsalCachePlugin: Failed to acquire lock on cache file after ${retries} attempts.`,
          );
          throw new Error(
            `Failed to acquire lock on cache file after ${retries} attempts. Please try clearing Access token cache.`,
          );
        }
        retryAttempt++;
        this._logger.verbose(
          `MsalCachePlugin: Failed to acquire lock on cache file. Retrying in ${retryWait} ms.`,
        );

        await new Promise((resolve) => setTimeout(() => resolve, retryWait));
      }
    }
  }
}
