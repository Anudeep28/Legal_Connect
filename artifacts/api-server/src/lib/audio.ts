import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isWav(buffer: Buffer): boolean {
  return buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WAVE";
}

function isMp3(buffer: Buffer): boolean {
  return buffer.length > 12 &&
    ((buffer[0] === 0x49 && buffer.subarray(0, 3).toString("ascii") === "ID3") ||
      (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0));
}

export async function ensureCompatibleAudio(
  audioBuffer: Buffer,
): Promise<{ buffer: Buffer; format: "wav" | "mp3" }> {
  if (isWav(audioBuffer)) return { buffer: audioBuffer, format: "wav" };
  if (isMp3(audioBuffer)) return { buffer: audioBuffer, format: "mp3" };

  const inputPath = join(tmpdir(), `dictation-${randomUUID()}`);
  const outputPath = join(tmpdir(), `dictation-${randomUUID()}.wav`);
  try {
    await writeFile(inputPath, audioBuffer);
    await new Promise<void>((resolve, reject) => {
      const process = spawn("ffmpeg", [
        "-nostdin", "-v", "error", "-i", inputPath, "-vn",
        "-f", "wav", "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
        "-y", outputPath,
      ], { stdio: ["ignore", "ignore", "ignore"] });
      process.once("error", reject);
      process.once("close", (code) => code === 0 ? resolve() : reject(new Error("Audio conversion failed.")));
    });
    return { buffer: await readFile(outputPath), format: "wav" };
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => undefined),
      unlink(outputPath).catch(() => undefined),
    ]);
  }
}
