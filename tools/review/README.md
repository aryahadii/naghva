# Verifiers

`claims.md` and `article.md` are the instructions for a verifier. Run
`tools/gate.py <ID>` first: it writes `.gate/<ID>/claims.json`. The verifier
writes `.gate/<ID>/claims.review.<name>.json` (or `article.review.<name>.json`)
beside it, and the gate reads that file on its next run.

Run a verifier from the repository root. The prompt is the same for every tool:

```
Follow the instructions in tools/review/claims.md for the artist with ID <ID>. Use '<name>' as your name in the output file name.
```

For the rubric, use `tools/review/article.md` in its place.

## Codex

```
codex exec -m <model> -s workspace-write -c model_reasoning_effort=medium "<prompt>"
```

`-s workspace-write` lets it write its file. Add `--skip-git-repo-check`
outside a Git checkout.

## Claude Code

```
claude -p "<prompt>" --model <model> --settings '{"advisorModel":""}' \
  --permission-mode acceptEdits --tools Read Write Edit Glob Grep
```

Pass `--settings '{"advisorModel":""}'` every time. It turns the advisor off
for that run, so no advisor model is consulted. Without it, an
`advisorModel` in the user's settings reaches the run, and the verdicts are
partly another model's. With `--output-format stream-json --verbose`, the
result line's `modelUsage` should list only the verifier's model.
