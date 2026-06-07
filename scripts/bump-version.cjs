const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// npm_package_version is automatically set by `npm version`
const version = process.env.npm_package_version;

if (!version) {
  console.error('Error: npm_package_version is not set. Please run via npm version.');
  process.exit(1);
}

console.log(`Bumping version to ${version} in Tauri config and Cargo.toml...`);

// Update tauri.conf.json
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

// Update Cargo.toml
const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(/^version = ".*"/m, `version = "${version}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);

// Update Cargo.lock by running cargo check
try {
  console.log('Running cargo check to update Cargo.lock...');
  execSync('cargo check', { cwd: path.join(__dirname, '../src-tauri'), stdio: 'inherit' });
} catch (e) {
  console.error('cargo check failed; aborting version bump to avoid publishing inconsistent metadata.');
  process.exit(1);
}

// Add files to git index (npm version will automatically commit them)
try {
  execSync('git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock', { stdio: 'inherit' });
  console.log('Successfully staged bumped files.');
} catch (e) {
  console.error('Failed to git add bumped files:', e);
  process.exit(1);
}
