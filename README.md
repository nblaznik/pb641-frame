# PocketBook Frame

PocketBook Frame turns a PocketBook PB641 into a dedicated E-Ink drawing display. A private web page provides a phone-friendly canvas; the device checks the server for a changed drawing and performs a full refresh only when the image revision changes.

## Components

- `src/main.cpp`: PocketBook InkView application.
- `server/`: dependency-free Node.js drawing server and web canvas.
- `device/pb641-frame.cfg.example`: device configuration template.
- `build.sh`: ARM cross-build script for the PocketBook SDK container.

## Run The Server

Node.js 20 or newer is required. Generate a strong shared token and start the server:

```sh
cd server
FRAME_TOKEN="replace-with-a-long-random-token" node server.js
```

The drawing page is available at `http://localhost:8080`. Persistent drawings are stored under `server/data` by default. Set `PORT` or `DATA_DIR` to override those values.

For Docker:

```sh
docker build -t pb641-frame-server server
docker run -d --name pb641-frame-server \
  -p 8080:8080 \
  -e FRAME_TOKEN="replace-with-a-long-random-token" \
  -v pb641-frame-data:/data \
  pb641-frame-server
```

Place the server behind an HTTPS reverse proxy before exposing it outside a trusted LAN. The PocketBook sends its token as a query parameter because the built-in InkView downloader cannot set an authorization header. Configure the proxy not to retain query strings in access logs.

## Build And Install The Device App

Build the SDK image once if it does not already exist:

```sh
docker build -t pb641-sdk-a13 .
```

Cross-compile the application:

```sh
docker run --rm -v "$PWD:/project" pb641-sdk-a13 ./build.sh
```

Copy `build/PB641Frame.app` to the PocketBook's `applications` directory. Copy `device/pb641-frame.cfg.example` to this exact device path and edit it:

```text
/mnt/ext1/system/config/pb641-frame.cfg
```

Example configuration:

```ini
server_url=https://frame.example.com
token=replace-with-a-long-random-token
poll_seconds=300
```

Connect the PocketBook to Wi-Fi once through its normal settings so it has a saved default connection. Launch `PB641Frame.app`; it caches the latest valid JPEG at `/mnt/ext1/My pictures/PB641Frame/latest.jpg`. Press Back to exit.

## Polling And Power

Each poll powers Wi-Fi on, connects using the saved PocketBook network, fetches a 64-byte revision, and downloads the JPEG only if that revision changed. It then disconnects and powers Wi-Fi off. Failed polls leave the currently displayed image untouched.

The app uses an InkView hard timer so checks continue while its event loop is active. The public SDK does not provide a reliable scheduled wake-from-suspend API, and PB641 firmware behavior varies. Consequently, automatic checks during true device suspend require physical-device testing; keeping the app active with Wi-Fi off is the supported baseline.

## Test

```sh
cd server
npm test
```
