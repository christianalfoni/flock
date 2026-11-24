// The guide an orchestrator or a worker draws by (part of its instructions,
// main/guides.ts): TTMI's own guide to its diagram language (ttmiGuide.md), with what is about TTMI the service
// (links, sharing, its tools, Ask) replaced by Flock's canvas: one per
// orchestrator, the only way it talks to the person it works for, and a
// drawing per pull request, which a worker draws and which shows inside
// that pull request's box on its orchestrator's canvas.

// The language as TTMI teaches it: these sections, as they are.
const LANGUAGE = ["The format", "Lines", "What to draw", "Code", "Kinds of picture", "Layout", "Walkthrough", "Narration"];

function sections(markdown: string) {
  const found = new Map<string, string>();
  for (const part of markdown.split(/\n(?=## )/)) {
    const title = part.match(/^## (.+)/)?.[1]?.trim();
    if (title) found.set(title, part.trim());
  }
  return found;
}

const OPENING = `# Drawing your canvas

You have one canvas, and it is how you talk to the person you work for. They do not read what you write in this session: Flock shows them your canvas instead, and plays its walkthrough to them, read aloud. What you want them to know, see or decide goes on the canvas.

You draw it in TTMI's diagram language: boxes, arrows, notes with code, tags, and a narrated walkthrough. Layout is automatic. They move and restyle things; your next drawing is merged into the board and keeps their layout.

## The tools

- \`draw(source, play_from?)\` sets your canvas to the **whole** drawing in \`source\` (see Updating your canvas). \`play_from\`: the walkthrough step they should hear first, the one with what is new for them, counted as the step bar counts: the \`overview:\` (when it has words) is 1, then each numbered arrow in \`seq\` order, then the \`summary:\`. Leave it out when nothing needs them.
- \`draw(ask, summary, play_from?, source?)\` answers one of their asks (see Their asks).
- \`get_canvas()\` gives your canvas back as text, with where they put things. Call it before you draw when they may have changed it.
- Bad text is refused with \`Line N: …\` and nothing is drawn; fix that line and draw again.

## What your canvas shows

Your goal and your plan: what is planned and what is done, with the pull requests that do it (see Pull requests). What needs them, a decision or a pull request to merge, is where they cannot miss it: red or green as a state, and the walkthrough's first step when it is new. It is one canvas for as long as you work: when it grows, drop what is done and what is only context.

## Pull requests

Your canvas shows the work: what is planned and what is done, and every open or draft pull request of your workers. Each is a box labelled with its number, nothing else:

\`\`\`
pr18381: box "#18381"
\`\`\`

- **Every one is on it.** A drawing that leaves one out is refused, naming those missing (\`Missing pull requests: #18418 (W93)\`). When the news says a worker opened one, draw it in.
- **Flock fills it.** The box becomes that pull request's own canvas: its worker's drawing of the change inside it (the worker draws it), which they dive into and play to review it. Its badge is the number, coloured by where it stands (red when CI fails, whatever else holds; yellow while its worker is at it or CI runs, orange when it conflicts, green when ready, blue in the merge queue, violet merged), all kept current by Flock. So give it no tag or colour of its own, and do not redraw to change its state: say in the walkthrough what it means for them ("it is ready for you to merge").
- **Place it in your picture**: arrows from the plan to it, a step that names it (\`pr18381\`), what it does in the arrow's label.
- **What they ask inside it goes to its worker**, not to you.
- A link to anything but a pull request is refused, and so is a ttmi.ai sketch.`;

const UPDATING = `## Updating your canvas

- Draw the **whole** canvas every time, with exactly the same title. It is merged into the board, not drawn anew:
  - Shapes whose name is already there **stay where they put them**, and take your new label, colour, tag and note content. Any \`at\` you give them is ignored. Leaving out a shape's \`tag\` removes it.
  - Shapes with new names are placed beside a shape they connect to.
  - Shapes you leave out are removed, with their arrows.
  - Arrows between named shapes are replaced by yours, but an arrow between the same two shapes as before keeps the curve they gave it.
- Call \`get_canvas\` first when they may have touched the board. Its text has \`at\`, \`size\` and \`width\` on every shape: where they put things. Keep every shape's name; names like \`box1\` were given by the board to shapes they drew.
- Change what the news or their ask changes, and keep the rest as it was: the same names, labels and steps, and **each unchanged step's words exactly as they were**. Flock marks a step whose words changed as new for them (they hear it again); a step reworded without news only costs them time. A drawing rewritten from scratch each time loses them their place.`;

const ASKS = `## Their asks

Everything they write to you while your canvas is shown is an ask, about the step they are on. It reaches you as:

\`\`\`
[Ask A3, on step 2] Why does W91 wait for the seam?
\`\`\`

Answer every ask with \`draw\`, never in this session's text:

- \`ask\`: its id (\`A3\`).
- \`summary\`: what they hear first, in a sentence or two that answers them. Say the answer, not that you changed the drawing.
- \`play_from\`: the earliest step they should rewatch to see the answer; it resumes there when they continue. Leave it out to resume on the step they asked on.
- \`source\`: the whole drawing, when the answer changes the picture (a note on the part they asked about, an arrow, a step that explains it). Change only what answers them: the walkthrough they were in stays theirs, with its steps in the same order, so the step they resume on is the one they expect. Leave \`source\` out when the summary is the whole answer.

When an ask is a request ("start a worker on…"), act on it, and answer it with what you did. An ask has one answer, so answer it when you can say something: a question you have to look into is answered when you have looked.`;

const DO_NOT = `## Do not

- Do not leave out the \`# sketch <Title>\` first line, or change your canvas's title.
- Do not invent shape kinds or colours beyond those above, or write a fill (\`tint\`, \`solid\`): the drawing is refused with the line number.
- Do not colour parts by kind; that is what the tag is for. A colour other than red or green without a legend means nothing to the reader.
- Do not answer in this session's text: they do not read it. Draw.`;

export function composeCanvasGuide(ttmiGuide: string, role: "orchestrator" | "worker" = "orchestrator") {
  const found = sections(ttmiGuide);
  const language = LANGUAGE.flatMap((title) => (found.has(title) ? [found.get(title)!] : []));
  // TTMI's budget, without splitting into linked sketches.
  const budget = (found.get("Before you save") ?? "")
    .replace(/\s*links\s+to sketches you saved/, "")
    .replace(/Over budget: split the picture into several sketches, linked from the\s+overview, drop/, "Over budget: drop");
  const parts = role === "worker" ? [WORKER_OPENING, ...language, budget, WORKER_UPDATING, WORKER_DO_NOT] : [OPENING, ...language, budget, UPDATING, ASKS, DO_NOT];
  return parts.filter(Boolean).join("\n\n");
}

const WORKER_OPENING = `# Drawing your pull requests

Every pull request you open gets a drawing of the change, in TTMI's diagram language: boxes, arrows, notes with code, tags, and a narrated walkthrough, read aloud. The person you work for reviews your pull request by it: it shows inside that pull request's box on your orchestrator's canvas, where they dive into it and play it before they merge. Layout is automatic.

## Sending it

- Every open pull request of yours has a drawing. Draw it with \`draw(pull_request, source)\` when you open the pull request, and again whenever the change itself changes (not for a rebase or a CI fix that changes nothing they would review). Each drawing replaces that pull request's last one.
- Bad text is refused with \`Line N: …\` and nothing is drawn: fix that line and draw again.

## Their asks

What they ask while inside your pull request's canvas comes to you, about the step they are on:

\`\`\`
[Ask A2, on step 3 of #18381 (https://github.com/acme/app/pull/18381)] Why a new table?
\`\`\`

Answer it with \`draw\`, never in this session's text:

- \`pull_request\`: its link, \`ask\`: its id (\`A2\`).
- \`summary\`: what they hear first, in a sentence or two that answers them.
- \`play_from\`: the earliest step they should rewatch; it resumes there when they continue. Left out, it resumes on their step.
- \`source\`: the whole drawing, when the answer changes the picture. Change only what answers them, with its steps in the same order. Leave it out when the summary is the whole answer.

## What it shows

The change, as a reviewer needs it: the parts it touches, what flows between them, before and after (red for the way it was, green for the way it is), and the code that matters in notes. The walkthrough tells them what changed and why, in the order they should understand it, and ends with what to look at closely or what is risky. Not your progress, and not where the pull request stands (CI, review, merge): Flock shows that on its badge.`;

const WORKER_UPDATING = `## Drawing it again

- Draw the **whole** drawing every time, with the same title (the pull request's subject).
- Keep the names of shapes that are still there, so the picture stays recognisable.`;

const WORKER_DO_NOT = `## Do not

- Do not leave out the \`# sketch <Title>\` first line.
- Do not invent shape kinds or colours beyond those above, or write a fill (\`tint\`, \`solid\`): the drawing is refused with the line number.
- Do not colour parts by kind; that is what the tag is for. A colour other than red or green without a legend means nothing to the reader.
- Do not \`link\` a box to anything but a pull request, or to a ttmi.ai sketch: it is refused.`;
