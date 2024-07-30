/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const QueryPlan = () => {
	return (
		<html lang="en">
			<head>
				<meta charSet="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			</head>
			<body>
				<div id="root">
					<div role="button" id="queryplanpane" tabIndex={0} className="boxRow header collapsible">
						<span> Query Plan </span>
						<span className="shortCut"> Ctrl + Alt + Q </span>
					</div>
					<div role="button" id="plantreepane" tabIndex={0} className="boxRow header collapsible">
						<span> Plan Tree </span>
						<span className="shortCut"> Ctrl + Alt + P </span>
					</div>
					<div role="button" id="topopspane" tabIndex={0} className="boxRow header collapsible">
						<span> Top Operations</span>
						<span className="shortCut"> Ctrl + Alt + T </span>
					</div>
				</div>
			</body>
		</html>
	);
}