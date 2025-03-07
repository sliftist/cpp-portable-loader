let { getWasmMemoryExports, getWasmFunctionExports, getWasmImports, getTypedArrayCtorFromMemoryObj } = require("./wasm-to-sourcemap");

let g = Function('return this')();

module.exports.CompileWasmFunctions = "GetSyncFunctions";

function isEmpty(obj) {
    for(var key in obj) return false;
    return true;
}

g.wasmCompilerCompileCache = g.wasmCompilerCompileCache || Object.create(null);
module.exports.compile = function compile(webAssembly, compilationCacheKey, functionsForImports = Object.create(null)) {
    if (compilationCacheKey) {
        if (compilationCacheKey in g.wasmCompilerCompileCache) {
            return g.wasmCompilerCompileCache[compilationCacheKey];
        }
    }

    let initializeWarningTimeout = 10 * 1000;

    const MemoryBufferAddress = Symbol("MemoryBufferAddress");
    const WasmFncObj = Symbol("WasmFncObj");

    // An object where we put all the exports, once they are loaded
    let exportsObj = Object.create(null);

    // Some basic error handling, so at least string throws (such as   throw "x too big"; )  can work.
    function getLastError() {
        if("SHIM__lastErrorString" in exportsObj) {
            if (exportsObj.SHIM__lastErrorString[0]) {
                let length = exportsObj.SHIM__lastErrorString[0];
                return new TextDecoder().decode(exportsObj.SHIM__lastErrorString.slice(1, length + 1));
            }
        }
        return `A call from wasm to the javascript wrapping function "SHIM__lastErrorString" was made, but the wasm file has no SHIM__lastErrorString export (an array containing the error), so this is invalid.`;
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

    
    /*
    let arrayObj = new Float64Array(baseExports.memory.buffer, offset, count);
    */

    let importList = getWasmImports(webAssembly);

    let dynamicFunctionsForImport;
    let dynamicFunctionsForImportResolve;
    let dynamicFunctionsResolved = false;

    if(importList.length === 0) {
        dynamicFunctionsForImport = Promise.resolve(Object.create(null));
        dynamicFunctionsForImportResolve = function () {};
        dynamicFunctionsResolved = true;
    } else {
        dynamicFunctionsForImport = new Promise(resolve => {
            dynamicFunctionsForImportResolve = function(functions) {
                if(dynamicFunctionsResolved) {
                    return;
                }
                dynamicFunctionsResolved = true;
                resolve(functions);
            }
        });
    }

    let memoryBufferLookup = Object.create(null);

    let memoryExports = getWasmMemoryExports(webAssembly);
    for(let exportName in memoryExports) {
        let memoryObj = memoryExports[exportName];
        let { size, address } = memoryObj;

        // Warning is given after compilation finishes
        if(size < 0) continue;
        
        exportsObj[exportName] = new Uint8Array(size);

        let TypedArrayCtor = getTypedArrayCtorFromMemoryObj(memoryObj);
        if(TypedArrayCtor) {
            exportsObj[exportName] = new TypedArrayCtor(exportsObj[exportName].buffer, exportsObj[exportName].byteOffset, Math.round(size / memoryObj.byteWidth));
        }

        exportsObj[exportName][MemoryBufferAddress] = address;
        memoryBufferLookup[address] = exportsObj[exportName];
    }

    let functionExports = getWasmFunctionExports(webAssembly);
    for(let fncExport of functionExports) {
        if(fncExport.warning) continue;

        exportsObj[fncExport.demangledName] = async function() {
            if(!dynamicFunctionsResolved) {
                setTimeout(() => {
                    if(!dynamicFunctionsResolved) {
                        console.warn(`Failed to call GetSyncFunctions within a timeout of calling function ${fncExport.name}. The function call won't resolve until GetSyncFunctions is called.`);
                    }
                }, initializeWarningTimeout);
            }
            let loadedExports = await exportsPromise;
            return loadedExports[fncExport](...arguments);
        };
        exportsObj[fncExport.demangledName][WasmFncObj] = fncExport;
    }

    let elemIdLookup = Object.create(null);
    for(let fncExport of functionExports) {
        if(fncExport.warning) continue;
        if("elemId" in fncExport) {
            elemIdLookup[fncExport.elemId] = fncExport;
        }
    }


    let moduleObjPromise = dynamicFunctionsForImport.then(dynamicFunctions => {
        return WebAssembly.instantiate(webAssembly, {
            env: {
                SHIM__throwCurrentError,
                ... functionsForImports,
                ... dynamicFunctions
            },
        });
    });


    let exportsLoaded = false;

    // Once the module loads, update exportsObj to have the actual correct functions, and typed arrays.
    let exportsPromise = moduleObjPromise.then((moduleObj) => {
        let baseExports = moduleObj.instance.exports;

        //exportsObj["memory"] = Buffer.from(baseExports.memory.buffer);

        for(let exportName in memoryExports) {
            let memoryObj = memoryExports[exportName];
            let { size, address } = memoryObj;

            if(size < 0) {
                console.warn(`Invalid size, ${size}, for ${exportName}, ignoring export.`);
                continue;
            }

            let buffer = new Uint8Array(baseExports.memory.buffer, address, size);
            let source = exportsObj[exportName];
            buffer.set(new Uint8Array(source.buffer, source.byteOffset));

            exportsObj[exportName] = buffer;

            let TypedArrayCtor = getTypedArrayCtorFromMemoryObj(memoryObj);
            if(TypedArrayCtor) {
                exportsObj[exportName] = new TypedArrayCtor(exportsObj[exportName].buffer, exportsObj[exportName].byteOffset, Math.round(size / memoryObj.byteWidth));
            }

            exportsObj[exportName][MemoryBufferAddress] = address;
            memoryBufferLookup[address] = exportsObj[exportName];
        }

        

        if(isEmpty(functionExports)) {
            for(let name in baseExports)  {
                let fnc = baseExports[name];
                if(typeof fnc === "function") {
                    exportsObj[name] = fnc;
                }
            }
        } else {
            for(let fncExport of functionExports) {
                if(fncExport.warning) continue;

                // TODO: If fncExport.javascriptTypeNames has any types which are pointers? Then wrap it, so that we check all of the arguments
                //  and convert any Buffers that our from this module to pass the correct memory offsets.
                let fnc = baseExports[fncExport.name];

                exportsObj[fncExport.demangledName] = fnc;

                let needsShim = fncExport.javascriptTypeNames.some(x => x.type.pointer || x.type.subFunction) || fncExport.returnType.pointer || fncExport.returnType.subFunction;

                if(needsShim) {
                    exportsObj[fncExport.demangledName] = function() {
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
                            if(elemId in elemIdLookup) {
                                return exportsObj[elemIdLookup[elemId].demangledName];
                            } else {
                                console.warn(`Returned element id (from a function that returns a function) that doesn't correspond to any element ids we know.`, fncExport, elemId, elemIdLookup);
                            }
                        }

                        return result;
                    };
                }
                exportsObj[fncExport.demangledName][WasmFncObj] = fncExport;
            }
        }

        exportsLoaded = true;
        return exportsObj;
    }, e => {
        console.error(e);
    });

    exportsObj.GetSyncFunctions = function GetSyncFunctions(functions) {
        if(exportsLoaded) {
            return exportsObj;
        }

        dynamicFunctionsForImportResolve(functions);

        return exportsPromise;
    };
    exportsObj.CompileNewWasm = function (functions) {
        return compile(webAssembly).GetSyncFunctions(functions);
    };

    exportsObj.UtilGetBufferFromAddress = function(address) {
        return memoryBufferLookup[address];
    };
    exportsObj.UtilGetAddressFromBuffer = function(buffer) {
        return buffer[MemoryBufferAddress];
    };
    exportsObj.UtilGetFncFromArg = function(arg) {
        return elemIdLookup[arg];
    };
    exportsObj.UtilGetArgFromFnc = function(wasmFnc) {
        let fncObj = wasmFnc[WasmFncObj];
        if(!fncObj) return undefined;
        return exportsObj[fncObj.name];
    };

    if (compilationCacheKey) {
        if (!(compilationCacheKey in g.wasmCompilerCompileCache)) {
            g.wasmCompilerCompileCache[compilationCacheKey] = exportsObj;
        }
    }
    return exportsObj;
}