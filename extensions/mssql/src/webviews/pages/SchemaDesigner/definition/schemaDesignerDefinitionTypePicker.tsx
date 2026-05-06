/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import {
    ResponsiveOptionPicker,
    ResponsiveOptionPickerOption,
} from "../../../common/responsiveOptionPicker";
import { locConstants } from "../../../common/locConstants";
import { useSchemaDesignerDefinitionPanelContext } from "./schemaDesignerDefinitionPanelContext";
import { SchemaDesignerDefinitionKind } from "../../../../sharedInterfaces/schemaDesignerDefinitionOutput";

export const SchemaDesignerDefinitionTypePicker = () => {
    const { selectedDefinitionKind, setSelectedDefinitionKind } =
        useSchemaDesignerDefinitionPanelContext();

    const options = useMemo<ResponsiveOptionPickerOption<SchemaDesignerDefinitionKind>[]>(
        () => [
            {
                value: SchemaDesignerDefinitionKind.Sql,
                label: locConstants.schemaDesigner.definitionTypeSql,
            },
            {
                value: SchemaDesignerDefinitionKind.Prisma,
                label: locConstants.schemaDesigner.definitionTypePrisma,
            },
            {
                value: SchemaDesignerDefinitionKind.Sequelize,
                label: locConstants.schemaDesigner.definitionTypeSequelize,
            },
            {
                value: SchemaDesignerDefinitionKind.TypeOrm,
                label: locConstants.schemaDesigner.definitionTypeTypeOrm,
            },
            {
                value: SchemaDesignerDefinitionKind.Drizzle,
                label: locConstants.schemaDesigner.definitionTypeDrizzle,
            },
            {
                value: SchemaDesignerDefinitionKind.SqlAlchemy,
                label: locConstants.schemaDesigner.definitionTypeSqlAlchemy,
            },
            {
                value: SchemaDesignerDefinitionKind.EfCore,
                label: locConstants.schemaDesigner.definitionTypeEfCore,
            },
        ],
        [],
    );

    return (
        <ResponsiveOptionPicker
            ariaLabel={locConstants.schemaDesigner.definitionType}
            options={options}
            selectedValue={selectedDefinitionKind}
            onValueChange={setSelectedDefinitionKind}
        />
    );
};
