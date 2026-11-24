// Whether this person is on a team (docs/plan-cloud-voice.md): GET
// /api/voice/access, asked once a load per user. Hosted voices are a team's
// setting, so this no longer returns a personal list.
import { useEffect, useState } from "react";
import { functionsBase } from "../config";
import { firebase } from "../firebase";

export type CloudAccess = { status: "loading" | "ready"; voices: []; onTeam: boolean };
const asked = new Map<string, Promise<{ onTeam: boolean }>>();

function ask(uid: string): Promise<{ onTeam: boolean }> {
  let answer = asked.get(uid);
  if (!answer) {
    answer = (async () => {
      const token = await firebase().auth.currentUser?.getIdToken();
      if (!token) return { onTeam: false };
      const response = await fetch(`${functionsBase}/voice/access`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) return { onTeam: false };
      const body = (await response.json()) as { onTeam?: boolean };
      return { onTeam: Boolean(body.onTeam) };
    })().catch(() => ({ onTeam: false }));
    asked.set(uid, answer);
  }
  return answer;
}

export function useCloudAccess(uid: string): CloudAccess {
  const [access, setAccess] = useState<CloudAccess>({ status: uid ? "loading" : "ready", voices: [], onTeam: false });
  useEffect(() => {
    if (!uid) {
      setAccess({ status: "ready", voices: [], onTeam: false });
      return;
    }
    let live = true;
    setAccess({ status: "loading", voices: [], onTeam: false });
    void ask(uid).then((next) => live && setAccess({ status: "ready", voices: [], onTeam: next.onTeam }));
    return () => {
      live = false;
    };
  }, [uid]);
  return access;
}
