/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";

export enum SchemaDesignerDefinitionFormat {
    TSql = "tsql",
    Prisma = "prisma",
    Sequelize = "sequelize",
    TypeOrm = "typeorm",
    DrizzleOrm = "drizzleOrm",
    SqlAlchemy = "sqlalchemy",
    EfCore = "efcore",
}

export const schemaDesignerDefinitionFormats: SchemaDesignerDefinitionFormat[] = [
    SchemaDesignerDefinitionFormat.TSql,
    SchemaDesignerDefinitionFormat.Prisma,
    SchemaDesignerDefinitionFormat.Sequelize,
    SchemaDesignerDefinitionFormat.TypeOrm,
    SchemaDesignerDefinitionFormat.DrizzleOrm,
    SchemaDesignerDefinitionFormat.SqlAlchemy,
    SchemaDesignerDefinitionFormat.EfCore,
];

const schemaDesignerDefinitionFormatDetails: Record<
    SchemaDesignerDefinitionFormat,
    {
        language: string;
        getLabel: (schemaDesignerLoc: typeof locConstants.schemaDesigner) => string;
    }
> = {
    [SchemaDesignerDefinitionFormat.TSql]: {
        language: "sql",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatTsql,
    },
    [SchemaDesignerDefinitionFormat.Prisma]: {
        language: "prisma",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatPrisma,
    },
    [SchemaDesignerDefinitionFormat.Sequelize]: {
        language: "typescript",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatSequelize,
    },
    [SchemaDesignerDefinitionFormat.TypeOrm]: {
        language: "typescript",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatTypeOrm,
    },
    [SchemaDesignerDefinitionFormat.DrizzleOrm]: {
        language: "typescript",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatDrizzleOrm,
    },
    [SchemaDesignerDefinitionFormat.SqlAlchemy]: {
        language: "python",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatSqlAlchemy,
    },
    [SchemaDesignerDefinitionFormat.EfCore]: {
        language: "csharp",
        getLabel: (schemaDesignerLoc) => schemaDesignerLoc.definitionFormatEfCore,
    },
};

export function getSchemaDesignerDefinitionLanguage(
    format: SchemaDesignerDefinitionFormat,
): string {
    return schemaDesignerDefinitionFormatDetails[format].language;
}

export function getSchemaDesignerDefinitionFormatLabel(
    format: SchemaDesignerDefinitionFormat,
    schemaDesignerLoc: typeof locConstants.schemaDesigner,
): string {
    return schemaDesignerDefinitionFormatDetails[format].getLabel(schemaDesignerLoc);
}
