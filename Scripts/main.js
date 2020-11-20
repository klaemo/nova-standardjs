const ALLOWED_SYNTAXES = ['javascript', 'typescript', 'jsx', 'tsx']
const AUTO_FIX_CONFIG_KEY = 'klaemo.standardjs.config.autoFixOnSave'

// Do work when the extension is activated
exports.activate = async function () {
  if (!nova.workspace.contains('node_modules/standard')) {
    return
  }

  try {
    const extension = new StandardExtension()

    await extension.start()

    const issueProvider = new IssuesProvider(extension.service)

    nova.assistants.registerIssueAssistant(ALLOWED_SYNTAXES, issueProvider)
    console.info(`${nova.extension.name} activated for ${nova.workspace.path}`)
  } catch (error) {
    console.error(error)
  }
}

exports.deactivate = function () {
  // Clean up state before the extension is deactivated
}

function getWorkspaceConfig (name) {
  const value = nova.workspace.config.get(name)
  switch (value) {
    case 'Enable':
      return true
    case 'Disable':
      return false
    case 'Inherit from global settings':
      return null
    default:
      return value
  }
}

function getConfigWithWorkspaceOverride (name) {
  const workspaceConfig = getWorkspaceConfig(name)
  const extensionConfig = nova.config.get(name)

  return workspaceConfig === null ? extensionConfig : workspaceConfig
}

/**
 * Returns a new range to account for changed text
 * or null if it can't be adjusted because it overlaps with the replacement.
 *
 * @param {Range} toAdjust
 * @param {Range} replacedRange
 * @param {string} newText
 *
 * @returns {Range | null}
 */
function adjustRange (toAdjust, replacedRange, newText) {
  if (toAdjust.end <= replacedRange.start) {
    return toAdjust
  }
  if (toAdjust.start >= replacedRange.end) {
    const characterDiff = newText.length - replacedRange.length
    return new Range(
      toAdjust.start + characterDiff,
      toAdjust.end + characterDiff
    )
  }
  return null
}

/**
 * @typedef {{
   ruleId: string,
   column: number,
   messageId: string,
   endColumn: number,
   message: string,
   fix?: {
     range: [number, number] | Range,
     text: string
   },
   line: number,
   severity: number,
   nodeType: string,
   endLine: number
 }} LintMessage
*/

class StandardExtension {
  constructor () {
    this.service = new Process('/usr/bin/env', {
      args: [
        'node',
        nova.path.join(nova.extension.path, 'Scripts', 'standard-server.js'),
        nova.path.join(nova.workspace.path, 'node_modules', 'standard')
      ],
      stdio: 'jsonrpc'
    })

    this.onWillSaveListeners = new CompositeDisposable()

    this.service.onDidExit((exitCode) =>
      console.error('standard-server exitCode', exitCode)
    )
  }

  async start () {
    const isReady = new Promise((resolve) => {
      const listener = this.service.onNotify('didStart', () => {
        listener.dispose()
        resolve(true)
      })
    })
    this.service.start()
    await isReady

    nova.workspace.onDidAddTextEditor((editor) => {
      if (getConfigWithWorkspaceOverride(AUTO_FIX_CONFIG_KEY)) {
        this.onWillSaveListeners.add(
          editor.onWillSave(this.editorWillSave, this)
        )
      }
    })

    nova.config.onDidChange(AUTO_FIX_CONFIG_KEY, this.handleConfigChange, this)
    nova.workspace.config.onDidChange(
      AUTO_FIX_CONFIG_KEY,
      this.handleConfigChange,
      this
    )

    nova.commands.register(
      'klaemo.standardjs.command.executeAutofix',
      this.format,
      this
    )
  }

  handleConfigChange () {
    const isEnabled = getConfigWithWorkspaceOverride(AUTO_FIX_CONFIG_KEY)

    if (isEnabled) {
      console.info('enabling auto fix on save')
      for (const editor of nova.workspace.textEditors) {
        this.onWillSaveListeners.add(
          editor.onWillSave(this.editorWillSave, this)
        )
      }
    } else {
      console.info('disabling auto fix on save')
      this.onWillSaveListeners.dispose()
    }
  }

  /**
   * @param {TextEditor} editor
   */
  async editorWillSave (editor) {
    if (!ALLOWED_SYNTAXES.includes(editor.document.syntax)) {
      return
    }

    await this.format(editor)
  }

  /**
   * @param {TextEditor} editor
   */
  async format (editor) {
    const filename = editor.document.isUntitled
      ? 'untitled'
      : nova.path.basename(editor.document.path)
    const documentRange = new Range(0, editor.document.length)
    const text = editor.document.getTextInRange(documentRange)

    console.info('format:', text.length, 'chars in', filename)

    const response = await this.service.request('lint', {
      text,
      filename: editor.document.path,
      cwd: nova.workspace.path
    })

    if (response.fixableErrorCount === 0) {
      console.info('format: no fixable errors in', filename)
      return
    }

    /** @type {LintMessage[]} */
    const messages = response.results?.[0]?.messages

    if (!messages) {
      console.info('format: messages is null', filename)
      return
    }

    console.info('fix:', messages.length, 'issues found in', filename)

    console.time(`fix: edit ${filename}`)
    await editor.edit((edit) => {
      // do biggest edits first
      let fixableIssues = messages
        .filter((issue) => issue.fix)
        .map((issue) => {
          issue.fix.range = new Range(...issue.fix.range)
          return issue
        })
        .sort((a, b) => a.fix.range.compare(b.fix.range))

      while (fixableIssues.length) {
        const fixedIssue = fixableIssues.shift()
        edit.replace(fixedIssue.fix.range, fixedIssue.fix.text)

        fixableIssues = fixableIssues
          .map((nextIssue) => {
            nextIssue.fix.range = adjustRange(
              nextIssue.fix.range,
              fixedIssue.fix.range,
              fixedIssue.fix.text
            )
            return nextIssue
          })
          .filter((nextIssue) => nextIssue.fix.range)
      }
    })

    console.timeEnd(`fix: edit ${filename}`)
  }
}

class IssuesProvider {
  /**
   * @param {Process} server
   */
  constructor (server) {
    this.service = server
  }

  /**
   * @param {TextEditor} editor
   * @returns {Promise<string[]>}
   */
  async provideIssues (editor) {
    const filename = editor.document.isUntitled
      ? 'untitled'
      : nova.path.basename(editor.document.path)

    try {
      const text = editor.document.getTextInRange(
        new Range(0, editor.document.length)
      )

      console.time('linting finished in')

      const response = await this.service.request('lint', {
        text,
        filename: editor.document.path,
        cwd: nova.workspace.path
      })

      const messages = response.results?.[0]?.messages

      if (!messages) {
        console.info('lint: messages is null')
        return
      }

      console.info(
        'lint: issues found',
        messages.length,
        'in',
        filename
      )

      const issues = messages.map((message) => {
        const issue = new Issue()
        issue.message = message.message
        issue.line = message.line
        issue.endLine = message.endLine
        issue.column = message.column
        issue.endColumn = message.endColumn
        issue.code = message.ruleId
        issue.source = nova.extension.name
        issue.severity = message.fix ? IssueSeverity.Info : IssueSeverity.Error
        return issue
      })

      console.timeEnd('linting finished in')

      return issues
    } catch (error) {
      console.error(error)
      console.trace()
    }
  }
}
