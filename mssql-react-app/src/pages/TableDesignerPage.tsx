import { Toolbar, ToolbarButton } from "@fluentui/react-toolbar";
import { DocumentChevronDoubleRegular } from "@fluentui/react-icons";
import { Separator, Stack } from "@fluentui/react";
import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from "@fluentui/react-dialog";
import { Button } from "@fluentui/react-button";
import { DatabaseArrowDownRegular } from "@fluentui/react-icons";

export const TableDesigner = () => {
	return (
		<div>
			<div>
				<Toolbar size="small">
					<Stack horizontal tokens={
						{ childrenGap: 10 }
					}>
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
					</Stack>
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
				<Separator>
				</Separator>
			</div>
		</div >
	);
}