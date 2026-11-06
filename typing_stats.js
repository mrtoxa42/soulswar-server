'use strict';
function tap(actor, correct) {
  actor.typing ||= { correct: 0, errors: 0, words: 0 };
  actor.typing[correct ? 'correct' : 'errors']++;
}
function word(actor) {
  actor.typing ||= { correct: 0, errors: 0, words: 0 };
  actor.typing.words++;
}
function summary(actor, seconds) {
  const data = actor.typing || { correct: 0, errors: 0, words: 0 };
  const strokes = data.correct + data.errors;
  return {
    ...data,
    seconds: Math.max(0, seconds),
    wpm: seconds > 0 ? Math.round((data.correct / 5 / (seconds / 60)) * 10) / 10 : 0,
    accuracy: strokes ? Math.round((data.correct / strokes) * 1000) / 10 : 100,
  };
}
module.exports = { tap, word, summary };
