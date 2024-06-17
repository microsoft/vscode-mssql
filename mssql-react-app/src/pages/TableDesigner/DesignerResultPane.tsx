import { Button, CounterBadge, Divider, Link, Tab, TabList, Text, Theme, makeStyles, shorthands, teamsHighContrastTheme, webDarkTheme } from "@fluentui/react-components";
import { useContext } from "react";
import { OpenFilled } from "@fluentui/react-icons";
import Editor from '@monaco-editor/react';
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { DesignerResultPaneTabs, InputBoxProperties } from "./tableDesignerInterfaces";
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";

const useStyles = makeStyles({
	root: {
		width: '100%',
		height: '100%',
		display: 'flex',
		flexDirection: 'column',
	},
	ribbon: {
		width: '100%',
		display: 'flex',
		flexDirection: 'row',
		'> *': {
			marginRight: '10px'
		},
	},
	designerResultPaneTabs: {
		flex: 1,
	},
	tabContent: {
		...shorthands.flex(1),
		width: '100%',
		height: '100%',
		display: 'flex',
		...shorthands.overflow('auto'),
	},
	designerResultPaneScript: {
		width: '100%',
		height: '100%',
		position: 'relative',
	},
	designerResultPaneScriptOpenButton: {
		position: 'absolute',
		top: '0px',
		right: '0px',
	},
	issuesContainer: {
		width: '100%',
		height: '100%',
		flexDirection: 'column',
		'> *': {
			marginBottom: '10px'
		},

	},
	issuesRows: {
		flexDirection: 'row',
		...shorthands.padding('10px'),
		'> *': {
			marginRight: '10px'
		},
	}
});

export const DesignerResultPane = () => {
	const classes = useStyles();
	const state = useContext(TableDesignerContext);
	const webViewState = useContext(VscodeWebviewContext);
	const metadata = state?.state;
	if (!metadata) {
		return null;
	}

	const getVscodeTheme = (theme: Theme) => {

		switch (theme) {
			case webDarkTheme:
				return 'vs-dark';
			case teamsHighContrastTheme:
				return 'hc-black';
			default:
				return 'light';
		}
	}

	return <div className={classes.root}>
		<div className={classes.ribbon}>
			<TabList
				size='medium'
				selectedValue={metadata.tabStates!.resultPaneTab}
				onTabSelect={(event, data) => {
					state.provider.setResultTab(data.value as string)
				}}
				className={classes.designerResultPaneTabs}
			>
				<Tab value={DesignerResultPaneTabs.Script} key={DesignerResultPaneTabs.Script}>
					Script
				</Tab>
				<Tab value={DesignerResultPaneTabs.Issues} key={DesignerResultPaneTabs.Issues}
					disabled={!metadata.issues || metadata.issues.length === 0}
				>
					Issues {metadata.issues && <CounterBadge style={{
						marginLeft: '5px',
						marginTop: '-10px'
					}} count={metadata.issues?.length} size='small' />}
				</Tab>
			</TabList>
			<Divider vertical style={{
				flex: '0'
			}}/>
			{metadata.tabStates!.resultPaneTab == DesignerResultPaneTabs.Script &&
				<Button appearance="transparent" icon={<OpenFilled />} onClick={() => state.provider.scriptAsCreate()} title='Open in new tab'></Button>
			}
		</div>
		<div className={classes.tabContent}>
			{metadata.tabStates!.resultPaneTab === DesignerResultPaneTabs.Script &&
				<div className={classes.designerResultPaneScript}>
					<Editor
						height={'100%'}
						width={'100%'}
						language="sql"
						theme={getVscodeTheme(webViewState!.theme!)}
						value={(metadata?.model!['script'] as InputBoxProperties).value ?? ''}
					>

					</Editor>
				</div>
			}
			{metadata.tabStates!.resultPaneTab === DesignerResultPaneTabs.Issues && <div className={classes.issuesContainer}>
				{metadata.issues?.map((i, index) => {
					return <div className={classes.issuesRows}>
						<Text size={300}>{(index + 1)}.</Text>
						<Text size={300}>{i.description} : {i.propertyPath?.join('.')}</Text>
						<Link onClick={() => {
							console.log('Go there');
							//designerContext.goToProperty(i.propertyPath!);
						}}>
							Go there
						</Link>
						{i.moreInfoLink && <Link href={i.moreInfoLink} target="_blank">More info</Link>}
					</div>
				})}
			</div>
			}
		</div>
	</div>
}