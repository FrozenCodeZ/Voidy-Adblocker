// Spotify ad muting (src/spotify-mute.js reports "an ad is playing"; the
// background mutes the tab). Voidy only ever unmutes a tab it muted itself, and
// stops managing a tab as soon as the person mutes or unmutes it.
//   record:    { byVoidy: true } while Voidy's own mute is active, else null
//   mutedInfo: the tab's mutedInfo ({ muted, reason })
//   adOn:      an ad is playing now
// Returns "mute", "unmute", "forget" (drop the record, change nothing) or "none".
globalThis.VOIDY_MUTE = (() => {
  function muteDecision(record, mutedInfo, adOn) {
    const muted = !!(mutedInfo && mutedInfo.muted), byExtension = muted && mutedInfo.reason === "extension";
    if (record) {
      if (!muted || !byExtension) return "forget";   // the person changed it: theirs now
      return adOn ? "none" : "unmute";
    }
    return adOn && !muted ? "mute" : "none";
  }
  return { muteDecision };
})();
