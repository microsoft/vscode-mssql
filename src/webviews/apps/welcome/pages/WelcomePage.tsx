import { useContext } from "react";
import { Button, Input, Label, makeStyles, shorthands, useId } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    just: 'center',
    ...shorthands.gap('10px'),
    alignItems: 'center',
    width: '100%',
    height: '100%',
    justifyContent: 'center'
  }
})


export const WelcomePage = () => {
  // const state = useContext(StateContext);
  const classNames = useStyles();
  const inputId = useId("input");

  return (
    <div className={classNames.root}>
      <h1>Count: NaN</h1>
      <Button
        appearance="primary"
        onClick={() => {
          console.log("Incrementing counter");
        }}
      >Increment Counter</Button>
      <Label htmlFor={inputId}>
        Sample input
      </Label>
      <Input id={inputId} />
    </div>
  );
}


export interface WelcomePageState {
  count: number;
}