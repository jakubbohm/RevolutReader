# Design

- **The app's look lives in two Claude Design artifacts** in the owner's Claude account: the design system and the Screens design (links, what each holds and the prompts: [workflow.md § 8](../../docs/conventions/workflow.md#8-design)). For the look, the design wins; for behaviour, the specs win.
- **Claude Code only reads them,** by link with the Artifact tool, at their latest saved version, and never edits them. The design system's reference components are a model, never committed as they are.
- **Whenever the owner asks for a visual change** (a colour, a component, a screen) or starts a step that builds UI, walk them through the loop first, step by step, even unasked: the owner runs it only now and then and expects to forget it. Say which step comes next and where to paste, and give each prompt filled in, from § 8:
  1. The owner says what should change; Claude Code writes the prompt for the design system. A change to a screen alone goes to the Screens design instead, and steps 2 and 3 fall away.
  2. When the design system is done, the owner gives it § 8's "list what you changed" prompt.
  3. The owner pastes that list into § 8's update prompt and sends it to the Screens design.
  4. When the Screens design is done, the owner gives Claude Code the same list (for a screen alone, the artboards that changed). Claude Code reads the artifacts, compares them with the code, and applies the change the way § 8's table says (a direct PR or an OpenSpec change), or does nothing yet when the code has none of it.

Source of truth: [docs/conventions/workflow.md § 8](../../docs/conventions/workflow.md#8-design).
