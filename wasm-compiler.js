//todonext;
// Well... first, work wasm-compiler.ts back to js (or just run it through the compiler).
//  But then... why aren't we parsing the wasm file for exports to get rid of the need for the proxy?
//  This would also allow promise returning functions to exist without the need for CompileWasmFunctions to be called first...
//  which allows direct import of the functions.
// Also... we can make the functions dual return T|Promise<T>, so you can still call CompileWasmFunctions, to have them always return T...
// ALTHOUGH! Before we change it, we will need a wasm file to test, so... we should get this working first...
// We should take our compilation from devserver to just webpack, so we can see if emitFile really does nothing? And if it does something...
//  we should use it (maybe with loader-utils) to properly get a file path for our .wasm temp outputs.

let g = Function('return this')();

const DuplicateModule = module.exports.DuplicateModule = Symbol("NewModuleFnc");

module.exports.CompileWasmFunctionsName = "CompileWasmFunctions";

function leb128Parse(index, buffer) {
    let bytes = [];
    while (index < buffer.length) {
        let byte = buffer[index++];
        bytes.push(byte);
        if (!(byte & 0x80)) {
            break;
        }
    }
    let value = Number.parseInt(bytes.reverse().map(x => x.toString(2).padStart(8, "0").slice(1)).join(""), 2);
    return {
        value,
        bytes,
    };
}
function getSections(file) {
    let sections = [];
    // Insert a section for the magic number and version identifier
    sections.push({
        sectionId: -1,
        offset: 0,
        contents: file.slice(0, 8)
    });
    let i = 8;
    while (i < file.length) {
        let sectionId = file[i];
        i++;
        let { value, bytes } = leb128Parse(i, file);
        let num = value;
        i += bytes.length;
        let baseOffsetStart = i;
        let contents = file.slice(i, i + num);
        sections.push({
            sectionId,
            offset: baseOffsetStart,
            contents
        });
        i += num;
    }
    return sections;
}

/** Maps function index (in wasm file) to function name.
 * @return {{ [fncIndex: number]: string }} */
function getExportNames(sections) {
    sections = sections.filter(x => x.sectionId === 7);   
    let exportedFunctions = Object.create(null);
    for(let exportSection of sections) {
        let curIndex = 0;
        let curBuffer = exportSection.contents;
        function parseLeb128(signed = false) {
            let obj = leb128Parse(curIndex, curBuffer);
            curIndex += obj.bytes.length;
            if(signed) {
                let negativePoint = 1 << (7 * obj.bytes.length - 1);
                if(obj.value >= negativePoint) {
                    obj.value = obj.value - 2 * negativePoint;
                }
            }
            return obj.value;
        }

        let functionCount = parseLeb128();
        while (curIndex < curBuffer.length) {
            let nameLength = parseLeb128();
            let nameBytes = curBuffer.slice(curIndex, curIndex + nameLength);
            curIndex += nameLength;
            let name = Array.from(nameBytes).map(x => String.fromCharCode(x)).join("");
            let exportType = parseLeb128();
            let exportValue = parseLeb128();
            if (exportType === 0) {
                exportedFunctions[exportValue] = name;
            }
        }
    }
    return exportedFunctions;
}


g.wasmCompilerCompileCache = g.wasmCompilerCompileCache || Object.create(null);
module.exports.compile = function compile(webAssembly, compilationCacheKey) {
    if (compilationCacheKey) {
        if (compilationCacheKey in g.wasmCompilerCompileCache) {
            return g.wasmCompilerCompileCache[compilationCacheKey];
        }
    }

    // An object where we put all the exports, once they are loaded
    let exportsObj = Object.create(null);

    // Some basic error handling, so at least   throw "x too big";   can work.
    function getLastError() {
        if("lastErrorStringForShim" in exportsObj) {
            if (exportsObj.lastErrorStringForShim[0]) {
                let length = exportsObj.lastErrorStringForShim[0];
                return new TextDecoder().decode(exportsObj.lastErrorStringForShim.slice(1, length + 1));
            }
        }
        return `A call from wasm to the javascript wrapping function "throwCurrentError" was made, but the waasm file has no lastErrorStringForShim export (an array containing the error), so this is invalid.`;
    }
    function throwCurrentError() {
        let error = new Error(getLastError());
        // Remove our junk from the stack
        if (error.stack) {
            let stack = error.stack.split("\n");
            stack.splice(1, 3);
            error.stack = stack.join("\n");
        }
        if (!g["TEST_THROWS"]) {
            console.error(error);
            debugger;
        }
        throw error;
    }

    let moduleObjPromise = WebAssembly.instantiate(webAssembly, {
        env: {
            throwCurrentError
        },
    });
    let dataExports = Object.create(null);

    let exportsLoaded = false;
    // Once the module loads, update exportsObj to have the actual correct functions, and typed arrays.
    let exportsPromise = moduleObjPromise.then((moduleObj) => {
        let baseExports = moduleObj.instance.exports;
        // Clear out the previous shimmed keys
        for(let key of Object.keys(exportsObj)) {
            // But not CompileWasmFunctions, unless they've defined an CompileWasmFunctions function.
            if(key === "CompileWasmFunctions" && !baseExports["CompileWasmFunctions"]) continue;
            delete exportsObj[key];
        }
        // Map specially named exports to javascript memory constructs (typed arrays).
        for (let key in baseExports) {
            if (key.startsWith("SHIM_part_")) {
                continue;
            }
            if (key.startsWith("SHIM_array_")) {
                let name = key.split("_").slice(2).join("_");
                let offset = baseExports[`SHIM_array_${name}`]();
                let count = baseExports[`SHIM_part_${name}_count`]();
                let size = baseExports[`SHIM_part_${name}_sizeBytes`]();
                let isSigned = baseExports[`SHIM_part_${name}_isSigned`]();
                let isFloat = baseExports[`SHIM_part_${name}_isFloat`]();
                let v = (isFloat ? "f" : "i") + (isSigned ? "s" : "u") + size;
                let Ctor;
                if (v === "iu1")
                    Ctor = Uint8Array;
                else if (v === "is1")
                    Ctor = Int8Array;
                else if (v === "iu2")
                    Ctor = Uint16Array;
                else if (v === "is2")
                    Ctor = Int16Array;
                else if (v === "iu4")
                    Ctor = Uint32Array;
                else if (v === "is4")
                    Ctor = Int32Array;
                else if (v === "fs4")
                    Ctor = Float32Array;
                else if (v === "fs8")
                    Ctor = Float64Array;
                else
                    throw new Error(`No handling for exported type called ${name}. It is a ${size} byte ${(isSigned ? "signed" : "unsigned")}${isFloat ? "floating point" : ""} number`);
                let arrayObj = new Ctor(baseExports.memory.buffer, offset, count);
                dataExports[name] = true;
                exportsObj[name] = arrayObj;
            }
        }

        for (let key in baseExports) {
            if (key.startsWith("SHIM_part_"))
                continue;
            if (key.startsWith("SHIM_array_"))
                continue;
            // Global values have their locations exported, but we can ignore those if we have a SHIM for them.
            if (key in exportsObj)
                continue;
            let baseFnc = baseExports[key];
            if (typeof baseFnc !== "function")
                continue;
            exportsObj[key] = baseFnc;
        }

        exportsLoaded = true;
        return exportsObj;
    }, e => {
        console.error(e);
    });

    exportsObj.CompileWasmFunctions = function CompileWasmFunctions() {
        if(exportsLoaded) {
            return exportsObj;
        }

        return moduleObjPromise;
    };
    exportsObj[DuplicateModule] = function () {
        return compile(webAssembly);
    }

    let exportNames = getExportNames(getSections(webAssembly));
    for(let exportName of Object.values(exportNames)) {
        exportsObj[exportName] = async function() {
            let loadedExports = await exportsPromise;
            return loadedExports[exportName](...arguments);
        };
    }

    if (compilationCacheKey) {
        if (!(compilationCacheKey in g.wasmCompilerCompileCache)) {
            g.wasmCompilerCompileCache[compilationCacheKey] = exportsObj;
        }
    }
    return exportsObj;
}