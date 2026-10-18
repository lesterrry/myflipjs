import {
	COMMAND_DELAY_MS,
	type IrSignal,
	runIrSequence,
} from "./common/ir_sequence";
import { getRtcDatetime } from "./common/rtc";

// Samsung32 button codes from the Samsung AA59-00580A capture.
// https://github.com/Lucaslhm/Flipper-IRDB/blob/main/TVs/Samsung/Samsung_AA59-00580A.ir
// Inline buttons are bundled into the script; no remote file is needed.
const REMOTE: IrSignal[] = [
	{
		name: "Exit",
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: 0x2d,
	},
	{
		name: "Menu",
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: 0x1a,
	},
	{
		name: "Down",
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: 0x61,
	},
	{
		name: "OK",
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: 0x68,
	},
	{
		name: "Right",
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: 0x62,
	},
];

// Numeric buttons 0..9, indexed by the digit itself.
const DIGIT_COMMANDS = [
	0x11, 0x04, 0x05, 0x06, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0e,
];
for (let digit = 0; digit < DIGIT_COMMANDS.length; digit += 1) {
	REMOTE.push({
		name: digit.toString(),
		type: "parsed",
		protocol: "Samsung32",
		address: 0x07,
		command: DIGIT_COMMANDS[digit],
	});
}

// Start with the TV on. This sequence opens the first clock field (month).
const SEQUENCE: string[] = [
	"Exit",
	"Menu",
	"Down",
	"Down",
	"OK",
	"Down",
	"OK",
	"OK",
];

function padded(value: number, width: number): string {
	let text = value.toString();
	while (text.length < width) {
		text = "0" + text;
	}
	return text;
}

print("Make sure that:");
print("- TV is ON");
print("- Apple TV is selected");

delay(1000);

runIrSequence(REMOTE, SEQUENCE);

delay(COMMAND_DELAY_MS);

const datetime = getRtcDatetime();
const month = padded(datetime.month, 2);
const day = padded(datetime.day, 2);
const year = padded(datetime.year % 100, 2);
const hour = padded(datetime.hour, 2);
const minute = padded(datetime.minute, 2);

print("Date: ", month, "/", day, "/", year);
print("Time: ", hour, ":", minute);

// The TV displays four year digits but accepts only YY from the remote.
// Enter MM DD YY HH mm, then confirm with OK.
const dateTime = month + day + year + hour + minute;
const clockSequence: string[] = [];
for (let digit = 0; digit < dateTime.length; digit += 1) {
	clockSequence.push(dateTime.slice(digit, digit + 1));
}

clockSequence.push("OK");
clockSequence.push("Exit");

runIrSequence(REMOTE, clockSequence);
