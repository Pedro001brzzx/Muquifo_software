import type { LoginUser } from '@muquifo/contracts';
import { cn } from '@/lib/utils';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Cor pela função: dono (laranja), caixa (verde), garçom (cinza). */
const roleTone: Record<LoginUser['role'], string> = {
  owner: 'bg-primary text-primary-foreground',
  cashier: 'bg-free text-white',
  waiter: 'bg-muted-foreground/80 text-background',
};

/** Iniciais do nome num círculo, para achar a pessoa rápido na entrada. */
export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<LoginUser, 'name' | 'role'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        roleTone[user.role],
        size === 'sm' && 'size-8 text-xs',
        size === 'md' && 'size-14 text-lg',
        size === 'lg' && 'size-20 text-2xl',
      )}
    >
      {initials(user.name)}
    </span>
  );
}
