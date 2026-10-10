// SPDX-License-Identifier: GPL-3.0-or-later
declare module "fasttext.wasm.js/dist/core/fastText.node.js" {
    const initialize: (options: {
        wasmBinary: Uint8Array;
        print: () => void;
        printErr: () => void;
    }) => Promise<any>;
    export default initialize;
}
