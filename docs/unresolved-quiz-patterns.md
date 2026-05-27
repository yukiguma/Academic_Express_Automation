# Unresolved Quiz Pattern Notes

## tests/authoring.xml

This fixture is a `book` payload whose questions are nested inside
`combinationQuestion type="listeningComprehension"` blocks.

Differences from the previously handled patterns:

- The visible `questionText` can be identical across multiple questions.
  The first six questions all use `Click your answer on the screen.`, so
  matching only by question text/signature selects the first matching item
  repeatedly.
- The actual listening prompt is outside `<question>` in sibling fields such
  as `<en_script>`, `<jp_script>`, `<sound>`, and `<image>`.
- Answers are numeric references (`<answer>2</answer>`) that must be mapped to
  `<choice no="2">...</choice>` before solving.
- The page displays a question order such as `6:` and `6 / 9`. That order is
  needed to disambiguate repeated question text.
- Choice counts vary. Some questions have four options (`a.` to `d.`), while
  others have three.
- `shuffleChoices` may be `true`, so answers should be clicked by mapped choice
  text rather than by position.
- Some questions include extra explanatory fields such as
  `<explain_jp_script>` that are not part of the visible question prompt.

Expected answers in the fixture order:

1. `b.`
2. `d.`
3. `d.`
4. `b.`
5. `a.`
6. `b.`
7. `Location`
8. `By special phone.`
9. `Sunny.`
