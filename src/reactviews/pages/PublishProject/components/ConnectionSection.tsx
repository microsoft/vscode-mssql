/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { Field, Input } from "@fluentui/react-components";
import { FormItemType } from "../../../../sharedInterfaces/form";
import type { IPublishForm } from "../../../../sharedInterfaces/publishDialog";

export const ConnectionSection: React.FC = () => {
    const publishCtx = useContext(PublishProjectContext);
    const serverComponent = usePublishDialogSelector((s) => s.formComponents.serverName);
    const databaseComponent = usePublishDialogSelector((s) => s.formComponents.databaseName);
    const serverValue = usePublishDialogSelector((s) => s.formState.serverName);
    const databaseValue = usePublishDialogSelector((s) => s.formState.databaseName);

    const [localServer, setLocalServer] = useState(serverValue || "");
    const [localDatabase, setLocalDatabase] = useState(databaseValue || "");

    useEffect(() => setLocalServer(serverValue || ""), [serverValue]);
    useEffect(() => setLocalDatabase(databaseValue || ""), [databaseValue]);

    if (!publishCtx) {
        return undefined;
    }

    const renderInput = (
        component:
            | {
                  propertyName: string;
                  hidden?: boolean;
                  required?: boolean;
                  label: string;
                  placeholder?: string;
                  validation?: { isValid: boolean; validationMessage?: string };
                  type: FormItemType;
              }
            | undefined,
        value: string,
        setValue: (v: string) => void,
    ) => {
        if (!component || component.hidden) {
            return undefined;
        }
        if (component.type !== FormItemType.Input) {
            return undefined;
        }
        return (
            <Field
                key={component.propertyName}
                required={component.required}
                label={<span dangerouslySetInnerHTML={{ __html: component.label }} />}
                validationMessage={component.validation?.validationMessage}
                validationState={
                    component.validation
                        ? component.validation.isValid
                            ? "none"
                            : "error"
                        : "none"
                }
                orientation="horizontal">
                <Input
                    size="small"
                    value={value}
                    placeholder={component.placeholder ?? ""}
                    onChange={(_, data) => {
                        setValue(data.value);
                        publishCtx.formAction({
                            propertyName: component.propertyName as keyof IPublishForm,
                            isAction: false,
                            value: data.value,
                        });
                    }}
                />
            </Field>
        );
    };

    return (
        <>
            {renderInput(serverComponent, localServer, setLocalServer)}
            {renderInput(databaseComponent, localDatabase, setLocalDatabase)}
        </>
    );
};
