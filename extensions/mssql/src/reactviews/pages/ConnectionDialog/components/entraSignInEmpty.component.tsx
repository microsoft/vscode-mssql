/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { Link, Spinner, makeStyles } from "@fluentui/react-components";
import { ApiStatus } from "../../../../sharedInterfaces/webview";

export const EntraSignInEmpty: React.FC<EntraSignInEmptyProps> = ({
  loadAccountStatus,
  hasAccounts,
  brandImageSource,
  signInText,
  linkText: linkText,
  loadingText,
  onSignInClick,
}) => {
  const styles = useStyles();

  if (loadAccountStatus === ApiStatus.Loaded) {
    // If accounts are already loaded and exist, don't render the empty state
    if (hasAccounts) {
      return undefined;
    }
    // If loaded but no accounts, show sign-in prompt
  }

  return (
    <div className={styles.notSignedInContainer}>
      {(loadAccountStatus === ApiStatus.NotStarted ||
        (loadAccountStatus === ApiStatus.Loaded && !hasAccounts)) && (
        <div className={styles.notSignedInContainer}>
          <img
            className={styles.icon}
            src={brandImageSource}
            alt={signInText}
          />
          <div>{signInText}</div>
          <Link className={styles.signInLink} onClick={onSignInClick}>
            {linkText}
          </Link>
        </div>
      )}
      {loadAccountStatus === ApiStatus.Loading && (
        <div className={styles.notSignedInContainer}>
          <img
            className={styles.icon}
            src={brandImageSource}
            alt={signInText}
          />
          <div>{loadingText}</div>
          <Spinner size="large" style={{ marginTop: "10px" }} />
        </div>
      )}
    </div>
  );
};

export default EntraSignInEmpty;

const useStyles = makeStyles({
  icon: {
    width: "75px",
    height: "75px",
    marginBottom: "10px",
  },
  notSignedInContainer: {
    marginTop: "20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  signInLink: {
    marginTop: "8px",
  },
});

export interface EntraSignInEmptyProps {
  loadAccountStatus: ApiStatus;
  hasAccounts: boolean;
  brandImageSource: string;
  signInText: string;
  linkText: string;
  loadingText: string;
  onSignInClick: () => void;
}
