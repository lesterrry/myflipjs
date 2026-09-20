import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { SerialPort } from "serialport";

import { DEVICE_DIR, OUTPUT_DIR, SERIAL_BAUD_RATE } from "./config.mjs";

const PROMPT = ">: ";
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+\.js$/;

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
      console.log("With no names, every dist/*.js file is synced.");
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
  let flippers = ports.filter((candidate) => candidate.serialNumber?.startsWith("flip_"));

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
    throw new Error(`Multiple Flippers found (${choices}); select one with --port.`);
  }

  return flippers[0].path;
}

async function openPort(portPath) {
  const port = new SerialPort({
    path: portPath,
    baudRate: SERIAL_BAUD_RATE,
    autoOpen: false,
  });
  await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
  return port;
}

function createCli(port) {
  let received = "";
  let cursor = 0;

  port.on("data", (chunk) => {
    received += chunk.toString("utf8");
  });

  function waitFor(text, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;

      const check = () => {
        const match = received.indexOf(text, cursor);
        if (match === -1) return;
        cursor = match + text.length;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(received.slice(0, cursor));
      };

      const poll = setInterval(check, 20);
      timer = setTimeout(() => {
        clearInterval(poll);
        reject(new Error(`Timed out waiting for Flipper CLI response: ${JSON.stringify(text)}`));
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
  await new Promise((resolve, reject) => port.close((error) => (error ? reject(error) : resolve())));
}

async function main() {
  const { names: requestedNames, port: explicitPort } = parseArguments(process.argv.slice(2));
  const availableNames = (await readdir(OUTPUT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();
  const names = requestedNames.length > 0 ? requestedNames : availableNames;

  if (names.length === 0) throw new Error("Nothing to sync. Run npm run build first.");
  for (const name of names) {
    if (!SAFE_FILE_NAME.test(name)) throw new Error(`Unsafe script filename: ${name}`);
    if (!availableNames.includes(name)) {
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

    for (const name of names) {
      const localPath = path.join(OUTPUT_DIR, name);
      const devicePath = `${DEVICE_DIR}/${name}`;
      const contents = await readFile(localPath);

      // This is the same overwrite sequence used by the official fz-sdk uploader.
      await cli.write(`storage remove ${devicePath}\r`);
      await cli.waitFor(PROMPT, 3000);
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
