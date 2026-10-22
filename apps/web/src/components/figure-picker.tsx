import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { figureGroups } from '@/lib/figures';
import { cn } from '@/lib/utils';

/** Figura grande num quadro; usada no cardápio e no cadastro. */
export function FigureTile({
  emoji,
  size = 'md',
  className,
}: {
  emoji: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-xl bg-muted/60 leading-none select-none',
        {
          sm: 'size-9 text-xl',
          md: 'size-12 text-3xl',
          lg: 'size-16 text-4xl',
          xl: 'size-28 rounded-3xl text-7xl',
        }[size],
        className,
      )}
    >
      {emoji}
    </span>
  );
}

/** Grade de figuras para trocar a do item. */
export function FigurePicker({
  open,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escolha a figura</DialogTitle>
          <DialogDescription>
            Ajuda o garçom a achar o item rápido.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
          {figureGroups.map((g) => (
            <section key={g.title} className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {g.title}
              </h3>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                {g.figures.map((f) => (
                  <button
                    key={f.emoji}
                    type="button"
                    title={f.label}
                    aria-label={f.label}
                    aria-pressed={f.emoji === value}
                    onClick={() => {
                      onPick(f.emoji);
                      onClose();
                    }}
                    className={cn(
                      'grid aspect-square place-items-center rounded-xl border text-3xl transition hover:bg-accent active:scale-95',
                      f.emoji === value && 'border-primary bg-primary/10',
                    )}
                  >
                    {f.emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
