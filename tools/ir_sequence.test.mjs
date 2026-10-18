import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";

const { outputFiles } = await esbuild.build({
	entryPoints: [
		path.join(import.meta.dirname, "../scripts/common/ir_sequence.ts"),
	],
	platform: "neutral",
	format: "cjs",
	bundle: true,
	write: false,
	external: ["@flipperdevices/fz-sdk/*", "infrared"],
});

function runtime(supportsInfrared = true) {
	const loaded = new Set();
	const sent = [];
	const pauses = [];
	const module = { exports: {} };
	vm.runInNewContext(outputFiles[0].text, {
		module,
		exports: module.exports,
		doesSdkSupport: () => supportsInfrared,
		delay: (ms) => pauses.push(ms),
		print: () => {},
		die: (message) => {
			throw new Error(message);
		},
		require: (name) => {
			const nativeName = name.replace("@flipperdevices/fz-sdk/", "");
			if (loaded.has(nativeName)) {
				throw new Error(`"${nativeName}" module is already installed`);
			}
			loaded.add(nativeName);
			if (nativeName === "storage") return {};
			assert.equal(nativeName, "infrared");
			return {
				sendSignal: (...args) => sent.push(["parsed", ...args]),
				sendRawSignal: (...args) => sent.push(["raw", ...args]),
			};
		},
	});
	return { run: module.exports.runIrSequence, loaded, sent, pauses };
}

const remote = [
	{
		name: "Menu",
		type: "parsed",
		protocol: "Samsung32",
		address: 7,
		command: 0x1a,
	},
	{
		name: "Raw",
		type: "raw",
		timings: [500, 1000, 500],
		frequency: 38000,
		dutyCycle: 0.33,
	},
];

test("multiple sequences reuse the IR module when duplicate require is forbidden", () => {
	const { run, sent, loaded, pauses } = runtime();
	run(remote, ["Menu"]);
	run(remote, ["Raw", "Menu"]);
	assert.deepEqual([...loaded], ["storage", "infrared"]);
	assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
		["parsed", "Samsung32", 7, 0x1a],
		["raw", [500, 1000, 500], true, { frequency: 38000, dutyCycle: 0.33 }],
		["parsed", "Samsung32", 7, 0x1a],
	]);
	assert.deepEqual(pauses, [500]);
});

test("unknown names do not load IR or prevent a later valid sequence", () => {
	const { run, sent, loaded } = runtime();
	assert.throws(() => run(remote, ["Menu", "Missing"]), /not found/);
	assert.equal(loaded.has("infrared"), false);
	assert.deepEqual(sent, []);
	run(remote, ["Menu"]);
	assert.equal(sent.length, 1);
});

test("unsupported firmware fails before loading IR", () => {
	const { run, loaded, sent } = runtime(false);
	assert.throws(() => run(remote, ["Menu"]), /infrared-send/);
	assert.equal(loaded.has("infrared"), false);
	assert.deepEqual(sent, []);
});
