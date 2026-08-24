# AGENTS.md

## Domain Language

This project maintains a domain thesaurus at `docs/THESAURUS.md`. It is grep-first:
one `## Index` line per concept — ``- **Term** `Identifier` kind:… avoid: `synonyms` ``.

- **Before naming anything** (class, method, variable, type, file, MCP tool, config key),
  search `rg -n -i '<word>' docs/THESAURUS.md` for each name you are considering.
  - Hit in an Index line → use that line's `Identifier`, even if your word was under `avoid:`.
  - Hit in a `` - `word` use: `` (Forbidden) or `` - `word` → `` (Legacy) line → do not use it;
    the line names the replacement.
  - Hit in `## Unresolved` → open question; ask before deciding.
  - No hit → new concept: add an Index line and a `### Term` entry **before** using it in code.
- Useful: `rg 'kind:query'` · ``rg 'avoid:.*`Word`'`` · `rg -F '**Term**'` · `rg '^### Term( \(|$)'`.
- Never introduce a synonym for an existing Index term.
