# NodeMCU tank level

Shows how full a water tank is on your phone's browser, using a NodeMCU and a waterproof ultrasonic sensor mounted at the top of the tank.

- The **NodeMCU** only measures. It pings the sensor when asked and returns the distance to the water.
- The **page** (`docs/tank.js`, hosted on GitHub Pages) asks every 3 seconds, draws the tank, and turns red when the water is within 25 cm of the sensor.

## Hardware

- NodeMCU 1.0 (ESP-12E), e.g. the HW-625 board
- JSN-SR04T-style waterproof sensor (tested with an SR04M-2 board, left in mode 1: Trig/Echo)

| NodeMCU | Sensor |
|---|---|
| VIN (5 V) | 5V |
| G | GND |
| D6 (GPIO 12) | Trig |
| D5 (GPIO 14) | Echo |

At 5 V the sensor's Echo output is 5 V, above what the ESP8266 is rated for. For permanent use, put a voltage divider (1 kΩ in series, 2 kΩ to GND) or a level shifter between Echo and D5.

Mount the sensor at least 25 cm above the highest water level: it can't measure closer than that.

## Firmware

1. Copy `nodeMcuAPIServer/secrets.example.h` to `nodeMcuAPIServer/secrets.h` and fill in your Wi-Fi name and password.
2. Check the static IP in `nodeMcuAPIServer.ino` (default `192.168.1.58`, gateway `192.168.1.1`) suits your network.
3. Open `nodeMcuAPIServer/nodeMcuAPIServer.ino` in the Arduino IDE, choose board **NodeMCU 1.0 (ESP-12E Module)**, and upload.

Serial Monitor runs at 115200 baud.

### Endpoints

| URL | Returns |
|---|---|
| `GET /` | The display page. Loads `tank.js` from GitHub Pages; without internet it shows the raw distance in large digits. |
| `GET /api` | Measures now: `{ "d": 47.6 }` (cm from sensor to water), or HTTP 503 `{ "d": null, "error": "no echo" }` |

The sensor is only pinged when `/api` is called. Requests within 1 s of each other share a measurement.

## Using it

Open `http://192.168.1.58` on a phone on the same Wi-Fi. Type `http://` in full. Use **Add to Home Screen** for an app-like icon.

Readings are stored in the browser's localStorage, one entry per day, kept for 7 days.

## Changing the display

Edit `docs/tank.js`. Tank height (70 cm) and the red line (25 cm) are in `CONFIG` at the top. GitHub Pages publishes it from the `main` branch, `/docs` folder. After a change, bump `?v=` in the page inside `nodeMcuAPIServer.ino` and re-upload, so phones don't keep an old cached copy.
