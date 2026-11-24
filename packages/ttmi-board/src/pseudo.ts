import type { LanguageFn } from "lowlight";

// Pseudo code: a plan, a status list or a mechanism that is not valid in any
// language. It colours comments, strings and numbers only, so words that
// happen to be keywords elsewhere ("with", "in", "type") stay plain. Single
// quotes are left alone: in pseudo code they are mostly apostrophes.
export const pseudo: LanguageFn = (hljs) => ({
  name: "Pseudo code",
  aliases: ["pseudocode"],
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.QUOTE_STRING_MODE,
    { scope: "string", begin: "`", end: "`" },
    hljs.C_NUMBER_MODE,
  ],
});
