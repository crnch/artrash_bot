import { crypto } from 'https://deno.land/std@0.159.0/crypto/mod.ts'
import { config } from "https://deno.land/std@0.163.0/dotenv/mod.ts";

export async function digestMessageToHex(message: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', message) // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string
  return hashHex
}

const envConfig = await config()

export function getEnvVariable(key: string): string | undefined {
  return envConfig[key] || Deno.env.get(key)
}
