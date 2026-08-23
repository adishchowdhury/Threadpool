import fs from "fs";
import path from "path";
import crypto from "crypto";
import manifest from "../models/model-manifest.json";

async function downloadFile(url: string, dest: string, expectedSize: number, expectedHash: string): Promise<void> {
  console.log(`Downloading from ${url} to ${dest}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(dest);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Could not initialize response stream reader.");
  }

  const hash = crypto.createHash("sha256");
  let downloadedBytes = 0;
  let lastLoggedProgress = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (value) {
      downloadedBytes += value.length;
      hash.update(value);
      fileStream.write(value);

      const progress = Math.round((downloadedBytes / expectedSize) * 100);
      if (progress % 10 === 0 && progress !== lastLoggedProgress) {
        console.log(`Download progress: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} / ${(expectedSize / 1024 / 1024).toFixed(1)} MB)`);
        lastLoggedProgress = progress;
      }
    }
  }

  fileStream.end();

  // Verify hash
  const calculatedHash = hash.digest("hex");
  if (calculatedHash !== expectedHash) {
    // Delete file if hash is mismatch to prevent corruption
    try { fs.unlinkSync(dest); } catch {}
    throw new Error(`SHA256 mismatch!\nExpected: ${expectedHash}\nCalculated: ${calculatedHash}`);
  }

  console.log("✓ Download complete. Hash verified successfully!");
}

async function main() {
  const modelName = process.env.PROMPT_MODEL_NAME || manifest.default;
  const modelConfig = manifest.models.find(m => m.name === modelName);

  if (!modelConfig) {
    console.error(`Error: Model ${modelName} not found in model-manifest.json.`);
    process.exit(1);
  }

  const destDir = path.join(process.cwd(), "models");
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destPath = path.join(destDir, `${modelConfig.name.toLowerCase()}.${modelConfig.format.toLowerCase()}`);

  if (fs.existsSync(destPath)) {
    // Check if existing file is already correct
    const stats = fs.statSync(destPath);
    if (stats.size === modelConfig.sizeBytes) {
      console.log(`Model file already exists at ${destPath} with correct size. Skipping download.`);
      process.exit(0);
    }
    console.log(`Local file exists but size mismatch (${stats.size} vs ${modelConfig.sizeBytes}). Re-downloading...`);
  }

  try {
    await downloadFile(modelConfig.source, destPath, modelConfig.sizeBytes, modelConfig.sha256);
    console.log(`Successfully downloaded model: ${modelConfig.name}`);
    process.exit(0);
  } catch (err: any) {
    console.error("Failed to download model:", err.message);
    process.exit(1);
  }
}

main();
