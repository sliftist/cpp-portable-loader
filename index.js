const fs = require("fs");

// Use eval to prevent webpack from inlining wasm-loader-main.
let requireReal = eval("require");
let path = requireReal.resolve("./wasm-loader-main");
// Make the next require call get a new wasm-loader-main, by clearing the cache of the old one.
fs.watchFile(path, () => {
    delete require.cache[path];
});

module.exports = function transformWrapper() {
    return requireReal("./wasm-loader-main").transform.apply(this, arguments);
};