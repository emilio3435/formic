import type { Stats } from "node:fs";
import { open } from "node:fs/promises";

export type JsonRecord = Record<string, unknown>;

export const JSONL_READ_CHUNK_BYTES = 1024 * 1024;

const JSONL_ROW_BATCH_SIZE = 64;

type AppendRows = (rows: readonly JsonRecord[]) => void;

interface RowBatch {
  rows: JsonRecord[];
  sourceBytes: number;
}

function appendParsedLine(
  line: string,
  batch: RowBatch,
  appendRows: AppendRows,
): void {
  if (!line) return;
  try {
    const value = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    batch.rows.push(value as JsonRecord);
    batch.sourceBytes += Buffer.byteLength(line);
    if (
      batch.rows.length >= JSONL_ROW_BATCH_SIZE
      || batch.sourceBytes >= JSONL_READ_CHUNK_BYTES
    ) {
      flushRows(batch, appendRows);
    }
  } catch {
    // A live JSONL source may end in a partially-written record.
  }
}

function flushRows(batch: RowBatch, appendRows: AppendRows): void {
  if (batch.rows.length === 0) return;
  appendRows(batch.rows.splice(0));
  batch.sourceBytes = 0;
}

export function appendJsonlText(jsonl: string, appendRows: AppendRows): void {
  const batch: RowBatch = { rows: [], sourceBytes: 0 };
  let offset = 0;
  while (offset < jsonl.length) {
    const newline = jsonl.indexOf("\n", offset);
    if (newline < 0) {
      appendParsedLine(jsonl.slice(offset), batch, appendRows);
      break;
    }
    appendParsedLine(jsonl.slice(offset, newline), batch, appendRows);
    offset = newline + 1;
  }
  flushRows(batch, appendRows);
}

export async function appendJsonFileRange(
  path: string,
  offset: number,
  length: number,
  prefix: Buffer,
  appendRows: AppendRows,
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(Math.max(1, Math.min(JSONL_READ_CHUNK_BYTES, length || 1)));
    const batch: RowBatch = { rows: [], sourceBytes: 0 };
    const pending: Buffer[] = prefix.length > 0 ? [Buffer.from(prefix)] : [];
    let pendingBytes = prefix.length;
    let bytesRead = 0;

    const appendLine = (line: Buffer): void => {
      let complete = line;
      if (pendingBytes > 0) {
        pending.push(line);
        complete = Buffer.concat(pending, pendingBytes + line.length);
      }
      pending.length = 0;
      pendingBytes = 0;
      appendParsedLine(complete.toString("utf8"), batch, appendRows);
    };

    while (bytesRead < length) {
      const requested = Math.min(chunk.length, length - bytesRead);
      const read = await handle.read(chunk, 0, requested, offset + bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;

      let lineStart = 0;
      for (let index = 0; index < read.bytesRead; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        appendLine(chunk.subarray(lineStart, index));
        lineStart = index + 1;
      }
      if (lineStart < read.bytesRead) {
        const trailing = Buffer.from(chunk.subarray(lineStart, read.bytesRead));
        pending.push(trailing);
        pendingBytes += trailing.length;
      }
      flushRows(batch, appendRows);
    }

    if (bytesRead !== length) {
      throw new Error(`JSONL snapshot ended after ${bytesRead} of ${length} bytes`);
    }
    flushRows(batch, appendRows);
    return pendingBytes === 0 ? Buffer.alloc(0) : Buffer.concat(pending, pendingBytes);
  } finally {
    await handle.close();
  }
}

export function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size;
}
