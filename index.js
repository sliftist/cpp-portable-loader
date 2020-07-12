function isNode() {
    return typeof window === "undefined";
}

if(isNode() && process.env["cpp-portable-loader-dev"]) {
    // Use eval to prevent webpack from inlining wasm-loader-main.
    let requireAtRuntime = eval("require");

    const fs = requireAtRuntime("fs");

    let path = requireAtRuntime.resolve("./wasm-loader-main");

    // Make the next require call get a new wasm-loader-main, by clearing the cache of the old one.
    fs.watchFile(path, () => {
        delete require.cache[path];
    });

    module.exports = function transformWrapper() {
        return requireAtRuntime("./wasm-loader-main").transform.apply(this, arguments);
    };
} else {
    module.exports = function transformWrapper() {
        return require("./wasm-loader-main").transform.apply(this, arguments);
    };
}