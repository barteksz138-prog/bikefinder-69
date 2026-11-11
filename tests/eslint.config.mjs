export default [{
  files: ["app.js"],
  languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: {
    React: "readonly", ReactDOM: "readonly", window: "readonly", document: "readonly", localStorage: "readonly", fetch: "readonly",
    console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", DOMParser: "readonly", AbortSignal: "readonly", AbortController: "readonly",
    alert: "readonly", URL: "readonly", Date: "readonly", Math: "readonly", JSON: "readonly", Number: "readonly", String: "readonly", Set: "readonly", Map: "readonly",
    Promise: "readonly", Array: "readonly", Object: "readonly", RegExp: "readonly", Error: "readonly", parseInt: "readonly", parseFloat: "readonly", isNaN: "readonly",
    encodeURIComponent: "readonly", decodeURIComponent: "readonly", navigator: "readonly", Boolean: "readonly", Infinity: "readonly", Symbol: "readonly", requestAnimationFrame: "readonly", setInterval: "readonly", clearInterval: "readonly", confirm: "readonly", Blob: "readonly"
  } },
  rules: { "no-undef": "error", "no-unused-vars": ["warn", { vars: "all", args: "none" }], "no-const-assign": "error", "no-dupe-keys": "error" },
}];
