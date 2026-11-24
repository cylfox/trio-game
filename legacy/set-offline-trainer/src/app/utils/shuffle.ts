// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
// The new ES6 allows us to assign two variables at once. This is especially
// handy when we want to swap the values of two variables, as we can do it in one
// line of code. Here is a shorter form of the same function, using this feature.
export function shuffle(array: any) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
