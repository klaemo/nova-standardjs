const JsonRpcService = require('./json-rpc.js')
const standardPath = process.argv[2]

const standard = require(standardPath)
const server = new JsonRpcService(process.stdin, process.stdout)

server.onRequest('lint', (request) => {
  return new Promise((resolve, reject) => {
    standard.lintText(
      request.text,
      { filename: request.filename, cwd: request.cwd },
      (error, results) => {
        if (error) return reject(error)
        resolve(results)
      }
    )
  })
})

server.notify('didStart')
