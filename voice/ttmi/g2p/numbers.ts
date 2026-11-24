// Whole numbers as English words, the way num2words says them and misaki
// reads them (no "and"). Decimals, times and money are written out before
// this by normalize.ts.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
  [100, "hundred"],
];

export function cardinal(n: number): string {
  if (n < 0) return `minus ${cardinal(-n)}`;
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  for (const [size, name] of SCALES) {
    if (n < size) continue;
    const rest = n % size;
    return `${cardinal(Math.floor(n / size))} ${name}${rest ? ` ${cardinal(rest)}` : ""}`;
  }
  return String(n);
}

const IRREGULAR: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

export function ordinal(n: number): string {
  const words = cardinal(n);
  const last = words.match(/[a-z]+$/)![0];
  const head = words.slice(0, -last.length);
  if (IRREGULAR[last]) return head + IRREGULAR[last];
  if (last.endsWith("y")) return `${head}${last.slice(0, -1)}ieth`;
  return `${head}${last}th`;
}
