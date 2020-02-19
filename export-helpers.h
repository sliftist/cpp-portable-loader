#pragma once

typedef unsigned char uint8_t;
typedef unsigned long uint32_t;
typedef unsigned long long uint64_t;

typedef uint64_t size_t;


#define ExportedArray(name, type, count) \
extern "C" { \
type name[count] = { 0 }; \
void* SHIM_array_##name () { return &name; } \
int SHIM_part_##name ## _count() { return count; } \
int SHIM_part_##name ## _sizeBytes() { return sizeof(type); } \
bool SHIM_part_##name ## _isSigned() { return IsSigned<type>().get(); } \
bool SHIM_part_##name ## _isFloat() { return IsFloat<type>().get(); } \
}



/*
#define ExportedType(name, type, count) \
type name[count] = { 0 }; \
void* SHIM_value_##name() { return &name; } \
int SHIM_part_##name_sizeBytes() { return sizeof(type); } \
bool SHIM_part_##name_isSigned() { return IsSigned<type>().get(); } \
bool SHIM_part_##name_isFloat() { return IsFloat<type>().get(); }
*/


class BoolTrue { public: static bool get() { return true; } };
class BoolFalse { public: static bool get() { return false; } };

template<typename T> class IsSigned : public BoolFalse { };
template<> class IsSigned<char> : public BoolTrue { };
template<> class IsSigned<short> : public BoolTrue { };
template<> class IsSigned<int> : public BoolTrue { };
template<> class IsSigned<long> : public BoolTrue { };
template<> class IsSigned<long long> : public BoolTrue { };
template<> class IsSigned<float> : public BoolTrue { };
template<> class IsSigned<double> : public BoolTrue { };

template<typename T> class IsFloat : public BoolFalse { };
template<> class IsFloat<float> : public BoolTrue { };
template<> class IsFloat<double> : public BoolTrue { };

extern "C" {
    void SHIM__throwCurrentError();
}

ExportedArray(lastErrorStringForShim, unsigned char, 1024);
void INTERNAL_setError(const char* message) {
    int length = 0;
    while(message[length] != '\0') {
        length++;
    }
    if(length > sizeof(lastErrorStringForShim) - 1) {
        length = sizeof(lastErrorStringForShim) - 1;
    }
    lastErrorStringForShim[0] = length;
    for(int i = 0; i < length; i++) {
        lastErrorStringForShim[i + 1] = message[i];
    }
    // TODO: How do we trigger a trap? Because... webassembly supports them, I'm just not sure how to trigger it from C++...
    SHIM__throwCurrentError();
}
extern "C" {
    void* __cxa_allocate_exception(unsigned int thrown_size) {
        if(thrown_size + 1 > sizeof(lastErrorStringForShim)) {
			INTERNAL_setError("Exception is larger than max size for exceptions");
			return nullptr;
        }
        return lastErrorStringForShim;
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