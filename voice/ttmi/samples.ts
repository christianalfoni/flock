// Sketches with walkthroughs, for the voice lab's walkthrough section.
export const SKETCHES: { name: string; source: string }[] = [
  {
    name: "Job retries",
    source: `# sketch Job retries
direction: right

api: box "API server" tag "Service"
queue: box "Queue" tag "Redis"
worker: box "Worker" tag "Service"
dlq: box "Dead letters" red tag "Redis"
retry: note
  ## Retry rule
  \`\`\`ts
  if (job.attempts < 2) requeue(job);
  else moveToDeadLetters(job);
  \`\`\`

api -> queue "enqueue"
queue -> worker "take job"
worker -> dlq "after 2 retries" red
retry -> worker

step: api queue
  A request comes in. The [API server](api) doesn't do the work itself. It puts a job on the [queue](queue), and answers straight away.
step: worker
  A [worker](worker) takes jobs off the queue, one at a time.
step: retry dlq
  Work can fail. When it does, the [retry rule](retry) puts the job back on the queue, but only twice. After that, it lands in [dead letters](dlq), where nothing is lost.
step: api worker
  So the [API](api) stays fast, and the [worker](worker) does the slow part.
`,
  },
  {
    name: "Sign-in",
    source: `# sketch Sign-in
direction: right

browser: box "Browser"
app: box "Web app" tag "Client"
authkit: box "AuthKit" tag "WorkOS"
fn: box "Token exchange" tag "Function"
store: box "Firestore" tag "Database"
claims: note
  ## Custom token
  \`\`\`ts
  type Claims = { uid: string; org?: string; admin?: boolean };
  \`\`\`
  The function signs it with the service account; the web app never sees a secret.
edge: group "Google Cloud" of fn store

browser -> app "open /sketches"
app -> authkit "redirect"
authkit -> app "code"
app -> fn "exchange code"
fn -> store "user + orgs"
fn -> app "custom token"
claims -> fn

step: browser app
  You open the [web app](app) in your [browser](browser).
step: authkit
  You're not signed in, so the app sends you to [AuthKit](authkit). You sign in there, and it sends you back with a code.
step: edge claims
  The app hands that code to the [token exchange](fn). It looks you up in [Firestore](store), with your organizations, and signs a [custom token](claims) with your claims.
step: app
  From then on, the [app](app) talks to Firestore as you, and the security rules check every read.
`,
  },
];
