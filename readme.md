# Janotor
Bun script for syncing donations to vauhtijuoksu api

## Requirements
- [Bun](https://bun.sh/)

## Setup
1. Copy `.env.example` to `.env` and fill in your environment variables
2. List the fundraisers in `charities.json` (or the file in `CHARITIES_FILE`). `name` is for the logs, `type` is `iraiser`, `securycast` or `betternow`.
   `charity` is the `id` of the charity in the API's `/charities`, so create the charities first, e.g. in the admin panel
3. Run the script:
   ```bash
   bun janotor.js
   ```

## Compilation
To compile for Linux:
```bash
bun build --compile --target=bun-linux-x64 janotor.js --outfile janotor
```

## Measuring API delay
Make a test donation while this runs and compare when each line shows it:
```bash
bun delay-watch.js
```
