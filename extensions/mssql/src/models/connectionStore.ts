/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as ConnInfo from "./connectionInfo";
import * as Utils from "./utils";
import * as Contracts from "./contracts";
import ValidationException from "../utils/validationException";
import { ConnectionCredentials } from "./connectionCredentials";
import {
  IConnectionProfile,
  IConnectionCredentialsQuickPickItem,
  CredentialsQuickPickItemType,
  AuthenticationTypes,
  IConnectionProfileWithSource,
  IConnectionGroup,
} from "./interfaces";
import { ICredentialStore } from "../credentialstore/icredentialstore";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { IConnectionInfo } from "vscode-mssql";
import { Logger } from "./logger";
import { Deferred } from "../protocol";
import { ConnectionMatcher, MatchScore } from "./utils";
import { sendActionEvent } from "../telemetry/telemetry";
import {
  TelemetryActions,
  TelemetryViews,
} from "../sharedInterfaces/telemetry";

/**
 * Manages the connections list including saved profiles and the most recently used connections
 *
 * @export
 * @class ConnectionStore
 */
export class ConnectionStore {
  /**
   * Map to store password for connections where savePassword is false for the session.
   * For connections with savePassword = true, the password will be saved to the credential
   * store.
   */
  private _sessionPasswords: Map<string, string> = new Map();
  constructor(
    private _context: vscode.ExtensionContext,
    private _credentialStore: ICredentialStore,
    private _logger?: Logger,
    private _connectionConfig?: ConnectionConfig,
    private _vscodeWrapper?: VscodeWrapper,
  ) {
    if (!this.vscodeWrapper) {
      this.vscodeWrapper = new VscodeWrapper();
    }

    if (!this._logger) {
      this._logger = Logger.create(
        this.vscodeWrapper.outputChannel,
        "ConnectionStore",
      );
    }

    if (!this._connectionConfig) {
      this._connectionConfig = new ConnectionConfig(this.vscodeWrapper);
    }
  }

  public get initialized(): Deferred<void> {
    return this._connectionConfig.initialized;
  }

  public static get CRED_PREFIX(): string {
    return "Microsoft.SqlTools";
  }
  public static get CRED_SEPARATOR(): string {
    return "|";
  }
  public static get CRED_SERVER_PREFIX(): string {
    return "server:";
  }
  public static get CRED_DB_PREFIX(): string {
    return "db:";
  }
  public static get CRED_USER_PREFIX(): string {
    return "user:";
  }
  public static get CRED_ITEMTYPE_PREFIX(): string {
    return "itemtype:";
  }
  public static get CRED_CONNECTION_STRING_PREFIX(): string {
    return "isConnectionString:";
  }
  public static get CRED_PROFILE_PREFIX(): string {
    return "profile_id:";
  }
  public static get CRED_PROFILE_USER(): string {
    return CredentialsQuickPickItemType[CredentialsQuickPickItemType.Profile];
  }
  public static get CRED_MRU_USER(): string {
    return CredentialsQuickPickItemType[CredentialsQuickPickItemType.Mru];
  }

  public static get shouldSavePasswordUntilRestart(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>(Constants.configSavePasswordsUntilRestart);
  }

  public static formatCredentialIdForCred(
    creds: IConnectionInfo,
    itemType?: CredentialsQuickPickItemType,
  ): string {
    if (Utils.isEmpty(creds)) {
      throw new ValidationException("Missing Connection which is required");
    }
    let itemTypeString: string = ConnectionStore.CRED_PROFILE_USER;
    if (itemType) {
      itemTypeString = CredentialsQuickPickItemType[itemType];
    }

    // Use profile ID as key if available for saved profiles
    const profile = creds as IConnectionProfile;
    if (profile.id) {
      return ConnectionStore.formatCredentialIdFromProfileId(
        profile.id,
        itemTypeString,
      );
    }

    return ConnectionStore.formatCredentialId(
      creds.server,
      creds.database,
      creds.user,
      itemTypeString,
    );
  }

  /**
   * Creates a credential ID using profile ID instead of connection details
   * @param profileId The connection profile ID
   * @param itemType The item type string
   * @returns formatted credential ID
   */
  public static formatCredentialIdFromProfileId(
    profileId: string,
    itemType: string = ConnectionStore.CRED_PROFILE_USER,
  ): string {
    let cred: string[] = [ConnectionStore.CRED_PREFIX];
    ConnectionStore.pushIfNonEmpty(
      profileId,
      ConnectionStore.CRED_PROFILE_PREFIX,
      cred,
    );
    ConnectionStore.pushIfNonEmpty(
      itemType,
      ConnectionStore.CRED_ITEMTYPE_PREFIX,
      cred,
    );
    return cred.join(ConnectionStore.CRED_SEPARATOR);
  }

  /**
   * Creates a formatted credential usable for uniquely identifying a SQL Connection.
   * This string can be decoded but is not optimized for this.
   * @deprecated Use formatCredentialIdForCred instead.
   * @param server name of the server - required
   * @param database name of the database - optional
   * @param user name of the user - optional
   * @param itemType type of the item (MRU or Profile) - optional
   * @returns formatted string with server, DB and username
   */
  public static formatCredentialId(
    server: string,
    database?: string,
    user?: string,
    itemType?: string,
    isConnectionString?: boolean,
  ): string {
    if (Utils.isEmpty(server) && !isConnectionString) {
      throw new ValidationException("Missing Server Name, which is required");
    }
    let cred: string[] = [ConnectionStore.CRED_PREFIX];
    if (!itemType) {
      itemType = ConnectionStore.CRED_PROFILE_USER;
    }

    ConnectionStore.pushIfNonEmpty(
      itemType,
      ConnectionStore.CRED_ITEMTYPE_PREFIX,
      cred,
    );
    ConnectionStore.pushIfNonEmpty(
      server,
      ConnectionStore.CRED_SERVER_PREFIX,
      cred,
    );
    ConnectionStore.pushIfNonEmpty(
      database,
      ConnectionStore.CRED_DB_PREFIX,
      cred,
    );
    ConnectionStore.pushIfNonEmpty(
      user,
      ConnectionStore.CRED_USER_PREFIX,
      cred,
    );
    if (isConnectionString) {
      ConnectionStore.pushIfNonEmpty(
        "true",
        ConnectionStore.CRED_CONNECTION_STRING_PREFIX,
        cred,
      );
    }

    return cred.join(ConnectionStore.CRED_SEPARATOR);
  }

  public get connectionConfig(): ConnectionConfig {
    return this._connectionConfig;
  }

  private static pushIfNonEmpty(
    value: string,
    prefix: string,
    arr: string[],
  ): void {
    if (Utils.isNotEmpty(value)) {
      arr.push(prefix.concat(value));
    }
  }

  private get vscodeWrapper(): VscodeWrapper {
    return this._vscodeWrapper;
  }

  private set vscodeWrapper(value: VscodeWrapper) {
    this._vscodeWrapper = value;
  }

  /**
   * Load connections from MRU and profile list and return them as a formatted picklist.
   * Note: connections will not include password value
   *
   * @returns
   */
  public async getPickListItems(): Promise<
    IConnectionCredentialsQuickPickItem[]
  > {
    let pickListItems: IConnectionCredentialsQuickPickItem[] =
      await this.getConnectionQuickpickItems(false);
    pickListItems.push(<IConnectionCredentialsQuickPickItem>{
      label: `$(add) ${LocalizedConstants.CreateProfileFromConnectionsListLabel}`,
      connectionCreds: undefined,
      quickPickItemType: CredentialsQuickPickItemType.NewConnection,
    });
    return pickListItems;
  }

  /**
   * Gets all connection profiles stored in the user settings
   * Note: connections will not include password value
   *
   * @returns
   */
  public async getProfilePickListItems(
    getWorkspaceProfiles: boolean,
  ): Promise<IConnectionCredentialsQuickPickItem[]> {
    return await this.loadProfiles(getWorkspaceProfiles);
  }

  public async addSavedPassword(
    credentialsItem: IConnectionCredentialsQuickPickItem,
  ): Promise<IConnectionCredentialsQuickPickItem> {
    let self = this;
    if (
      typeof credentialsItem.connectionCreds["savePassword"] === "undefined" ||
      credentialsItem.connectionCreds["savePassword"] === false
    ) {
      // Don't try to lookup a saved password if savePassword is set to false for the credential
      return credentialsItem;
      // Note that 'emptyPasswordInput' property is only present for connection profiles
    } else if (
      self.shouldLookupSavedPassword(
        <IConnectionProfile>credentialsItem.connectionCreds,
      )
    ) {
      let credentialId = ConnectionStore.formatCredentialIdForCred(
        credentialsItem.connectionCreds,
        credentialsItem.quickPickItemType,
      );
      const savedCred =
        await self._credentialStore.readCredential(credentialId);
      if (savedCred) {
        credentialsItem.connectionCreds.password = savedCred.password;
        return credentialsItem;
      } else {
        throw new Error("No saved password found");
      }
    } else {
      // Already have a password, no need to look up
      return credentialsItem;
    }
  }

  /**
   * Lookup password in credential store.
   * @param connectionCredentials Connection credentials of profile for password lookup
   * @param isConnectionString Whether this is a connection string lookup
   */
  public async lookupPassword(
    connectionCredentials: IConnectionInfo,
    isConnectionString: boolean = false,
  ): Promise<string> {
    const profile = connectionCredentials as IConnectionProfile;
    let savedCredential: Contracts.Credential;

    // Generate credential ID using profile's id (new format)
    const credentialId = ConnectionStore.formatCredentialIdForCred(
      profile,
      CredentialsQuickPickItemType.Profile,
    );

    // First, try to get password from session storage for non-saved passwords
    if (
      !profile.savePassword &&
      ConnectionStore.shouldSavePasswordUntilRestart
    ) {
      const sessionPassword = this._sessionPasswords.get(credentialId);
      if (sessionPassword) {
        return sessionPassword;
      }
    }

    // We try to read from the credential store with the new format id
    savedCredential = await this._credentialStore.readCredential(credentialId);
    if (savedCredential && savedCredential.password) {
      sendActionEvent(
        TelemetryViews.Connection,
        TelemetryActions.LookupPassword,
        {
          isNewFormat: true.toString(),
          passwordFound: true.toString(),
        },
      );
      return savedCredential.password;
    }

    // If no password was found, fallback to legacy format and see if credential exists
    const legacyCredentialId = ConnectionStore.formatCredentialId(
      connectionCredentials.server,
      connectionCredentials.database,
      connectionCredentials.user,
      ConnectionStore.CRED_PROFILE_USER,
      isConnectionString,
    );

    // We try to read from the credential store with the legacy format id
    const legacyCredential =
      await this._credentialStore.readCredential(legacyCredentialId);
    if (legacyCredential && legacyCredential.password) {
      sendActionEvent(
        TelemetryViews.Connection,
        TelemetryActions.LookupPassword,
        {
          isNewFormat: false.toString(),
          passwordFound: true.toString(),
        },
      );
      return legacyCredential.password;
    }

    // Send telemetry event if password was not found for connections with savePassword enabled
    if (profile?.savePassword) {
      sendActionEvent(
        TelemetryViews.Connection,
        TelemetryActions.LookupPassword,
        {
          passwordFound: false.toString(),
        },
      );
    }
    return undefined;
  }

  /**
   * Store password in session storage for connections that don't save passwords
   * @param connectionCredentials Connection credentials
   * @param password Password to store
   */
  public storeSessionPassword(
    connectionCredentials: IConnectionInfo,
    password: string,
  ): void {
    if (ConnectionStore.shouldSavePasswordUntilRestart) {
      const sessionKey = ConnectionStore.formatCredentialIdForCred(
        connectionCredentials,
      );
      this._sessionPasswords.set(sessionKey, password);
    }
  }

  /**
   * public for testing purposes. Validates whether a password should be looked up from the credential store or not
   *
   * @param connectionCreds
   * @returns
   * @memberof ConnectionStore
   */
  public shouldLookupSavedPassword(
    connectionCreds: IConnectionProfile,
  ): boolean {
    if (ConnectionCredentials.isPasswordBasedCredential(connectionCreds)) {
      // Only lookup if password isn't saved in the profile, and if it was not explicitly defined
      // as a blank password
      return (
        Utils.isEmpty(connectionCreds.password) &&
        !connectionCreds.emptyPasswordInput
      );
    }
    return false;
  }

  /**
   * Saves a connection profile to the user settings.
   * Password values are stored to a separate credential store if the "savePassword" option is true
   *
   * @param profile the profile to save
   * @param whether the plaintext password should be written to the settings file
   * @returns a Promise that returns the original profile, for help in chaining calls
   */
  public async saveProfile(
    profile: IConnectionProfile,
    forceWritePlaintextPassword?: boolean,
  ): Promise<IConnectionProfile> {
    await this._connectionConfig.populateMissingConnectionIds(profile);

    // Add the profile to the saved list, taking care to clear out the password field if necessary
    let savedProfile: IConnectionProfile;
    if (
      profile.authenticationType ===
      Utils.authTypeToString(AuthenticationTypes.AzureMFA)
    ) {
      savedProfile = Object.assign({}, profile, {
        azureAccountToken: "",
      });
    } else {
      if (forceWritePlaintextPassword) {
        savedProfile = Object.assign({}, profile);
      } else {
        savedProfile = Object.assign({}, profile, { password: "" });
      }
    }

    await this._connectionConfig.addConnection(savedProfile);

    if (await this.saveProfilePasswordIfNeeded(profile)) {
      ConnInfo.fixupConnectionCredentials(profile);
    }
    return profile;
  }

  /**
   * Gets the list of recently used connections. These will not include the password - a separate call to
   * {addSavedPassword} is needed to fill that before connecting
   *
   * @returns the array of connections, empty if none are found
   */
  public getRecentlyUsedConnections(): IConnectionInfo[] {
    let configValues = this._context.globalState.get<IConnectionInfo[]>(
      Constants.configRecentConnections,
    );
    if (!configValues) {
      configValues = [];
    }
    return configValues;
  }

  /**
   * Adds a connection to the recently used list.
   * Password values are stored to a separate credential store if the "savePassword" option is true
   *
   * @param conn the connection to add
   * @returns a Promise that returns when the connection was saved
   */
  public addRecentlyUsed(conn: IConnectionInfo): Promise<void> {
    const self = this;
    return new Promise<void>((resolve, reject) => {
      // Get all profiles
      let configValues = self.getRecentlyUsedConnections();
      let maxConnections = self.getMaxRecentConnectionsCount();

      // Remove the connection from the list if it already exists
      configValues = configValues.filter(
        (value) =>
          !Utils.isSameProfile(
            <IConnectionProfile>value,
            <IConnectionProfile>conn,
          ),
      );

      // Add the connection to the front of the list, taking care to clear out the password field
      let savedConn: IConnectionInfo = Object.assign({}, conn, {
        password: "",
      });
      configValues.unshift(savedConn);

      // Remove last element if needed
      if (configValues.length > maxConnections) {
        configValues = configValues.slice(0, maxConnections);
      }

      self._context.globalState
        .update(Constants.configRecentConnections, configValues)
        .then(
          async () => {
            // Only save if we successfully added the profile and if savePassword
            if ((<IConnectionProfile>conn).savePassword) {
              await self.doSaveCredential(
                conn,
                CredentialsQuickPickItemType.Mru,
              );
            }
            // And resolve / reject at the end of the process
            resolve(undefined);
          },
          (err) => {
            reject(err);
          },
        );
    });
  }

  /**
   * Clear all recently used connections from the MRU list.
   * @returns a boolean value indicating whether the credentials were deleted successfully.
   */
  public async clearRecentlyUsed(): Promise<boolean> {
    // Get all recent connection profiles and delete the associated credentials.
    const mruList = this.getRecentlyUsedConnections();
    let deleteCredentialSuccess = true;
    for (const connection of mruList) {
      const credentialId = ConnectionStore.formatCredentialId(
        connection.server,
        connection.database,
        connection.user,
        ConnectionStore.CRED_MRU_USER,
      );
      try {
        await this._credentialStore.deleteCredential(credentialId);
      } catch (err) {
        deleteCredentialSuccess = false;
        this._logger.log(
          LocalizedConstants.deleteCredentialError,
          credentialId,
          err,
        );
      }
    }
    // Update the MRU list to be empty
    await this._context.globalState.update(
      Constants.configRecentConnections,
      [],
    );
    return deleteCredentialSuccess;
  }

  /**
   * Remove a connection profile from the recently used list.
   * @param conn connection profile to remove
   * @param keepCredentialStore Whether keep the credential store after a profile removal.  Defaults to false.
   */
  public removeRecentlyUsed(
    conn: IConnectionProfile,
    keepCredentialStore: boolean = false,
  ): Promise<void> {
    const self = this;
    return new Promise<void>(async (resolve, reject) => {
      // Get all profiles
      let configValues = self.getRecentlyUsedConnections();

      // Remove the connection from the list if it already exists
      configValues = configValues.filter(
        (value) => !Utils.isSameProfile(<IConnectionProfile>value, conn),
      );

      // Remove any saved password
      if (conn.savePassword && !keepCredentialStore) {
        let credentialId = ConnectionStore.formatCredentialId(
          conn.server,
          conn.database,
          conn.user,
          ConnectionStore.CRED_MRU_USER,
        );
        await self._credentialStore.deleteCredential(credentialId);
      }

      // Update the MRU list
      self._context.globalState
        .update(Constants.configRecentConnections, configValues)
        .then(
          () => {
            // And resolve / reject at the end of the process
            resolve(undefined);
          },
          (err) => {
            reject(err);
          },
        );
    });
  }

  public async saveProfilePasswordIfNeeded(
    profile: IConnectionProfile,
  ): Promise<boolean> {
    return await this.doSaveCredential(
      profile,
      CredentialsQuickPickItemType.Profile,
    );
  }

  public async saveProfileWithConnectionString(
    profile: IConnectionProfile,
  ): Promise<boolean> {
    if (!profile.connectionString) {
      return Promise.resolve(true);
    }
    return await this.doSaveCredential(
      profile,
      CredentialsQuickPickItemType.Profile,
      true,
    );
  }

  private async doSaveCredential(
    conn: IConnectionInfo,
    type: CredentialsQuickPickItemType,
    isConnectionString: boolean = false,
  ): Promise<boolean> {
    let password = isConnectionString ? conn.connectionString : conn.password;

    if (Utils.isEmpty(password)) {
      return true;
    }

    const profile = conn as IConnectionProfile;

    let legacyCredentialId = ConnectionStore.formatCredentialId(
      profile.server,
      profile.database,
      profile.user,
      ConnectionStore.CRED_PROFILE_USER,
    );

    if (profile.id) {
      // Delete legacy credential
      try {
        await this._credentialStore.deleteCredential(legacyCredentialId);
      } catch {
        // Ignore errors for legacy cleanup
      }
    }

    let credentialId = ConnectionStore.formatCredentialIdForCred(profile, type);
    if (profile.savePassword) {
      return await this._credentialStore.saveCredential(credentialId, password);
    } else {
      if (ConnectionStore.shouldSavePasswordUntilRestart) {
        await this.storeSessionPassword(profile, password);
      }
      return true;
    }
  }

  /**
   * Removes a profile from the user settings and deletes any related password information
   * from the credential store
   *
   * @param profile the profile to be removed
   * @param keepCredentialStore Whether to keep the credential store after a profile removal. Defaults to false.
   * @returns true if successful
   */
  public async removeProfile(
    profile: IConnectionProfile,
    keepCredentialStore: boolean = false,
  ): Promise<boolean> {
    let profileFound = await this._connectionConfig.removeConnection(profile);
    if (profileFound) {
      // Remove the profile from the recently used list if necessary
      await this.removeRecentlyUsed(profile, keepCredentialStore);

      // Now remove password from credential store. Currently do not care about status unless an error occurred
      if (profile.savePassword === true && !keepCredentialStore) {
        await this.deleteCredential(profile);
      }

      return profileFound;
    }
  }

  private createQuickPickItem(
    item: IConnectionInfo,
    itemType: CredentialsQuickPickItemType,
  ): IConnectionCredentialsQuickPickItem {
    return <IConnectionCredentialsQuickPickItem>{
      label: ConnInfo.getSimpleConnectionDisplayName(item),
      description: ConnInfo.getPicklistDescription(item),
      detail: ConnInfo.getPicklistDetails(item),
      connectionCreds: item,
      quickPickItemType: itemType,
    };
  }

  /**
   * Deletes the password for a connection from the credential store
   * @param profile Connection profile
   */
  public async deleteCredential(profile: IConnectionProfile): Promise<void> {
    let credentialId: string;

    // Use profile ID if available

    credentialId = ConnectionStore.formatCredentialIdForCred(profile);
    await this._credentialStore.deleteCredential(credentialId);

    // Also try to delete legacy format if using profile ID
    if (profile.id) {
      const legacyCredentialId = ConnectionStore.formatCredentialId(
        profile.server,
        profile.database,
        profile.user,
        ConnectionStore.CRED_PROFILE_USER,
      );
      try {
        await this._credentialStore.deleteCredential(legacyCredentialId);
      } catch {
        // Ignore errors for legacy cleanup
      }
    }
  }

  /**
   * Removes password from a saved profile and credential store
   */
  public async removeProfilePassword(
    connection: IConnectionInfo,
  ): Promise<void> {
    // if the password is saved in the credential store, remove it
    let profile = connection as IConnectionProfile;
    profile.password = "";
    await this.saveProfile(profile);
  }

  public async readAllConnectionGroups(): Promise<IConnectionGroup[]> {
    const groups = await this._connectionConfig.getGroups();
    return groups;
  }

  public async getGroupForConnectionId(
    connectionId: string,
  ): Promise<IConnectionGroup | undefined> {
    const connProfile =
      await this._connectionConfig.getConnectionById(connectionId);
    if (connProfile) {
      return this._connectionConfig.getGroupById(connProfile.groupId);
    }
    return undefined;
  }

  public async readAllConnections(
    includeRecentConnections: boolean = false,
  ): Promise<IConnectionProfileWithSource[]> {
    let connResults: IConnectionProfileWithSource[] = [];

    const connections = await this._connectionConfig.getConnections(true);

    const configConnections = connections.map((c) => {
      const conn = c as IConnectionProfileWithSource;
      conn.profileSource = CredentialsQuickPickItemType.Profile;
      return conn;
    });

    connResults = connResults.concat(configConnections);

    // Include recent connections, if specified
    if (includeRecentConnections) {
      const recentConnections = this.getRecentlyUsedConnections().map((c) => {
        const conn = c as IConnectionProfileWithSource;
        conn.profileSource = CredentialsQuickPickItemType.Mru;
        return conn;
      });

      connResults = connResults.concat(recentConnections);
    }

    // Deduplicate connections by ID
    const uniqueConnections = new Map<string, IConnectionProfileWithSource>();
    let dupeCount = 0;

    for (const conn of connResults) {
      if (!uniqueConnections.has(conn.id)) {
        uniqueConnections.set(conn.id, conn);
      } else {
        dupeCount++;
        this._logger.verbose(
          `Duplicate connection ID found: ${conn.id}. Ignoring duplicate connection.`,
        );
      }
    }

    connResults = Array.from(uniqueConnections.values());

    let logMessage = `readAllConnections(): ${connResults.length} connections found`;

    if (includeRecentConnections) {
      logMessage += ` (${configConnections.length} from config, ${connResults.length - configConnections.length} from recent)`;
    } else {
      logMessage += "; excluded recent";
    }

    if (dupeCount > 0) {
      logMessage += `; ${dupeCount} duplicate connections ignored`;
    }

    this._logger.logDebug(logMessage);

    return connResults;
  }

  /**
   * Finds the closest-matching profile from the saved connections for the given partial connection profile
   * @param connProfile partial connection profile to match against
   * @returns closest-matching connection profile from the saved connections. If none is found, returns {score: MatchScore.NotMatch}
   */
  public async findMatchingProfile(
    connProfile: IConnectionProfile,
  ): Promise<{ profile: IConnectionProfile; score: MatchScore }> {
    const savedConnections = await this.readAllConnections();

    return ConnectionMatcher.findMatchingProfile(connProfile, savedConnections);
  }

  /** Gets the groupId for connections  */
  public get rootGroupId(): string {
    return this.connectionConfig.getRootGroup().id;
  }

  public async getConnectionQuickpickItems(
    includeRecentConnections: boolean = false,
  ): Promise<IConnectionCredentialsQuickPickItem[]> {
    let output: IConnectionCredentialsQuickPickItem[] = [];
    const connections = await this.readAllConnections(includeRecentConnections);

    output = connections.map((c) => {
      return this.createQuickPickItem(c, c.profileSource);
    });

    return output;
  }

  private async loadProfiles(
    loadWorkspaceProfiles: boolean,
  ): Promise<IConnectionCredentialsQuickPickItem[]> {
    let connections: IConnectionProfile[] =
      await this._connectionConfig.getConnections(loadWorkspaceProfiles);
    let quickPickItems = connections.map((c) =>
      this.createQuickPickItem(c, CredentialsQuickPickItemType.Profile),
    );
    return quickPickItems;
  }

  private getMaxRecentConnectionsCount(): number {
    let config = this._vscodeWrapper.getConfiguration(
      Constants.extensionConfigSectionName,
    );

    let maxConnections: number = config[Constants.configMaxRecentConnections];
    if (typeof maxConnections !== "number" || maxConnections <= 0) {
      maxConnections = 5;
    }
    return maxConnections;
  }
}
