'use strict';

/** A problem with what Claude asked for. Its message is shown to Claude as the tool's answer, so it says what to do instead. */
class ToolError extends Error {}

module.exports = { ToolError };
