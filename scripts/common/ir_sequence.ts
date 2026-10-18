import type * as Infrared from "@flipperdevices/fz-sdk/infrared";

import storage = require("@flipperdevices/fz-sdk/storage");

export const COMMAND_DELAY_MS = 500;
const MAX_FILE_SIZE = 64 * 1024;
let infraredModule: typeof Infrared | false = false;

type Fields = { [key: string]: string };
export type IrSignal =
	| {
			name: string;
			type: "parsed";
			protocol: Infrared.Protocol;
			address: number;
			command: number;
	  }
	| {
			name: string;
			type: "raw";
			timings: number[];
			frequency: number;
			dutyCycle: number;
	  };

function trim(text: string): string {
	let start = 0;
	let end = text.length;
	while (start < end && text.charCodeAt(start) <= 32) {
		start += 1;
	}
	while (end > start && text.charCodeAt(end - 1) <= 32) {
		end -= 1;
	}
	return text.slice(start, end);
}

function words(text: string): string[] {
	const result: string[] = [];
	let start = 0;
	for (let i = 0; i <= text.length; i += 1) {
		if (i === text.length || text.charCodeAt(i) <= 32) {
			if (i > start) {
				result.push(text.slice(start, i));
			}
			start = i + 1;
		}
	}
	return result;
}

function uint(text: string, base: number, max: number): number {
	if (!text.length) {
		die("Missing IR number");
	}
	let value = 0;
	const digits = "0123456789abcdef";
	const normalized = text.toLowerCase();
	for (let i = 0; i < normalized.length; i += 1) {
		const digit = digits.indexOf(normalized.slice(i, i + 1));
		if (digit < 0 || digit >= base) {
			die("Invalid IR number: " + text);
		}
		value = value * base + digit;
		if (value > max) {
			die("IR number out of range: " + text);
		}
	}
	return value;
}

// Flipper .ir files store address/command as four little-endian hex bytes.
function hex32(text: string): number {
	const bytes = words(text);
	if (bytes.length !== 4) {
		die("Expected four IR hex bytes: " + text);
	}
	let value = 0;
	let multiplier = 1;
	for (let i = 0; i < bytes.length; i += 1) {
		if (bytes[i].length !== 2) {
			die("Expected two-digit IR hex bytes: " + text);
		}
		value += uint(bytes[i], 16, 255) * multiplier;
		multiplier *= 256;
	}
	return value;
}

function dutyCycle(text: string): number {
	if (text.length > 12) {
		die("Invalid IR RAW duty cycle: " + text);
	}
	const dot = text.indexOf(".");
	if (dot < 0) {
		return uint(text, 10, 1);
	}
	const whole = uint(text.slice(0, dot), 10, 1);
	const fraction = text.slice(dot + 1);
	let divisor = 1;
	for (let i = 0; i < fraction.length; i += 1) {
		divisor *= 10;
	}
	return whole + uint(fraction, 10, divisor) / divisor;
}

function field(fields: Fields, key: string): string {
	if (!fields[key]) {
		die("Missing IR field: " + key);
	}
	return fields[key];
}

function signal(fields: Fields): IrSignal {
	const name = field(fields, "name");
	const type = field(fields, "type");
	if (type === "parsed") {
		const protocol = field(fields, "protocol");
		// Validate before calling native code, which asserts on unknown protocols.
		const limits: { [protocol: string]: number[] } = {
			NEC: [0xff, 0xff],
			NECext: [0xffff, 0xffff],
			NEC42: [0x1fff, 0xff],
			NEC42ext: [0x3ffffff, 0xffff],
			Samsung32: [0xff, 0xff],
			RC6: [0xff, 0xff],
			RC5: [0x1f, 0x3f],
			RC5X: [0x1f, 0x7f],
			SIRC: [0x1f, 0x7f],
			SIRC15: [0xff, 0x7f],
			SIRC20: [0x1fff, 0x7f],
			Kaseikyo: [0x3ffffff, 0x3ff],
			RCA: [0xf, 0xff],
		};
		const limit = limits[protocol];
		if (!limit) {
			die("Unsupported IR protocol: " + protocol);
		}
		const address = hex32(field(fields, "address"));
		const command = hex32(field(fields, "command"));
		if (address > limit[0] || command > limit[1]) {
			die("IR address or command out of range: " + name);
		}
		return {
			name,
			type,
			protocol: protocol as Infrared.Protocol,
			address,
			command,
		};
	}
	if (type === "raw") {
		const timings: number[] = [];
		const values = words(field(fields, "data"));
		if (!values.length || values.length > 1024) {
			die("IR RAW must contain 1 to 1024 timings");
		}
		for (let i = 0; i < values.length; i += 1) {
			const timing = uint(values[i], 10, 0x7fffffff);
			if (!timing) {
				die("IR RAW timings must be positive");
			}
			timings.push(timing);
		}
		const frequency = uint(field(fields, "frequency"), 10, 1000000);
		const duty = dutyCycle(field(fields, "duty_cycle"));
		if (frequency < 10000 || duty <= 0 || duty > 1) {
			die("Invalid IR RAW frequency or duty cycle");
		}
		return { name, type, timings, frequency, dutyCycle: duty };
	}
	die("Unsupported IR signal type: " + type);
}

function readSignals(path: string): IrSignal[] {
	const file = storage.openFile(path, "r", "open_existing");
	if (!file) {
		die("Could not open IR file: " + path);
	}
	const size = file.size();
	if (size > MAX_FILE_SIZE) {
		file.close();
		die("IR file exceeds 64 KiB: " + path);
	}
	const text = file.read<string>("ascii", size);
	file.close();
	if (text.length !== size) {
		die("Could not read complete IR file: " + path);
	}
	const signals: IrSignal[] = [];
	const header: Fields = {};
	let fields: Fields = {};
	let start = 0;
	for (let i = 0; i <= text.length; i += 1) {
		if (i !== text.length && text.charCodeAt(i) !== 10) {
			continue;
		}
		const line = trim(text.slice(start, i));
		start = i + 1;
		if (!line.length || line.slice(0, 1) === "#") {
			continue;
		}
		const colon = line.indexOf(":");
		if (colon < 1) {
			die("Invalid IR line: " + line);
		}
		const key = trim(line.slice(0, colon));
		const value = trim(line.slice(colon + 1));
		if (key === "name" && fields.name) {
			signals.push(signal(fields));
			fields = {};
		}
		if (key === "Filetype" || key === "Version") {
			header[key] = value;
		} else {
			fields[key] = value;
		}
	}
	if (fields.name) {
		signals.push(signal(fields));
	}
	if (header.Filetype !== "IR signals file" || header.Version !== "1") {
		die("Expected an IR signals file, Version 1: " + path);
	}
	return signals;
}

/** Plays names from a saved .ir file or an inline remote; repeats press again. */
export function runIrSequence(
	remote: string | IrSignal[],
	names: string[],
): void {
	if (!names.length) {
		die("IR sequence is empty. Add button names to the sequence.");
	}
	if (!doesSdkSupport(["infrared-send"])) {
		die("This script requires Unleashed with infrared-send support.");
	}
	const signals = typeof remote === "string" ? readSignals(remote) : remote;
	const sequence: IrSignal[] = [];
	// Resolve every name before transmitting anything.
	for (let i = 0; i < names.length; i += 1) {
		const name = names[i];
		let found = false;
		for (let j = 0; j < signals.length; j += 1) {
			if (signals[j].name === name) {
				if (found) {
					die("Duplicate button name in IR file: " + name);
				}
				sequence.push(signals[j]);
				found = true;
			}
		}
		if (!found) {
			die("Button not found in IR file: " + name);
		}
	}
	// Flipper's require rejects duplicate loads instead of returning a cache.
	if (!infraredModule) {
		infraredModule = require("infrared") as typeof Infrared;
	}
	const infrared = infraredModule;
	for (let i = 0; i < sequence.length; i += 1) {
		if (i > 0) {
			delay(COMMAND_DELAY_MS);
		}
		const command = sequence[i];
		print("IR: ", command.name);
		if (command.type === "parsed") {
			infrared.sendSignal(command.protocol, command.address, command.command);
		} else {
			infrared.sendRawSignal(command.timings, true, {
				frequency: command.frequency,
				dutyCycle: command.dutyCycle,
			});
		}
	}
	print("IR sequence complete");
}
