```js
module.exports = {
    resolve: {
        extensions: [".cpp"]
    },
    module: {
        rules: [
            { test: /\.cpp$/, loader: "cpp-portable-loader" },
        ]
    },
    resolveLoader: {
        modules: ["node_modules"]
    },
};
```

## Requirements
- Window 64 bit, OSX 64 bit, or Linux 64 bit

## Caveats
- Support for exceptions (via throw) is limited and does not work on Linux.
