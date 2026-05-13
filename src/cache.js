import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class DailyCache {
  constructor({ root = path.resolve(process.cwd(), ".cache", "betpawa-cli"), date = localDate() } = {}) {
    this.root = root;
    this.date = date;
  }

  async read(namespace, key) {
    try {
      const raw = await readFile(this.filePath(namespace, key), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async write(namespace, key, value) {
    const file = this.filePath(namespace, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
    return value;
  }

  filePath(namespace, key) {
    const safeNamespace = safePathPart(namespace);
    const safeKey = safePathPart(key);
    return path.join(this.root, this.date, safeNamespace, `${safeKey}.json`);
  }
}

export function safePathPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
