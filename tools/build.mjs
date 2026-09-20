import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import esbuild from "esbuild";

import {
	COMPILED_DIR,
	ENFORCE_SDK_VERSION,
	MINIFY,
	OUTPUT_DIR,
	SOURCE_DIR,
} from "./config.mjs";

// This mirrors the official fz-sdk build target. mJS only supports a small
// JavaScript subset, so esbuild must lower all of these features.
const MJS_SUPPORTED = {
	"array-spread": false,
	arrow: false,
	"async-await": false,
	"async-generator": false,
	bigint: false,
	class: false,
	"const-and-let": true,
	decorators: false,
	"default-argument": false,
	destructuring: false,
	"dynamic-import": false,
	"exponent-operator": false,
	"export-star-as": false,
	"for-await": false,
	"for-of": false,
	"function-name-configurable": false,
	"function-or-class-property-access": false,
	generator: false,
	hashbang: false,
	"import-assertions": false,
	"import-meta": false,
	"inline-script": false,
	"logical-assignment": false,
	"nested-rest-binding": false,
	"new-target": false,
	"node-colon-prefix-import": false,
	"node-colon-prefix-require": false,
	"nullish-coalescing": false,
	"object-accessors": false,
	"object-extensions": false,
	"object-rest-spread": false,
	"optional-catch-binding": false,
	"optional-chain": false,
	"regexp-dot-all-flag": false,
	"regexp-lookbehind-assertions": false,
	"regexp-match-indices": false,
	"regexp-named-capture-groups": false,
	"regexp-set-notation": false,
	"regexp-sticky-and-unicode-flags": false,
	"regexp-unicode-property-escapes": false,
	"rest-argument": false,
	"template-literal": false,
	"top-level-await": false,
	"typeof-exotic-object-is-object": false,
	"unicode-escapes": false,
	using: false,
};

const SDK_MODULE_PREFIX = "@flipperdevices/fz-sdk/";
const normalizeSdkModuleNames = {
	name: "normalize-fz-sdk-module-names",
	setup(build) {
		build.onResolve({ filter: /^@flipperdevices\/fz-sdk\// }, (args) => ({
			path: args.path.slice(SDK_MODULE_PREFIX.length),
			external: true,
		}));
	},
};

const require = createRequire(import.meta.url);
const sdkPackagePath = require.resolve("@flipperdevices/fz-sdk/package.json");
const sdkPackage = JSON.parse(await readFile(sdkPackagePath, "utf8"));
const [sdkMajor, sdkMinor] = sdkPackage.version.split(".").map(Number);

const entries = (await readdir(SOURCE_DIR, { withFileTypes: true }))
	.filter(
		(entry) =>
			entry.isFile() &&
			entry.name.endsWith(".ts") &&
			!entry.name.endsWith(".d.ts"),
	)
	.map((entry) => entry.name)
	.sort();

if (entries.length === 0) {
	throw new Error(`No TypeScript entry points found in ${SOURCE_DIR}`);
}

await rm(OUTPUT_DIR, { recursive: true, force: true });

for (const entry of entries) {
	const compiledEntry = path.join(
		COMPILED_DIR,
		`${path.basename(entry, ".ts")}.js`,
	);
	const outputName = `${path.basename(entry, ".ts")}.js`;
	const output = path.join(OUTPUT_DIR, outputName);

	await esbuild.build({
		entryPoints: [compiledEntry],
		outfile: output,
		tsconfig: path.join(import.meta.dirname, "..", "tsconfig.json"),
		format: "cjs",
		bundle: true,
		minify: MINIFY,
		plugins: [normalizeSdkModuleNames],
		supported: MJS_SUPPORTED,
	});

	const compiled = await readFile(output, "utf8");
	const compatibilityCheck = ENFORCE_SDK_VERSION
		? `checkSdkCompatibility(${sdkMajor}, ${sdkMinor});\n`
		: "";
	await writeFile(
		output,
		`${compatibilityCheck}let exports = {};\n${compiled}`,
	);
	console.log(`built scripts/${entry} -> dist/${outputName}`);
}

await rm(COMPILED_DIR, { recursive: true, force: true });
