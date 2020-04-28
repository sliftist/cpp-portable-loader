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

## Notes
- .d.ts files are emitted, which may cause `webpack --watch` to infinitely loop. This can be solved by excluding .d.ts files from your typescript loader (`{ test: /(([^d])|([^.]d)|(^d))\.tsx?$/, loader: "ts-loader", }`), however this will result in compilation not being triggered if you only change .d.ts files. As a result if you save a .cpp file and a .ts file that uses the generated .d.ts file, you may need to force two compilations before the .d.ts changes are picked up.

## Caveats
- Support for exceptions (via throw) is limited and does not work on Linux.
