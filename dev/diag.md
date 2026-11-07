# Sensor test (removed, kept for later)

A test page for the NodeMCU, used to investigate a sensor fault in November 2026. It isn't in the firmware. To use it again, follow the steps below.

## What it does

`/diag.json` takes about 2.5 s and blocks other requests while it runs:

1. Turns on the echo pin's pull-up. A connected sensor still holds the pin low; a loose wire lets it go high.
2. Listens for 0.5 s with no ping sent. The echo line should stay low and quiet.
3. Sends 20 raw pings and records `[high before ping, pulse start us, pulse width us, edges, longest pause us]`.

It also reports uptime, restart reason, free memory, Wi-Fi signal and Wi-Fi drops. `/diag` shows the results with a verdict.

## Known problem: don't trust the verdict

The verdict thresholds were guesses, and it gives false warnings on a healthy sensor. Before using the page again, change it to judge groups of 5 pings by their median, as `/api` does.

Until then, read the raw values and check whether `/api` holds steady.

## What the fault looked like

The probe plug on the sensor board had come loose after the cable was pulled. There was no visible damage.

| Check | Plug loose | Plug reseated |
|---|---|---|
| `/api` over about 20 readings | 22 to 88 cm | 39.68 to 39.76 cm |
| Raw pings with a pulse, out of 20 | 8 to 13 | 7 to 12 |
| Raw ping distances | 22 to 95 cm | Mostly 39.7 cm, a few stray values from 22 cm |
| Pulse start after trigger | 2571 to 2574 us | 2570 to 2574 us |
| Longest NodeMCU pause | 17 us | 17 us |
| Pull-up check and idle edges | 0 and 0 | 0 and 0 |

Lessons:

- About half of raw pings getting no pulse is normal at this ping rate.
- A loose probe plug doesn't show up in the wiring checks. The pulses stay clean, and only the distances go wrong.
- Readings near 22 cm can come from the sensor itself, at the edge of its blind zone.

## Restoring it

1. Save the page below as `nodeMcuAPIServer/diag_page.h`.
2. In `nodeMcuAPIServer.ino`, add each firmware part below where its heading says.
3. Build and upload as described in `build.md`, then open `http://tank.local/diag`.

### Page: `nodeMcuAPIServer/diag_page.h`

```cpp
// Sensor test page at /diag. It lives on the board so it still works when the display or the internet doesn't.
// verdict() turns the raw results from /diag.json into a plain answer.
const char DIAG_HTML[] PROGMEM = R"rawliteral(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Sensor test</title>
<style>
:root{--bg:#0a1217;--card:#14212a;--ink:#e3ecf1;--mute:#9db0bc;--ok:#3ecf8e;--bad:#ff6b6b;--warn:#f5b84b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
main{max-width:520px;margin:auto;padding:16px}
h1{font-size:20px;margin:4px 0 12px}
h2{font-size:18px;margin:0 0 6px}
p{margin:0}
button{width:100%;min-height:48px;border:0;border-radius:10px;background:#2b8fd6;color:#fff;font:600 16px system-ui,sans-serif}
button:disabled{opacity:.6}
.card{background:var(--card);border-radius:12px;padding:14px;margin-top:12px}
.next{color:var(--mute);margin-top:8px}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #ffffff1a}
.row:first-child{border-top:0}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.unknown{color:var(--mute)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:5px 4px;border-top:1px solid #ffffff1a}
th{color:var(--mute);font-weight:500;border-top:0}
summary{min-height:32px;cursor:pointer}
textarea{width:100%;height:140px;margin-top:8px;background:var(--bg);color:var(--ink);border:0;border-radius:8px;padding:8px;font:12px monospace}
</style></head>
<body><main>
<h1>Sensor test</h1>
<button id="run">Run test</button>
<div id="out"></div>
</main>
<script>
const CM_PER_US = 0.034 / 2;
const BLIND_CM = 25;       // the sensor can't measure closer than this
const STEADY_CM = 2;       // readings this close to the median count as steady
const STEADY_SHARE = 0.9;
const FLOATING_PCT = 95;   // echo pin stays high on its pull-up when nothing holds it low
const IDLE_EDGE_LIMIT = 2; // the echo line should stay quiet when nothing is triggered
const STALL_LIMIT_US = 500; // about 8 cm of error
const CLEAN_EDGES = 2;     // one pulse: up, then down
const NAMES = { ok: 'OK', warn: 'Check', bad: 'Fault', unknown: 'Not known' };

function summarise(data) {
  const pings = data.pings.map(([before, rise, width, edges, stall]) => ({
    before, rise, width, edges, stall, cm: width > 0 ? width * CM_PER_US : null
  }));
  const usable = pings.filter(p => p.cm !== null && p.stall <= STALL_LIMIT_US);
  const sorted = usable.map(p => p.cm).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const steady = usable.filter(p => Math.abs(p.cm - median) <= STEADY_CM).length;
  return { pings, usable, median, steady, min: sorted[0], max: sorted[sorted.length - 1] };
}

function verdict(data) {
  const s = summarise(data);
  const total = s.pings.length;
  const share = test => s.pings.filter(test).length / total;
  const answer = (nodemcu, trigger, echo, probe, title, next) => ({ nodemcu, trigger, echo, probe, title, next });

  if (share(p => p.rise >= 0 && p.rise <= 10 && p.width >= 10 && p.width <= 40) >= STEADY_SHARE)
    return answer('ok', 'unknown', 'unknown', 'unknown', 'Jumper test passed',
      'The NodeMCU sends and reads its pins correctly. Remove the jumper and reconnect the sensor.');
  if (share(p => p.stall > STALL_LIMIT_US) > 0.25)
    return answer('bad', 'unknown', 'unknown', 'unknown', 'The NodeMCU keeps pausing mid-measurement',
      'Its timing can\'t be trusted. Restart it and test again before blaming the sensor.');
  if (data.pull_high >= FLOATING_PCT)
    return answer('ok', 'unknown', 'bad', 'unknown', 'Nothing is holding the echo wire',
      'The wire to D5 is probably loose or broken, or the sensor board has no power. Check the wire and sensor power.');
  if (data.idle_high_pct >= FLOATING_PCT || share(p => p.before) > 0.5)
    return answer('ok', 'unknown', 'bad', 'unknown', 'The echo pin is stuck on',
      'The sensor board isn\'t finishing its pulses. Check its power, then replace the board.');
  if (data.idle_edges > IDLE_EDGE_LIMIT)
    return answer('ok', 'unknown', 'warn', 'unknown', 'The echo pin flickers with no ping sent',
      'This is electrical noise. Reseat the wires at D5, ground and 5 V, and keep them away from mains cables.');
  if (share(p => p.rise < 0) === 1)
    return answer('ok', 'warn', 'warn', 'unknown', 'The sensor never answered',
      'Run this again with your ear at the probe. Ticking means the trigger works and the echo pin is the fault. Silence means check the trigger wire to D6, 5 V, ground and the probe plug.');
  if (share(p => p.rise < 0) > 0.25)
    return answer('ok', 'warn', 'warn', 'unknown', 'The sensor answers only some pings',
      'Both pins work at least some of the time, so suspect a loose wire or cracked joint. Wiggle each wire and plug while running this again.');
  if (share(p => p.edges > CLEAN_EDGES) > 0.25)
    return answer('ok', 'ok', 'warn', 'unknown', 'The echo pulses are broken up',
      'The trigger works, but a clean ping is one pulse. Reseat the wires and check the sensor\'s 5 V supply.');
  if (s.usable.length < total / 2)
    return answer('ok', 'ok', 'ok', 'bad', 'Both pins work, but most pings get no echo',
      'The fault is after the pins: the probe, its plug or cable, or the sensor board\'s receiver. Swap probes between the two sensor boards to see which.');
  if (s.steady / s.usable.length < STEADY_SHARE)
    return answer('ok', 'ok', 'ok', 'bad', 'Both pins work, but the distances jump',
      'The fault is after the pins: the probe, its plug or cable, or the sensor board\'s receiver. Swap probes between the two sensor boards to see which.');
  if (s.median < BLIND_CM)
    return answer('ok', 'ok', 'ok', 'warn', 'Steady, but inside the blind zone',
      'Something is closer than ' + BLIND_CM + ' cm, or the probe is hearing itself. Run this again with the probe aimed at a wall 1 m away.');
  return answer('ok', 'ok', 'ok', 'ok', 'All good: steady at ' + s.median.toFixed(1) + ' cm',
    'Check this matches a tape measure. If it does, the sensor is working.');
}

function render(data) {
  const v = verdict(data);
  const s = summarise(data);
  const part = (name, key) => '<div class="row"><span>' + name + '</span><b class="' + v[key] + '">' + NAMES[v[key]] + '</b></div>';
  const fact = (name, value) => '<div class="row"><span>' + name + '</span><span>' + value + '</span></div>';
  const rows = s.pings.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + (p.cm === null ? 'none' : p.cm.toFixed(1)) +
    '</td><td>' + (p.rise < 0 ? '-' : p.rise) + '</td><td>' + p.edges + '</td><td>' + p.stall + '</td></tr>').join('');
  const starts = s.pings.filter(p => p.rise >= 0).map(p => p.rise);
  const delay = starts.length ? Math.min(...starts) + ' to ' + Math.max(...starts) + ' µs' : 'none';
  const range = s.usable.length ? s.min.toFixed(1) + ' to ' + s.max.toFixed(1) + ' cm' : 'none';
  document.getElementById('out').innerHTML =
    '<section class="card"><h2>' + v.title + '</h2><p class="next">' + v.next + '</p></section>' +
    '<section class="card">' + part('NodeMCU', 'nodemcu') + part('Trigger pin', 'trigger') + part('Echo pin', 'echo') + part('Probe and receiver', 'probe') + '</section>' +
    '<section class="card">' +
      fact('Good readings', s.usable.length + ' of ' + s.pings.length) + fact('Range', range) +
      fact('Echo starts after trigger', delay) +
      fact('Longest pause', Math.max(...s.pings.map(p => p.stall)) + ' µs') +
      fact('Wi-Fi signal', data.rssi + ' dBm') + fact('Wi-Fi drops since start', data.wifi_drops) +
      fact('Running for', Math.round(data.uptime_s / 60) + ' min') + fact('Last restart', data.reset) +
      fact('Free memory', data.heap + ' bytes') + '</section>' +
    '<section class="card"><details><summary>Every ping</summary><table><tr><th>#</th><th>cm</th><th>Start µs</th><th>Edges</th><th>Pause µs</th></tr>' +
      rows + '</table></details></section>' +
    '<section class="card"><details><summary>Raw results</summary><textarea readonly>' + JSON.stringify(data) + '</textarea></details></section>';
}

async function run() {
  const button = document.getElementById('run');
  button.disabled = true;
  button.textContent = 'Testing…';
  try {
    const reply = await fetch('/diag.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    render(await reply.json());
  } catch (e) {
    document.getElementById('out').innerHTML = '<section class="card"><h2>No reply from the NodeMCU</h2><p class="next">Check that it has power and Wi-Fi, then try again.</p></section>';
  }
  button.disabled = false;
  button.textContent = 'Run test again';
}

document.getElementById('run').onclick = run;
run();
</script>
</body></html>)rawliteral";
```

### Firmware: after the other includes

```cpp
#include "diag_page.h" // Sensor test page at /diag
```

### Firmware: after `#define REUSE_MS`

```cpp
// Sensor test at /diag
#define TRIGGER_US 20         // Same trigger length as ping()
#define DIAG_PINGS 20
#define DIAG_WINDOW_US 40000  // Longer than any real echo
#define DIAG_GAP_MS 60        // Same gap as medianEchoTime()
#define DIAG_IDLE_CHUNKS 10   // Listens with no ping in short chunks so Wi-Fi keeps running
#define DIAG_IDLE_CHUNK_MS 50
#define DIAG_PULL_SAMPLES 100
```

### Firmware: after `unsigned long lastBlinkMs = 0;`

```cpp
unsigned long wifiDrops = 0;
int lastDropReason = 0;
WiFiEventHandler wifiDropHandler;
```

### Firmware: before `void ledTick();`

```cpp
void handleDiagPage();
void handleDiagJson();
```

### Firmware: at the start of `setup()`, before `WiFi.begin`

```cpp
    wifiDropHandler = WiFi.onStationModeDisconnected([](const WiFiEventStationModeDisconnected &event) {
        wifiDrops++;
        lastDropReason = event.reason;
    });
```

### Firmware: with the other `server.on` routes

```cpp
    server.on("/diag", handleDiagPage);      // Sensor test page
    server.on("/diag.json", handleDiagJson); // Runs the sensor test
```

### Firmware: at the end of the file

```cpp
void handleDiagPage()
{
    server.send_P(200, "text/html", DIAG_HTML);
}

// With the pull-up on, a connected sensor still holds the echo pin low. A loose wire lets it go high.
int echoPullHighPct()
{
    pinMode(echoPin, INPUT_PULLUP);
    delay(2);
    int high = 0;
    for (int i = 0; i < DIAG_PULL_SAMPLES; i++)
    {
        high += digitalRead(echoPin);
        delayMicroseconds(10);
    }
    pinMode(echoPin, INPUT);
    delay(5);
    return high * 100 / DIAG_PULL_SAMPLES;
}

// Listens with no ping sent. The echo line should stay low and quiet.
void listenIdle(int &edges, int &highPct)
{
    int level = digitalRead(echoPin);
    unsigned long samples = 0;
    unsigned long highSamples = 0;
    edges = 0;

    for (int chunk = 0; chunk < DIAG_IDLE_CHUNKS; chunk++)
    {
        unsigned long start = millis();
        while (millis() - start < DIAG_IDLE_CHUNK_MS)
        {
            int now = digitalRead(echoPin);
            samples++;
            highSamples += now;
            if (now != level)
            {
                level = now;
                edges++;
            }
        }
        delay(1);
    }
    highPct = highSamples * 100 / samples;
}

// Records one raw ping as [high before ping, pulse start us, pulse width us, edges, longest pause us].
// Watching the pin directly shows broken pulses and pauses in the NodeMCU, which pulseIn() hides.
// Start is -1 if no pulse began; width is 0 if the pulse didn't finish.
void diagPing(String &json)
{
    int before = digitalRead(echoPin);
    long rise = -1;
    long width = 0;
    int edges = 0;
    unsigned long longestPause = 0;

    digitalWrite(trigPin, LOW);
    delayMicroseconds(5);

    unsigned long start = micros();
    unsigned long previous = start;
    unsigned long now = start;
    bool triggerOn = true;
    int level = before;
    digitalWrite(trigPin, HIGH);

    while ((now = micros()) - start < DIAG_WINDOW_US)
    {
        longestPause = max(longestPause, now - previous);
        previous = now;

        if (triggerOn && now - start >= TRIGGER_US)
        {
            digitalWrite(trigPin, LOW);
            triggerOn = false;
        }

        int sample = digitalRead(echoPin);
        if (sample != level)
        {
            level = sample;
            edges++;
            if (sample == HIGH && rise < 0)
            {
                rise = now - start;
            }
            else if (sample == LOW && rise >= 0 && width == 0)
            {
                width = now - start - rise;
            }
        }
    }

    json += "[" + String(before) + "," + String(rise) + "," + String(width) + "," + String(edges) + "," + String(longestPause) + "]";
}

void handleDiagJson()
{
    delay(DIAG_GAP_MS); // Let any earlier ping finish before checking the line

    int pullHigh = echoPullHighPct();
    int idleEdges = 0;
    int idleHigh = 0;
    listenIdle(idleEdges, idleHigh);

    String json;
    json.reserve(1024);
    json += "{\"uptime_s\":" + String(millis() / 1000);
    json += ",\"reset\":\"" + ESP.getResetReason() + "\"";
    json += ",\"heap\":" + String(ESP.getFreeHeap());
    json += ",\"rssi\":" + String(WiFi.RSSI());
    json += ",\"wifi_drops\":" + String(wifiDrops);
    json += ",\"wifi_drop_reason\":" + String(lastDropReason);
    json += ",\"pull_high\":" + String(pullHigh);
    json += ",\"idle_edges\":" + String(idleEdges);
    json += ",\"idle_high_pct\":" + String(idleHigh);
    json += ",\"pings\":[";
    for (int i = 0; i < DIAG_PINGS; i++)
    {
        if (i > 0)
        {
            json += ",";
        }
        diagPing(json);
        delay(DIAG_GAP_MS);
    }
    json += "]}";

    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", json);
}
```
