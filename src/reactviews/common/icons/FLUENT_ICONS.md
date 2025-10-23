## Creating custom React Fluent icons

1. Clean up
   Fluent icons are constructed with an array of paths, but without any `fill-rule` or `clip-rule` entries. You can use the free/OSS Inkscape to clean this up easily:

    1. Open your SVG

        - File → Open… and load your SVG.
        - Make sure your shape with fill-rule="evenodd" is visible.

    2. Select the path(s)

        - Use the Select tool (S) and click the object.
        - If it’s a compound path, you may need Object → Ungroup first.

    3. Convert the shape into geometry that respects the evenodd fill

        - With the path selected, go to:
            - Path → Break Apart (Shift+Ctrl+K)
            - This splits the path into its component sub-paths.
        - Inkscape interprets the evenodd rule at this step: “holes” become independent paths.

    4. Subtract the holes (if present)
        - Select the main outer shape, then the hole shapes.
        - Use Path → Difference (Ctrl+-) to cut the holes out.
        - Repeat until all inner holes are cut away.
        - Now you have pure geometry with no reliance on fill-rule.

2. Use this script to scale all the paths to your target size:

    `npm install svgpath`

    ```js
    // scaleSvg.js

    import svgpath from "svgpath";

    const fabricPath = "M 42.400391..."; // replace with your path

    const currentViewboxSize = 40; // replace with the viewbox from your existing SVG
    const targetSize = 20; // replace with your target viewbox size

    const scale = targetSize / currentViewboxSize;

    const scaled = svgpath(fabricPath).scale(scale).toString();

    console.log(scaled);
    ```

    `node scaleSvg.js`

3. Create the React icon:

    ```ts
    // in this example, the target size is 20.

    import { createFluentIcon } from "@fluentui/react-icons";
    const iconPath = "M19.2729..."; // paths scaled to target size 20, from previous step
    export const CustomIcon20 = createFluentIcon("CustomIcon20", "20", [iconPath]);
    ```
