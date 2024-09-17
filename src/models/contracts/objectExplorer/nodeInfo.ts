/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";

/**
 * Information describing a Node in the Object Explorer tree.
 * Contains information required to display the Node to the user and
 * to know whether actions such as expanding children is possible
 * the node
 */
export class NodeInfo {
    /**
     * Path identifying this node: for example a table will be at ["server", "database", "tables", "tableName"].
     * This enables rapid navigation of the tree without the need for a global registry of elements.
     * The path functions as a unique ID and is used to disambiguate the node when sending requests for expansion.
     * A common ID is needed since processes do not share address space and need a unique identifier
     */
    public nodePath: string;

    /**
     * The type of node - for example Server, Database, Folder, Table
     */
    public nodeType: string;

    /**
     * Label to display to the user, describing this node
     */
    public label: string;

    /**
     * Node sub type - for example a key can have type as "Key" and sub type as "PrimaryKey"
     */
    public nodeSubType: string;

    /**
     * Node status - for example logic can be disabled/enabled
     */
    public nodeStatus: string;

    /**
     * Is this a leaf node (no children) or is it expandable
     */
    public isLeaf: boolean;

    /**
     * Error message returned from the engine for a object explorer node failure reason, if any.
     */
    public errorMessage: string;

    /**
     * Object metadata about the node
     */
    public metadata: vscodeMssql.ObjectMetadata;

    /**
     * Filterable properties that this node supports
     */
    filterableProperties?: vscodeMssql.NodeFilterProperty[];

    /**
     * Object type of the node. In case of folder nodes, this will be the type of objects that are present in the folder
     */
    objectType?: string;

    /**
     * Parent node path. This is used to identify the parent node of the current node
     */
    parentNodePath?: string;
}
