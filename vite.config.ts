import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import IstanbulPlugin from "vite-plugin-istanbul";

export default defineConfig({
    build: {
        sourcemap: true,
    },
    plugins: [
        react(),
        [
            IstanbulPlugin({
                include: "out/src/**",
                exclude: ["node_modules", "test/"],
                extension: [".ts", ".js", ".jsx", ".tsx"],
                forceBuildInstrument: true, // Forces instrumentation even in build mode
            }),
        ],
    ],
});
