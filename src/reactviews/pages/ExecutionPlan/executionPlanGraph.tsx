import { useContext, useRef, useEffect } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { AzdataGraphView } from "./azdataGraphView";

export const ExecutionPlanGraph = () => {
  const state = useContext(ExecutionPlanContext);
  const executionPlanState = state?.state;
  const executionPlanProvider = state?.provider;

  const diagramContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!executionPlanState || !executionPlanProvider || !diagramContainerRef.current || !executionPlanState.executionPlanGraphs) {
      return;
    }

    const azdataGraph = new AzdataGraphView(
      diagramContainerRef.current,
      executionPlanState.executionPlanGraphs[0]!,
      "Diagram Name"
    );

    // Clean up the graph when the component unmounts
    return () => {
      azdataGraph.dispose(); // Adjust based on how you clean up AzdataGraphView instances
    };
  }, [executionPlanState, executionPlanProvider]);

  return <div ref={diagramContainerRef} />;
};
