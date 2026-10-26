(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpeechBuffer = api;
})(globalThis, function () {
  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function merge(previous, incoming) {
    const left = String(previous || '').trim();
    const right = String(incoming || '').trim();
    if (!left) return right;
    if (!right) return left;
    const leftNorm = normalize(left);
    const rightNorm = normalize(right);
    if (leftNorm === rightNorm || leftNorm.startsWith(rightNorm + ' ')) return left;
    if (rightNorm.startsWith(leftNorm + ' ')) return right;
    const leftWords = left.split(/\s+/);
    const rightWords = right.split(/\s+/);
    let overlap = Math.min(leftWords.length, rightWords.length);
    while (overlap > 0 && normalize(leftWords.slice(-overlap).join(' ')) !== normalize(rightWords.slice(0, overlap).join(' '))) overlap--;
    return `${left} ${rightWords.slice(overlap).join(' ')}`.trim();
  }

  const readbackFillers = new Set(['about', 'after', 'again', 'also', 'because', 'could', 'every', 'first', 'from', 'have', 'just', 'more', 'most', 'over', 'same', 'some', 'that', 'their', 'there', 'these', 'they', 'this', 'through', 'under', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your']);
  function contentWords(value) {
    return normalize(value).split(' ').filter((word) => word.length > 2 && !readbackFillers.has(word));
  }

  function looksLikeReadback(spokenText, suggestionText) {
    const spoken = contentWords(spokenText);
    const suggestion = contentWords(suggestionText);
    if (spoken.length < 2 || !suggestion.length) return false;

    // Use token occurrences rather than a set so short speech-recognition
    // chunks can be matched without requiring five unique recognized words.
    const suggestionCounts = new Map();
    for (const word of suggestion) suggestionCounts.set(word, (suggestionCounts.get(word) || 0) + 1);
    let shared = 0;
    for (const word of spoken) {
      const count = suggestionCounts.get(word) || 0;
      if (count > 0) { shared++; suggestionCounts.set(word, count - 1); }
    }
    if (spoken.length <= 5) return shared >= 2 && shared / spoken.length >= 0.67;
    if (shared >= 4 && shared / spoken.length >= 0.62) return true;

    // ASR may return only the start of the answer or slightly reorder a phrase.
    let orderedMatches = 0;
    let cursor = 0;
    for (const word of spoken) {
      const found = suggestion.indexOf(word, cursor);
      if (found >= 0) { orderedMatches++; cursor = found + 1; }
    }
    return orderedMatches >= 3 && orderedMatches / spoken.length >= 0.58;
  }

  function looksLikeCandidateAcknowledgment(utterance) {
    const text = String(utterance || '').trim().toLowerCase().replace(/[^a-z0-9'?\s]/g, ' ').replace(/\s+/g, ' ');
    const withoutLead = text.replace(/^(?:right|yeah|yes|okay|ok|alright|exactly|correct|sure|i see|got it|so)[,\s]+/, '').trim();
    // Do not swallow an actual follow-up request just because it starts with
    // “right” or “okay”.
    if (/^(?:can|could|would|will|should|do|does|did|what|why|how|when|where|who|which|explain|apply|use|show|give|write|find|tell|describe|compare|solve|provide)\b/.test(withoutLead)) return false;
    return /^(?:right|yeah|yes|okay|ok|alright|exactly|correct|sure|i see|got it)\b/.test(text)
      && /\b(?:you(?:'re| are) saying|you(?:'re| are) correct|that(?:'s| is) correct|i agree|makes sense|as you said|as you mentioned|that is right|that sounds right)\b/.test(text);
  }

  return { merge, normalize, looksLikeReadback, looksLikeCandidateAcknowledgment };
});
