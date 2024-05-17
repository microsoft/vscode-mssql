import { PrimaryButton } from "@fluentui/react";
import { rpc } from "../utils/rpc";
import { useContext } from "react";
import { StateContext } from "../StateProvider";
import { makeStyles, shorthands } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    ...shorthands.gap('10px'),
    alignItems: 'center',
    width: '100%',
    height: '100%',
  }
})


export const WelcomePage = () => {
  const state = useContext(StateContext);
  const classNames = useStyles();
  return (
    <div className={classNames.root}>
      <h1>Count: {(state?.state?.state as WelcomePageState)?.count}</h1>
      <div className="card">
        <PrimaryButton
          text='Click me'
          onClick={() => {
            rpc.action('increment');
          }}
        />
      </div>
    </div>
  );
}


export interface WelcomePageState {
  count: number;
}