import badusb = require("@flipperdevices/fz-sdk/badusb");
import eventLoop = require("@flipperdevices/fz-sdk/event_loop");
import flipper = require("@flipperdevices/fz-sdk/flipper");
import gpio = require("@flipperdevices/fz-sdk/gpio");
import gui = require("@flipperdevices/fz-sdk/gui");

import dialog = require("@flipperdevices/fz-sdk/gui/dialog");

import notification = require("@flipperdevices/fz-sdk/notification");
import storage = require("@flipperdevices/fz-sdk/storage");

const REPORT_PATH = __dirname + "/power_diagnostic.txt";
const PHASE_REPORT_CHOICE = 0;
const PHASE_DISCONNECT = 1;
const PHASE_CONNECT = 2;
const PHASE_SAMPLE = 3;
const PHASE_DONE = 4;
const SAMPLE_INTERVAL_MS = 5000;
const SAMPLE_COUNT = 6;

type RuntimeModule = {
	[property: string]: unknown;
};

type DiagnosticView = {
	set(
		property: "header" | "text" | "left" | "center" | "right",
		value: string,
	): void;
};

type OptionalReport = storage.File | false;

type DiagnosticContext = {
	report: OptionalReport;
	usbStarted: boolean;
	view: DiagnosticView;
	phase: number;
	sampleNumber: number;
};

function writeLine(report: OptionalReport, line: string): void {
	if (report) {
		report.write(line + "\n");
	}
	print(line);
}

function dumpModule(
	report: OptionalReport,
	moduleName: string,
	moduleObject: RuntimeModule,
): void {
	writeLine(report, "[module " + moduleName + "]");
	let propertyCount = 0;
	let property = "";
	for (property in moduleObject) {
		writeLine(report, property + ": " + typeof moduleObject[property]);
		propertyCount += 1;
	}
	if (propertyCount === 0) {
		writeLine(report, "(no enumerable properties)");
	}
}

function dumpFeature(report: OptionalReport, featureName: string): void {
	const supported = doesSdkSupport([featureName]);
	writeLine(
		report,
		"feature " + featureName + ": " + (supported ? "true" : "false"),
	);
}

function beginDiagnostic(
	context: DiagnosticContext,
	saveReport: boolean,
): void {
	if (saveReport) {
		const report = storage.openFile(REPORT_PATH, "w", "create_always");
		if (!report) {
			die("Could not create " + REPORT_PATH);
		}
		context.report = report;
	}

	writeLine(context.report, "Power diagnostic v1");
	const firmwareVendor = flipper.firmwareVendor;
	const sdkMajor = flipper.jsSdkVersion[0].toString();
	const sdkMinor = flipper.jsSdkVersion[1].toString();
	const model = flipper.getModel();
	const initialBattery = flipper.getBatteryCharge().toString();
	writeLine(context.report, "Firmware vendor: " + firmwareVendor);
	writeLine(context.report, "JS SDK: " + sdkMajor + "." + sdkMinor);
	writeLine(context.report, "Model: " + model);
	writeLine(context.report, "Initial battery: " + initialBattery + "%");

	dumpModule(context.report, "flipper", flipper as RuntimeModule);
	dumpModule(context.report, "badusb", badusb as RuntimeModule);
	dumpModule(context.report, "notification", notification as RuntimeModule);
	dumpModule(context.report, "usbdisk", require("usbdisk"));
	dumpModule(context.report, "gpio", gpio as RuntimeModule);
	dumpModule(context.report, "i2c", require("i2c"));
	dumpModule(context.report, "spi", require("spi"));

	dumpFeature(context.report, "power");
	dumpFeature(context.report, "power-info");
	dumpFeature(context.report, "power-status");
	dumpFeature(context.report, "battery-info");
	dumpFeature(context.report, "charging");
	dumpFeature(context.report, "usb-power");

	context.phase = PHASE_DISCONNECT;
	context.view.set("header", "Power diagnostic");
	context.view.set("text", "Disconnect every USB\ncable, then press OK");
	context.view.set("left", "");
	context.view.set("center", "OK");
	context.view.set("right", "");
}

function finishDiagnostic(context: DiagnosticContext): void {
	if (context.usbStarted) {
		badusb.quit();
		context.usbStarted = false;
	}
	if (context.report) {
		writeLine(context.report, "Diagnostic complete.");
		writeLine(context.report, "Report: " + REPORT_PATH);
		context.report.close();
		context.report = false;
		context.view.set(
			"text",
			"Report saved to\napps/Scripts/\npower_diagnostic.txt",
		);
	} else {
		writeLine(context.report, "Diagnostic complete.");
		context.view.set("text", "Diagnostic complete.\nNo report saved.");
	}
	context.phase = PHASE_DONE;
	context.view.set("header", "Diagnostic done");
	context.view.set("center", "Exit");
}

const view = dialog.makeWith({
	header: "Power diagnostic",
	text: "Save results to a\ntext report?",
	left: "No",
	center: "",
	right: "Yes",
});

const context = {
	report: false as OptionalReport,
	usbStarted: false,
	view,
	phase: PHASE_REPORT_CHOICE,
	sampleNumber: 0,
};

eventLoop.subscribe(
	view.input,
	(_subscription, button, context) => {
		if (context.phase === PHASE_REPORT_CHOICE) {
			if (button === "left") {
				beginDiagnostic(context, false);
			}
			if (button === "right") {
				beginDiagnostic(context, true);
			}
			return;
		}

		if (button !== "center") {
			return;
		}

		if (context.phase === PHASE_DISCONNECT) {
			writeLine(context.report, "[disconnected]");
			const battery = flipper.getBatteryCharge().toString();
			writeLine(context.report, "battery: " + battery + "%");
			badusb.setup();
			context.usbStarted = true;
			const usbConnected = badusb.isConnected();
			writeLine(
				context.report,
				"badusb connected: " + (usbConnected ? "true" : "false"),
			);
			context.phase = PHASE_CONNECT;
			context.view.set("header", "Connect power");
			context.view.set(
				"text",
				"Connect the intended\npower source, wait 5s,\nthen press OK",
			);
			return;
		}

		if (context.phase === PHASE_CONNECT) {
			writeLine(context.report, "[connected]");
			const battery = flipper.getBatteryCharge().toString();
			const usbConnected = badusb.isConnected();
			writeLine(context.report, "battery: " + battery + "%");
			writeLine(
				context.report,
				"badusb connected: " + (usbConnected ? "true" : "false"),
			);
			context.phase = PHASE_SAMPLE;
			context.sampleNumber = 0;
			context.view.set("header", "Sampling power");
			context.view.set("text", "Taking six samples\nover 30 seconds...");
			context.view.set("center", "");
			return;
		}

		if (context.phase === PHASE_DONE) {
			eventLoop.stop();
		}
	},
	context,
);

eventLoop.subscribe(
	eventLoop.timer("periodic", SAMPLE_INTERVAL_MS),
	(_subscription, _item, context) => {
		if (context.phase !== PHASE_SAMPLE) {
			return;
		}

		context.sampleNumber += 1;
		const battery = flipper.getBatteryCharge();
		const usbConnected = badusb.isConnected();
		const sampleNumberText = context.sampleNumber.toString();
		const batteryText = battery.toString();
		const usbConnectedText = usbConnected ? "true" : "false";
		writeLine(
			context.report,
			"sample " +
				sampleNumberText +
				": battery=" +
				batteryText +
				"%, badusb=" +
				usbConnectedText,
		);
		context.view.set(
			"text",
			"Sample " +
				sampleNumberText +
				"/" +
				SAMPLE_COUNT.toString() +
				"\nBattery: " +
				batteryText +
				"%\nUSB host: " +
				usbConnectedText,
		);

		if (context.sampleNumber === SAMPLE_COUNT) {
			finishDiagnostic(context);
		}
	},
	context,
);

eventLoop.subscribe(
	gui.viewDispatcher.navigation,
	(_subscription, _item, context) => {
		if (context.usbStarted) {
			badusb.quit();
			context.usbStarted = false;
		}
		if (context.report) {
			writeLine(context.report, "Diagnostic cancelled.");
			context.report.close();
			context.report = false;
		}
		eventLoop.stop();
	},
	context,
);

gui.viewDispatcher.switchTo(view);
eventLoop.run();
