export function createSeed(): number {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0] || Date.now();
}

export function nextSeed(seed: number): number {
  return (seed * 1664525 + 1013904223) >>> 0;
}

export function shuffleWithSeed<T>(items: T[], seed: number): { items: T[]; seed: number } {
  const shuffled = [...items];
  let next = seed;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    next = nextSeed(next);
    const swapIndex = next % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return { items: shuffled, seed: next };
}
