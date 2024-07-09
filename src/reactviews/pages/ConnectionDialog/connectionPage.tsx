import { Divider, Tab, TabList, Text, makeStyles, shorthands } from "@fluentui/react-components";
import { ResizableBox } from "react-resizable";
import { MruConnectionsContainer } from "./mruConnectionsContainer";

export const useStyles = makeStyles({
	root: {
		flexDirection: 'row',
		display: 'flex',
		height: '100%',
		width: '100%',
		maxWidth: '100%',
		maxHeight: '100%',
	},
	mainContainer: {
		...shorthands.flex(1),
		height: '100%',
	},
	mruContainer: {
		position: 'relative',

		height: '100%',
		width: '300px',
		padding: '20px',
	},
	mruPaneHandle: {
		position: 'absolute',
		top: '0',
		left: '0',
		width: '10px',
		height: '100%',
		cursor: 'ew-resize',
		zIndex: 1,
	},
});

export const ConnectionPage = () => {
	const classes = useStyles();
	return (
		<div className={classes.root}>
			<div className={classes.mainContainer}>
				<TabList>
					<Tab value="tab1">Connections</Tab>
					<Tab value="tab2">Azure Accounts</Tab>
				</TabList>
				<Text size={600} weight='bold'>Connection Page</Text>
				<p>Connection Page</p>
			</div>
			<Divider style={
				{
					width: '5px',
					height: '100%',
					flex: 0
				}
			} vertical />
			<ResizableBox
				className={classes.mruContainer}
				width={250}
				height={Infinity}
				maxConstraints={[800, Infinity]}
				minConstraints={[300, Infinity]}
				resizeHandles={['w']}
				handle={
					<div className={classes.mruPaneHandle} />
				}
			>
				<MruConnectionsContainer />
			</ResizableBox>
		</div>
	);
}