/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const OUTPUT = 'project-export.txt';
const CHUNK_PREFIX = 'project-export-';

// ============================================================
// SETTINGS
// ============================================================

const MAX_CHARS_PER_CHUNK = 100000;

// ============================================================
// DIRECTORIES / FILES TO IGNORE
// ============================================================

const IGNORE = new Set([
  'orangehrm-v2.json',
  // Dependencies
  'node_modules',

  // Project folders
  'images',
  'archive',
  //'auth',

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
  //'Dockerfile',
  'eslint.config.mjs',
  'oauth-debug.png',
  'orangehrm-5.9.zip',
  '.env.example',
  //'compose.yml',
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

function shouldIgnore(name, fullPath) {
  // Ignore explicitly listed names
  if (IGNORE.has(name)) {
    return true;
  }

  // Ignore sensitive / unwanted files
  const relativePath = fullPath && path.relative(ROOT, fullPath);
  const isAuthCredential =
    relativePath &&
    relativePath.split(path.sep)[0] === 'auth' &&
    path.extname(name).toLowerCase() === '.json';

  if (IGNORED_FILES.has(name) || isAuthCredential) {
    return true;
  }

  // Ignore our generated GPT chunks
  if (/^project-export-\d+\.txt$/.test(name)) {
    return true;
  }

  return false;
}

function shouldIncludeFile(filename, fullPath) {
  if (shouldIgnore(filename, fullPath)) {
    return false;
  }

  return EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function getEntries(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !shouldIgnore(entry.name, path.join(dir, entry.name)))
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
      if (!shouldIncludeFile(entry.name, fullPath)) {
        continue;
      }

      const relativePath = path.relative(ROOT, fullPath);

      let contents;

      try {
        contents = fs.readFileSync(fullPath, 'utf8');
      } catch (error) {
        console.warn(`Skipping unreadable file: ${relativePath} (${error.message})`);

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

// Split a single large string into slices of at most `max` chars,
// trying to break on newlines so slices stay readable.
function splitContent(text, max) {
  const slices = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + max, text.length);

    // Prefer to break at a newline near the end of the slice
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1; // include the newline
      }
    }

    slices.push(text.slice(start, end));
    start = end;
  }

  return slices;
}

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

    // Case 1: file fits in the current chunk
    if (currentChunk.length + fileSize <= MAX_CHARS_PER_CHUNK) {
      currentChunk += file.content;
      continue;
    }

    // Case 2: flush current chunk, then handle the file
    writeChunk();

    // Case 2a: file itself is too big -> split it into slices
    if (fileSize > MAX_CHARS_PER_CHUNK) {
      const slices = splitContent(file.content, MAX_CHARS_PER_CHUNK);

      for (let i = 0; i < slices.length; i++) {
        currentChunk =
          '# Project Export — Continued\n\n' +
          `# File (part ${i + 1}/${slices.length}): ${file.path}\n\n` +
          slices[i];
        writeChunk();
      }

      currentChunk = '# Project Export — Continued\n\n# File Contents\n\n';
    } else {
      // Case 2b: normal file, start a fresh chunk with it
      currentChunk = '# Project Export — Continued\n\n# File Contents\n\n' + file.content;
    }
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
