# AGENTS.md

## Project

Lambda calculus visualizer web app: parse lambda expressions into ASTs, perform beta reduction step by step, and render the AST as a colored 2D binary treemap on `<canvas>`, with the substituted expression animating (interpolating) into variable positions during reduction. The implementation plan lives in `TODO.md`.

## Conventions

- No external libraries or frameworks — plain HTML, vanilla JS (ES modules), CSS only.
- Follow the checklist in `TODO.md`; mark items off as they are completed.
- Git: one commit per change / feature addition (small, logical commits). The workspace has no git repo yet — run `git init` before the first commit.
