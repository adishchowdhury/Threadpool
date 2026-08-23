# Momentum Prompt Optimization Models

This directory contains the manifest and local storage configuration for small, instruction-tuned GGUF language models used by the Prompt Optimization Engine.

## Manifest Details
- The available models and their download sources, SHA-256 hashes, and license files are configured in [`model-manifest.json`](file:///c:/New%20folder/Desktop/innofusion/models/model-manifest.json).

## Setup
To download and verify the default optimization model:
```bash
npm run model:download
```

## Config Variables
Configure the active model parameters inside your `.env` file:
- `PROMPT_MODEL_ENABLED=true` (Toggle local prompt optimization on/off)
- `PROMPT_MODEL_PATH="models/qwen2.5-0.5b-instruct-q4_k_m.gguf"` (Absolute or relative path to model binary)
