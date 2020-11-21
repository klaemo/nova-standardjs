const { getConfigWithWorkspaceOverride, adjustRange } = require('./helpers')

const DEFAULT_SYNTAXES = ['javascript', 'jsx']
const EXTRA_SYNTAXES = ['markdown', 'html']
const ALLOWED_SYNTAXES = [...DEFAULT_SYNTAXES, ...EXTRA_SYNTAXES]
const AUTO_FIX_CONFIG_KEY = 'klaemo.standardjs.config.autoFixOnSave'

// Do work when the extension is activated
exports.activate = async function () {
  const standardPath = nova.path.join(nova.workspace.path, 'node_modules', 'standard')
  const isStandardInstalled = nova.fs.access(standardPath, nova.fs.constants.R_OK)

  if (!isStandardInstalled) {
    return
  }

  try {
    const extension = new StandardExtension()

    await extension.start()

    const issueProvider = new IssuesProvider(extension)

    nova.assistants.registerIssueAssistant(ALLOWED_SYNTAXES, issueProvider)
    console.info(`${nova.extension.name} activated for ${nova.workspace.path}`)
  } catch (error) {
    console.error(error)
  }
}

exports.deactivate = function () {
  // Clean up state before the extension is deactivated
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
    /**
    * @type {Map<string, boolean>}
    */
    this._installedPluginsCache = new Map()
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

    nova.workspace.onDidAddTextEditor(this.onDidAddTextEditor, this)

    nova.config.onDidChange(AUTO_FIX_CONFIG_KEY, this.handleConfigChange, this)
    nova.workspace.config.onDidChange(
      AUTO_FIX_CONFIG_KEY,
      this.handleConfigChange,
      this
    )

    nova.commands.register(
      'klaemo.standardjs.command.executeAutofix',
      this.fixIssues,
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
  onDidAddTextEditor (editor) {
    if (getConfigWithWorkspaceOverride(AUTO_FIX_CONFIG_KEY)) {
      this.onWillSaveListeners.add(
        editor.onWillSave(this.editorWillSave, this)
      )
    }

    const { syntax } = editor.document

    const syntaxSupport = this.supportsSyntax(syntax)

    if (syntaxSupport.isSupported && !syntaxSupport.isPluginInstalled) {
      this.showNotificationForMissingPlugin(syntax, syntaxSupport.plugin)
    }
  }

  supportsSyntax (syntax) {
    if (DEFAULT_SYNTAXES.includes(syntax)) {
      return { isSupported: true, isPluginInstalled: true, plugin: undefined }
    }

    if (!EXTRA_SYNTAXES.includes(syntax)) {
      return { isSupported: false, isPluginInstalled: true, plugin: undefined }
    }

    const pluginName = `eslint-plugin-${syntax}`

    // try not to do the file system lookup all the time
    if (this._installedPluginsCache.get(pluginName)) {
      return { isSupported: true, isPluginInstalled: true, plugin: pluginName }
    }

    const pluginPath = nova.path.join(nova.workspace.path, 'node_modules', pluginName)
    // nova.workspace.contains() always returns `true` here?!
    const hasPlugin = nova.fs.access(pluginPath, nova.fs.constants.R_OK)

    this._installedPluginsCache.set(pluginName, hasPlugin)

    return { isSupported: true, isPluginInstalled: hasPlugin, plugin: pluginName }
  }

  /**
  * @param {string} syntax
  * @param {string} pluginName
  */
  async showNotificationForMissingPlugin (syntax, pluginName) {
    const configKey = 'klaemo.standardjs.notifications'
    const dissmissedNotifications = nova.config.get(configKey, 'array') || []
    const id = `missing-${pluginName}`

    if (dissmissedNotifications.includes(id)) {
      return
    }

    const notification = new NotificationRequest(id)
    notification.title = nova.localize('Missing plugin')
    notification.body = `To check code inside ${syntax} files, install the "${pluginName}" ESLint plugin and add it to "standard.plugins" in your "package.json".`
    notification.actions = [nova.localize('Got it'), nova.localize("Don't show this again")]

    try {
      const response = await nova.notifications.add(notification)
      if (response.actionIdx === 1) {
        nova.config.set(configKey, Array.from(new Set([...dissmissedNotifications, id])))
      }
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * @param {TextEditor} editor
   */
  editorWillSave (editor) {
    return this.fixIssues(editor)
  }

  /**
   * @param {TextEditor} editor
   */
  async fixIssues (editor) {
    const syntaxSupport = this.supportsSyntax(editor.document.syntax)
    if (!syntaxSupport.isSupported || !syntaxSupport.isPluginInstalled) {
      return
    }

    const filename = editor.document.isUntitled
      ? 'untitled'
      : nova.path.basename(editor.document.path)
    const documentRange = new Range(0, editor.document.length)
    const text = editor.document.getTextInRange(documentRange)

    const response = await this.service.request('lint', {
      text,
      filename: editor.document.path,
      cwd: nova.workspace.path
    })

    if (response.fixableErrorCount === 0) {
      console.info('fix: no fixable errors in', filename)
      return
    }

    /** @type {LintMessage[]} */
    const messages = response.results?.[0]?.messages

    if (!messages) {
      console.info('fix: messages is null', filename)
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
   * @param {StandardExtension} extension
   */
  constructor (extension) {
    this.extension = extension
  }

  /**
   * @param {TextEditor} editor
   * @returns {Promise<string[]>}
   */
  async provideIssues (editor) {
    const syntaxSupport = this.extension.supportsSyntax(editor.document.syntax)
    if (!syntaxSupport.isSupported || !syntaxSupport.isPluginInstalled) {
      return
    }

    const filename = editor.document.isUntitled
      ? 'untitled'
      : nova.path.basename(editor.document.path)

    try {
      const text = editor.document.getTextInRange(
        new Range(0, editor.document.length)
      )

      console.time('linting finished in')

      const response = await this.extension.service.request('lint', {
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
