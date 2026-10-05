/* eslint-disable no-console */
/* eslint-disable no-unused-vars */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const OUTPUT = 'project-export.txt';
const CHUNK_PREFIX = 'project-export-';

// ============================================================
// SETTINGS
// ============================================================

const MAX_CHARS_PER_CHUNK = 50000;

// ============================================================
// DIRECTORIES / FILES TO IGNORE
// ============================================================

const IGNORE = new Set([
  // Dependencies
  'node_modules',

  // Project folders
  'images',
  'archive',
  'auth',

  // Git / IDE
  '.git',
  '.idea',
  '.vscode',

  // Playwright generated output
  'playwright-report',
  'test-results',
  'blob-report',

  // Coverage / build output
  'coverage',
  'dist',
  'build',

  // Files that aren't relevant to the AI export
  'Dockerfile',
  'eslint.config.mjs',
  'oauth-debug.png',
  'orangehrm-5.9.zip',
  '.env.example',
  'compose.yml',
  '.gitignore',
  '.prettierignore',
  '.prettierrc',

  // Export output
  OUTPUT,
]);

// ============================================================
// FILES TO ALWAYS IGNORE
// ============================================================

const IGNORED_FILES = new Set([
  // Environment / secrets
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',

  // Package manager lock files
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

// ============================================================
// FILE EXTENSIONS TO INCLUDE
// ============================================================

const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.yaml', '.yml', '.xml', '.md']);

// ============================================================
// HELPERS
// ============================================================

function shouldIgnore(name) {
  // Ignore explicitly listed names
  if (IGNORE.has(name)) {
    return true;
  }

  // Ignore sensitive / unwanted files
  if (IGNORED_FILES.has(name)) {
    return true;
  }

  // Ignore our generated GPT chunks
  if (/^project-export-\d+\.txt$/.test(name)) {
    return true;
  }

  return false;
}

function shouldIncludeFile(filename) {
  if (shouldIgnore(filename)) {
    return false;
  }

  return EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function getEntries(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !shouldIgnore(entry.name))
    .sort((a, b) => {
      // Directories first
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }

      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });
}

// ============================================================
// PROJECT STRUCTURE
// ============================================================

function getProjectStructure() {
  let structure = '# Project Structure\n\n';

  function tree(dir, prefix = '') {
    const entries = getEntries(dir);

    entries.forEach((entry, index) => {
      const last = index === entries.length - 1;

      const connector = last ? '└── ' : '├── ';

      structure += `${prefix}${connector}${entry.name}\n`;

      if (entry.isDirectory()) {
        const nextPrefix = prefix + (last ? '    ' : '│   ');

        tree(path.join(dir, entry.name), nextPrefix);
      }
    });
  }

  tree(ROOT);

  return structure;
}

// ============================================================
// COLLECT FILES
// ============================================================

function getFileBlocks() {
  const files = [];

  function collect(dir) {
    const entries = getEntries(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Recurse into directories
      if (entry.isDirectory()) {
        collect(fullPath);
        continue;
      }

      // Only collect allowed extensions
      if (!shouldIncludeFile(entry.name)) {
        continue;
      }

      const relativePath = path.relative(ROOT, fullPath);

      let contents;

      try {
        contents = fs.readFileSync(fullPath, 'utf8');
      } catch (error) {
        console.warn(`Skipping unreadable file: ${relativePath}`);

        continue;
      }

      const block =
        '\n' +
        '='.repeat(80) +
        '\n' +
        `FILE: ${relativePath}\n` +
        '='.repeat(80) +
        '\n\n' +
        contents +
        '\n';

      files.push({
        path: relativePath,
        content: block,
        size: contents.length,
      });
    }
  }

  collect(ROOT);

  return files;
}

// ============================================================
// FULL EXPORT
// ============================================================

function createFullExport(structure, files) {
  let output = structure;

  output += '\n# File Contents\n';

  output += '\nThis file contains the relevant source files of the project.\n';

  output += 'Files are separated by FILE markers.\n\n';

  for (const file of files) {
    output += file.content;
  }

  fs.writeFileSync(path.join(ROOT, OUTPUT), output, 'utf8');

  console.log(`Created ${OUTPUT} ` + `(${output.length.toLocaleString()} chars)`);
}

// ============================================================
// GPT CHUNKS
// ============================================================

function createGPTChunks(structure, files) {
  // Remove old GPT chunks
  const existingFiles = fs
    .readdirSync(ROOT)
    .filter((name) => /^project-export-\d+\.txt$/.test(name));

  for (const file of existingFiles) {
    fs.unlinkSync(path.join(ROOT, file));
  }

  let chunkNumber = 1;

  let currentChunk = structure + '\n# File Contents\n\n';

  function writeChunk() {
    if (!currentChunk.trim()) {
      return;
    }

    const filename = `${CHUNK_PREFIX}${String(chunkNumber).padStart(3, '0')}.txt`;

    fs.writeFileSync(path.join(ROOT, filename), currentChunk, 'utf8');

    console.log(`Created ${filename} ` + `(${currentChunk.length.toLocaleString()} chars)`);

    chunkNumber++;

    currentChunk = '';
  }

  for (const file of files) {
    const fileSize = file.content.length;

    // Keep individual files intact.
    // Start a new chunk if adding this file
    // would exceed the maximum size.
    if (currentChunk.length > 0 && currentChunk.length + fileSize > MAX_CHARS_PER_CHUNK) {
      writeChunk();

      currentChunk = '# Project Export — Continued\n\n' + '# File Contents\n\n';
    }

    currentChunk += file.content;
  }

  writeChunk();

  console.log(`Created ${chunkNumber - 1} GPT chunk(s)`);
}

// ============================================================
// SUMMARY
// ============================================================

function printSummary(files) {
  console.log('\nProject Summary');
  console.log('----------------------------');

  console.log(`Source files: ${files.length}`);

  const totalCharacters = files.reduce((total, file) => total + file.size, 0);

  console.log(`Source characters: ` + `${totalCharacters.toLocaleString()}`);

  console.log(`Chunk limit: ` + `${MAX_CHARS_PER_CHUNK.toLocaleString()}`);

  console.log('----------------------------\n');
}

// ============================================================
// RUN
// ============================================================

console.log('Exporting Playwright QA framework...\n');

const structure = getProjectStructure();

const files = getFileBlocks();

printSummary(files);

createFullExport(structure, files);

createGPTChunks(structure, files);

console.log('\nExport complete!');
