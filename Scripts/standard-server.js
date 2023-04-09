const JsonRpcService = require('./json-rpc.js')
const standardPath = process.argv[2]
const server = new JsonRpcService(process.stdin, process.stdout)

let standardInstance

server.onRequest('lint', async (request) => {
  if (!standardInstance) {
    standardInstance = (await import(standardPath)).default
  }

  if (standardInstance.constructor.name === 'StandardEngine') {
    return await standardInstance.lintText(
      request.text,
      { filename: request.filename, cwd: request.cwd }
    )
  } else {
    return new Promise((resolve, reject) => {
      standardInstance.lintText(
        request.text,
        { filename: request.filename, cwd: request.cwd },
        (error, results) => {
          if (error) return reject(error)
          resolve(results)
        }
      )
    })
  }
})

server.notify('didStart')
