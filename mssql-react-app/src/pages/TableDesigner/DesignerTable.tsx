import { getTheme, mergeStyles } from '@fluentui/react/lib/Styling';
import { CommandBarButton, DetailsList, IStackStyles, IconButton, SelectionMode, Stack, Text } from "@fluentui/react";
import { DesignerFormLabel } from "./DesignerFormLabel";
import { ErrorCallout } from "./ErrorCallout";
import { DesignerInputBox } from "./DesignerInputBox";
import { DesignerCheckbox } from "./DesignerCheckbox";
import { useContext } from "react";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerDropdown } from "./DesignerDropdown";
import { CheckBoxProperties, DesignerDataPropertyInfo, DesignerEditType, DesignerTableComponentDataItem, DesignerTableProperties, DesignerUIArea, DropDownProperties, InputBoxProperties } from './tableDesignerInterfaces';

export type DesignerTableProps = {
	component: DesignerDataPropertyInfo,
	model: DesignerTableProperties,
	componentPath: (string | number)[],
	UiArea: DesignerUIArea,
	loadPropertiesTabData?: boolean
}

type DesignerTableCellData = {
	index: number,
	item: DesignerTableComponentDataItem
}

export const DesignerTable = ({
	component,
	model,
	componentPath,
	UiArea,
	loadPropertiesTabData = true
}: DesignerTableProps) => {
	const tableProps = component.componentProperties as DesignerTableProperties;
	const theme = getTheme();
	const commandBarStackStyle: Partial<IStackStyles> = { root: { height: 44 } };
	const dragEnterClass = mergeStyles({
		backgroundColor: theme.palette.neutralLight,
	});
	let draggedItem: DesignerTableCellData | undefined;
	const state = useContext(TableDesignerContext);
	const handleCellSelection = (item: DesignerTableCellData) => {
		if (!loadPropertiesTabData) {
			return;
		}
		state?.provider.setPropertiesTabData(
			[...componentPath, item.index],
			component,
			model
		)
	}

	const getRowError = (index: number): string | undefined => {
		const issue = state!.state.issues?.find(i => {
			return i.propertyPath!.join('.') === [...componentPath, index].join('.');
		});
		return issue?.description ?? undefined;
	}

	const getErrorMessage = (path: (string | number)[]): string => {
		const issue = state!.state.issues?.find(i => i.propertyPath!.join('.') === path.join('.'));
		return issue?.description ?? '';
	}
	const columns = tableProps.columns?.map((col: string) => {
		const colProps = tableProps.itemProperties?.find(item => item.propertyName === col);
		return {
			key: col,
			name: colProps?.componentProperties.title ?? col,
			minWidth: (colProps?.componentProperties.width ?? 100) + 30,
			maxWidth: (colProps?.componentProperties.width ?? 100) + 30,
			isResizable: false,
			onRenderHeader: () => {
				return <DesignerFormLabel label={colProps?.componentProperties.title ?? col} description={colProps?.description ?? ''} />;
			},
			onRender: (cellValue: DesignerTableCellData) => {
				const value = cellValue.item[col];
				const getComponent = () => {
					switch (colProps?.componentType) {
						case 'input':
							if ((value as InputBoxProperties).enabled === false) {
								return <Text style={
									{
										lineHeight: '32px',
									}
								} variant="large">{(value as InputBoxProperties).value}</Text>
							}
							return <Stack horizontal>
								<DesignerInputBox
									component={colProps!}
									model={value as InputBoxProperties}
									componentPath={[...componentPath, cellValue.index, col]}
									UiArea={'TabsView'}
									showLabel={false}
									showError={false}
								/>
								{getErrorMessage([...componentPath, cellValue.index, col]) !== '' && <ErrorCallout message={getErrorMessage([...componentPath, cellValue.index, col])} />}
							</Stack>
						case 'dropdown':
							return <Stack horizontal>
								<DesignerDropdown
									component={colProps!}
									model={value as DropDownProperties}
									componentPath={[...componentPath, cellValue.index, col]}
									UiArea={'TabsView'}
									showLabel={false}
									showError={false}
								/>
								{getErrorMessage([...componentPath, cellValue.index, col]) !== '' && <ErrorCallout message={getErrorMessage([...componentPath, cellValue.index, col])} />}
							</Stack>
						case 'checkbox':
							return <DesignerCheckbox
								component={colProps!}
								model={value as CheckBoxProperties}
								componentPath={[...componentPath, cellValue.index, col]}
								UiArea={'TabsView'}
								showLabel={false}
							/>;
						default:
							return <div>Unknown type</div>
					}
				}
				return <Stack horizontal onClick={() => {
					handleCellSelection(cellValue);
				}}>
					{getComponent()}
				</Stack>
			}

		}
	}) ?? [];

	// Add drag and drop column to the beginning
	columns?.unshift({
		key: 'drag',
		name: '',
		minWidth: 30,
		maxWidth: 30,
		isResizable: false,
		onRenderHeader: () => {
			return <div></div>;
		},
		onRender: (cellValue: DesignerTableCellData) => {
			return <Stack horizontal onClick={() => {
				handleCellSelection(cellValue);
			}}>
				{tableProps.canMoveRows && <IconButton iconProps={{ iconName: 'GlobalNavButton' }}></IconButton>}
				{getRowError(cellValue.index) && <ErrorCallout componentPath={[...componentPath, cellValue.index]} message={getRowError(cellValue.index) ?? ''} />}
			</Stack>
		}
	});
	if (tableProps.canRemoveRows) {
		columns?.push({
			key: 'delete',
			name: 'Delete',
			minWidth: 100,
			maxWidth: 100,
			isResizable: false,
			onRenderHeader: () => {
				return <DesignerFormLabel label='Delete' />;
			},
			onRender: (cellValue: DesignerTableCellData) => {
				return <Stack horizontal onClick={() => {
					handleCellSelection(cellValue);
				}}>
					<IconButton disabled={cellValue.item['canBeDeleted'] ? !cellValue.item['canBeDeleted'] : false} iconProps={{ iconName: 'Delete' }} onClick={async () => {
						if (UiArea === 'TabsView') {
							await state?.provider.clearPropertiesTabData();
						}
						await (state?.provider.processTableEdit({
							path: [...componentPath, cellValue.index],
							source: UiArea,
							type: DesignerEditType.Remove,
							value: cellValue.item
						}));
					}}></IconButton>
				</Stack>
			}
		});
	}
	return <div>
		<Stack tokens={{
			childrenGap: 0
		}}>
			<Stack horizontal styles={commandBarStackStyle}>
				{model.canAddRows &&
					<CommandBarButton
						iconProps={{ iconName: 'Add' }}
						text={tableProps.labelForAddNewButton}
						onClick={async () => {
							await state?.provider.processTableEdit({
								path: componentPath,
								source: 'TabsView',
								type: DesignerEditType.Add,
								value: undefined
							});
						}}
					></CommandBarButton>}
			</Stack>
			<DetailsList
				compact
				setKey="items"
				columns={
					columns!
				}
				selectionMode={SelectionMode.none}
				items={
					model.data?.map((row, index) => {
						return {
							index: index,
							item: row
						}
					}) ?? []
				}
				dragDropEvents={{
					canDrop: () => {
						return true;
					},
					canDrag: () => {
						return true;
					},
					onDragEnter: () => {
						// return string is the css classes that will be added to the entering element.
						return dragEnterClass;
					},
					onDragLeave: () => {
						return;
					},
					onDrop: async (item?: DesignerTableCellData) => {
						if (draggedItem && tableProps.canMoveRows && item?.index !== draggedItem.index) {
							await state?.provider.processTableEdit({
								path: componentPath,
								source: UiArea,
								type: DesignerEditType.Move,
								value: draggedItem.item,
							}
							);
						}
					},
					onDragStart: (item?: DesignerTableCellData) => {
						draggedItem = item;
					},
					onDragEnd: () => {
						draggedItem = undefined;
					},
				}}
			/>
		</Stack>
	</div>;
}