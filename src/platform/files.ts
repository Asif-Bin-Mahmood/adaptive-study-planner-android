// Backup file export. On Android the file is written to the app's private
// storage and then offered through the system share sheet, so the user decides
// where it goes (Files, a USB drive, Drive...). Nothing is uploaded automatically.
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function saveBackupFile(name: string, json: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'Backup downloaded.';
  }
  // keep a private copy that survives until the app is uninstalled
  await Filesystem.writeFile({ path: `backups/${name}`, data: json, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  const cached = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: 'Study Planner backup', url: cached.uri, dialogTitle: 'Save backup' });
    return 'Backup created. Choose where to keep it.';
  } catch {
    return 'Backup saved inside the app. Sharing was cancelled.';
  }
}

/** Backups are small (well under 1 MB for a semester); refuse anything implausibly large. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function readFileAsText(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) return Promise.reject(new Error('This file is too large to be a Study Planner backup.'));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}
