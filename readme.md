# Janotor
Deno script for syncing donations to vauhtijuoksu api

## Requirements
- [Deno](https://deno.land/)

## Setup
1. Copy `.env.example` to `.env` and fill in your environment variables
2. Run the script:
   ```bash
   deno --allow-read --allow-env --allow-net janotor.js
   ```

## Compilation
To compile for Linux:
```bash
deno compile --target x86_64-unknown-linux-gnu --allow-read --allow-env --allow-net janotor.js
```