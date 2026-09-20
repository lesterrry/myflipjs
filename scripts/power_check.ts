import * as eventLoop from "@flipperdevices/fz-sdk/event_loop";
import * as gui from "@flipperdevices/fz-sdk/gui";

import dialog = require("@flipperdevices/fz-sdk/gui/dialog");

import * as notification from "@flipperdevices/fz-sdk/notification";
import * as power from "@flipperdevices/fz-sdk/power";

const CHECK_INTERVAL_MS = 10000;
const ALARM_INTERVAL_MS = 1000;
const MISSED_CHECK_LIMIT = 3;

const STATE_MONITORING = 0;
const STATE_ALARMING = 1;
const STATE_ACKNOWLEDGED = 2;

type PowerViewProperties = {
	header: string;
	text: string;
	left: string;
	center: string;
	right: string;
};

type PowerView = gui.View<PowerViewProperties, never>;

type PowerContext = {
	view: PowerView;
	state: number;
	missedChecks: number;
	hasPowerState: boolean;
	lastPowerState: boolean;
};

function wakeForPowerChange(powered: boolean, context: PowerContext): void {
	gui.viewDispatcher.switchTo(context.view);
	gui.viewDispatcher.sendTo("front");
	if (powered) {
		notification.success();
	} else {
		notification.error();
	}
}

function readPowerState(context: PowerContext): boolean {
	const powered = power.isUsbPowered();
	const changed = context.hasPowerState && powered !== context.lastPowerState;
	context.hasPowerState = true;
	context.lastPowerState = powered;

	if (changed) {
		wakeForPowerChange(powered, context);
	}

	return powered;
}

function showConnected(context: PowerContext): void {
	context.state = STATE_MONITORING;
	context.missedChecks = 0;
	context.view.set("header", "Power monitor");
	context.view.set("text", "USB power connected\nChecking every 10 sec");
	context.view.set("center", "");
}

function showMissingCheck(context: PowerContext): void {
	const missedChecksText = context.missedChecks.toString();
	context.view.set("header", "Power missing");
	context.view.set(
		"text",
		"Failed check " + missedChecksText + "/3\nAlarm after 3 failures",
	);
}

function startAlarm(context: PowerContext): void {
	context.state = STATE_ALARMING;
	context.view.set("header", "POWER LOST");
	context.view.set("text", "Reconnect USB power\nor press OK to silence");
	context.view.set("center", "Silence");
	gui.viewDispatcher.switchTo(context.view);
	notification.error();
	notification.blink("red", "long");
}

function acknowledgeAlarm(context: PowerContext): void {
	context.state = STATE_ACKNOWLEDGED;
	context.view.set("header", "Alarm silenced");
	context.view.set("text", "Waiting for USB power\nto be restored");
	context.view.set("center", "");
}

function checkPower(context: PowerContext): void {
	if (readPowerState(context)) {
		showConnected(context);
		return;
	}

	if (context.state !== STATE_MONITORING) {
		return;
	}

	context.missedChecks += 1;
	if (context.missedChecks === MISSED_CHECK_LIMIT) {
		startAlarm(context);
		return;
	}

	showMissingCheck(context);
}

function stopMonitor(): void {
	eventLoop.stop();
}

const view = dialog.makeWith({
	header: "Power monitor",
	text: "Starting USB power\nmonitor...",
	left: "",
	center: "",
	right: "Exit",
});

const context: PowerContext = {
	view,
	state: STATE_MONITORING,
	missedChecks: 0,
	hasPowerState: false,
	lastPowerState: false,
};

eventLoop.subscribe(
	eventLoop.timer("periodic", CHECK_INTERVAL_MS),
	(_subscription, _item, context) => {
		checkPower(context);
	},
	context,
);

eventLoop.subscribe(
	eventLoop.timer("periodic", ALARM_INTERVAL_MS),
	(_subscription, _item, context) => {
		if (
			context.state !== STATE_ALARMING &&
			context.state !== STATE_ACKNOWLEDGED
		) {
			return;
		}

		if (readPowerState(context)) {
			showConnected(context);
			return;
		}

		if (context.state === STATE_ALARMING) {
			notification.error();
			notification.blink("red", "long");
		}
	},
	context,
);

eventLoop.subscribe(
	view.input,
	(_subscription, button, context) => {
		if (button === "center" && context.state === STATE_ALARMING) {
			acknowledgeAlarm(context);
			return;
		}

		if (button === "right") {
			stopMonitor();
		}
	},
	context,
);

eventLoop.subscribe(gui.viewDispatcher.navigation, (_subscription, _item) => {
	stopMonitor();
});

gui.viewDispatcher.switchTo(view);
eventLoop.run();
