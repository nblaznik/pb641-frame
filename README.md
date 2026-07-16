# PocketBook Frame

PocketBook Frame turns a PocketBook PB641 into a public, twice-daily E-Ink drawing contest. Anyone can draw, submit, browse the current entries, and vote. A live countdown shows the next deadline. At 09:00 and 18:00 Europe/Ljubljana time, the highest-voted drawing is published to the PocketBook with the artist's name and optional location in its footer.

The live contest is available at <https://pb641-frame.blaznik-nejc.workers.dev>.

## Components

- `src/main.cpp`: PocketBook InkView polling application.
- `server/public/index.html`: responsive drawing and voting interface.
- `cloudflare/worker.js`: public contest API and scheduled winner selection.
- `cloudflare/migrations/`: D1 contest database schema.
- `device/pb641-frame.cfg.example`: PocketBook configuration template.
- `build.sh`: ARM cross-build script for the PocketBook SDK container.

## Contest Behavior

- Submissions and voting are public and require no account or access code.
- Each browser can vote once for each drawing. This is a lightweight preference, not strong identity verification.
- Active entries compete until the next 09:00 or 18:00 cutoff.
- The entry with the most votes wins; ties go to the earliest submission.
- A cutoff archives all entries in that round and starts a new round.
- Published winners remain available in the Hall of Fame with their attribution, vote total, and publication time.
- If a round has no submissions, the currently displayed PocketBook image remains unchanged.
- Submission JPEGs are stored in Cloudflare KV and contest records and votes are stored in D1.

## Cloudflare Deployment

The production Worker serves the static interface and API from one HTTPS origin. It runs an hourly cron and publishes only when the local Europe/Ljubljana hour is 09 or 18.

To provision another deployment:

```sh
npx wrangler login
npx wrangler kv namespace create FRAME_DATA
npx wrangler d1 create pb641-frame
npx wrangler d1 migrations apply pb641-frame --remote --config cloudflare/wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Update the KV and D1 IDs in `cloudflare/wrangler.jsonc` after creating those resources. `ADMIN_TOKEN` protects only the undocumented manual publication endpoint; public contest operations do not use a token.

### Manual Publication

Open <https://pb641-frame.blaznik-nejc.workers.dev/admin.html> and enter the Cloudflare `ADMIN_TOKEN` to unlock the image library. From there an administrator can preview every record, send any available image directly to the frame without affecting voting, select an active submission as the winner and close its round, or permanently delete an image and its related votes and records. Deleting the currently displayed image restores the previous Hall of Fame winner when available. Scheduled publication still selects the vote leader automatically.

Submission images are stored in Cloudflare KV under `submission:<uuid>` for 14 days. Published and directly displayed images are retained under `published:<sha256>`. Names, votes, round state, and publication history live in D1. Use the admin page rather than deleting KV keys manually so both stores remain consistent.

## Build And Install The Device App

Build the SDK image once if needed:

```sh
docker build -t pb641-sdk-a13 .
```

Cross-compile the application:

```sh
docker run --rm -v "$PWD:/project" pb641-sdk-a13 ./build.sh
```

When the PocketBook is connected over USB, its drive root corresponds to `/mnt/ext1` in InkView paths. Copy:

- `build/PB641Frame.app` to `applications/PB641Frame.app` on the USB drive.
- `device/pb641-frame.cfg` to `system/config/pb641-frame.cfg` on the USB drive.

Example configuration:

```ini
server_url=https://pb641-frame.blaznik-nejc.workers.dev
poll_seconds=300
```

Connect the PocketBook to Wi-Fi through its normal settings first so it has a saved default network. Launch `PB641Frame.app`; it caches the latest winner at `/mnt/ext1/My pictures/PB641Frame/latest.jpg`. Tap the screen to toggle the frontlight between off and maximum brightness. Press Back to exit; the app restores the frontlight setting that was active when it launched.

## Polling And Power

Each poll powers Wi-Fi on, connects using the saved PocketBook network, and fetches the published image revision. It downloads the JPEG and performs a full E-Ink refresh only when that revision changes, then disconnects and powers Wi-Fi off. Failed polls leave the current image untouched.

The app uses an InkView hard timer while its event loop is active. The public SDK does not provide a reliable scheduled wake-from-suspend API, and PB641 firmware behavior varies. Automatic checks during true device suspend therefore require physical-device testing.
