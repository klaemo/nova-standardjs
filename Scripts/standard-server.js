const standard = require('standard')

console.time('lint')
standard.lintText('const foo = new Range("asdf");', {}, (error, results) => {
  console.timeEnd('lint')
  console.log(results.results)
})