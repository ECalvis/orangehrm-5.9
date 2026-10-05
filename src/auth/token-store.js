const fs = require('fs');
const path = require('path');

class FileTokenStore {
  constructor(filePath) {
    if (!filePath) {
      throw new TypeError('Token file path is required');
    }

    this.filePath = filePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const contents = fs.readFileSync(this.filePath, 'utf8');
      const token = JSON.parse(contents);

      if (!token || typeof token !== 'object') {
        return null;
      }

      return token;
    } catch {
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
      mode: 0o600,
    });
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
