import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import esbuild from "esbuild";

const DEVICE_DIR = "/ext/apps/Scripts";
const { outputFiles } = await esbuild.build({
	entryPoints: [path.join(import.meta.dirname, "sync.mjs")],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	plugins: [
		{
			name: "fake-device",
			setup(build) {
				build.onResolve({ filter: /^serialport$/ }, () => ({
					path: path.join(import.meta.dirname, "fixtures/serialport.mjs"),
				}));
				build.onResolve({ filter: /^\.\/config\.mjs$/ }, () => ({
					path: "config",
					namespace: "fixture",
				}));
				build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `
export const DEVICE_DIR = ${JSON.stringify(DEVICE_DIR)};
export const EXCLUDE_PATH = process.env.TEST_ROOT + "/exclude.txt";
export const OUTPUT_DIR = process.env.TEST_ROOT + "/dist";
export const SOURCE_DIR = process.env.TEST_ROOT + "/scripts";
export const SERIAL_BAUD_RATE = 230400;
`,
				}));
			},
		},
	],
});

async function sync(t, options = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), "myflipjs-sync-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	if (options.sources !== null) {
		await mkdir(path.join(root, "scripts"));
		for (const name of options.sources ?? ["test.ts", "conf_aiwa.ts"]) {
			const source = path.join(root, "scripts", name);
			await mkdir(path.dirname(source), { recursive: true });
			await writeFile(source, "");
		}
	}
	if (options.exclude !== null) {
		await writeFile(
			path.join(root, "exclude.txt"),
			options.exclude ?? "conf_aiwa.ts\n",
		);
	}
	if (options.dist !== null) {
		await mkdir(path.join(root, "dist"));
		for (const name of options.dist ?? ["test.js", "conf_aiwa.js"]) {
			await writeFile(path.join(root, "dist", name), `print("${name}");`);
		}
	}
	const resultPath = path.join(root, "result.json");
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "-", ...(options.args ?? [])],
		{
			input: outputFiles[0].text,
			encoding: "utf8",
			timeout: 10000,
			env: {
				...process.env,
				TEST_ROOT: root,
				TEST_RESULT_PATH: resultPath,
				TEST_REMOTE_FILES: JSON.stringify(
					options.remote ?? { [`${DEVICE_DIR}/conf_aiwa.js`]: "old aiwa" },
				),
				TEST_REMOVE_ERROR: options.removeError ?? "",
				TEST_REMOVE_ERRORS: JSON.stringify(options.removeErrors ?? {}),
				TEST_LIST_ERROR: options.listError ?? "",
			},
		},
	);
	assert.ifError(result.error);
	const device = await readFile(resultPath, "utf8").catch((error) => {
		if (error.code === "ENOENT") return null;
		throw error;
	});
	return { ...result, device: device ? JSON.parse(device) : null };
}

test("full sync removes exclusions and orphan JS, uploads enabled scripts and preserves data", async (t) => {
	const result = await sync(t, {
		remote: {
			[`${DEVICE_DIR}/conf_aiwa.js`]: "old aiwa",
			[`${DEVICE_DIR}/deleted.js`]: "old script",
			[`${DEVICE_DIR}/aiwa.ir`]: "keep",
		},
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {
		[`${DEVICE_DIR}/test.js`]: 'print("test.js");',
		[`${DEVICE_DIR}/aiwa.ir`]: "keep",
	});
	assert.deepEqual(result.device.operations, [
		["remove", `${DEVICE_DIR}/conf_aiwa.js`],
		["remove", `${DEVICE_DIR}/deleted.js`],
		["remove", `${DEVICE_DIR}/test.js`],
		["upload", `${DEVICE_DIR}/test.js`],
	]);
});

test("missing excluded files do not prevent later uploads", async (t) => {
	const result = await sync(t, { remote: {} });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /already absent/);
	assert.deepEqual(Object.keys(result.device.files), [`${DEVICE_DIR}/test.js`]);
});

test("selected sync still removes every exclusion", async (t) => {
	const result = await sync(t, { args: ["test"] });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.device.files[`${DEVICE_DIR}/conf_aiwa.js`], undefined);
	assert.equal(result.device.operations[0][1], `${DEVICE_DIR}/conf_aiwa.js`);
});

test("explicitly selecting an excluded script cannot upload it, even without dist", async (t) => {
	const result = await sync(t, { args: ["conf_aiwa"], dist: null });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {});
	assert.deepEqual(result.device.operations, [
		["remove", `${DEVICE_DIR}/conf_aiwa.js`],
	]);
});

test("deletion-only sync works without dist", async (t) => {
	const result = await sync(t, { dist: null, sources: ["conf_aiwa.ts"] });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {});
});

test("comments, CRLF, whitespace and duplicate entries are accepted", async (t) => {
	const result = await sync(t, {
		exclude: "# parked\r\n\r\n conf_aiwa.ts # aiwa\r\nconf_aiwa.ts\r\n",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		result.device.operations.filter(([, name]) => name.endsWith("conf_aiwa.js"))
			.length,
		1,
	);
});

for (const exclude of [
	"../test.ts",
	"common/test.ts",
	"*.ts",
	"test.js",
	"test.d.ts",
	"test.ts; reboot",
]) {
	test(`unsafe or unsupported exclusion is rejected before connecting: ${exclude}`, async (t) => {
		const result = await sync(t, { exclude });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Invalid exclude.txt line 1/);
		assert.equal(result.device, null);
	});
}

test("removal errors stop syncing and close the port", async (t) => {
	const result = await sync(t, { removeError: "access denied" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Could not remove.*access denied/);
	assert.deepEqual(result.device.operations, [
		["remove", `${DEVICE_DIR}/conf_aiwa.js`],
	]);
});

test("empty or missing exclude.txt enables all scripts", async (t) => {
	for (const exclude of ["", null]) {
		const result = await sync(t, { exclude });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			result.device.files[`${DEVICE_DIR}/conf_aiwa.js`],
			'print("conf_aiwa.js");',
		);
	}
});

test("an earlier missing file does not hide a later removal error", async (t) => {
	const result = await sync(t, {
		remote: {},
		removeErrors: { [`${DEVICE_DIR}/test.js`]: "access denied" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Could not remove.*test.js.*access denied/);
	assert.deepEqual(result.device.operations, [
		["remove", `${DEVICE_DIR}/conf_aiwa.js`],
		["remove", `${DEVICE_DIR}/test.js`],
	]);
});

test("empty sources remove remote JS without requiring dist", async (t) => {
	const result = await sync(t, { exclude: "", dist: null, sources: [] });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {});
});

test("missing requested build fails before exclusions are removed", async (t) => {
	const result = await sync(t, { args: ["missing"], sources: ["missing.ts"] });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Missing dist\/missing.js/);
	assert.equal(result.device, null);
});

for (const dist of [["test.js", "deleted.js"], ["test.js"]]) {
	test(`deleted source removes remote JS with ${dist.includes("deleted.js") ? "stale" : "rebuilt"} dist`, async (t) => {
		const result = await sync(t, {
			exclude: "",
			sources: ["test.ts"],
			dist,
			remote: { [`${DEVICE_DIR}/deleted.js`]: "old script" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(result.device.files, {
			[`${DEVICE_DIR}/test.js`]: 'print("test.js");',
		});
		assert.deepEqual(result.device.operations[0], [
			"remove",
			`${DEVICE_DIR}/deleted.js`,
		]);
	});
}

test("selecting a deleted script removes it instead of uploading stale dist", async (t) => {
	const result = await sync(t, {
		exclude: "",
		sources: [],
		dist: ["deleted.js"],
		args: ["deleted"],
		remote: { [`${DEVICE_DIR}/deleted.js`]: "old script" },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {});
	assert.deepEqual(result.device.operations, [
		["remove", `${DEVICE_DIR}/deleted.js`],
	]);
});

test("selected sync cleans orphan JS and preserves enabled unselected scripts, data and directories", async (t) => {
	const result = await sync(t, {
		exclude: "",
		sources: ["test.ts", "other.ts", "common/helper.ts", "types.d.ts"],
		dist: ["test.js"],
		args: ["test"],
		remote: {
			[`${DEVICE_DIR}/deleted.js`]: "old script",
			[`${DEVICE_DIR}/other.js`]: "preserve unselected",
			[`${DEVICE_DIR}/common.js`]: "orphan",
			[`${DEVICE_DIR}/types.d.js`]: "orphan declaration output",
			[`${DEVICE_DIR}/note.txt`]: "data",
			[`${DEVICE_DIR}/nested.js/inside.js`]: "nested script",
		},
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {
		[`${DEVICE_DIR}/test.js`]: 'print("test.js");',
		[`${DEVICE_DIR}/other.js`]: "preserve unselected",
		[`${DEVICE_DIR}/note.txt`]: "data",
		[`${DEVICE_DIR}/nested.js/inside.js`]: "nested script",
	});
});

test("missing scripts directory fails before connecting rather than deleting remote files", async (t) => {
	const result = await sync(t, { sources: null });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /ENOENT.*scripts/);
	assert.equal(result.device, null);
});

test("directory listing errors stop before any remote changes", async (t) => {
	const result = await sync(t, { listError: "access denied" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Could not list.*access denied/);
	assert.deepEqual(result.device.operations, []);
});

test("missing device directory is treated as empty", async (t) => {
	const result = await sync(t, { listError: "file/dir not exist", remote: {} });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.device.files, {
		[`${DEVICE_DIR}/test.js`]: 'print("test.js");',
	});
});

test("unsafe remote script names stop before any deletion", async (t) => {
	const result = await sync(t, {
		remote: { [`${DEVICE_DIR}/bad; reboot.js`]: "old script" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Unsafe script filename on Flipper/);
	assert.deepEqual(result.device.operations, []);
});
