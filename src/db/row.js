function toCamel(row) {
  if (row === null || row === undefined) {
    return row;
  }

  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/_([a-z])/g, (_, character) => character.toUpperCase())] = value;
  }
  return result;
}

function toSnake(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    result[key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)] = value;
  }
  return result;
}

module.exports = { toCamel, toSnake };
