"use strict";

const message =
  "Native sharp image optimization is disabled. Use original allowlisted images or an explicitly approved Cloudflare Images loader.";

function unsupportedSharp() {
  throw new Error(message);
}

unsupportedSharp.block = unsupportedSharp;
unsupportedSharp.unblock = unsupportedSharp;
unsupportedSharp.cache = unsupportedSharp;
unsupportedSharp.concurrency = unsupportedSharp;

module.exports = unsupportedSharp;
