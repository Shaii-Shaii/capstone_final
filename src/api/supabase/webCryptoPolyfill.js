import * as ExpoCrypto from 'expo-crypto';

// Supabase Auth expects the small WebCrypto surface used by PKCE. Hermes does
// not expose crypto.subtle in every React Native build, while expo-crypto
// provides the same secure native SHA-256 and random-value operations.
const cryptoTarget = globalThis.crypto || {};

if (typeof cryptoTarget.getRandomValues !== 'function') {
  cryptoTarget.getRandomValues = (typedArray) => ExpoCrypto.getRandomValues(typedArray);
}

if (!cryptoTarget.subtle) {
  cryptoTarget.subtle = {
    digest: (algorithm, data) => ExpoCrypto.digest(algorithm, data),
  };
}

if (!globalThis.crypto) {
  globalThis.crypto = cryptoTarget;
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(value = '') {
      const encoded = encodeURIComponent(String(value));
      const bytes = [];

      for (let index = 0; index < encoded.length; index += 1) {
        if (encoded[index] === '%') {
          bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
          index += 2;
        } else {
          bytes.push(encoded.charCodeAt(index));
        }
      }

      return new Uint8Array(bytes);
    }
  };
}
