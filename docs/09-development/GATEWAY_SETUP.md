# Gateway Setup Guide

**Last updated:** 2026-07-29

Detailed setup for the Guardian Node.js gateway server.

## Prerequisites

- **Node.js 16+** — Download from [nodejs.org](https://nodejs.org/)
- **npm 7+** — Comes with Node.js
- **Firebase Project** — See [Firebase Setup](FIREBASE_SETUP.md)

Verify installation:
```bash
node --version
npm --version
```

## Step 1: Install Dependencies

```bash
cd gateway
npm install
```

This installs:
- `net` (TCP server)
- `firebase-admin` (Firestore writes)
- `node:test` (testing framework)

Takes ~2-3 minutes.

## Step 2: Download Firebase Key

Download from Firebase Console:
1. Project Settings → Service Accounts
2. "Generate new private key"
3. Save to `gateway/firebase-key.json`

**Never commit this file!**

```bash
# Verify it's ignored
cat .gitignore | grep firebase-key
```

## Step 3: Create `.env` File

```bash
cd gateway
cp .env.example .env
```

Edit `gateway/.env` with your Firebase credentials:

```
# Firebase Admin SDK
FIREBASE_PROJECT_ID=guardian-xxxxxx
FIREBASE_PRIVATE_KEY_PATH=./firebase-key.json
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@appspot.gserviceaccount.com

# Gateway Configuration
GATEWAY_PORT=9000
GATEWAY_HOST=0.0.0.0

# Location History (write to Firestore)
WRITE_LOCATION_HISTORY=true

# Notifications (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=

# AI Assistant (optional)
CLAUDE_API_KEY=

# Debug (optional)
LOG_LEVEL=debug
```

**Get values from:**
| Variable | Source |
|----------|--------|
| FIREBASE_PROJECT_ID | Firebase Console → Project ID |
| FIREBASE_CLIENT_EMAIL | Service account JSON file → `client_email` |
| Twilio | [Twilio Console](https://console.twilio.com) |
| Claude API | [console.anthropic.com](https://console.anthropic.com) |

## Step 4: Verify Configuration

Test that Firebase connection works:

```bash
npm test
```

Tests should pass ✓. If they fail:
- Check `.env` variables
- Verify `firebase-key.json` exists
- Verify Firebase project has Firestore enabled

## Step 5: Start the Gateway

```bash
npm start
```

You should see:
```
Listening on port 9000...
Firebase connected to project: guardian-xxxxx
Ready for TCP connections
```

**The gateway is now running!**

## Step 6: Test with Simulator

In a new terminal:

```bash
cd gateway
npm run simulate
```

The simulator sends fake GPS data to the gateway.

In the first terminal, you should see:
```
Received UD packet from device 869362...
Location: lat=-20.1234, lng=57.5678
```

If you see location updates, everything is working! ✓

## Configuration Options

### `GATEWAY_PORT` (default: 9000)

TCP port the gateway listens on. Devices connect to this port.

```
GATEWAY_PORT=8000   # Use port 8000 instead
```

### `GATEWAY_HOST` (default: 0.0.0.0)

Network interface to bind to.

```
GATEWAY_HOST=127.0.0.1    # Only local connections
GATEWAY_HOST=0.0.0.0       # All interfaces (production)
GATEWAY_HOST=192.168.1.10  # Specific interface
```

### `WRITE_LOCATION_HISTORY` (default: true)

Whether to persist location history to Firestore.

```
WRITE_LOCATION_HISTORY=true   # Save all locations (dev/testing)
WRITE_LOCATION_HISTORY=false  # Don't save (save bandwidth)
```

### `LOG_LEVEL` (default: info)

Verbosity of logging output.

```
LOG_LEVEL=debug      # All messages (very verbose)
LOG_LEVEL=info       # Important messages
LOG_LEVEL=warn       # Warnings + errors only
LOG_LEVEL=error      # Errors only
```

## Running Tests

```bash
# All tests
npm test

# Specific test file
npm test -- --grep "geofence"

# Watch mode (re-run on file changes)
npm test -- --watch

# Verbose output
npm test -- --verbose
```

Test suites cover:
- Protocol parsing (gt06.test.js)
- Command building (commands.test.js)
- Geofence logic (geofence.test.js)
- Event processing (server.test.js)

## Common Issues

### "Port 9000 already in use"

Change the port in `.env`:
```
GATEWAY_PORT=9001
```

Or kill the process using port 9000:
```bash
# Windows
netstat -ano | findstr :9000
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :9000
kill -9 <PID>
```

### "Firebase connection failed"

Verify `.env` variables:
```bash
# Check if file exists
ls -la firebase-key.json

# Verify Firebase project ID
grep FIREBASE_PROJECT_ID .env
```

### "Module not found"

Reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

### "Tests failing"

Make sure Firebase project has:
- ✓ Firestore Database enabled
- ✓ Authentication enabled
- ✓ Composite index created (for alerts query)

## Development Server Modes

### Production Mode

```bash
NODE_ENV=production npm start
```

- Disables logging to stderr
- Uses real Firebase project
- Binds to all interfaces (0.0.0.0)

### Development Mode

```bash
NODE_ENV=development npm start
```

- Full debug logging
- Local Firebase emulator (if running)
- Logs all packets to console

### Testing Mode

```bash
npm test
```

- Uses fake Firestore (for unit tests)
- Mocks external APIs (Twilio, Claude)
- Fast test suite (no network)

## Monitoring

### Check Gateway Health

```bash
# Is it running?
ps aux | grep "node.*server.js"

# Is port open?
netstat -an | grep 9000

# Check logs
# (Look at terminal output)
```

### Monitor Firestore Writes

1. Firebase Console → Firestore Database
2. Watch collections update in real-time:
   - `devices/{imei}` — Updated on heartbeat
   - `locations/{docId}` — Updated on location upload
   - `alerts/{docId}` — Updated on events

### Test TCP Connection

```bash
# From another machine (if gateway is on 192.168.1.100:9000)
nc -zv 192.168.1.100 9000

# Or: telnet 192.168.1.100 9000
```

## Performance Tips

- **Disable location history** if not needed: `WRITE_LOCATION_HISTORY=false`
- **Increase log level** in production: `LOG_LEVEL=error`
- **Use connection pooling** for Firestore (built-in)
- **Monitor memory** usage on long-running processes

## Deployment Checklist

Before deploying to production:

- [ ] `.env` has production Firebase project
- [ ] `firebase-key.json` is secure (not in git)
- [ ] `LOG_LEVEL=error` (reduce verbosity)
- [ ] Security rules deployed to Firestore
- [ ] Composite indexes created
- [ ] Gateway exposed (via tunnel or public IP)
- [ ] Firewall rules allow port 9000 inbound
- [ ] SSL/TLS for device communication (future)

## Next Steps

- [Getting Started](GETTING_STARTED.md) — Full dev setup
- [Local Development](LOCAL_DEVELOPMENT.md) — Daily workflow
- [TCP Connection Lifecycle](../04-gateway/TCP_CONNECTION_LIFECYCLE.md) — Protocol details
