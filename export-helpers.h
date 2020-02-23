#pragma once

typedef unsigned char uint8_t;
typedef unsigned long uint32_t;
typedef unsigned long long uint64_t;

typedef uint64_t size_t;



extern "C" {
    void SHIM__throwCurrentError();
}


unsigned char SHIM__lastErrorString[250];

void INTERNAL_setError(const char* message) {
    int length = 0;
    while(message[length] != '\0') {
        length++;
    }
    if(length > sizeof(SHIM__lastErrorString) - 1) {
        length = sizeof(SHIM__lastErrorString) - 1;
    }
    SHIM__lastErrorString[0] = length;
    for(int i = 0; i < length; i++) {
        SHIM__lastErrorString[i + 1] = message[i];
    }
    // TODO: How do we trigger a trap? Because... webassembly supports them, I'm just not sure how to trigger it from C++...
    SHIM__throwCurrentError();
}
extern "C" {
    void* __cxa_allocate_exception(unsigned int thrown_size) {
        if(thrown_size + 1 > sizeof(SHIM__lastErrorString)) {
			INTERNAL_setError("Exception is larger than max size for exceptions");
			return nullptr;
        }
        return SHIM__lastErrorString;
    }
    void __cxa_throw(void* thrown_object, void* type, void(*dest)(void*)) {
        // TODO: Type and dest are both nullptr, so... how can we know if thrown_object is not a string?
        //      Maybe I am wrong and they have values... but... I don't think so... my debugger is basically broken though.
        INTERNAL_setError(*((const char**)thrown_object));
    }
}

extern "C" {
    #ifndef memcpy
    // num is int, because of some issue with clang which causes bad WASM to be emitted
    //  if num is size_t (64 bits). Try it and see (with optimizations on). Or it might be
    //  fixed, in which case switch it back to size_t.
    void* memcpy(void* destination, const void* source, int num) {
        for(int i = 0; i < num; i++) {
            ((unsigned char*)destination)[i] = ((unsigned char*)source)[i];
        }
        return destination;
    }
    #endif

    #ifndef memset
    void* memset(void* ptr, int value, int num) {
        for(int i = 0; i < num; i++) {
            ((unsigned char*)ptr)[i] = (unsigned char)value;
        }
        return ptr;
    }
    #endif
}