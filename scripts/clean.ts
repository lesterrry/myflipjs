import * as storage from "@flipperdevices/fz-sdk/storage";

const SD_ROOT = "/ext";
const APPLEDOUBLE_PREFIX = "._";
const DISK_LABEL_PREFIX = ".disk_label";
const TRASH_PREFIX = ".Trash-";
const TIME_MACHINE_PREFIX = ".com.apple.timemachine.";
const TIME_MACHINE_LEGACY_PREFIX = ".com.apple.TimeMachine.";

function isMacosMetadata(
	name: string,
	isDirectory: boolean,
	isRootEntry: boolean,
): boolean {
	if (isDirectory && (name === ".AppleDouble" || name === "__MACOSX")) {
		return true;
	}

	if (!isDirectory) {
		if (name.slice(0, APPLEDOUBLE_PREFIX.length) === APPLEDOUBLE_PREFIX) {
			return true;
		}
		if (
			name === ".DS_Store" ||
			name === ".LSOverride" ||
			name === ".localized" ||
			name === "Icon\r"
		) {
			return true;
		}
	}

	if (!isRootEntry) {
		return false;
	}

	if (
		name.slice(0, TIME_MACHINE_PREFIX.length) === TIME_MACHINE_PREFIX ||
		name.slice(0, TIME_MACHINE_LEGACY_PREFIX.length) ===
			TIME_MACHINE_LEGACY_PREFIX ||
		name.slice(0, DISK_LABEL_PREFIX.length) === DISK_LABEL_PREFIX
	) {
		return true;
	}

	if (isDirectory) {
		if (name.slice(0, TRASH_PREFIX.length) === TRASH_PREFIX) {
			return true;
		}

		return (
			name === ".Spotlight-V100" ||
			name === ".Trashes" ||
			name === ".Trash" ||
			name === ".fseventsd" ||
			name === ".TemporaryItems" ||
			name === ".DocumentRevisions-V100" ||
			name === ".AppleDB" ||
			name === ".AppleDesktop" ||
			name === ".MobileBackups" ||
			name === ".MobileBackups.trash" ||
			name === "MobileBackups.trash" ||
			name === ".PKInstallSandboxManager" ||
			name === ".PKInstallSandboxManager-SystemSoftware" ||
			name === ".vol" ||
			name === ".HFS+ Private Directory Data\r" ||
			name === "Backups.backupdb" ||
			name === "Network Trash Folder" ||
			name === "Temporary Items" ||
			name === "TheFindByContentFolder" ||
			name === "TheVolumeSettingsFolder" ||
			name === ".FBCLockFolder"
		);
	}

	return (
		name === ".apdisk" ||
		name === ".metadata_never_index" ||
		name === ".metadata_never_index_unless_rootfs" ||
		name === ".hotfiles.btree" ||
		name === ".file" ||
		name === ".journal" ||
		name === ".journal_info_block" ||
		name === ".VolumeIcon.icns" ||
		name === "Desktop DB" ||
		name === "Desktop DF" ||
		name === ".FBCIndex" ||
		name === ".FBCSemaphoreFile" ||
		name === ".quota.group" ||
		name === ".quota.user" ||
		name === ".quota.ops.group" ||
		name === ".quota.ops.user" ||
		name === "tmbootpicker.efi"
	);
}

const pendingDirectories: string[] = [SD_ROOT];
let metadataFiles = 0;
let metadataDirectories = 0;
let deletedItems = 0;
let deletionErrors = 0;
let unreadableDirectories = 0;

print("Scanning SD card...");

while (pendingDirectories.length > 0) {
	const lastIndex = pendingDirectories.length - 1;
	const directory = pendingDirectories[lastIndex];
	pendingDirectories.splice(lastIndex, 1);

	const entries = storage.readDirectory(directory);
	if (!entries) {
		unreadableDirectories += 1;
		continue;
	}

	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const name = entry.path;

		if (name === "." || name === "..") {
			continue;
		}

		const entryPath = directory + "/" + name;

		if (isMacosMetadata(name, entry.isDirectory, directory === SD_ROOT)) {
			let deleted = false;
			if (entry.isDirectory) {
				metadataDirectories += 1;
				deleted = storage.rmrf(entryPath);
			} else {
				metadataFiles += 1;
				deleted = storage.remove(entryPath);
			}

			if (deleted) {
				deletedItems += 1;
			} else {
				deletionErrors += 1;
			}
			continue;
		}

		if (entry.isDirectory) {
			pendingDirectories.push(entryPath);
		}
	}
}

print("Found:", metadataFiles + metadataDirectories);
print("Deleted:", deletedItems);
print("Delete errors:", deletionErrors);
print("Read errors:", unreadableDirectories);
