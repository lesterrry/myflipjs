import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SerialPort } from "serialport";

import {
	DEVICE_DIR,
	EXCLUDE_PATH,
	OUTPUT_DIR,
	SERIAL_BAUD_RATE,
	SOURCE_DIR,
} from "./config.mjs";

const PROMPT = ">: ";
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+\.js$/;
const SAFE_SOURCE_NAME = /^[A-Za-z0-9._-]+\.ts$/;

async function readExclusions() {
	let text;
	try {
		text = await readFile(EXCLUDE_PATH, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return new Set();
		throw error;
	}

	const names = new Set();
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		const name = line.split("#", 1)[0].trim();
		if (!name) continue;
		if (!SAFE_SOURCE_NAME.test(name) || name.endsWith(".d.ts")) {
			throw new Error(
				`Invalid exclude.txt line ${index + 1}: expected a top-level .ts filename, got ${JSON.stringify(name)}`,
			);
		}
		names.add(`${name.slice(0, -3)}.js`);
	}
	return names;
}

function parseArguments(args) {
	const names = [];
	let port;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--port") {
			port = args[index + 1];
			if (!port) throw new Error("--port requires a serial device path");
			index += 1;
		} else if (argument === "--help" || argument === "-h") {
			console.log("Usage: npm run sync -- [--port /dev/tty...] [name ...]");
			console.log(
				"With no names, every non-excluded top-level scripts/*.ts build is synced.",
			);
			console.log(
				"Every sync removes excluded scripts and remote .js files without a top-level .ts source.",
			);
			process.exit(0);
		} else {
			names.push(argument.endsWith(".js") ? argument : `${argument}.js`);
		}
	}

	return { names, port };
}

async function findFlipper(explicitPort) {
	if (explicitPort) return explicitPort;
	if (process.env.FLIPPER_PORT) return process.env.FLIPPER_PORT;

	const ports = await SerialPort.list();
	let flippers = ports.filter((candidate) =>
		candidate.serialNumber?.startsWith("flip_"),
	);

	// Fallback used by the official SDK for systems that omit USB serial numbers.
	if (flippers.length === 0) {
		flippers = ports.filter(
			(candidate) =>
				candidate.vendorId?.toLowerCase() === "0483" &&
				candidate.productId?.toLowerCase() === "5740",
		);
	}

	if (flippers.length === 0) {
		throw new Error(
			"No Flipper Zero found. Connect it over USB, close qFlipper, and try again.",
		);
	}
	if (flippers.length > 1) {
		const choices = flippers.map((candidate) => candidate.path).join(", ");
		throw new Error(
			`Multiple Flippers found (${choices}); select one with --port.`,
		);
	}

	return flippers[0].path;
}

async function openPort(portPath) {
	const port = new SerialPort({
		path: portPath,
		baudRate: SERIAL_BAUD_RATE,
		autoOpen: false,
	});
	await new Promise((resolve, reject) =>
		port.open((error) => (error ? reject(error) : resolve())),
	);
	return port;
}

function createCli(port) {
	let received = "";
	let cursor = 0;

	port.on("data", (chunk) => {
		received += chunk.toString("utf8");
	});

	function waitFor(text, timeoutMs) {
		const start = cursor;
		return new Promise((resolve, reject) => {
			let timer;

			const check = () => {
				const match = received.indexOf(text, cursor);
				if (match === -1) return;
				cursor = match + text.length;
				clearInterval(poll);
				clearTimeout(timer);
				resolve(received.slice(start, cursor));
			};

			const poll = setInterval(check, 20);
			timer = setTimeout(() => {
				clearInterval(poll);
				reject(
					new Error(
						`Timed out waiting for Flipper CLI response: ${JSON.stringify(text)}`,
					),
				);
			}, timeoutMs);
			check();
		});
	}

	async function write(data) {
		await new Promise((resolve, reject) =>
			port.write(data, (error) => (error ? reject(error) : resolve())),
		);
		await new Promise((resolve, reject) =>
			port.drain((error) => (error ? reject(error) : resolve())),
		);
	}

	return { waitFor, write };
}

async function closePort(port) {
	if (!port.isOpen) return;
	await new Promise((resolve, reject) =>
		port.close((error) => (error ? reject(error) : resolve())),
	);
}

async function removeFromDevice(cli, devicePath) {
	await cli.write(`storage remove ${devicePath}\r`);
	const response = await cli.waitFor(PROMPT, 3000);
	const error = response.match(/Storage error: ([^\r\n]+)/);
	if (!error) return true;
	if (error[1].trim() === "file/dir not exist") return false;
	throw new Error(`Could not remove ${devicePath}: ${error[1]}`);
}

async function readDeviceScripts(cli) {
	await cli.write(`storage list ${DEVICE_DIR}\r`);
	const response = await cli.waitFor(PROMPT, 3000);
	const error = response.match(/Storage error: ([^\r\n]+)/);
	if (error) {
		if (error[1].trim() === "file/dir not exist") return [];
		throw new Error(`Could not list ${DEVICE_DIR}: ${error[1]}`);
	}
	const names = [];
	for (const line of response.split(/\r?\n/)) {
		const file = line.match(/^\s*\[F\] (.+) \d+b\s*$/);
		if (!file?.[1].endsWith(".js")) continue;
		if (!SAFE_FILE_NAME.test(file[1])) {
			throw new Error(`Unsafe script filename on Flipper: ${file[1]}`);
		}
		names.push(file[1]);
	}
	return names;
}

async function main() {
	const { names: requestedNames, port: explicitPort } = parseArguments(
		process.argv.slice(2),
	);
	const excludedNames = await readExclusions();
	// Read sources even without a new build, so stale dist files cannot be sent.
	// A missing source directory is an error, not an empty desired device state.
	const sourceNames = new Set();
	for (const entry of await readdir(SOURCE_DIR, { withFileTypes: true })) {
		if (
			!entry.isFile() ||
			!entry.name.endsWith(".ts") ||
			entry.name.endsWith(".d.ts")
		)
			continue;
		if (!SAFE_SOURCE_NAME.test(entry.name)) {
			throw new Error(`Unsafe script filename: ${entry.name}`);
		}
		sourceNames.add(`${entry.name.slice(0, -3)}.js`);
	}
	const entries = await readdir(OUTPUT_DIR, { withFileTypes: true }).catch(
		(error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		},
	);
	const availableNames = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
		.map((entry) => entry.name)
		.sort();
	const selectedNames =
		requestedNames.length > 0 ? requestedNames : [...sourceNames].sort();
	const names = [...new Set(selectedNames)].filter(
		(name) => sourceNames.has(name) && !excludedNames.has(name),
	);

	for (const name of selectedNames) {
		if (!SAFE_FILE_NAME.test(name))
			throw new Error(`Unsafe script filename: ${name}`);
		if (names.includes(name) && !availableNames.includes(name)) {
			throw new Error(`Missing dist/${name}; run npm run build first.`);
		}
	}

	const portPath = await findFlipper(explicitPort);
	const port = await openPort(portPath);
	const cli = createCli(port);

	try {
		console.log(`connected to ${portPath}`);
		await cli.write("\r");
		await cli.waitFor(PROMPT, 3000);

		const remoteNames = await readDeviceScripts(cli);
		const namesToRemove = new Set([
			...excludedNames,
			...remoteNames.filter((name) => !sourceNames.has(name)),
		]);
		for (const name of namesToRemove) {
			const devicePath = `${DEVICE_DIR}/${name}`;
			const removed = await removeFromDevice(cli, devicePath);
			const reason = excludedNames.has(name) ? "excluded" : "without source";
			console.log(
				removed
					? `removed ${reason} ${devicePath}`
					: `${reason} ${devicePath} (already absent)`,
			);
		}

		for (const name of names) {
			const localPath = path.join(OUTPUT_DIR, name);
			const devicePath = `${DEVICE_DIR}/${name}`;
			const contents = await readFile(localPath);

			// This is the same overwrite sequence used by the official fz-sdk uploader.
			await removeFromDevice(cli, devicePath);
			await cli.write(`storage write_chunk ${devicePath} ${contents.length}\r`);
			await cli.waitFor("Ready", 3000);
			await cli.write(contents);
			await cli.waitFor(PROMPT, 15000);
			console.log(`synced dist/${name} -> ${devicePath}`);
		}
	} finally {
		await closePort(port);
	}
}

main().catch((error) => {
	console.error(`sync failed: ${error.message}`);
	process.exitCode = 1;
});
