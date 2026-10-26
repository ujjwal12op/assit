function isImplementationRequest(question) {
  const text = String(question || '').toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return false;

  if (/\b(?:code|coding|query|function|program|script|algorithm|implement(?:ation)?|write a class)\b/.test(text)) return true;

  const asksHowToImplement = /\b(?:how (?:do|would|will|can|could) (?:i|you|we) |how to |show me how to |give me how (?:to|you) )?(?:find|calculate|return|select|get|rank|sort|filter|join|execute|run|build|create|design|solve|implement|process|transform)\b/.test(text);
  const structuredTask = /\b(?:(?:second|2nd|third|3rd|fourth|4th|\d+(?:st|nd|rd|th))\s+highest|highest|lowest|top\s+\d+|nth\s+highest|duplicate|deduplicate|running total|moving average)\b/.test(text)
    && /\b(?:salary|salaries|value|values|record|records|row|rows|table|database|array|list|element|elements|number|numbers|amount|amounts)\b/.test(text);
  const actionableTarget = asksHowToImplement
    && /\b(?:table|database|data|rows?|records?|array|list|elements?|salary|salaries|numbers?|values?|query|result|output)\b/.test(text);
  return structuredTask || actionableTarget;
}

function inferImplementationLanguage(question) {
  const text = String(question || '').toLowerCase();
  if (/\b(?:in|using|written in|coded in|implemented in)\s+(?:python|javascript|typescript|java|c\+\+|c#|go|golang|rust|scala|bash)\b/.test(text)) return '';
  const salaryRanking = /\b(?:(?:second|2nd|third|3rd|fourth|4th|\d+(?:st|nd|rd|th))\s+highest|highest|lowest|top\s+\d+|nth\s+highest)\b/.test(text)
    && /\b(?:salary|salaries)\b/.test(text)
    && /\b(?:table|database|row|rows|record|records)\b/.test(text);
  return salaryRanking ? 'SQL' : '';
}

module.exports = { isImplementationRequest, inferImplementationLanguage };
