# Third-party notices

ChatTranslate's original source is licensed under GPL-3.0-or-later; see LICENSE.
This project integrates with Vencord's public plugin APIs. It is an independent
user plugin, not an official Discord or Vencord product. No Read Frog source is
included.

## fasttext.wasm.js 1.0.0

- Author: Yuns / yunsii and contributors.
- Source: https://github.com/yunsii/fasttext.wasm.js
- Wrapper and included fastText engine: MIT.
- The build copies the dependency's MIT notice into the distributable.
- The generated engine is bundled without modifying the model or engine source.
  The integration supplies local WASM bytes and manages native prediction vectors.

## fastText language-identification model

- Model: `lid.176.ftz`, distributed in `fasttext.wasm.js@1.0.0`.
- Attribution: fastText / Facebook AI Research contributors.
- Model documentation and original download: https://fasttext.cc/docs/en/language-identification.html
- License: CC BY-SA 3.0, independent of the JavaScript wrapper's MIT license.
- This project embeds the unchanged compressed model as base64 for local loading.
- The model license text is in `docs/model-license.txt` and is copied into builds.
- Source packaging through npm is recorded in `package-lock.json`; distributing
  the plugin must retain these notices and the separate model license.

Vencord is GPL-3.0-or-later. Verification uses a pinned upstream checkout and
does not include its checkout in this project's source distribution.
