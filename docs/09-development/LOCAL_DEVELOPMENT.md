# Local Development Workflow

**Last updated:** 2026-07-29

Daily development workflow for Guardian.

## Daily Setup

### Terminal 1: Gateway

```bash
cd gateway
npm start
```

Gateway listens on `localhost:9000` for TCP connections.

### Terminal 2: Device Simulator

```bash
cd gateway
npm run simulate
```

Sends fake GPS data to localhost:9000 every 10 seconds.

### Terminal 3: Mobile App

```bash
cd apps/mobile
flutter run
```

Hot reload enabled — changes to `.dart` files reload instantly.

## Development Workflow

### Mobile App Development

1. Edit `apps/mobile/lib/screens/*.dart`
2. Save file → Flutter hot reloads automatically
3. App shows changes in emulator/device
4. Run tests: `flutter test`

**Common tasks:**
```bash
cd apps/mobile

# Run all tests
flutter test

# Run specific test file
flutter test test/screens/dashboard_test.dart

# Analyze code
flutter analyze

# Format code
dart format lib/

# Clean build
flutter clean
flutter pub get
```

### Gateway Development

1. Edit `gateway/src/*.js`
2. Stop gateway (Ctrl+C) → Restart `npm start`
3. Changes take effect on restart
4. Run tests: `npm test`

**Common tasks:**
```bash
cd gateway

# Run all tests
npm test

# Run specific test
npm test -- --grep "geofence"

# Run simulator
npm run simulate

# Lint code
npm run lint

# Format code
npm run format
```

### Firestore Development

1. Edit `firestore/rules.example` or `firestore/SCHEMA.md`
2. To deploy rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. To create composite indexes:
   - See error message in gateway logs
   - Click link to Firebase Console
   - Index auto-created

## Testing

### Flutter Tests

```bash
cd apps/mobile

# All tests
flutter test

# With verbose output
flutter test -v

# Specific test file
flutter test test/models/device_test.dart

# Watch mode (re-run on changes)
flutter test --watch
```

### Gateway Tests

```bash
cd gateway

# All tests
npm test

# Specific test file
npm test -- --grep "gt06"

# Watch mode (re-run on changes)
npm test -- --watch
```

## Debugging

### Mobile App Debugging

**Print debugging:**
```dart
print('Device location: $lat, $lng');
```

Output appears in Flutter console.

**Visual debugging:**
- Use `flutter inspector` (in VS Code)
- Inspect widget tree
- See layout issues

**Network debugging:**
- Watch Firestore in Firebase Console
- Verify documents are created/updated
- Check Firebase Auth is working

### Gateway Debugging

**Console logging:**
```javascript
console.log('Received location:', {lat, lng, imei});
console.error('Error:', error.message);
```

Output appears in terminal.

**Firestore inspection:**
1. Firebase Console → Firestore
2. Click collection (devices, locations, etc.)
3. See documents and their fields in real-time

**Test-driven debugging:**
1. Write test that reproduces issue
2. Run `npm test -- --watch`
3. Fix code until test passes

## Common Workflows

### Adding a New Screen to Mobile App

1. Create file: `apps/mobile/lib/screens/my_screen_page.dart`
2. Add route in `apps/mobile/lib/main.dart`
3. Build widget with `StatefulWidget` or `StatelessWidget`
4. Access Firestore via `guardian_services.dart`
5. Test with `flutter test test/screens/my_screen_test.dart`

### Adding a Device Command

1. Add command builder in `gateway/src/commands.js`
   ```javascript
   function buildMyCommand(imei, param) {
     return Buffer.from([...]);
   }
   ```
2. Add test in `gateway/test/commands.test.js`
3. Wire into mobile app UI (Care Settings)
4. Test with real device or simulator

### Fixing a Protocol Issue

1. Read packet in gateway: `console.log(buffer.toString('hex'))`
2. Compare to protocol spec in `docs/reference/`
3. Update parser in `gateway/src/protocol/gt06.js`
4. Add test in `gateway/test/protocol/gt06.test.js`
5. Verify with simulator: `npm run simulate`

## Environment Setup

### VS Code Extensions (Recommended)

- **Dart** (Dart Code)
- **Flutter** (Dart Code)
- **ES7+ React/Redux/React-Native snippets**
- **ESLint**
- **Prettier**

### Flutter Configuration

```bash
# Enable web
flutter config --enable-web

# Enable Chrome device
flutter devices
```

### Local Firebase Emulator (Optional)

```bash
npm install -g firebase-tools

firebase emulators:start

# In gateway .env:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

## Performance Tips

### Mobile App
- Use `const` constructors to avoid rebuilds
- Avoid rebuilding entire map widget on location update
- Use `ListView.builder` for long lists
- Profile with DevTools: `flutter pub global run devtools`

### Gateway
- Use streams for large Firestore queries
- Don't load all locations into memory
- Batch Firestore writes when possible
- Monitor CPU/memory: `node --inspect server.js`

## Debugging Map Updates

If the map marker is lagging:

1. **Check gateway is receiving locations:**
   ```bash
   # In gateway logs, watch for:
   # "UD: lat=..., lng=..., imei=..."
   ```

2. **Check Firestore is updated:**
   ```bash
   # In Firebase Console → Firestore → locations/
   # Verify documents have latest timestamp
   ```

3. **Check app is listening:**
   ```dart
   // In mobile app, verify listener is active:
   FirebaseFirestore.instance
     .collection('locations')
     .where('imei', isEqualTo: imei)
     .snapshots()
     .listen((snapshot) {
       print('Got ${snapshot.docs.length} locations');
     });
   ```

4. **Check network latency:**
   - Open browser DevTools Network tab
   - Look at Firestore request latency
   - Should be < 500ms typically

## Code Quality

Before committing:

```bash
# Mobile
cd apps/mobile
flutter analyze
dart format lib/

# Gateway
cd gateway
npm run lint
npm run format

# Both
npm test        # gateway
flutter test    # mobile
```

## Cleanup

### Clear Firestore Data (for testing)

1. Firebase Console → Firestore
2. Click collection → Select all → Delete
3. Repeat for all collections

### Reset Mobile App State

```bash
flutter clean
flutter pub get
flutter run
```

### Reset Gateway State

```bash
cd gateway
npm run simulate &  # Restart simulator
# Kill and restart: npm start
```

---

## Next Steps

- [Repository Structure](REPOSITORY_STRUCTURE.md) — Understand file organization
- [Gateway Setup](GATEWAY_SETUP.md) — Detailed gateway configuration
- [System Overview](../02-architecture/SYSTEM_OVERVIEW.md) — Understand how things work
