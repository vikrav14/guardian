# V28C pendant — from-scratch setup (Mauritius / my.t)

Step-by-step guide to configure a Shenzhen ReachFar **V28C** GPS pendant to talk to the Guardian gateway. Every SMS command below comes from vendor PDFs (see [docs/reference/](reference/)); nothing is guessed.

## What you need

| Item | Notes |
|------|--------|
| V28C pendant | IMEI on label or in status SMS |
| my.t SIM | SMS + mobile data active; note the pendant's SIM phone number (E.164, e.g. `+2305xxxxxxx`) |
| Your phone | To send configuration SMS **to the pendant's SIM number** |
| PC running gateway | `cd gateway && npm start` — listens on **TCP port 9000** |
| ngrok TCP tunnel | Required for real hardware while the gateway runs locally (see below) |
| Firebase | `FIRESTORE_DISABLED=false` in `gateway/.env` so locations reach the app ([FIREBASE_SETUP.md](FIREBASE_SETUP.md)) |

**Default device password:** `123456` (vendor Switch-Server + Setting APN PDFs).

---

## Part A — Gateway + ngrok (do this first)

The pendant connects over **cellular TCP**, not HTTP. Your gateway must be reachable from the internet.

### 1. Configure and start the gateway

```bash
cd gateway
cp .env.example .env   # if you haven't already
```

In `gateway/.env` (minimum for real hardware):

```env
PORT=9000
HOST=0.0.0.0
FIRESTORE_DISABLED=false
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccount.json
# Set true in production so route history appears in the app.
WRITE_LOCATION_HISTORY=true
```

```bash
npm install
npm start
```

You should see:

```text
[guardian-gateway] listening on 0.0.0.0:9000
[guardian-gateway] firestore ON
```

### 2. Expose TCP 9000 with ngrok

Free ngrok HTTP tunnels **do not** work for pendants. You need a **TCP** endpoint:

```bash
ngrok tcp 9000
```

Copy the forwarding line, e.g. `tcp://8.tcp.ngrok.io:15375` → host `8.tcp.ngrok.io`, port `15375`.

> **Important:** ngrok free TCP URLs change every restart. After each restart, re-send the `ip,...#` SMS (Step 4 below).

### 3. Smoke-test without hardware

In a second terminal:

```bash
cd gateway
npm run simulate
```

Gateway logs should show ASCII frames (`LK`, `UD_LTE`) and ACK replies. With Firestore on, check `devices/{imei}` in the Firebase console.

---

## Part B — SMS setup (send to the pendant's SIM number)

Send each SMS **from your phone** **to the phone number of the SIM inside the pendant**. Replace placeholders with your values.

| Placeholder | Example |
|-------------|---------|
| `{YOUR_PHONE}` | `+23058590100` (your mobile — becomes the "center" number for replies) |
| `{NGROK_HOST}` | `8.tcp.ngrok.io` |
| `{NGROK_PORT}` | `15375` |

### Recommended order

#### Step 1 — Set center number

Required so the device can SMS replies back to you.

```text
pw,123456,center,{YOUR_PHONE}#
```

**Example:**

```text
pw,123456,center,+23058590100#
```

*Source: Switch-Server SMS-Commands PDF.*

#### Step 2 — Check status (before APN)

```text
pw,123456,ts#
```

Alternative without password prefix (also vendor-documented):

```text
ts#
```

The device replies by SMS. Per the **Setting APN** vendor email: if the reply shows **`netid:0`**, mobile data is not configured — proceed to Step 3.

> **Note:** Fields like `NET:YES` appear in real-world status replies but are **not** spelled out in the vendor PDFs we have. Treat `netid:0` (documented) as the signal to set APN. After APN + server are correct, a later `ts#` reply should show the configured server and a working data registration.

#### Step 3 — Set APN (my.t / Mauritius Telecom)

**Verify APN on an Android phone** with the same SIM (Settings → Mobile network → Access Point Names) — the vendor recommends this over guessing.

Typical my.t values:

| Field | Value |
|-------|-------|
| APN name | `my.t` |
| Username | *(blank)* |
| Password | *(blank)* |
| MCC+MNC | `61701` (Mauritius / my.t) |

**With password prefix** (Setting APN PDF — preferred when diagnosing APN):

```text
pw,123456,apn,my.t,,,61701#
```

**Without password prefix** (Switch-Server PDF — simpler form):

```text
apn,my.t,,,61701#
```

Blank username/password → keep the commas: `,,,`

> **Correction:** Do **not** use `46230` — that is China Unicom (MCC 460). Mauritius my.t is **`61701`**.

#### Step 4 — Point device at your gateway

```text
ip,{NGROK_HOST},{NGROK_PORT}#
```

**Example:**

```text
ip,8.tcp.ngrok.io,15375#
```

*Source: Switch-Server SMS-Commands PDF (`ip,url_or_ip,port_number#`).*

#### Step 5 — Verify status again

```text
pw,123456,ts#
```

Confirm the reply reflects your server host/port. Wait 1–5 minutes for the first TCP connection.

#### Step 6 (optional) — SOS numbers

```text
sos1,{YOUR_PHONE}#
sos2,{OTHER_PHONE}#
sos3,{OTHER_PHONE}#
```

*Source: Switch-Server SMS-Commands PDF.*

---

## Part C — Link device in Guardian app

New accounts start with **no linked pendants**. Link your real device from the app:

1. Read the **15-digit IMEI** from the device label or status SMS (`imei:861397053141170` in the `ts#` reply).
2. In the app, open **Account → Link a pendant** and enter that 15-digit IMEI (never the 10-digit protocol id).
3. Optionally set `devices/{imei}.simNumber` in Firestore to the pendant SIM (E.164) if you use in-app SMS commands later.

For local simulator testing without hardware, link the demo IMEI `359633100123456` the same way, then run `npm run simulate` in `gateway/`.

Alternatively, set `users/{your-uid}.linkedImeis` to **only** that 15-digit value directly in Firestore.

### 10-digit vs 15-digit IMEI (important)

The V28C TCP protocol puts a **10-digit device id** in every ASCII frame (e.g. `9705314117`), while the label and status SMS show the **full 15-digit IMEI** (e.g. `861397053141170`). They are the same device:

```text
861397053141170
     ^^^^^^^^^^
     9705314117   ← protocol id = full IMEI characters 5–14 (0-based index 4–13)
```

The gateway **normalizes** incoming frames to the 15-digit IMEI before writing Firestore, so `linkedImeis` should always use the label/SMS value. On first connect it also migrates any legacy `devices/{10-digit-id}` document to `devices/{15-digit-imei}`.

Optional overrides in `gateway/.env` if the default suffix digit (`0`) is wrong for your unit:

```env
IMEI_PREFIX=8613970
IMEI_DEFAULT_SUFFIX=0
IMEI_MAP=9705313987:861397053139877
```

Open the Flutter app map dashboard — the wearer should appear once the gateway writes a location.

---

## Part D — What success looks like

### Gateway terminal

```text
[tcp] connected <ip>:<port>
[gateway] unknown command: CONFIG from 861397053139877   ← normal on first connect
```

Then, after GPS fix:

```text
[tcp] connected ...
```

Heartbeat and location events are applied silently; location writes go to Firestore.

### Expected ASCII protocol (vendor Communication Example PDF)

Device sends frames like:

```text
[3G*2104327437*0009*LK,0,0,20]
[3G*2104327437*0122*UD_LTE,241122,062109,A,22.653729,N,114.014600,E,...]
```

Gateway **must** reply with ACK frames, e.g. `[SG*2104327437*0002*LK]`. The decoder in `gateway/src/protocol/gt06.js` handles this automatically.

### WiFi/cell geolocation (gps=V)

Indoors the pendant often sends `UD_LTE` with `gps=V` and WiFi MAC / LBS cell fields instead of satellite coordinates. The gateway calls the [Google Geolocation API](https://developers.google.com/maps/documentation/geolocation/overview) to resolve those to lat/lng.

1. In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Library**, enable **Geolocation API** (same project as Maps is fine).
2. Create or reuse an API key and set in `gateway/.env`:

```env
GOOGLE_GEOLOCATION_API_KEY=your-key-here
FIRESTORE_DISABLED=false
```

3. Restart the gateway. Successful lookups log like:

```text
[geolocate] 861397053141170 wifi=3 cells=1 → -20.261, 57.478 acc=45m
```

Without the key (or with `FIRESTORE_DISABLED=true`), V packets are parsed but geolocation is skipped — no crash, no fabricated coordinates.

### Firebase / app

- `devices/{imei}` → `online: true`, `lastHeartbeatAt` recent
- `location.lat` / `location.lng` populated when GPS valid (`A` in protocol) or geolocated from WiFi/cell (`V` + Google Geolocation API)
- Map dashboard shows the wearer (outdoors may take a few minutes for first GPS fix)

### Simulator check (no pendant)

```bash
cd gateway
npm run simulate -- --host 127.0.0.1 --port 9000 --imei YOUR_IMEI
```

---

## Troubleshooting

| Problem | Things to try |
|---------|----------------|
| No SMS reply from pendant | SIM seated correctly; SMS credit/plan active; center number set (Step 1); try sending from a different phone |
| SMS works but no TCP connection | Re-check APN (`61701` not `46230`); confirm ngrok TCP tunnel still running; re-send `ip,...#` with current ngrok host/port |
| ngrok URL changed | Every ngrok restart → new host/port → must re-send `ip,{host},{port}#` |
| Gateway sees connection but no location | Indoors GPS may be `V` — gateway geolocates WiFi/cell when `GOOGLE_GEOLOCATION_API_KEY` is set; move outside for satellite `A` fixes |
| Device in Firestore but not in app | IMEI not in your `linkedImeis` — use the **15-digit** label/SMS IMEI, not the 10-digit protocol id; check Firestore rules deployed |
| App empty after TCP connect | Gateway may have written under the old 10-digit doc id — restart gateway (normalization migrates on next heartbeat) or manually merge `devices/9705314117` into `devices/861397053141170` |
| `FIRESTORE_DISABLED=true` | Gateway runs but app stays empty — set to `false` and restart |
| Mauritius Telecom SMS delay | SMS can take 30s–2min; send commands one at a time |

### Switch back to vendor platform

```text
ip,a.igps123.com,8888#
```

*Source: Switch-Server SMS-Commands PDF.*

---

## Vendor reference map

| Topic | Document |
|-------|----------|
| SMS: center, ip, apn, sos, ts#, imei | `Switch-Server-SMS-Commands.pdf` |
| APN format with `pw,123456,apn,...` + `pw,123456,ts#` | `Setting APN.pdf` (ReachFar sales email) |
| ASCII protocol `[CS*IMEI*LEN*cmd,...]` | `V28C Communication Protocol.pdf` |
| LK / UD_LTE / AL_LTE examples | `V28C Communication Example.pdf` |

Copy the three protocol/APN PDFs into `docs/reference/` if not already there (repo currently ships Switch-Server + DataSheet only).

---

## Commands **not** in vendor PDFs — do not use for setup

These exist in community docs or other Reachfar models but are **not** in the V28C vendor SMS manual:

- `monitor,+phone#` / `find#` — RF-V28 community source, unverified on V28C
- Remote photo, pill reminders, pedometer server commands — protocol PDF server-side only; no SMS syntax for setup

See [CLAUDE.md](../CLAUDE.md) hard rule: never fabricate hardware commands.
