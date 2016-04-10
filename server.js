'use strict'
require('dotenv').load({ silent: true })

const crypto = require('crypto')
const debug = require('debug')('github')
const litesocket = require('litesocket')
const express = require('express')
const bodyParser = require('body-parser')

const app = express()
const captureRaw = (req, res, buffer) => { req.raw = buffer }
app.use(bodyParser.json({ verify: captureRaw }))

const secret = process.env.GITHUB_WEBHOOK_SECRET || 'hush-hush'

const sign = (secret, data) => {
  const buffer = new Buffer(data, 'utf8')
  return 'sha1=' + crypto.createHmac('sha1', secret).update(buffer).digest('hex')
}

app.post('/', (req, res) => {
  const event = req.headers['x-github-event']
  if (!event) {
    res.writeHead(400, 'Event Header Missing')
    return res.end()
  }

  const signature = req.headers['x-hub-signature']
  if (!signature || signature !== sign(secret, req.raw)) {
    res.writeHead(401, 'Invalid Signature')
    return res.end()
  }

  res.end()

  const data = req.body
  const action = data.action ? event + '.' + data.action : event

  var source = data.repository ? data.repository.full_name : data.organization.login
  console.log('event@%s: %s', source, action)

  app.emit('sse', JSON.stringify(data, null, 2))
})

app.get('/info', (req, res) => {
  const info = JSON.stringify({ listeners: app.listenerCount('sse') }, null, 2);
  app.emit('sse', info)
  res.json(info)
})

// Add an endpoint that will send all events via SSE.
app.get('/', litesocket, (req, res) => {
  // do not allow too many listeners!
  if (app.listenerCount('sse') > app.getMaxListeners()) {
    return res.status(502).end()
  }

  const fn = (event) => res.send(event)
  const removeListener = () => app.removeListener('sse', fn)
  const timeout = () => {
    removeListener()
    res.end()
  }

  app.on('sse', fn)
  res.on('close', removeListener)

  // force disconnect after 20 min
  setTimeout(timeout, 1200000)
})
