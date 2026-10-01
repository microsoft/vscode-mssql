/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Curated system catalog / DMV surface for the inline-completion schema
 * context. The DATA now lives in src/sqlLanguage/data/systemObjectCatalog
 * (single source — the native language service resolves sys/
 * INFORMATION_SCHEMA names from it, and sqlLanguage/data is import-pure so
 * the dependency must point this way); this module re-exports the copilot
 * surface unchanged. engineEditionDisplayName stays here: it is prompt
 * display text, not catalog data.
 */

export type {
    CuratedSystemObject,
    SystemObjectScope,
} from "../sqlLanguage/data/systemObjectCatalog";
export {
    curatedSystemObjects,
    selectCuratedSystemObjects,
} from "../sqlLanguage/data/systemObjectCatalog";

/** Engine-edition display names, from the query's CASE mapping. */
export function engineEditionDisplayName(engineEdition: number | undefined): string | undefined {
    switch (engineEdition) {
        case 2:
            return "SQL Server Standard/Enterprise (or other on-premises edition)";
        case 3:
            return "SQL Server Enterprise";
        case 4:
            return "SQL Server Express";
        case 5:
            return "Azure SQL Database";
        case 6:
            return "Azure Synapse dedicated SQL pool / Fabric Data Warehouse";
        case 8:
            return "Azure SQL Managed Instance";
        case 9:
            return "Azure SQL Edge";
        case 11:
            return "Azure Synapse serverless SQL pool / Microsoft Fabric";
        case 12:
            return "Fabric SQL Database";
        default:
            return engineEdition === undefined
                ? undefined
                : `Unknown engine edition ${engineEdition}`;
    }
}
