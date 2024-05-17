import { Toolbar, ToolbarButton } from "@fluentui/react-toolbar";
import { DocumentChevronDoubleRegular } from "@fluentui/react-icons";
import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from "@fluentui/react-dialog";
import { Button } from "@fluentui/react-button";
import { DatabaseArrowDownRegular } from "@fluentui/react-icons";
import { makeStyles, shorthands } from "@fluentui/react-components";

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		just: 'center',
		alignItems: 'center',
		width: '100%',
		height: '100%',
		...shorthands.gap('10px'),
	}
});

export const TableDesigner = () => {
	const classNames = useStyles();
	return (
		<div>
			<div>
				<Toolbar size="small">
					<div className={classNames.root}>
						<ToolbarButton
							aria-label="Generate Script"
							title="Generate"
							icon={<DocumentChevronDoubleRegular />}
						>
							Generate Script
						</ToolbarButton>
						<ToolbarButton
							icon={<DocumentChevronDoubleRegular />}
						>
							Script As Create
						</ToolbarButton>
					</div>
					<Dialog>
						<DialogTrigger disableButtonEnhancement>
							<ToolbarButton
								aria-label="Publish"
								title="Publish"
								icon={<DatabaseArrowDownRegular />}
								onClick={() => {

								}}
							>
								Publish
							</ToolbarButton>
						</DialogTrigger>
						<DialogSurface>
							<DialogBody>
								<DialogTitle>
									Preview Designer Changes
								</DialogTitle>
								<DialogContent>
									Hello World
								</DialogContent>
								<DialogActions>
									<DialogTrigger disableButtonEnhancement>
										<Button size="medium" appearance="secondary">Close</Button>
									</DialogTrigger>
									<Button >Open Script</Button>
									<Button >Update Database</Button>
								</DialogActions>
							</DialogBody>
						</DialogSurface>
					</Dialog>
				</Toolbar>
			</div>
		</div >
	);
}