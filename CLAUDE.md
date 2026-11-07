# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

No build, test or lint tooling. Compile-check the firmware with the Arduino IDE's bundled CLI (needs `nodeMcuAPIServer/secrets.h`, copied from `secrets.example.h`):

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --fqbn esp8266:esp8266:nodemcuv2 nodeMcuAPIServer
node --check docs/tank.js
```

## Architecture

This project is a two-component IoT system for monitoring water tank depth:

### Embedded Firmware (`nodeMcuAPIServer/nodeMcuAPIServer.ino`)
Arduino sketch for NodeMCU 1.0 / HW-625 (ESP8266) that:
- Connects to WiFi with a static IP (`192.168.1.58`)
- Reads distance from a JSN-SR04T-style waterproof sensor (SR04M-2 board) on trigger GPIO 12 (D6), echo GPIO 14 (D5)
- Only measures when `/api` is requested (5 pings, median); requests within 1 s share one measurement
- `GET /api` returns `{ "d": <distance_cm> }`, or HTTP 503 `{ "d": null, "error": "no echo" }`
- `GET /` serves a small HTML page that loads `docs/tank.js` from GitHub Pages; if that fails it shows the raw distance every 3 s
- Wi-Fi credentials live in git-ignored `secrets.h`

### Display (`docs/tank.js`)
Plain JavaScript, no build step, served by GitHub Pages from `main` `/docs`
(`https://rohitbels.github.io/nodemcu-tank-level/tank.js`):
- Polls `/api` every 3 s, stores `[time, d]` per day in localStorage (7 days)
- Tank defaults to 70 cm (probe to floor), settable in Settings; green while d > 25 cm, red at d <= 25 cm (sensor blind zone)
- Fill is shown as a percentage everywhere: `level / tankCm * 100`, so 100% is the whole tank, and the red line's % comes from the same formula (64% on a 70 cm tank). The formulas live together at the top of the file; don't repeat them or hardcode tank numbers
- Settings page (gear icon): theme, tank depth and optional diameter, stored per device in IndexedDB; the page falls back to defaults if it fails. Levels are derived from stored d, so a new depth applies to past days too
- Water available tile: litres for a round straight-sided tank when a diameter is set, otherwise cm of water
- Mobile first: design and check at phone widths before desktop
- Two tabs under the always-visible status banner: Today (gauge, current numbers) and History
- History tab: per-day level chart (one median point per minute, shaded gaps), daily high/low/readings, and Copy Data (CSV of every stored day, one row per minute, with fill % and raw distance)
- Copy Data can't rely on `navigator.clipboard`: the page is plain http, so it uses `execCommand('copy')`, then a manual-copy box
- Pages serves it with `max-age=600`, so phones get a change within 10 minutes on their next page load. Bumping `?v=` in the firmware's page skips that wait but needs a re-flash

### Data Flow
Phone opens http://192.168.1.58 → page loads tank.js → tank.js GETs /api every 3 s → NodeMCU pings sensor → returns distance JSON → tank.js draws level
