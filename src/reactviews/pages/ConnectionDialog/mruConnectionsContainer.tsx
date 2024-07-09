import { Button, Caption1, Card, CardHeader, CardPreview, Text, makeStyles, tokens } from "@fluentui/react-components"
import { MoreHorizontal20Regular, ServerRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
	main: {
		gap: "36px",
		display: "flex",
		flexDirection: "column",
		flexWrap: "wrap",
	},

	card: {
		width: "100%",
		maxWidth: "100%",
		height: "fit-content",
	},

	section: {
		width: "fit-content",
	},

	title: { margin: "0 0 12px" },

	horizontalCardImage: {
		width: "60px",
		height: "30px",
	},

	headerImage: {
		borderRadius: "4px",
		maxWidth: "44px",
		maxHeight: "44px",
	},

	caption: {
		color: tokens.colorNeutralForeground3,
	},

	text: { margin: "0" },
});

export const MruConnectionsContainer = () => {
	const styles = useStyles();

	return (
		<>
			<Text weight="semibold" className={styles.title}>Recent Connections</Text>
			<Card className={styles.card} orientation="horizontal">
				<CardPreview className={styles.horizontalCardImage}>
					<ServerRegular />
				</CardPreview>

				<CardHeader
					header={<Text weight="semibold">App Name</Text>}
					description={
						<Caption1 className={styles.caption}>Developer</Caption1>
					}
					action={
						<Button
							appearance="transparent"
							icon={<MoreHorizontal20Regular />}
							aria-label="More options"
						/>
					}
				/>
			</Card>
		</>
	)
}