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

  return { merge, normalize };
});
