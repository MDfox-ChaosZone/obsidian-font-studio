import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const watch = process.argv.includes("--watch");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const options = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    outfile: "main.js",
    format: "cjs",
    platform: "browser",
    target: "es2021",
    external: ["obsidian", "electron"],
    minify: !watch,
    legalComments: "eof",
    banner: { js: "/*! Font Studio · Copyright (c) 2026 MDfox · MIT License */" },
};
if (watch) {
    await (await esbuild.context(options)).watch();
} else {
    await esbuild.build(options);
    const files = {};
    for (const path of ["main.js", "manifest.json", "styles.css", "LICENSE"]) {
        files[manifest.id + "/" + path] = new Uint8Array(await readFile(path));
    }
    await mkdir("dist", { recursive: true });
    await writeFile("dist/" + manifest.id + "-" + manifest.version + ".zip", zipSync(files, { level: 9 }));
}
