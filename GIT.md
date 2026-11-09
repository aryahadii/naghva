# Git workflow

Git history is where the owner's intent is kept. The diff shows what changed;
the commit message says why the owner wanted it, so a later reader, person or
agent, can run `git log` and not undo a decision or ask the same question
again.

## Commit messages

```
<Subject: imperative, under about 70 characters, says what changes>

Intent: <One short paragraph in plain words: what the owner asked for and
why, the decision they made, any alternative they rejected, and any
constraint that holds from now on. Use the owner's own words where they
matter. Only what the owner actually said or chose.>

<Optional: one paragraph on what the change does, when the diff doesn't
make it obvious.>

Defaults: <Optional: choices the author made that the owner didn't state,
so they can be overridden later.>
```

- Every commit has an `Intent:` paragraph of three to six lines. It is about
  the owner's goal, not a summary of the diff.
- Keep the owner's choices in `Intent:` and the author's own guesses in
  `Defaults:`.
- A commit with no new intent (a typo, a CI fix, a review nit) says so in one
  line and names what it serves: `Intent: none new; keeps the validator
  honest for #5.`
- A revert says why the owner wanted it reverted.
- Nothing in a commit links to a chat or agent session.

Examples:

```
Fetch the licensed Persian fonts from the private R2 bucket

Intent: naghva.com sets Persian in Farhang2 and IRANSansX, which are
licensed to the owner and must not be published with the code. The files
stay in the private bucket and only builds with a key fetch them; every
other build uses a free font, so anyone can still build the site.

Defaults: Vazirmatn as the free font.
```

```
Hear interviews in full, quote audio briefly and keep provenance

Intent: A long interview is heard in full, not read from its description
or automatic captions, and only passages two independent transcriptions
agree on are captured. Every passage says where in the source it is and
when it was read, and every web source gets an archive link.
```

## Branches and pull requests

- Work happens on a branch named for the change, such as `add-six-artists`
  or `git-guide-and-readme`, never a tool's or session's name.
- One change per pull request; for the record, one artist's entry by
  default (see [data/README.md](data/README.md#workflow)).
- Each commit should pass `python3 tools/validate.py`.
- The description says what changed, why, and where coverage stops. It
  links to no chat or agent session.
- Nothing is pushed to this repository without the owner's word for that
  push, and `main` is never force-pushed.

## Merging

The owner merges. A pull request lands with a merge commit, so each commit
and its intent stay in history. The merge commit's body states the intent of
the whole pull request in the format above, reconciled from its commits:
overlapping intents combined, abandoned ones left out. Where commits
conflict, the owner's explicit decisions settle it, not the later commit;
if it is still unclear, ask the owner before merging.
