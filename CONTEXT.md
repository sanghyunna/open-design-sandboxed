# Readable Studio

Readable Studio is a document workspace for turning source text into polished standalone HTML. This glossary records canonical product language, not implementation details.

## Product doctrine

**Primary audience**:
Office workers who create briefs, reports, presentations, plans, and other business documents, including teams adopting AI as part of enterprise AI transformation.
_Avoid_: designers only, developer tool, model showcase

**Source Text**:
The user's existing business material: notes, outlines, reports, research, requirements, or other text that grounds a document.
_Avoid_: empty prompt, invented source, design prompt only

**AI Generation**:
The first-draft stage that transforms Source Text into a structured, visually considered document. Generation accelerates the work; it does not remove the user's editorial control.
_Avoid_: one-click final answer, chatbot response, autonomous publishing

**Direct Editing**:
PowerPoint-like editing of generated content in the preview: select elements, revise text, and adjust presentation details directly instead of returning to a prompt for every change.
_Avoid_: prompt-only iteration, regenerate from scratch, code-only editing

**Standalone HTML**:
The canonical finished document: a polished, self-contained HTML file that can be opened independently and retains its intended presentation.
_Avoid_: hosted page, share URL, website, unsupported format promise

**Readable Studio Workflow**:
Source Text -> AI Generation -> Direct Editing -> Standalone HTML.
_Avoid_: prompt -> opaque output, generation -> automatic publishing

## Workspace language

**Project**:
A top-level document workspace that contains conversations and document files.
_Avoid_: repo, session

**Normal Artifact**:
A project document output represented by an artifact entry file and its artifact manifest.
_Avoid_: live artifact, generic file upload

**Live Artifact**:
A refreshable project output stored with source data and preview state.
_Avoid_: normal artifact, static artifact

**Artifact Entry File**:
The primary project file that opens or renders a Normal Artifact.
_Avoid_: support file, asset, sidecar

**Artifact Manifest**:
Metadata that identifies a project file as a Normal Artifact and records its kind, renderer, exports, and entry file.
_Avoid_: live-artifact document, project metadata

**Active Project**:
The project the user most recently interacted with and that tools may use when no project is specified.
_Avoid_: latest project, default project

**Home Composer Media Surface**:
A Home-only composer intent that exposes media-specific defaults before project creation while mapping onto an existing project kind.
_Avoid_: project kind, backend kind

**Chip Rail**:
The row of intent chips below the Home prompt card. A chip chooses the composer surface, default scenario, option state, and project kind before the user presses Run.
_Avoid_: plugin list, template list

**Onboarding Skip**:
The explicit path that lets a user leave onboarding without completing the currently selected setup option.
_Avoid_: continue, finish setup, passive close

## Relationships

- A **Project** contains zero or more **Normal Artifacts**.
- A **Normal Artifact** has exactly one **Artifact Entry File** and one **Artifact Manifest**.
- A **Live Artifact** belongs to a **Project** but is distinct from a **Normal Artifact**.
- An **Active Project** can be the target when a caller omits an explicit **Project**.
- A **Home Composer Media Surface** maps user intent to existing project metadata.
- The **Chip Rail** is the visible Home entry point for choosing that surface.
- **Onboarding Skip** bypasses setup requirements on the normal continue path.

## Example dialogue

> **Office worker:** "I have the source text for our quarterly review. Do I need to keep prompting for every layout change?"
> **Domain expert:** "No. Use **AI Generation** for the first draft, refine it with **Direct Editing**, then export the polished **Standalone HTML** document."
