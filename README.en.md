# HelmDesk

**Turn delegated AI tasks into deliveries you can inspect, verify, and accept.**

HelmDesk is a local CLI agent workbench for macOS. Codex defines a scoped task, Qoder executes in a separate workspace, and the host independently checks the delivered files before recording acceptance. The workbench keeps task history, diffs, verification, acceptance, and reported usage together.

**[Download for Mac](https://github.com/Mu-Miao/HelmDesk/releases/tag/v0.1.0-macos-preview.7) · [Run your first task](docs/quickstart.md) · [Get the free official Skill](https://www.agensi.io/skills/helmdesk-workflow-delegate-verify-review)**

[中文说明](README.md)

## Start here

1. Download the Apple Silicon DMG from Releases and move HelmDesk.app to Applications. The app bundles Node and its server; a source installation needs Node.js 24+ and Git.
2. Install and sign in to Qoder CN using its official app or compatible CLI. Authorize a specific project directory in HelmDesk. Keep your saved model, or explicitly choose one your account supports.
3. Export the local MCP configuration from HelmDesk and add it to your host without overwriting existing settings. Confirm the connection with `queue_get`.
4. Load the official `helmdesk-workflow` Skill through Agensi, or use the complete [skill folder](skills/helmdesk-workflow). Follow its [setup instructions](skills/helmdesk-workflow/references/setup-and-validation.md).
5. Use a clean, committed demo repository for your first task. Ask the host to allow only `HELLO.md`, inspect the complete delivery, check the original project baseline, record verification, and then record acceptance. Do not integrate yet.

The current instructions and examples are in Chinese. Codex as host with Qoder as executor has been tested locally; other host integrations have not been independently validated.

## The workflow

| Stage | Responsibility |
| --- | --- |
| Define | The host chooses the project, allowed files, and objective acceptance criteria. |
| Delegate | HelmDesk creates a separate workspace and runs Qoder with scoped file tools. |
| Inspect | The host reads the full output and checks the diff, file scope, and original baseline. |
| Verify | The host runs appropriate checks and records evidence for the current delivery version. |
| Accept | Acceptance is recorded separately, after verification. |
| Integrate | Applying reviewed changes is a separate, explicitly authorized operation. |

`completed` means execution ended. It does not mean the delivery passed verification or was accepted. Qoder's file-task tools are Read, Write, Edit, Glob, and Grep; shell checks and integration belong to the host. Failed tasks are not automatically retried, and models or credentials are not silently switched.

## Current scope

- Apple Silicon macOS preview. The deployment target is macOS 14+; validation has been performed on the author's macOS 27 machine. Other Macs, Intel builds, and sleep/wake behavior are not independently validated.
- The preview has ad-hoc local signing, **no Developer ID signing or Apple notarization**. Review the [installation notes](docs/macos-install.md) before installing.
- The Skill is free. Model requests use your own provider account and may incur charges. Missing or zero reported usage does not prove a request was free.
- Local execution is not the same as offline inference: the selected provider may receive model requests. Review the project and allowed files before delegation.
- The code is publicly available. The project's original code does not currently have a unified open-source license; third-party terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Documentation

- [First complete workflow](docs/helmdesk-delegate-verify-review.md)
- [Quick start and MCP setup](docs/quickstart.md)
- [Official Skill instructions](skills/helmdesk-workflow/SKILL.md)
- [Installation and troubleshooting](docs/macos-install.md)
- [Report a problem](https://github.com/Mu-Miao/HelmDesk/issues)

When reporting a problem, include the app version, macOS version, host and executor, the stage that failed, and a short redacted error. Do not post connection tokens, login data, private source files, or raw task databases.
