const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
let base64Mapping = {};
for (let i = 0; i < base64Alphabet.length; i++) {
    base64Mapping[base64Alphabet[i]] = i;
}
function parse6BitVLQs(base64Part) {
    let groups = Array.from(base64Part).map(x => base64Mapping[x]);
    let nums = [];
    let index = 0;
    while (index < groups.length) {
        nums.push(parseNumber());
    }
    return nums;
    function parseNumber() {
        let num = 0;
        let negative = false;
        let first = true;
        let magnitude = 1;
        while (true) {
            if (index >= groups.length) {
                throw new Error(`Invalid VLQ group`);
            }
            let group = groups[index++];
            let doContinue = !!(group & 0b100000);
            let value = group & 0b011111;
            if (first) {
                negative = !!(value & 0b1);
                value = value >> 1;
            }
            num += value * magnitude;
            if (first) {
                magnitude = magnitude << 4;
            }
            else {
                magnitude = magnitude << 5;
            }
            first = false;
            if (!doContinue) {
                break;
            }
        }
        if (negative) {
            num = -num;
        }
        return num;
    }
}

module.exports.encode6BitVLQ = encode6BitVLQ;
function encode6BitVLQ(number) {
    let output = "";
    let negative = number < 0;
    number = Math.abs(number);
    let magnitude = 4;
    while (true) {
        let curValue = number & ((1 << magnitude) - 1);
        number = number >> magnitude;
        if (output === "") {
            curValue = curValue << 1;
            if (negative) {
                curValue = curValue | 1;
            }
            magnitude = 5;
        }
        if (number > 0) {
            curValue = curValue | (1 << 5);
        }
        output += base64Alphabet[curValue];
        if (number === 0) {
            break;
        }
    }
    return output;
}

module.exports.parseMappingsPart = parseMappingsPart;
function parseMappingsPart(base64Part) {
    let values = parse6BitVLQs(base64Part);
    // https://sourcemaps.info/spec.html#h.qz3o9nc69um5
    let objPart = {
        newColumn: values[0],
        sourcesIndex: values.length > 1 ? values[1] : 0,
        originalLine: values.length > 2 ? values[2] : 0,
        originalColumn: values.length > 3 ? values[3] : 0,
        namesIndex: values.length > 4 ? values[4] : 0,
    };
    return objPart;
}

module.exports.encodeMappingsPart = encodeMappingsPart;
function encodeMappingsPart(mapping, first, usesNames) {
    let parts = [
        encode6BitVLQ(mapping.newColumn),
        encode6BitVLQ(mapping.sourcesIndex),
        encode6BitVLQ(mapping.originalLine),
        encode6BitVLQ(mapping.originalColumn),
    ];
    if (usesNames) {
        parts.push(encode6BitVLQ(mapping.namesIndex));
    }
    if (!first) {
        while (parts[parts.length] === "A") {
            parts.pop();
        }
    }
    return parts.join("");
}
