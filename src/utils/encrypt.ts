import CryptoJS, { MD5 } from 'crypto-js';

const secretKey = "5yGvayzCxMLtNr0n29et2ftV4RemirK0ZtdR";

export function encrypt(str: string): string {
  // 加密
  const encrypted = CryptoJS.AES.encrypt(str, secretKey).toString();
  return encrypted;
}

export function decrypt(str: string): string {
  // 解密
  const decrypted = CryptoJS.AES.decrypt(str, secretKey).toString(CryptoJS.enc.Utf8);
  return decrypted;
}

export function aesDecrypt(data: Uint8Array, keyData: Uint8Array, keyIV: string): Uint8Array {
  // 解密
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: uint8ArrayToWordArray(data),}), 
    uint8ArrayToWordArray(keyData), 
    { iv: CryptoJS.enc.Hex.parse(keyIV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  return wordArrayToUint8Array(decrypted);
}

function uint8ArrayToWordArray(u8Array: Uint8Array) {
  const words = [];
  for (let i = 0; i < u8Array.length; i += 4) {
    words.push(
      (u8Array[i] << 24) |
      (u8Array[i + 1] << 16) |
      (u8Array[i + 2] << 8) |
      (u8Array[i + 3])
    );
  }
  return CryptoJS.lib.WordArray.create(words, u8Array.length);
}

function wordArrayToUint8Array(wordArray: CryptoJS.lib.WordArray) {
  const { words, sigBytes } = wordArray;
  const u8Array = new Uint8Array(sigBytes);
  let offset = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const bytes = [
      (word >> 24) & 0xff,
      (word >> 16) & 0xff,
      (word >> 8) & 0xff,
      word & 0xff
    ];
    for (let b = 0; b < 4 && offset < sigBytes; b++) {
      u8Array[offset++] = bytes[b];
    }
  }
  return u8Array;
}

export function md5Encrypt(str: string): string {
  if (!str) {
    return '';
  }
  return MD5(str).toString();
};



