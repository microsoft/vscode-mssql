import { useContext, useEffect, useState } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { CheckBoxProperties, DesignerDataPropertyInfo, DesignerEditType, DesignerUIArea } from "./tableDesignerInterfaces";
import { Checkbox, Field } from "@fluentui/react-components";

export type DesignerCheckboxProps = {
	component: DesignerDataPropertyInfo,
	model: CheckBoxProperties,
	componentPath: (string | number)[],
	UiArea: DesignerUIArea,
	showLabel?: boolean
}

export const DesignerCheckbox = ({
	component,
	model,
	componentPath,
	UiArea,
	showLabel = true
}: DesignerCheckboxProps) => {
	const [value, setValue] = useState(model.checked);
	const state = useContext(TableDesignerContext);
	useEffect(() => {
		setValue(model.checked);
	}, [model]);
	return <Field
		size="small"
	>
		<Checkbox
			label={showLabel ? component.componentProperties.title! : undefined}
			id={state?.provider.getComponentId(componentPath)}
			checked={value}
			onChange={async (event, data) => {
				if (model.enabled === false) {
					return;
				}
				await state?.provider.processTableEdit({
					path: componentPath,
					value: data.checked,
					type: DesignerEditType.Update,
					source: UiArea
				}
				);
			}}
			size="medium"
			disabled={model.enabled === undefined ? false : !model.enabled}
		/>
	</Field>
}
