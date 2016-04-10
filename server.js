'use strict'

const crypto = require('crypto')
const litesocket = require('litesocket')
const http = require('http')
const bl = require('bl')
const events = new (require('events').EventEmitter)()

http.ServerResponse.prototype.status = function(code) {
  this.statusCode = code
  return this
}
const routes = {
  // an endpoint that just gives some info- and causes that info to be emitted
  // (just for testing)
  'GET/info': (req, res) => {
    const info = JSON.stringify({ listeners: app.listenerCount('sse') })
    app.emit('sse', 'info', info)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(info)
  },

  // Add an endpoint that will send all events via SSE.
  'GET/': (req, res) => {
    // do not allow too many listeners!
    if (app.listenerCount('sse') >= app.getMaxListeners()) {
      return res.status(502).end()
    }

    litesocket(req, res, () => {

      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
      const fn = (event, data) => {
        if(event === 'ping') {
          return litesocket.sendComment(res, 'ping')
        }

        litesocket.sendEvent(res, event)
        litesocket.send(res, data)
      }
      const removeListener = (timeout) => {
        console.log('removing listener @ ' + ip + (timeout||''))
        app.removeListener('sse', fn)
      }
      const timeout = () => {
        removeListener(' (timeout)')
        res.end()
      }

      console.log('new listener @ ' + ip)
      app.on('sse', fn)
      res.on('close', removeListener)

      // force disconnect after 20 min
      setTimeout(timeout, 1200000)
    })
  },
  'POST/': (req, res) => {
    const event = req.headers['x-github-event']
    if(!event) return res.end()

    req.pipe(bl(function (err, data) {
      if (err) return res.status(400).end()


      try {
        data = JSON.parse(data.toString())
      } catch (e) {
        return res.status(400).end()
      }

      const source = data.repository ? data.repository.full_name : data.organization.login
      const action = data.action ? event + '.' + data.action : event
      console.log('event@%s: %s', source, action)

      app.emit('sse', event, JSON.stringify(data, null, 2))

      res.end()
    }))
  }
}



const port = process.env.PORT || 3000
var app = http.createServer((req, res) => {
  const handler = routes[req.method+req.url]
  if(!handler) return res.status(404).end()

  handler(req, res)
})
.listen(port, () => {
  console.log('hook-relay listening on port', port)
})

setInterval(() => app.emit('sse', 'ping'), 57000);
