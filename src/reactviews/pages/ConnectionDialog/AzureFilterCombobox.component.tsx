/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, makeStyles } from "@fluentui/react-components";
import { useFormStyles } from "../../common/forms/form.component";
import { useEffect, useState } from "react";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../common/searchableDropdown.component";

const useFieldDecorationStyles = makeStyles({
    decoration: {
        display: "flex",
        alignItems: "center",
        columnGap: "4px",
    },
});

export const AzureFilterCombobox = ({
    label,
    required,
    clearable,
    content,
    decoration,
}: {
    label: string;
    required?: boolean;
    clearable?: boolean;
    content: {
        /** list of valid values for the combo box */
        valueList: string[];
        /** currently-selected value from `valueList` */
        selection?: string;
        /** callback when the user has selected a value from `valueList` */
        setSelection: (value: string | undefined) => void;
        /** currently-entered text in the combox, may not be a valid selection value if the user is typing */
        value: string;
        /** callback when the user types in the combobox */
        setValue: (value: string) => void;
        /** placeholder text for the combobox */
        placeholder?: string;
        /** message displayed if focus leaves this combobox and `value` is not a valid value from `valueList` */
        invalidOptionErrorMessage: string;
    };
    decoration?: JSX.Element;
}) => {
    const formStyles = useFormStyles();
    const decorationStyles = useFieldDecorationStyles();
    const [validationMessage, setValidationMessage] = useState<string>("");

    // clear validation message as soon as value is valid
    useEffect(() => {
        if (content.valueList.includes(content.value)) {
            setValidationMessage("");
        }
    }, [content.value]);

    // only display validation error if focus leaves the field and the value is not valid
    const onBlur = () => {
        if (content.value) {
            setValidationMessage(
                content.valueList.includes(content.value) ? "" : content.invalidOptionErrorMessage,
            );
        }
    };

    const onOptionChange = (selectedOption: SearchableDropdownOptions) => {
        content.setSelection(selectedOption.value ?? "");
        content.setValue(selectedOption.value ?? "");
    };

    return (
        <div className={formStyles.formComponentDiv}>
            <Field
                label={
                    decoration ? (
                        <div className={decorationStyles.decoration}>
                            {label}
                            {decoration}
                        </div>
                    ) : (
                        label
                    )
                }
                orientation="horizontal"
                required={required}
                validationMessage={validationMessage}
                onBlur={onBlur}>
                <SearchableDropdown
                    size="small"
                    selectedOption={{
                        value: content.value,
                    }}
                    onSelect={onOptionChange}
                    placeholder={content.placeholder}
                    searchBoxPlaceholder={content.placeholder}
                    options={content.valueList.map((val) => {
                        return {
                            value: val,
                            label: val,
                        };
                    })}
                    clearable={clearable}></SearchableDropdown>
            </Field>
        </div>
    );
};
