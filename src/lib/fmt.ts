import type { Money } from '@/schemas'

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: money.cents % 100 === 0 ? 0 : 2,
  }).format(money.cents / 100)
}
