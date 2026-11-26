/**
 * 记忆文件哈希：优先 WebCrypto SHA-256；旧浏览器或非安全上下文退化为 FNV-1a 64 位。
 * 哈希只用于发现「用户之后改过文件」与撤销校验，不是安全边界。
 */
const encoder = new TextEncoder()

const FALLBACK_PREFIX = 'fnv1a64:'

const fnv1a64 = (bytes: Uint8Array): string => {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export const hasWebCrypto = (): boolean =>
  typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function'

export const sha256 = async (text: string): Promise<string> => {
  const bytes = encoder.encode(text)
  if (hasWebCrypto()) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  return `${FALLBACK_PREFIX}${fnv1a64(bytes)}`
}

/** 退化哈希带前缀，避免与真实 SHA-256 混淆 */
export const isFallbackHash = (hash: string) => hash.startsWith(FALLBACK_PREFIX)
