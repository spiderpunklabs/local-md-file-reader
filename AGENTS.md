# Markdown Reader Agent Notes

This folder uses a local memory bank. At the start of every task, read all core
memory bank files before making changes.

## Memory Bank Read Order
1. `memory-bank/projectContext.md`
2. `memory-bank/activeState.md`
3. `memory-bank/systemPatterns.md`
4. `memory-bank/techContext.md`
5. `memory-bank/decisions.md`

## Update Rules
- Update the memory bank after any significant code or UX change.
- Update `activeState.md` at minimum whenever work is completed.
- Append durable architecture or workflow changes to `decisions.md` when they change.
- Keep `memory-bank/` aligned to the latest memory skill 5 file schema.

## Project Constraints
- Keep this app dependency-free unless there is a clear product reason to add a library.
- Prefer static files that can be opened directly in a browser without a build step.
- Treat local file handling and safe rendering as core concerns when changing the parser or preview.
