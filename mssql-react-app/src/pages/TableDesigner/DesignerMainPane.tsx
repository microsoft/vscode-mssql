/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from "@fluentui/react-tabs"
import { CounterBadge, Text, makeStyles, shorthands } from "@fluentui/react-components";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { useContext } from "react";
import { InputBoxProperties } from "./tableDesignerInterfaces";
import { DesignerMainPaneTab } from "./DesignerMainPaneTab";

const useStyles = makeStyles({
    root: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
    },
    title: {
        ...shorthands.margin('10px', '5px', '5px', '5px'),
    },
    separator: {
        ...shorthands.margin('0px', '-20px', '0px', '0px'),
        ...shorthands.padding('0px'),
        fontSize: '5px'
    },
    form: {
        height: '100%',
        maxWidth: '100%',
        overflow: 'hidden'
    },
    tabButtonContainer: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        '> *': {
			marginRight: '5px'
		},
    }
});

export const DesignerMainPane = () => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    const metadata = state?.state;
    if (!metadata) {
        return null;
    }
    const getCurrentTabIssuesCount = (tabId: string) => {
        const tabComponents = metadata.view?.tabs.find(tab => tab.id === tabId)?.components;
        if (!tabComponents) {
            return 0;
        }
        if (metadata.issues?.length === 0) {
            return 0;
        }
        let count = 0;
        for (let i = 0; i < metadata?.issues!.length; i++) {
            const issue = metadata.issues![i];
            if (issue.propertyPath && issue.propertyPath.length > 0) {
                if (tabComponents.find(c => c.propertyName === issue.propertyPath![0])) {
                    count++;
                }
            }
        }
        return count;
    }
    return <div className={classes.root}>
        <div className={classes.title}>
            <Text className={classes.title} size={500} weight='semibold'>{(metadata.model!['name'] as InputBoxProperties).value}</Text>
        </div>
        <TabList
            size="medium"
            selectedValue={metadata.tabStates?.mainPaneTab}
            onTabSelect={(_event, data) => {
                state.provider.setTab(data.value as string)
                state.provider.setPropertiesComponents(undefined);
            }}
        >
            {
                metadata.view?.tabs.map(tab => {
                    const ariaLabel = `${tab.title} ${getCurrentTabIssuesCount(tab.id) > 0 ? getCurrentTabIssuesCount(tab.id) + ` issues` : ''} `;
                    return <Tab title={ariaLabel} value={tab.id} key={tab.id} onClick={() => {
                        //designerContext.clearPropertiesTabData();
                    }}>
                        <div className={classes.tabButtonContainer}
                        >
                            <Text>{tab.title}</Text>
                            {
                                getCurrentTabIssuesCount(tab.id) > 0 && <CounterBadge style={
                                    {
                                        marginTop: '2px'
                                    }
                                } color="danger" size="small" title={getCurrentTabIssuesCount(tab.id) + ' issues'} count={getCurrentTabIssuesCount(tab.id)} />

                            }
                        </div>
                    </Tab>
                })
            }
        </TabList>
        <div className={classes.form}>
            {
                metadata.view?.tabs.map(tab => {
                    return <div style={{
                        display: metadata.tabStates?.mainPaneTab === tab.id ? '' : 'none',
                        width: '100%',
                        height: '100%',
                    }} key={tab.id}>
                        <DesignerMainPaneTab tabId={tab.id} />
                    </div>
                })
            }
        </div>

    </div>
}