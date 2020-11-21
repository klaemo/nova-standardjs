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

exports.getConfigWithWorkspaceOverride = function getConfigWithWorkspaceOverride (name) {
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
exports.adjustRange = function adjustRange (toAdjust, replacedRange, newText) {
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
