# AGENTS.md

Naghva is an archive of independent Iranian music. `specs/` says what it is
and the rules it follows; read the spec that covers your task first.

- `specs/` is written by the owner. Don't edit it unless asked.
- Before writing, translating or reviewing an artist's article, read
  [Artist writing](specs/artist-writing.md).
- Nothing is merged or released without the owner's word.
- Write down less. Create a file only when it has a clear use for future
  readers; finishing a task is not a reason. What you write must stand
  alone, without the chat or task history.

## Git

The repository is public, and so is everything in its history.

- Commit messages follow the common Git convention: an imperative subject
  of about 50 characters ("Add Sara's releases"), then, if the subject
  isn't enough, a blank line and a short body on what changed and why,
  wrapped at 72 characters. Don't repeat the diff.
- Write about the project, not the people behind it. Never put anyone's
  personal reasons, feelings, quotes or private context in a commit or
  pull request, and never link a chat or agent session.
- Name branches for the change (`add-six-artists`), never a tool or session.
- One change per pull request; for the record, one artist's entry by
  default (see [data/README.md](data/README.md#workflow)). Each commit
  should pass `python3 tools/validate.py`. The description says what
  changed, why, and where coverage stops.
- Nothing is pushed without the owner's word for that push. The owner
  merges, and `main` is never force-pushed.
