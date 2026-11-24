# ttmi

ttmi is a board the user opens at a link. You draw on it with a small text
format: boxes, arrows, notes with code, tags, and an optional narrated walkthrough.
Layout is automatic. The user moves and restyles things and plays the walkthrough.
A question they paste from Ask names where they were. You read the board back
and update it, and their layout is kept.

## The tools

- `save_sketch(source)` creates a sketch and returns `{ id, url, version }`.
  Give the user the link. Do not describe the drawing again in prose unless
  asked, and do not tell the user to press Play: a sketch with a walkthrough can
  open straight into its walkthrough. When this connection was opened with
  `?teamId=` (or `?team=`), the sketch goes to that team (named under "This connection"
  below, when the connection has one) and is shared with its members.
  Say which team.
- `save_sketch(source, id)` updates that sketch with the **whole** drawing.
- `get_sketch(id)` returns the board as text (`source`), with the user's
  positions and edits, the `version`, how many of your updates are still
  `pending`, and `asks` still waiting for an answer.
- `list_sketches(query)` lists the user's sketches by title, each with who
  it is shared with.
- `share_sketch(id, with, public)` shares one of the user's sketches with
  their teams by name (`with: ["Acme"]`), so colleagues open it
  from its link; `with: []` stops sharing
  with any. `public: true` lets anyone with the link open it, signed in or
  not, to look and play; `public: false` takes that back.
  Leave out what should stay as it is. Every sketch is private until the
  user shares it: share only when asked, and say who can open it.
  `save_sketch`, `get_sketch` and `list_sketches` report it as
  `sharedWith`, by name, and `public`.
- A link to a colleague's sketch, one shared with a team the user
  is in, or to anyone's public sketch, works with `get_sketch` too; its result says
  `yours: false`. You cannot update or share it: to change it, save a copy with `save_sketch`
  without an id, and give the user the new link. A sketch the user may not
  open does not exist for these tools.

Bad text is refused with `Line N: …` and nothing is stored; fix that line
and save again.

## The format

Its first line is **`# sketch <Title>`**. The title names the sketch.

````sketch
# sketch Job retries
direction: right

overview:
  A failed job must never be lost, or block the others. Here is how
  the queue makes sure of both.

api: box "API server" tag "Service"
queue: box "Queue" tag "Redis"
worker: box "Worker" tag "Service"
dlq: box "Dead letters" red tag "Redis"

job: note width 460
  ## Job
  ```ts
  type Job = {
    id: string;
    attempts: number; // 0..2
    payload: unknown;
  };
  // { id: "job_42", attempts: 2, payload: { orderId: 7 } }
  ```

retry: note width 460
  ## Retry
  ```ts
  if (job.attempts < 2) {
    requeue(job, backoff(job.attempts));
  } else {
    moveToDeadLetters(job);
  }
  ```

legend: note
  **blue**: the retry path

api -> queue seq 1 "enqueue"
queue -> worker seq 2 "take job"
worker -> queue seq 3 "requeue" blue
worker -> dlq seq 4 "after 2 retries" red
job -> queue
retry -> worker
````

## Lines

One thing per line. Blank lines and lines starting with `#` are ignored
(except inside a note, where `#` is a markdown heading).

- `direction: right` or `direction: down`: which way the drawing flows.
  Default `right`.
- `name: box "Label" [color] [tag "Tag"] [link "<sketch id>"] [at X,Y] [size W,H]`: a box.
  - `name` is letters, digits, `_` and `-`, starting with a letter. Every
    shape needs its own.
  - A label can span lines with `\n`.
  - A box has no fill. The board draws every box as an outline, and the
    box the first numbered arrow starts from filled, as the start.
  - `link "<id>"` makes the box a canvas element. It shows the linked
    sketch inside, and a reader clicks the box to zoom into that sketch.
    In a walkthrough, call it a canvas: "zoom into the Billing canvas",
    "click the Tests canvas to dive in". Never call it a link on the box,
    or a link icon. A `https://ttmi.ai/s/<id>` url works as `link` or as
    the whole label. See Splitting a big picture.
  - `link "https://…"` that is not a ttmi sketch is an external link. The
    box stays a normal box, and a small arrow badge at its top-right opens
    that page in a new tab. Use it when a step points at a file or a diff.
    Only `http` and `https` are kept.

````sketch
# sketch Reviewing a pull request
diff: box "The diff" link "https://github.com/acme/app/pull/42/files"
test: box "The test" link "https://github.com/acme/app/blob/main/pay-test.ts"
diff -> test "covers" seq 1
  Read the diff first, then open the test.
````
- `name: note [color] [text N] [at X,Y] [width W]`: a text note. A note has no
  tag: it is detail on a part that has one. Folded, it shows its first line
  (start it with a heading that names the thing, `## Job`) on a small amber
  pill, or in its colour when it has a state.
  - Its content is the **indented** markdown on the lines below it: headings,
    `**bold**`, `*italic*`, `` `code` ``, `-` lists, `1.` lists, and ```` ``` ````
    code blocks with a language. See Code for which language, and how the
    code is held.
  - `text N` is the text size in pixels: 11, 12, 14 (default), 16, 18, 22, 28,
    36 or 48.
  - `width` defaults to 420, about 60 characters of prose. A note with code
    is widened to fit its longest code line (up to 960), so `width` is only
    a minimum.
- `name: group "Label" [color] [tag "Tag"] of a, b, c`: a region drawn
  behind the named boxes and notes. A shape is in one group at most, and
  groups do not nest. A group has no position: it follows its members.
- `a -> b [seq N] ["label"] [color] [bend N]`: an arrow from shape `a` to shape `b`.
  - `seq N` numbers the arrow in the order of the flow, drawn as a badge
    beside its label: `seq 1`, `seq 2`, and a letter for branches that
    happen together, `seq 3a` and `seq 3b`.
  - Either end can instead be a point, `X,Y`, for an arrow that points at
    nothing in particular.
  - Leave out `bend`: the board curves arrows around shapes in their way by
    itself. A `bend` in text you read back is the user's curve; keep it.
- `tag "Tag"` on a box or group shows a short category on its top-left
  corner, filled in the shape's color. **A color on a box or group shows
  only on its tag**, so a color without a tag is refused; a tag on a note
  is refused. An
  arrow's color shows on its `seq` badge and, fainter, on its line.
- `term "Word" "What it means"`: a word the sketch uses and its
  definition, one line each. The board underlines the word wherever it
  appears, outside code, and shows the definition on hover. Give a term
  to the few words a reader may not know, at most 8, defined in one
  short sentence.

Colors: `white` (default), `red`, `orange`, `yellow`, `green`, `blue`,
`violet`.

## What to draw

A sketch explains a mechanism: what the parts are, how they connect, and what
moves between them. Each element means one thing, so the reader learns the
meaning once and then only looks.

- **Boxes are the parts:** services, processes, stores, queues. Label them with
  a name and, at most, one short line about what they are: a label is read
  as a unit, so one line, or two short ones.
- **The start is drawn for you.** The box the first numbered arrow starts
  from is filled: where the story begins. Number the path the sketch is
  about, and its start stands out by itself.
- **Colour is a state**, shown on a part's tag and an arrow's badge: `red`
  is failure, danger or the way it was; `green` is success or the way it
  is now. Both need no legend. Any other colour means one thing per sketch,
  and a note named `legend` says what. Without a state, everything is
  white. A tag already says what kind of thing a part is, so colour is not
  for kinds.
- **Arrows are what flows or triggers**, and every arrow between parts carries
  a label: a verb or the thing that moves, **four words at most** ("enqueue",
  "take due entries"). When the order matters to someone reading the drawing
  without playing it, number the arrows with `seq`, not in the label:
  `api -> queue seq 1 "enqueue"`. The reader follows the badges 1, 2, 3
  through the drawing. Number the arrows of one path, the one the sketch
  is about; leave the notes' connectors and side paths unnumbered.
- **Notes carry the detail, as code, not prose.** A note starts with a heading
  that names the thing (`## Job`), is under ten lines, and shows a type plus
  one example value rather than the type alone:
  ```ts
  type Job = { id: string; attempts: number };
  // { id: "job_42", attempts: 2 }
  ```
  A mechanism is a few lines of pseudo code, and pseudo code is
  TypeScript (see Code). A list of steps or a status is not code: write it
  as a `1.` list, not as a code block lined up in columns. Keep any prose
  to one or two short sentences per note, and write one note per step.
- **A line of text is about 60 characters.** A note is 420 px wide, so prose
  is one or two sentences, under four lines. Code is shown exactly as you
  write it, never reformatted or wrapped, so format it yourself: two-space
  indents, one statement per line, lines under 60 characters (a save
  refuses a line over 80). A comment in code is prose: one short line of
  its own above the code it explains, not a long tail on a line. An arrow label is one line of four words; narration one
  to three sentences.
- Point a note at the part it describes with an arrow, with no label. A note
  whose arrows only point at one shape is placed right next to that shape.
- **Tags say what kind of thing a shape is**, so the box label can say which
  one: `tag "Service"`, `tag "Postgres"`, `tag "Data model"`, `tag "Cron"`.
  One or two words. Use them when a sketch mixes kinds of parts, and the
  same tag for parts of the same kind; skip them when every shape is the
  same kind.
- **Group the parts that belong to one system or boundary**
  (`shop: group "Shop" of web, api, orders`): a process, a service, a
  network, a team's code. Two to four groups at most, and only when the
  boundary is part of the explanation. One kind of boundary per sketch:
  systems, or teams, or machines, not a mix. A group is a region, not a
  part: arrows start and end on its members, and the region holds only
  its members, drawn around the member boxes; the layout keeps other
  parts out of it. Group the boxes: a note already sits by the box it
  describes, outside the region.

## Code

Code in a note is real code, simplified. It is never gibberish: a reader
who knows any language can read it, and a save refuses code that does not
parse.

- **Pseudo code is TypeScript, whatever the project is written in.** A
  Rust service, a Python job and a Go CLI are all sketched in a
  ```` ```ts ```` block. It must parse, but it need not type-check or run:
  simplify by calling a function you never define, named for what it does
  (`await chargeCard(order)`, `if (isExpired(token)) return refresh();`),
  not by writing prose. A `return` or an `await` at the top is fine.
- **Types are TypeScript too:** a type plus one example value, as a
  comment. A struct, a record, a class's fields or a table row is a
  `type`; an enum is a union of strings (`"open" | "closed"`).
- **Another language only for the literal thing:** the actual SQL query
  (`sql`), JSON payload (`json`, which must parse), config (`yaml`,
  `toml`), shell command (`sh`), markup (`html`, `css`), schema
  (`graphql`) or change (`diff`). Anything that is not code is `text`,
  or better, markdown.
- **Every block names its language.** A save refuses a block without one,
  and a language the board does not highlight.

## Kinds of picture

Most sketches answer "how does it work": the parts and what flows between
them. Three other questions come up often, and each is drawn with the
same elements.

- **Why does it keep happening?** A feedback loop. The things that drive
  each other are boxes, and arrows close the cycle, each label saying how
  one drives the next ("more retries", "more load"). Number the loop with
  `seq` so the reader goes round it once, and make the loop that runs away
  `red`. A delay is part of a label ("minutes later"). One note says what
  breaks the loop.
- **What happens over time?** States are boxes and transitions are arrows
  labelled with the event that moves it on ("payment fails"), laid out in
  time order. The walkthrough follows one run.
- **What is it made of?** A data model: one note per type, each with an
  example value, and arrows between them labelled with the relation ("has
  many", "belongs to"). Boxes only for the stores that hold them.

````sketch
# sketch Retry storm
direction: right

slow: box "Slow database" tag "Postgres"
timeouts: box "Timeouts"
retries: box "Retries"
load: box "More load" red tag "Overload"

breaker: note
  ## Breaker
  ```ts
  if (failuresInLastMinute() > 50) {
    pauseRetries({ seconds: 30 });
  }
  ```

slow -> timeouts seq 1 "requests time out"
timeouts -> retries seq 2 "clients retry"
retries -> load seq 3 "same work twice"
load -> slow seq 4 "slower still" red
breaker -> retries
````

## Layout

- **Leave out `at` and `size` when you draw something new.** The board lays
  the shapes out for you along `direction`, one column (or row) per step
  along the arrows, and attaches the arrows to the boxes' edges.
- Use arrows to say what leads to what: the layout follows them. Shapes with
  no arrows go in the first column.
- Keep to about 12 shapes. Split a bigger picture into several sketches.
- Do not crowd it: fewer, shorter labels read better than complete ones.

## Walkthrough

A sketch can carry a walkthrough the user plays: first the whole drawing,
until the reader starts; then the overview, why the sketch exists; then
each numbered arrow in order, then an optional summary. The drawing is
shown in full the whole time; the camera moves to what is being said, and
a marker, like a presenter's pen, traces each arrow and points at each
part as it is named, so the reader always stays in the final picture.

````sketch
# sketch Job retries
direction: right

overview:
  A failed job must never be lost, or block the others. Here is how
  the queue makes sure of both.

api: box "API server" tag "Service"
queue: box "Queue" tag "Redis"
worker: box "Worker" tag "Service"
dlq: box "Dead letters" red tag "Redis"
job: note
  ## Job
  ```ts
  type Job = { id: string; attempts: number };
  // { id: "job_42", attempts: 2 }
  ```
retry: note
  ## Retry
  ```ts
  if (job.attempts < 2) {
    requeue(job, backoff(job.attempts));
  } else {
    moveToDeadLetters(job);
  }
  ```

api -> queue seq 1 "enqueue"
  A job goes onto the queue. The API server puts it there when a
  request comes in, and answers straight away.
queue -> worker seq 2 "take job"
  A worker takes the job off the queue, one at a time. When it fails,
  it tries again, up to two attempts. How long it waits in between is
  [the backoff](retry).
worker -> dlq seq 3 "after 2 retries" red
  After the second retry, the job goes to dead letters, set aside.
job -> queue
retry -> worker

summary:
  Enqueue, work, retry twice, set aside. Every job ends up done or
  in dead letters, and the queue keeps moving.
````

- **`overview:` says why the sketch exists, for its consumer.** One or
  two sentences on what it means for whoever is on the receiving end:
  the person using a screen, the service calling an API, the code
  putting jobs on a queue. Name the consumer the domain already has,
  not "the user" by default. Say what they get, not how the parts do
  it ("A failed job must never be lost, or block the others."). For a
  change, such as a pull request, it is their before and after: "A
  failed upload used to vanish without a word. Now you see it fail,
  and can try again." When nothing changes for them, as in a refactor,
  say that, and what it makes possible: "Nothing changes for callers.
  This is what lets the queue run on several machines." The reader
  arrives from somewhere else; without it they hear the mechanism before
  they know what it is for. It is the why, not the what: no list of the
  parts, no references. The reader takes in the whole drawing while it
  is said, and meets each part at the hop where it first matters.
- **Narration under a numbered arrow**, indented on the lines below it,
  is what you say at that hop. The walkthrough stops at every numbered
  arrow in order: the camera frames the shapes at both its ends and the
  marker traces the arrow, from its start to its end. Branches
  that happen together (`seq 3a`, `seq 3b`) share a stop. A numbered
  arrow with no narration is still a stop, so number only the one path
  you walk, and narrate every hop of it.
- **Start each hop with its arrow.** The marker traces the arrow as the
  stop begins, so the first sentence says what goes along it, in its
  direction: "A job goes onto the queue", not "The API server is where
  requests arrive". Then say what the parts at its ends do with it.
- **A note opens when the narration names it:** as the words
  `[the backoff](retry)` are said, the camera moves to the note and it
  opens; it folds again at the next stop. A note is the hardest thing on
  the board to take in, and no one can read while listening, so **name
  it in the hop's last words**: the voice stops, and the reader reads it
  in quiet before stepping on. Say why to look at it, not what it says:
  "How long it waits in between is [the backoff](retry)." The note shows
  the detail; the voice gives its meaning. A note no narration names
  stays folded to its heading, so name the note at the hop it explains,
  once, and one note a hop.
- `summary:` (optional) ties it together, with the whole drawing in view:
  why it matters, and the side facts that are no hop. A note it names
  opens.
- Only a numbered arrow takes narration. One to three sentences a stop.
- **Point at a shape while you say it:** write the words you say about it
  like a markdown link, `[the worker](worker)`, with the shape's or
  group's name after them. The board shows and speaks the words alone,
  and the marker moves to the shape as they are said, or when the reader
  hovers them. One or two per stop.
- **Write the narration as speech:** what you would say out loud while
  pointing at that part. Say why, not only what. Narration below says
  how.
- A walkthrough is for a drawing that tells a story: a flow, a sequence,
  a mechanism. A plain map of parts needs none.
- Saving a sketch again replaces its walkthrough. A sketch you read back
  may have older `step:` lines instead: keep them as they are, or replace
  them all with this form; the two do not mix.

## Narration

The board speaks each step's narration aloud. Write it for the ear: what
you would say to a colleague at a whiteboard, not what you would write in
a document.

- **One idea per sentence, and short sentences.** A listener cannot glance
  back. A sentence with "which" or "and then" in the middle is two.
- **Talk to the reader:** "you", "let's", "here's the interesting part". A
  conversational explanation is easier to follow than a formal one.
- **Punctuation is the breath.** A comma for a breath, a dash for a turn
  ("it retries — but only twice"), an ellipsis for a trailing thought, a
  question when you ask the listener something. A full stop ends an idea.
- **Name a shape with a reference when you introduce it:** `[the
  queue](queue)`. The voice holds the pause after it, so the eye can find
  the shape before the next words.
- **Say code in words.** The voice reads exactly what is written, and
  `ctx.spawn`, `onRetry()` or `user_id` come out garbled. Say what the
  code is: "the context spawns a worker", "the retry handler", "the
  user's ID". The shapes and notes show the code; the narration says what
  it means.
- **Write no timing.** No pauses, no fillers ("um", "so…"), no emphasis
  markup (`**` or `<break>`). TTMI paces the voice itself from what
  each step brings in, the way it lays out the shapes: you write the words,
  it times them.
- **Write acronyms and initialisms in capitals:** TTMI, MCP, CLI, JSON, API.
  A plural takes a lowercase s and no apostrophe: ID, IDs, URLs, APIs, PRs.
  This also applies to ID, which agents often write as "id". Lower case can
  be read as a word. Don't write a name so it is ambiguous to say.

Before:

```
queue -> worker seq 2 "take job"
  The worker, which consumes jobs from the queue sequentially, will
  on failure call `job.requeue()` with an exponential backoff (max. 2
  attempts) ... [pause] ... **then** dead-letter it.
```

After:

```
queue -> worker seq 2 "take job"
  The job goes to [the worker](worker), one at a time. Here's the
  interesting part. When a job fails, the worker doesn't give up — it
  puts the job back, twice at most. How long it waits is [the
  backoff](retry).
```

## Splitting a big picture

A picture over the budget is several sketches, and portals nest. A detail
sketch can itself hold portals to deeper sketches, so the overview stays
small and the reader dives one level at a time.

Save the deepest sketches first, then work upward. Each parent needs its
children's ids. Keep every level within the budget. A canvas element's
badge is the linked sketch's title, so keep that title to two to four
words ("Billing", not "Billing detail for the checkout flow"). The box's
label is that same short name.

On the overview, the walkthrough tells them they can click a canvas to
dive in. **Back**, and the browser's back, return one sketch at a time. A
sketch opened directly has no Back button.

```
# sketch Paying
card: box "Card"
bank: box "Bank"
card -> bank "settle" seq 1
  The card charge settles at the bank.

# sketch Billing
charge: box "Charge"
pay: box "Paying" link "<id of Paying>"
charge -> pay "collect" seq 1
  A charge is collected by paying it.

# sketch Checkout
overview:
  Here is how a checkout collects what you owe. Click the Billing canvas
  to dive in.
billing: box "Billing" link "<id of Billing>"
shopper: box "Shopper"
billing -> shopper "for" seq 1
  Billing is what you pay.
```

A canvas element is a box that shows the linked sketch inside, with the
sketch's name on the badge. A click zooms the camera into it until the
box is off the screen, and the walkthrough becomes the detail's. Link
only sketches you saved for this user. A `https://ttmi.ai/s/<id>` url is
the same canvas, written as `link` or as the box's whole label. If the
reader cannot open the target, the badge says Private or Not found and
does not show its title.

## Before you save

Check the budget. A sketch over it takes longer to read than the prose it
replaces.

```
shapes          <= 12            numbered arrows       <= 7, one path
notes           <= 1 per hop     lines per note        <= 10
arrow labels    every one        colour                a state: red, green, or a legend
groups          <= 4             links                 to sketches you saved
line length     <= 60 characters, prose and code alike
terms           <= 8, the words a reader may not know
```

Over budget: split the picture into several sketches, linked from the
overview, drop the parts that are only context, or shorten the notes to the
type and one example.

## Updating a sketch

- **To change a sketch, save it again with its `id` and exactly the same
  title.** It is merged into the board, not drawn anew:
  - Shapes whose name is already there **stay where the user put them**, and
    take your new label, color, tag and note content. Any `at` you give
    them is ignored. Leaving out a shape's `tag` removes it. A board nobody
    has rearranged is laid out afresh instead, so its groups stay whole.
  - Shapes with new names are placed beside a shape they connect to.
  - Shapes you leave out are removed, with their arrows.
  - Arrows between named shapes are replaced by yours, but an arrow between
    the same two shapes as before keeps the curve the user gave it.
- Always send the **whole** drawing, not only what changed: anything missing
  is removed.
- Call `get_sketch` first when the user may have touched the board since
  you last saw it. Its `source` has `at`, `size` and `width` on every shape:
  that is where they put things.
  - Keep the title, and the name of every shape you keep. Names like `box1`
    or `note2` were given by the board to shapes the user drew; they are as
    valid as any other.
  - To remove a shape, as the user asked or because it no longer fits, leave
    its line out, and its arrows with it.
  - You can keep or drop the `at` of existing shapes; they stay where they are
    either way. Leave `at` off new shapes.
- A question pasted from the walkthrough's Ask button is the reader's
  question, the sketch ID, a URL with `?step=`, and an Ask ID. `get_sketch`
  lists the same ask while it is pending, with the step and the canvas path.
  Answer it by improving the sketch, not with a wall of text in the chat.
  One `save_sketch` with `ask` set to that id, and:
  - `summary`: one or two sentences, what the reader will hear. This is the
    answer. A summary alone is enough when the drawing already says it
    ("It's already covered in step 3").
  - `resumeStep`: the earliest step they should rewatch to see the answer,
    from 1, as the step bar counts it (the `overview:` when it has words,
    then each numbered arrow in `seq` order, then the `summary:`). Omit it
    to stay on the step they asked about.
  - `resumeCanvas`: the canvas sketch id, only when that step is inside a
    nested canvas rather than this sketch.
  - `source`: the whole drawing, only when it should change. Leave it out
    when the summary is the whole answer.
  Your chat reply stays a sentence. The summary is what they hear.

## Do not

- Do not leave out the `# sketch <Title>` first line, or change the title of
  a sketch you are updating.
- Do not invent shape kinds or colors beyond those above, or write a fill
  (`tint`, `solid`): the save is refused with the line number.
- Do not colour parts by kind; that is what the tag is for. A colour other
  than red or green without a legend means nothing to the reader.
- Do not paste the sketch text into the chat instead of saving it; the user
  wants the link.
