import type { ExactPrice } from './market-metrics';

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const imbalanceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const unavailable = '—';

/** Format nonnegative integer cents or an exact cents ratio; ties round up to a cent. */
export function formatUsd(price: number | ExactPrice | null): string {
  if (price === null) {
    return unavailable;
  }

  const numeratorCents = typeof price === 'number' ? BigInt(price) : price.numeratorCents;
  const denominator = typeof price === 'number' ? 1n : price.denominator;

  if (denominator === 0n) {
    return unavailable;
  }

  const wholeCents = numeratorCents / denominator;
  const remainder = numeratorCents % denominator;
  const roundedCents = wholeCents + (remainder * 2n >= denominator ? 1n : 0n);
  const dollars = integerFormat.format(roundedCents / 100n);
  const cents = (roundedCents % 100n).toString().padStart(2, '0');

  return `$${dollars}.${cents}`;
}

export function formatVolume(volume: bigint): string {
  return integerFormat.format(volume);
}

/** Display the derived ratio with two decimals, normalizing a rounded negative zero. */
export function formatImbalance(imbalance: number | null): string {
  if (imbalance === null) {
    return unavailable;
  }

  const formatted = imbalanceFormat.format(imbalance);

  return formatted === '-0.00' ? '0.00' : formatted;
}
