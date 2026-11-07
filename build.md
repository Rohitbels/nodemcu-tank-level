# Building the firmware

Run this from the project folder:

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --fqbn esp8266:esp8266:nodemcuv2 --output-dir build nodeMcuAPIServer
```

This creates `build/nodeMcuAPIServer.ino.bin`, the file you upload to the board.

## What the command does

| Part | Meaning |
|---|---|
| `"/Applications/Arduino IDE.app/.../arduino-cli"` | The command-line tool that comes with the Arduino IDE. The quotes are needed because the path has a space in it. |
| `compile` | Turns the code into firmware. It doesn't upload anything. |
| `--fqbn esp8266:esp8266:nodemcuv2` | The board to build for, here the NodeMCU 1.0. |
| `--output-dir build` | Puts the finished files in the `build` folder. |
| `nodeMcuAPIServer` | The folder containing the sketch. |

## Before you build

The build needs `nodeMcuAPIServer/secrets.h`, which holds the Wi-Fi details and the update page login. If you don't have it, copy `secrets.example.h` to `secrets.h` and fill it in.

Those values are compiled into the `.bin` file, so don't share that file or commit it. `build/` and `secrets.h` are ignored by git.

## Uploading over Wi-Fi

1. Open `http://192.168.1.58/update` on the same Wi-Fi and log in with `OTA_USER` and `OTA_PASSWORD` from `secrets.h`.
2. Under **Firmware**, choose `build/nodeMcuAPIServer.ino.bin`. Leave **FileSystem** alone.
3. Click **Update Firmware**, and don't power off the board during the upload.
4. Wait 10 to 20 seconds for the board to restart, then check that `http://192.168.1.58` works.

Every new version must keep the `/update` page and be able to join the Wi-Fi. If it can't, you'll need to flash over USB from the Arduino IDE.
