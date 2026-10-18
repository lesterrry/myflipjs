import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";

// In-memory Flipper CLI used only by sync.test.mjs.
export class SerialPort extends EventEmitter {
	static async list() {
		return [{ path: "/fake/flipper", serialNumber: "flip_test" }];
	}

	files = JSON.parse(process.env.TEST_REMOTE_FILES);
	removeErrors = JSON.parse(process.env.TEST_REMOVE_ERRORS);
	operations = [];
	isOpen = false;
	pendingPath;

	open(callback) {
		this.isOpen = true;
		callback();
	}

	drain(callback) {
		callback();
	}

	write(data, callback) {
		let response = "\r\n>: ";
		if (this.pendingPath) {
			this.files[this.pendingPath] = data.toString();
			this.operations.push(["upload", this.pendingPath]);
			this.pendingPath = undefined;
		} else {
			const command = data.toString().trim();
			if (command.startsWith("storage list ")) {
				const directory = command.slice("storage list ".length);
				if (process.env.TEST_LIST_ERROR) {
					response = `Storage error: ${process.env.TEST_LIST_ERROR}\r\n>: `;
				} else {
					const entries = Object.entries(this.files)
						.filter(([name]) => name.startsWith(`${directory}/`))
						.map(([name, contents]) => {
							const relative = name.slice(directory.length + 1);
							if (relative.includes("/")) {
								return `\t[D] ${relative.split("/")[0]}`;
							}
							return `\t[F] ${relative} ${Buffer.byteLength(contents)}b`;
						});
					response = `${entries.join("\r\n") || "\tEmpty"}\r\n>: `;
				}
			} else if (command.startsWith("storage remove ")) {
				const path = command.slice("storage remove ".length);
				this.operations.push(["remove", path]);
				const error = this.removeErrors[path] || process.env.TEST_REMOVE_ERROR;
				if (error) {
					response = `Storage error: ${error}\r\n>: `;
				} else if (Object.hasOwn(this.files, path)) {
					delete this.files[path];
				} else {
					response = "Storage error: file/dir not exist\r\n>: ";
				}
			} else if (command.startsWith("storage write_chunk ")) {
				this.pendingPath = command.split(" ")[2];
				response = "Ready";
			} else if (command) {
				throw new Error(`Unexpected fake CLI command: ${command}`);
			}
		}
		callback();
		this.emit("data", Buffer.from(response));
	}

	close(callback) {
		this.isOpen = false;
		writeFileSync(
			process.env.TEST_RESULT_PATH,
			JSON.stringify({ files: this.files, operations: this.operations }),
		);
		callback();
	}
}
