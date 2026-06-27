// Headless phaser stub (see _phaser-stub.mjs for the why). addScore touches no
// Phaser API; the namespace is type-only / instanceof in un-driven helpers.
const handler = { get: () => p, apply: () => undefined, construct: () => ({}) };
const p = new Proxy(function () {}, handler);
module.exports = p;
module.exports.default = p;
