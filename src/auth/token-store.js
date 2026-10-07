const fs = require('fs');
const path = require('path');

const TOKEN_FILE_MODE = 0o600;

class FileTokenStore {
  constructor(filePath) {
    if (!filePath) {
      throw new TypeError('Token file path is required');
    }

    this.filePath = filePath;
  }

  load() {
    let contents;

    try {
      contents = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }

      // Permission errors, I/O errors, and anything else should not be
      // silently swallowed — they mean the store cannot be trusted and the
      // caller needs to know.
      throw err;
    }

    try {
      const token = JSON.parse(contents);

      if (!token || typeof token !== 'object') {
        return null;
      }

      return token;
    } catch {
      // Malformed JSON is treated as absent. The file is left on disk for
      // forensics; callers will re-authenticate and overwrite it.
      return null;
    }
  }

  save(token) {
    if (!token || typeof token !== 'object') {
      throw new TypeError('Token must be an object');
    }

    const directory = path.dirname(this.filePath);

    fs.mkdirSync(directory, { recursive: true });

    fs.writeFileSync(this.filePath, JSON.stringify(token, null, 2), {
      encoding: 'utf8',
      mode: TOKEN_FILE_MODE,
    });

    // mode only applies when the file is created. chmod ensures an existing
    // file that was previously written with looser permissions is tightened.
    fs.chmodSync(this.filePath, TOKEN_FILE_MODE);
  }

  clear() {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

module.exports = {
  FileTokenStore,
};
