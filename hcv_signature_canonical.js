'use strict';

const OMITTED_TOP_LEVEL_FIELDS = new Set([
  'signatureAlgorithm',
  'signature',
  'publicKey',
]);

function isWhitespace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

function skipWhitespace(text, index) {
  while (index < text.length && isWhitespace(text[index])) index += 1;
  return index;
}

function readStringEnd(text, start) {
  if (text[start] !== '"') throw new Error('EXPECTED_JSON_STRING');
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (ch === '"') return index + 1;
    index += 1;
  }
  throw new Error('UNTERMINATED_JSON_STRING');
}

function readValueEnd(text, start) {
  let index = skipWhitespace(text, start);
  if (index >= text.length) throw new Error('MISSING_JSON_VALUE');

  if (text[index] === '"') return readStringEnd(text, index);

  if (text[index] === '{' || text[index] === '[') {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < text.length; index += 1) {
      const ch = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
    throw new Error('UNTERMINATED_JSON_CONTAINER');
  }

  let end = index;
  while (end < text.length && text[end] !== ',' && text[end] !== '}') end += 1;
  while (end > index && isWhitespace(text[end - 1])) end -= 1;
  if (end === index) throw new Error('EMPTY_JSON_VALUE');
  return end;
}

function minifyJsonPreservingLexemes(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (!isWhitespace(ch)) out += ch;
  }
  if (inString) throw new Error('UNTERMINATED_JSON_STRING');
  return out;
}

function signedPayloadFromRawCertificate(raw) {
  const text = String(raw || '');
  let index = skipWhitespace(text, 0);
  if (text[index] !== '{') throw new Error('CERTIFICATE_NOT_OBJECT');
  index += 1;

  const kept = [];
  while (true) {
    index = skipWhitespace(text, index);
    if (text[index] === '}') {
      index += 1;
      break;
    }

    const keyStart = index;
    const keyEnd = readStringEnd(text, keyStart);
    const key = JSON.parse(text.slice(keyStart, keyEnd));

    index = skipWhitespace(text, keyEnd);
    if (text[index] !== ':') throw new Error('EXPECTED_JSON_COLON');
    index += 1;

    const valueEnd = readValueEnd(text, index);
    const propertyRaw = text.slice(keyStart, valueEnd);
    if (!OMITTED_TOP_LEVEL_FIELDS.has(key)) {
      kept.push(minifyJsonPreservingLexemes(propertyRaw));
    }

    index = skipWhitespace(text, valueEnd);
    if (text[index] === ',') {
      index += 1;
      continue;
    }
    if (text[index] === '}') {
      index += 1;
      break;
    }
    throw new Error('EXPECTED_JSON_COMMA_OR_END');
  }

  index = skipWhitespace(text, index);
  if (index !== text.length) throw new Error('TRAILING_JSON_DATA');
  return `{${kept.join(',')}}`;
}

module.exports = {
  minifyJsonPreservingLexemes,
  signedPayloadFromRawCertificate,
};
