import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Centavos no formato do campo: 11200 → "112,00". */
export const centsToInput = (cents: number) =>
  (Math.max(0, cents) / 100).toFixed(2).replace('.', ',');

/** Campo de valor em reais; o texto é convertido com parseCents de @muquifo/contracts. */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  autoFocus,
  className,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        className={cn(
          'h-11 pl-10 text-lg font-semibold tabular md:text-lg',
          className,
        )}
        value={value}
        placeholder={placeholder ?? '0,00'}
        aria-invalid={invalid || undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ''))}
      />
    </div>
  );
}
