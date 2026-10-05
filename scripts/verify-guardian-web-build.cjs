const fs = require('node:fs');
const path = require('node:path');

function verifyWebBuild(buildRoot) {
  for (const name of ['index.html', 'main.dart.js', 'flutter_bootstrap.js', 'maps_key.js', 'firebase-messaging-sw.js']) {
    if (!fs.existsSync(path.join(buildRoot, name))) {
      throw new Error(`Guardian web build is incomplete: ${name} is missing. Rebuild with the local web/maps_key.js before deploying.`);
    }
  }
  const config = fs.readFileSync(path.join(buildRoot, 'maps_key.js'), 'utf8');
  if (!/^\s*window\.GOOGLE_MAPS_API_KEY\s*=\s*['"]AIza[A-Za-z0-9_-]{30,}['"]/m.test(config)) {
    throw new Error('Guardian Maps configuration is invalid. Restore the existing local web/maps_key.js and rebuild.');
  }
}

if (require.main === module) {
  try {
    verifyWebBuild(path.join(__dirname, '..', 'apps', 'mobile', 'build', 'web'));
    console.log('Guardian web build and Maps configuration verified.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyWebBuild };
