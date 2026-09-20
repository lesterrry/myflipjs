declare module "@flipperdevices/fz-sdk/power" {
	/** Returns true while external USB VBUS is present. */
	export function isUsbPowered(): boolean;

	/** Returns the current USB VBUS voltage. */
	export function usbVoltage(): number;

	/** Returns true while the battery is actively charging. */
	export function isCharging(): boolean;
}
