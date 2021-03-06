## Usage
1) Add as your .cpp loader in your webpack.config.js file:
```js
module.exports = {
    resolve: {
        extensions: [".cpp"]
    },
    module: {
        rules: [
            { test: /\.cpp$/, loader: "cpp-portable-loader?emitMapFile" },
        ]
    },
    resolveLoader: {
        modules: ["node_modules"]
    },
};
```
2) Write your .cpp file, marking exported values with `__attribute__((visibility("default")))`, or importing export-helpers from node_modules and using the `EXPORT` macro.:
```cpp
/* example.cpp */
#include "../node_modules/cpp-portable-loader/export-helpers.h"
int return5() {
    return 5;
}
```
3) Import the .cpp file to trigger .d.ts file generation (make sure not to import anything from it, or else webpack will think you are using the import and .d.ts generation will not occur):
```js
import "./example.cpp";
```

4) Remove the earlier import and import from the .cpp file as if it a JS file:
```js
import { return5 } from "./test.cpp"
```

5) Either call functions and await the promise result, or get all of the functions in a promise, await that, and then call the functions synchronously:
```js
import { return5, GetSyncFunctions } from "./test.cpp"

async example() {
    assert(await return5() === 5);
    let fncs = await GetSyncFunctions();
    assert(fncs.return5() === 5);
}
```

## Requirements
- Window 64 bit, OSX 64 bit, or Linux 64 bit

## Features
- No installation required, all requirements (including the clang compiler) are in npm modules, which require no installation (they have no install scripts in their package.json).
- Automatic sourcemap generate and inlining
- Automatic .d.ts file generate for .cpp file, based on actual C++ types
    - Structs and classes are supported for types
- Some (very limited) buffer support, allowing non primitive types to be passed to and from C++ code
- Some (very limited) function support, allowing functions to be passed to and from C++ code

## Options
- emitMapFile
    - Emits a .wasm.map beside the .wasm output.
- noInlineSourceMap
    - Prevents inlining of source map with the .wasm file.

## Notes
- .d.ts files are emitted in the source directory, which may cause `webpack --watch` to infinitely loop. This can be solved by excluding .d.ts files from your typescript loader (`{ test: /(([^d])|([^.]d)|(^d))\.tsx?$/, loader: "ts-loader", }`), however this will result in compilation not being triggered if you only change .d.ts files. As a result if you save a .cpp file and a .ts file that uses the generated .d.ts file, you may need to force two compilations before the .d.ts changes are picked up.
- .wasm files are emitted in the output directory, even when running webpack-dev-server.

## Caveats
- Support for exceptions (via throw) is limited and does not work on Linux.
