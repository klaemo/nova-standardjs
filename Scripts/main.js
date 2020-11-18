exports.activate = function () {
    if (nova.workspace.contains("node_modules/.bin/standard")) {
      console.log(`${nova.extension.name} activated`);
      nova.assistants.registerIssueAssistant(
        ["javascript", "jsx", "typescript", "tsx"],
        new IssuesProvider()
      );
  }
  // Do work when the extension is activated
};

exports.deactivate = function () {
  // Clean up state before the extension is deactivated
};

class IssuesProvider {
  /**
   * @param {TextEditor} editor
   * @returns {Promise<string[]>}
   */
  async provideIssues (editor) {
    console.time('Linting')
    const process = new Process(`${nova.workspace.path}/node_modules/.bin/standard`, {
      args: ["--verbose", '--stdin']
    });

    const issueMatcher = new IssueParser('standardjs-issue-matcher')
    process.onStdout(function (line) {
      issueMatcher.pushLine(line)
    });
    
    process.start()
    
    const writer = process.stdin.getWriter()
    await writer.ready
    
    await writer.write(editor.document.getTextInRange(new Range(0, editor.document.length)))
    
    await writer.ready
    await writer.close()

    return new Promise((resolve) => {
        process.onDidExit(() => {
            console.timeEnd('Linting')
            resolve(issueMatcher.issues.map(issue => {
              issue.source = nova.extension.name
              return issue
            }))
        })
    });
  }
}
