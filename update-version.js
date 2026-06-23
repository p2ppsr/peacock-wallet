import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Get the version from command line arguments
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Please provide a version number as an argument');
  console.error('Example: node update-version.js 0.2.4');
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Version should be in format x.y.z');
  process.exit(1);
}

// Files to update
const filesToUpdate = [
  {
    path: 'package.json',
    update: (content) => {
      const json = JSON.parse(content);
      json.version = newVersion;
      return JSON.stringify(json, null, 2) + '\n';
    }
  },
  {
    path: 'src-tauri/tauri.conf.json',
    update: (content) => {
      const json = JSON.parse(content);
      json.version = newVersion;
      return JSON.stringify(json, null, 2) + '\n';
    }
  },
  {
    path: 'src-tauri/Cargo.toml',
    update: (content) => {
      return content.replace(/^version = ".*?"/m, `version = "${newVersion}"`);
    }
  },
  {
    path: 'src-tauri/Cargo.lock',
    update: (content) => {
      // Update the version in Cargo.lock for the user-wallet package
      return content.replace(
        /(\[\[package\]\]\s+name = "user-wallet"\s+version = ").*?(")/, 
        `$1${newVersion}$2`
      );
    }
  },
  {
    path: 'src-tauri/app.user.wallet.metainfo.xml',
    update: (content) => {
      // Update both version and release date
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      return content
        .replace(/<release version=".*?"/, `<release version="${newVersion}"`)
        .replace(/date=".*?"/, `date="${today}"`);
    }
  }
];

// Update each file
filesToUpdate.forEach(file => {
  const filePath = path.resolve(file.path);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const updatedContent = file.update(content);
      fs.writeFileSync(filePath, updatedContent);
      console.log(`Updated ${file.path} to version ${newVersion}`);
    } else {
      console.warn(`File not found: ${file.path}`);
    }
  } catch (error) {
    console.error(`Failed to update ${file.path}:`, error.message);
  }
});

console.log(`Version updated to ${newVersion} successfully!`);

try {
  // Commit the changes
  execSync('git add .');
  execSync(`git commit -m "Bump version to ${newVersion}"`);

  // Create annotated tag (required for --follow-tags to work)
  const tagName = `v${newVersion}`;
  execSync(`git tag -a ${tagName} -m "Release version ${newVersion}"`);

  console.log(`Created annotated git tag: ${tagName}`);
  console.log('To push changes and tag, run: git push --follow-tags');
} catch (error) {
  console.error('Failed to create git commit/tag:', error.message);
}
