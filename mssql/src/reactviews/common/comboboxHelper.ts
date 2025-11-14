/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Behavior for how the default selection is determined */
export enum DefaultSelectionMode {
    /** If there are any options, the first is always selected.  Otherwise, selects nothing. */
    SelectFirstIfAny,
    /** Always selects nothing, regardless of if there are available options */
    AlwaysSelectNone,
    /** Selects the only option if there's only one.  Otherwise (many or no options) selects nothing. */
    SelectOnlyOrNone,
}

export function updateComboboxSelection(
    /** current selected (valid) option */
    selected: string | undefined,
    /** callback to set the selected (valid) option */
    setSelected: (s: string | undefined) => void,
    /** callback to set the displayed value (not guaranteed to be valid if the user has manually typed something) */
    setValue: (v: string) => void,
    /** list of valid options */
    optionList: string[],
    /** behavior for choosing the default selected value */
    defaultSelectionMode: DefaultSelectionMode = DefaultSelectionMode.AlwaysSelectNone,
) {
    // if there is no current selection or if the current selection is no longer in the list of options (due to filter changes),
    // then select the only option if there is only one option, then make a default selection according to specified `defaultSelectionMode`

    if (selected === undefined || (selected && !optionList.includes(selected))) {
        let optionToSelect: string | undefined = undefined;

        if (optionList.length > 0) {
            switch (defaultSelectionMode) {
                case DefaultSelectionMode.SelectFirstIfAny:
                    optionToSelect = optionList.length > 0 ? optionList[0] : undefined;
                    break;
                case DefaultSelectionMode.SelectOnlyOrNone:
                    optionToSelect = optionList.length === 1 ? optionList[0] : undefined;
                    break;
                case DefaultSelectionMode.AlwaysSelectNone:
                default:
                    optionToSelect = undefined;
            }
        }

        setSelected(optionToSelect); // selected value's unselected state should be undefined
        setValue(optionToSelect ?? ""); // displayed value's unselected state should be an empty string
    }
}
