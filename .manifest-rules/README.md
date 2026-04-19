# Vendored Forge Manifest Rules

This directory contains a snapshot of the internal `forge-manifest-rules` validator.

It is copied here so that the template can be used inside sandboxes without needing access to internal registries.

## Usage

```bash
node .manifest-rules/dist/cli.js manifest.yml
```

Or via npm script:

```bash
npm run validate:manifest
```

## Do Not Edit Manually

All files under `dist/` will be overwritten when the sync script runs.
