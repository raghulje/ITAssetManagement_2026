import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../../src/app.js'

export type StartedApp = {
  baseUrl: string
  close: () => Promise<void>
}

export async function startApp(): Promise<StartedApp> {
  const prevEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'

  const app = createApp()
  const server: Server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (prevEnv === undefined) delete process.env.NODE_ENV
          else process.env.NODE_ENV = prevEnv
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}

export async function jsonRequest(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

export function isLiveWave0(): boolean {
  return process.env.WAVE0_LIVE === '1'
}
