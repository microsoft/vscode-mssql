/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { CoreRPCs } from "./webview";

export interface ObjectExplorerFilterState {
    filterProperties: vscodeMssql.NodeFilterProperty[];
    existingFilters: vscodeMssql.NodeFilter[];
    isPreviewEnabled: boolean;
    filterScopeId: string;
    filterPresets: ObjectExplorerFilterPreset[];
    nodePath?: string;
}

export interface ObjectExplorerFilterPreset {
    id: string;
    name?: string;
    filters: vscodeMssql.NodeFilter[];
    isPinned: boolean;
    lastUsed: number;
}

export interface ObjectExplorerReducers {
    submit: {
        filters: vscodeMssql.NodeFilter[];
        saveName?: string;
    };
    setPresetPinned: {
        presetId: string;
        isPinned: boolean;
    };
    deletePreset: {
        presetId: string;
    };
    renamePreset: {
        presetId: string;
        name: string;
    };
    cancel: {};
}

export interface ObjectExplorerFilterContextProps extends CoreRPCs {
    submit: (filters: vscodeMssql.NodeFilter[], saveName?: string) => void;
    setPresetPinned: (presetId: string, isPinned: boolean) => void;
    deletePreset: (presetId: string) => void;
    renamePreset: (presetId: string, name: string) => void;
    cancel: () => void;
}

export enum NodeFilterPropertyDataType {
    String = 0,
    Number = 1,
    Boolean = 2,
    Date = 3,
    Choice = 4,
}

export enum NodeFilterOperator {
    Equals = 0,
    NotEquals = 1,
    LessThan = 2,
    LessThanOrEquals = 3,
    GreaterThan = 4,
    GreaterThanOrEquals = 5,
    Between = 6,
    NotBetween = 7,
    Contains = 8,
    NotContains = 9,
    StartsWith = 10,
    NotStartsWith = 11,
    EndsWith = 12,
    NotEndsWith = 13,
}

export interface ObjectExplorerPageFilter {
    index: number;
    name: string;
    displayName: string;
    value: string | string[] | number | number[] | boolean | undefined;
    type: NodeFilterPropertyDataType;
    choices?: {
        name: string;
        displayName: string;
    }[];
    operatorOptions: NodeFilterOperator[];
    selectedOperator: NodeFilterOperator;
    description: string;
}
