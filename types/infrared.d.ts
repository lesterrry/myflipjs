declare module "@flipperdevices/fz-sdk/infrared" {
	/** Protocol names supported by the Unleashed infrared-send module. */
	export type Protocol =
		| "NEC"
		| "NECext"
		| "NEC42"
		| "NEC42ext"
		| "Samsung32"
		| "RC6"
		| "RC5"
		| "RC5X"
		| "SIRC"
		| "SIRC15"
		| "SIRC20"
		| "Kaseikyo"
		| "RCA";

	/** Address and command are numeric values, not .ir little-endian byte strings. */
	export function sendSignal(
		protocol: Protocol,
		address: number,
		command: number,
	): void;

	export function sendRawSignal(
		timings: number[],
		startFromMark: boolean,
		settings: { frequency: number; dutyCycle: number },
	): void;
}
