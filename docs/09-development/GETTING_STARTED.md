# Getting Started with Guardian Development

**Last updated:** 2026-07-29

New to Guardian? This guide walks you through setting up your development environment from scratch.

## Prerequisites

You'll need:
- **Git** — Version control
- **Flutter SDK** — Mobile app development (Android + Web)
- **Node.js 16+** — Gateway server
- **Firebase Account** — Backend (free tier OK)
- **A text editor or IDE** — VS Code, Android Studio, or JetBrains IntelliJ

## 1. Clone the Repository

```bash
git clone https://github.com/vikrav14/guardian.git
cd guardian
```

## 2. Flutter Setup

### Install Flutter

Follow [Flutter's official setup guide](https://flutter.dev/docs/get-started/install) for your platform (Windows, Mac, Linux).

Verify installation:
```bash
flutter --version
flutter doctor
```

### Install Flutter Dependencies

```bash
cd apps/mobile
flutter pub get
cd ../..
```

### Run Tests

```bash
cd apps/mobile
flutter test
cd ../..
```

If tests pass ✓, Flutter is ready.

## 3. Gateway Setup

### Install Node.js

Download from [nodejs.org](https://nodejs.org/). Use LTS version (16+).

Verify:
```bash
node --version
npm --version
```

### Install Gateway Dependencies

```bash
cd gateway
npm install
cd ..
```

### Run Tests

```bash
cd gateway
npm test
cd ..
```

If tests pass ✓, gateway is ready.

## 4. Firebase Setup

Guardian uses Firebase for:
- **Firestore** — Data storage
- **Firebase Auth** — User authentication
- **Firebase Cloud Messaging (FCM)** — Push notifications

### Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" → Enter "guardian" (or any name)
3. Create project (keep analytics disabled for now)

### Enable Firestore

1. In Firebase Console → Left menu → "Firestore Database"
2. Click "Create database"
3. Start in **test mode** (allows all reads/writes; will restrict with security rules later)
4. Choose region: **singapore** (closest to Mauritius)

### Enable Authentication

1. Left menu → "Authentication"
2. Click "Get started"
3. Under "Sign-in method" → Enable "Email/Password"

### Enable Cloud Messaging

1. Left menu → "Cloud Messaging"
2. Note the **Sender ID** (you'll need this for mobile app)

### Download Service Account

1. Left menu → "Project settings" (gear icon)
2. "Service accounts" tab
3. "Generate new private key" → Downloads JSON file
4. Save as `gateway/firebase-key.json` (don't commit this!)

## 5. Configure Gateway

### Create `.env` File

```bash
cd gateway
cp .env.example .env
```

Edit `gateway/.env`:

```
# Firebase
FIREBASE_PROJECT_ID=guardian-xxxxx
FIREBASE_PRIVATE_KEY_PATH=./firebase-key.json
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@appspot.gserviceaccount.com

# Write location history (for testing)
WRITE_LOCATION_HISTORY=true

# Notifications (optional for now)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=

# Claude AI (optional)
CLAUDE_API_KEY=
```

**Note:** Get Firebase values from Project Settings.

### Start Gateway

```bash
cd gateway
npm start
```

You should see:
```
Listening on port 9000...
```

Keep this terminal open.

## 6. Configure Mobile App

### Get Firebase Config

1. Firebase Console → Project settings
2. Click "Android" (or "Web") app
3. Download `google-services.json` (Android) or `GoogleService-Info.plist` (iOS)
4. Save to `apps/mobile/android/app/google-services.json`

### Run Mobile App

In a new terminal:

```bash
cd apps/mobile
flutter run
```

Choose a device (emulator or connected phone).

The app should:
1. Show "Loading..." screen
2. Auto-create a demo account
3. Show home dashboard with demo device

## 7. Test the Full Flow

### Start the Simulator

In a third terminal:

```bash
cd gateway
npm run simulate
```

The simulator sends fake GPS data. You should see:
- ✓ Gateway receives packets
- ✓ Firestore updates with locations
- ✓ Mobile app shows marker on map
- ✓ Marker updates every 10 seconds

### Create a Safe Zone

1. Mobile app → tap and hold on map → "Add safe zone"
2. Name it "Test Zone"
3. Set radius 500m
4. Confirm

Simulator should show geofence enter/exit events in the gateway logs.

## 8. Next Steps

Now that everything is running:

- **Understand the system** — Read [System Overview](../02-architecture/SYSTEM_OVERVIEW.md)
- **Explore the mobile app** — See [Mobile App Guide](../03-mobile/MOBILE_OVERVIEW.md)
- **Debug gateway issues** — See [Gateway Setup](GATEWAY_SETUP.md)
- **Contribute code** — Follow the conventions in [CLAUDE.md](../../CLAUDE.md)

## Troubleshooting

### "Flutter not found"
Make sure Flutter is in your PATH:
```bash
flutter --version
```

If not in PATH, add `<flutter-install-dir>/bin` to your system PATH.

### "firebase-key.json not found"
Download it from Firebase Console → Project Settings → Service Accounts → Generate Key.

### "Firestore query requires index"
When you first query locations, Firestore will ask you to create a composite index. Click the link in the error message to create it automatically.

### "Gateway won't start"
Check that port 9000 isn't in use:
```bash
# Windows
netstat -ano | findstr :9000

# Mac/Linux
lsof -i :9000
```

If port is in use, change `GATEWAY_PORT` in `gateway/.env`.

### "Mobile app shows blank map"
1. Check Firebase project ID matches
2. Ensure Firestore security rules allow test mode (or add your email to rules)
3. Check that gateway is running and writing to Firestore

---

## What's Next?

- Run `flutter test` to verify code quality
- Run `npm test` in gateway to verify server logic
- Read [Local Development](LOCAL_DEVELOPMENT.md) to learn the daily workflow
- Check [Contributing Guidelines](../../CLAUDE.md) before submitting PRs

---

**Still stuck?** Open an issue on [GitHub](https://github.com/vikrav14/guardian/issues) with:
- Your OS and versions (flutter --version, node --version)
- The error message
- What step you were on
