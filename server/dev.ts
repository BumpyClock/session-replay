import { homedir } from 'node:os'
import { createApiServer } from './index'
import { resolveSessionSource } from './api/session-source'

const port = Number(process.env.SESSION_REPLAY_API_PORT ?? 4848)
const homeDirectory = process.env.SESSION_REPLAY_HOME ?? homedir()
const sessionSource = await resolveSessionSource(homeDirectory)
const server = createApiServer({
  homeDirectory,
  hostname: '127.0.0.1',
  port,
  sessionSource,
})

console.log(`Session replay API listening on ${server.url}`)
