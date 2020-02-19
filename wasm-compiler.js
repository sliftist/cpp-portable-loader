//todonext;
// Well... first, work wasm-compiler.ts back to js (or just run it through the compiler).
//  But then... why aren't we parsing the wasm file for exports to get rid of the need for the proxy?
//  This would also allow promise returning functions to exist without the need for CompileWasmFunctions to be called first...
//  which allows direct import of the functions.
// Also... we can make the functions dual return T|Promise<T>, so you can still call CompileWasmFunctions, to have them always return T...
// ALTHOUGH! Before we change it, we will need a wasm file to test, so... we should get this working first...
// We should take our compilation from devserver to just webpack, so we can see if emitFile really does nothing? And if it does something...
//  we should use it (maybe with loader-utils) to properly get a file path for our .wasm temp outputs.

let { getWasmMemoryExports, getWasmFunctionExports } = require("./wasm-to-sourcemap");

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
module.exports.compile = function compile(webAssembly, compilationCacheKey, functionsForImports = Object.create(null)) {
    if (compilationCacheKey) {
        if (compilationCacheKey in g.wasmCompilerCompileCache) {
            return g.wasmCompilerCompileCache[compilationCacheKey];
        }
    }

    const MemoryBufferAddress = Symbol("MemoryBufferAddress");
    const WasmFncObj = Symbol("WasmFncObj");

    // An object where we put all the exports, once they are loaded
    let exportsObj = Object.create(null);

    // Some basic error handling, so at least string throws (such as   throw "x too big"; )  can work.
    function getLastError() {
        if("lastErrorStringForShim" in exportsObj) {
            if (exportsObj.lastErrorStringForShim[0]) {
                let length = exportsObj.lastErrorStringForShim[0];
                return new TextDecoder().decode(exportsObj.lastErrorStringForShim.slice(1, length + 1));
            }
        }
        return `A call from wasm to the javascript wrapping function "SHIM__throwCurrentError" was made, but the waasm file has no lastErrorStringForShim export (an array containing the error), so this is invalid.`;
    }
    function SHIM__throwCurrentError() {
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
            SHIM__throwCurrentError,
            ... functionsForImports
        },
    });
    /*
    let arrayObj = new Float64Array(baseExports.memory.buffer, offset, count);
    */

    let memoryExports = getWasmMemoryExports(webAssembly);
    for(let exportName in memoryExports) {
        let { size, address } = memoryExports[exportName];
        exportsObj[exportName] = Buffer.alloc(size);
        exportsObj[exportName][MemoryBufferAddress] = address;
    }

    let functionExports = undefined;
    try {
        functionExports = getWasmFunctionExports(webAssembly);
    } catch(e) {}
    if(functionExports) {
        for(let fncExport of functionExports) {
            if(fncExport.warning) continue;

            exportsObj[fncExport.name] = async function() {
                let loadedExports = await exportsPromise;
                return loadedExports[exportName](...arguments);
            };
            exportsObj[fncExport.name][WasmFncObj] = fncExport;
        }
    }


    let exportsLoaded = false;
    // Once the module loads, update exportsObj to have the actual correct functions, and typed arrays.
    let exportsPromise = moduleObjPromise.then((moduleObj) => {
        let baseExports = moduleObj.instance.exports;

        exportsObj["memory"] = Buffer.from(baseExports.memory.buffer);

        let memoryBufferLookup = Object.create(null);

        for(let exportName in memoryExports) {
            let { size, address } = memoryExports[exportName];
            let buffer = Buffer.from(baseExports.memory.buffer, address, size);
            buffer.set(exportsObj[exportName]);
            exportsObj[exportName] = buffer;
            exportsObj[exportName][MemoryBufferAddress] = address;
            memoryBufferLookup[address] = buffer;
        }

        if(!functionExports) {
            for(let name in baseExports)  {
                let fnc = baseExports[name];
                if(typeof fnc === "function") {
                    exportsObj[name] = fnc;
                }
            }
        } else {
            console.log(functionExports);

            let fncIdLookup = Object.create(null)
            for(let fncExport of functionExports) {
                if(fncExport.warning) continue;
                if("elemId" in fncExport) {
                    fncIdLookup[fncExport.elemId] = fncExport;
                }
            }

            for(let fncExport of functionExports) {
                if(fncExport.warning) continue;

                // TODO: If fncExport.javascriptTypeNames has any types which are pointers? Then wrap it, so that we check all of the arguments
                //  and convert any Buffers that our from this module to pass the correct memory offsets.
                let fnc = baseExports[fncExport.name];

                exportsObj[fncExport.name] = fnc;

                let needsShim = fncExport.javascriptTypeNames.some(x => x.type.pointer || x.type.subFunction) || fncExport.returnType.pointer || fncExport.returnType.subFunction;

                if(needsShim) {
                    exportsObj[fncExport.name] = function() {
                        let args = Array.from(arguments);
                        args = args.map(arg => {
                            if(arg && typeof arg === "object") {
                                if(MemoryBufferAddress in arg) {
                                    return arg[MemoryBufferAddress];
                                }
                            }

                            if(typeof arg === "function") {
                                if(WasmFncObj in arg) {
                                    let fncObj = arg[WasmFncObj];
                                    if("elemId" in fncObj) {
                                        return fncObj.elemId;
                                    }
                                }

                                console.warn(`Passed unknown javascript function to wasm function. You may only pass functions from a wasm module back to the same module.`, arg);
                            }

                            return arg;
                        });

                        let result = fnc(...args);

                        if(fncExport.returnType.pointer) {
                            if(result in memoryBufferLookup) {
                                return memoryBufferLookup[result];
                            } else {
                                console.warn(`Returned address from pointer function which does not correspond to an exported memory address. Just returneding the address by itself`, fncExport);
                            }
                        }
                        if(fncExport.returnType.subFunction) {
                            let elemId = result;
                            if(elemId in fncIdLookup) {
                                return exportsObj[fncIdLookup[elemId].name];
                            } else {
                                console.warn(`Returned element id (from a function that returns a function) that doesn't correspond to any element ids we know.`, fncExport, elemId, fncIdLookup);
                            }
                        }

                        return result;
                    };
                }
                exportsObj[fncExport.name][WasmFncObj] = fncExport;
            }
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

        return exportsPromise;
    };
    exportsObj[DuplicateModule] = function () {
        return compile(webAssembly);
    }

    if (compilationCacheKey) {
        if (!(compilationCacheKey in g.wasmCompilerCompileCache)) {
            g.wasmCompilerCompileCache[compilationCacheKey] = exportsObj;
        }
    }
    return exportsObj;
}