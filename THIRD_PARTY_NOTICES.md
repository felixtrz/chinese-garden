# Third-party notices

The garden's code is MIT-licensed (see [LICENSE](LICENSE)). It also ships or loads
the following third-party material under its own licence.

## Ma Shan Zheng (calligraphy font)

`public/fonts/garden-kai.woff2` is a subset of **Ma Shan Zheng** by Ma ShanZheng,
renamed "Garden Kai" for use in this project. It is used for the plaques, the
inscription on the moon gate and the HUD calligraphy.

Ma Shan Zheng is licensed under the
[SIL Open Font License, Version 1.1](https://openfontlicense.org/open-font-license-official-text/).
The font, including this subset, may be used, studied, modified and redistributed
freely, provided it is not sold by itself. Source: <https://fonts.google.com/specimen/Ma+Shan+Zheng>.

## Cormorant Garamond (UI font)

The HUD's Latin typeface, **Cormorant Garamond** by Christian Thalmann (Catharsis
Fonts), is loaded at runtime from Google Fonts and is not redistributed in this
repository. It is licensed under the SIL Open Font License, Version 1.1.

## Immersive Web SDK project scaffold

`vite.config.ts`, the `AGENTS.md`/`CLAUDE.md` files and the agent skills and rules
under `.agents/`, `.claude/`, `.cursor/` and `.github/instructions/` come from the
[Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) project template,
© Meta Platforms, Inc. and affiliates, MIT License.

## npm dependencies

Runtime and tooling dependencies, including `@iwsdk/*` and `three` (via
`super-three`), are installed from npm and carry their own licences. See
`package.json` and each package's `LICENSE` file under `node_modules/`.
