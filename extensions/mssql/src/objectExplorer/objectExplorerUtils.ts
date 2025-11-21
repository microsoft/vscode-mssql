/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { IConnectionProfile } from "../models/interfaces";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as vscodeMssql from "vscode-mssql";
import { TreeNodeType } from "./nodes/connectTreeNode";
import { IconUtils } from "../utils/iconUtils";

export class ObjectExplorerUtils {
  /**
   * Gets the path to the icon for a given node type.
   * @param nodeType The type of node to get the icon for
   * @returns The path to the icon for the node type
   */
  public static iconPath(nodeType: string): vscode.Uri | undefined {
    return IconUtils.getIcon("objectTypes", `${nodeType}.svg`);
  }

  public static getNodeUri(node: TreeNodeType): string {
    let profile: IConnectionProfile;
    if (node instanceof TreeNodeInfo) {
      profile = node.connectionProfile;
    } else {
      if (node.parentNode) {
        profile = node.parentNode.connectionProfile;
      }
    }
    if (profile === undefined) {
      return "";
    }
    return ObjectExplorerUtils.getNodeUriFromProfile(profile);
  }

  // TODO: this function emulates one in STS; replace with call to STS to avoid mixups
  public static getNodeUriFromProfile(profile: IConnectionProfile): string {
    let uri: string;
    if (profile.connectionString) {
      let fields = profile.connectionString
        .split(";")
        .filter((s) => !s.toLowerCase().includes("password"));
      uri = fields.join(";");
      return uri;
    }
    if (profile.authenticationType === Constants.sqlAuthentication) {
      uri = `${profile.server}_${profile.database}_${profile.user}_${profile.profileName}`;
    } else {
      uri = `${profile.server}_${profile.database}_${profile.profileName}`;
    }
    return uri;
  }

  /**
   * Gets the database name for the node - which is the database name of the connection for a server node, the database name
   * for nodes at or under a database node or a default value if it's neither of those.
   * @param node The node to get the database name of
   * @returns The database name
   */
  public static getDatabaseName(node: vscodeMssql.ITreeNodeInfo): string {
    // We're on a server node so just use the database directly from the connection string
    if (
      node.nodeType === Constants.serverLabel ||
      node.nodeType === Constants.disconnectedServerNodeType
    ) {
      return node.connectionProfile.database;
    }
    // Otherwise find the name from the node metadata - going up through the parents of the node
    // until we find the database node (so anything under a database node will get the name of
    // the database it's nested in)
    while (node) {
      if (node.metadata) {
        if (node.metadata.metadataTypeName === Constants.databaseString) {
          return node.metadata.name;
        }
      }
      node = node.parentNode;
    }
    return LocalizedConstants.defaultDatabaseLabel;
  }

  public static isFirewallError(errorCode: number): boolean {
    return errorCode === Constants.errorFirewallRule;
  }

  public static getQualifiedName(node: TreeNodeInfo): string {
    let objectString = "";
    if (node.metadata) {
      switch (node.metadata.metadataTypeName) {
        case "Table":
        case "StoredProcedure":
        case "View":
        case "UserDefinedFunction":
          objectString = `[${node.metadata.schema}].[${node.metadata.name}]`;
          break;
        default:
          objectString = `[${node.metadata.name}]`;
          break;
      }
    }
    return objectString;
  }
}
