// mJS exposes FFI, but the SDK does not declare it.
declare function ffi(signature: string): (datetime: RawPointer) => void;

if (typeof ffi === "undefined") {
	die("This firmware does not provide FFI access to the Flipper clock.");
}

const readRtcDatetime = ffi("void furi_hal_rtc_get_datetime(void *)");

export type RtcDateTime = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

export function getRtcDatetime(): RtcDateTime {
	// ARM DateTime layout: hour, minute, second, day, month, padding,
	// uint16 year (little-endian), weekday, padding. Read RTC once atomically.
	// https://developer.flipper.net/flipperzero/doxygen/datetime_8h_source.html
	// biome-ignore lint/correctness/noInvalidBuiltinInstantiation: mJS creates typed arrays without new.
	const bytes = Uint8Array(10) as Uint8Array & { [index: number]: number };
	readRtcDatetime(bytes.buffer.getPtr);
	const hour = bytes[0];
	const minute = bytes[1];
	const second = bytes[2];
	const day = bytes[3];
	const month = bytes[4];
	const yearLow = bytes[6];
	const yearHigh = bytes[7];
	const year = yearLow + yearHigh * 256;
	if (
		year < 2000 ||
		year > 2099 ||
		month < 1 ||
		month > 12 ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		die("Invalid Flipper RTC date/time. Check the device clock settings.");
	}
	const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (year % 4 === 0) {
		daysInMonth[1] = 29;
	}
	if (day < 1 || day > daysInMonth[month - 1]) {
		die("Invalid Flipper RTC day. Check the device clock settings.");
	}
	return { year, month, day, hour, minute, second };
}
