// Which note a walkthrough stop draws open because the voice named it
// (docs/board.md, Notes fold). A pointing left over from the previous
// stop does not count, and neither does hearing the same pointing again
// (the open note was measured, or the camera moved): only a pointing that
// changes while this stop is on screen opens a note. A note opened for
// an earlier stop is closed.
export type HeardNote = { step: number; name: string };
export type HeardCursor = { playing: number | undefined; pointing: string | undefined };

export function noteHeard(input: {
  playing: number | undefined;
  pointing: string | undefined;
  // The pointing names a note on the board.
  isNote: boolean;
  previous: HeardCursor;
  said: HeardNote | undefined;
}): { said: HeardNote | undefined; previous: HeardCursor } {
  const previous = { playing: input.playing, pointing: input.pointing };
  const kept = input.said?.step === input.playing ? input.said : undefined;
  const pointingChanged = input.previous.pointing !== input.pointing;
  if (input.playing === undefined || !input.pointing || !input.isNote || !pointingChanged) return { said: kept, previous };
  return { said: { step: input.playing, name: input.pointing }, previous };
}

// Whether the voice's pointing may move the camera (docs/plan-voice-cues.md).
// A pointing left over from the previous stop does not, including when the
// note it named is measured again as it folds: that measurement arrives
// after the new stop has framed the view. A pointing that changes on the
// stop now showing does, and so does that shape changing size afterwards.
export function cameraFollows(input: {
  playing: number | undefined;
  pointing: string | undefined;
  // The pointing last taken up, and the stop it was taken up on.
  followed: HeardCursor;
}): { follow: boolean; followed: HeardCursor } {
  if (input.playing === undefined || !input.pointing) return { follow: false, followed: { playing: input.playing, pointing: undefined } };
  // The stop changed under the same pointing: it still belongs to the stop just left.
  const carried = input.followed.playing !== input.playing && input.followed.pointing === input.pointing;
  if (carried) return { follow: false, followed: input.followed };
  return { follow: true, followed: { playing: input.playing, pointing: input.pointing } };
}
