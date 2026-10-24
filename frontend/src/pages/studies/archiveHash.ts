import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export async function archiveHash(file: Blob, signal: AbortSignal): Promise<string> {
  const hash = sha256.create()
  try {
    for (let offset = 0; offset < file.size; offset += 4 * 1024 ** 2) {
      signal.throwIfAborted()
      hash.update(new Uint8Array(await file.slice(offset, offset + 4 * 1024 ** 2).arrayBuffer()))
    }
    signal.throwIfAborted()
    return bytesToHex(hash.digest())
  } finally {
    hash.destroy()
  }
}
